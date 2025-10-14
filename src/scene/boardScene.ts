import {
  AdditiveBlending,
  AmbientLight,
  BufferGeometry,
  Clock,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  PMREMGenerator,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createPieceMesh, PieceColor, PieceKind } from "./pieceFactory";
import { Move as ChessJsMove } from "chess.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

type Square = ChessJsMove["from"];

type Listener<T> = (payload: T) => void;

type PieceObject = {
  mesh: Group;
  color: PieceColor;
  kind: PieceKind;
  square: Square;
};

type BoardSceneEvents = {
  squareSelected: Square;
};

type Tween = {
  elapsed: number;
  duration: number;
  easing: (t: number) => number;
  update: (t: number) => void;
  resolve: () => void;
};

const tileSize = 1.25;
const boardOffset = -((8 - 1) * tileSize) / 2;

type ParticleBurst = {
  points: Points;
  velocities: Float32Array;
  material: PointsMaterial;
  life: number;
  maxLife: number;
};

export class BoardScene {
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly tweens = new Set<Tween>();
  private readonly eventListeners: { [K in keyof BoardSceneEvents]: Set<Listener<BoardSceneEvents[K]>> } = {
    squareSelected: new Set()
  };
  private readonly clock = new Clock();
  private animationSpeed = 1;
  private vfxIntensity = 1;

  private pieces = new Map<Square, PieceObject>();
  private hoveredSquare: Square | null = null;
  private particleBursts: ParticleBurst[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setClearColor(new Color("#05070d"));

    const pmrem = new PMREMGenerator(this.renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTexture;
    pmrem.dispose();

    this.camera = new PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(8.5, 9.5, 11.5);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.75, 0);
    this.controls.maxPolarAngle = Math.PI * 0.88;
    this.controls.minDistance = 7.5;
    this.controls.maxDistance = 20;

    this.setupScene();
    window.addEventListener("resize", this.onResize);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    this.onResize();
    this.animate();
  }

  dispose() {
    window.removeEventListener("resize", this.onResize);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.controls.dispose();
    this.renderer.dispose();
    this.disposeParticles();
  }

  setAnimationSpeed(multiplier: number) {
    this.animationSpeed = multiplier;
  }

  setVfxIntensity(value: number) {
    this.vfxIntensity = value;
  }

  on<K extends keyof BoardSceneEvents>(event: K, listener: Listener<BoardSceneEvents[K]>) {
    this.eventListeners[event].add(listener);
    return () => this.eventListeners[event].delete(listener);
  }

  loadPosition(fenBoard: ({ type: PieceKind; color: PieceColor } | null)[][]) {
    this.clearPieces();
    fenBoard.forEach((rank, rankIndex) => {
      rank.forEach((cell, fileIndex) => {
        if (!cell) return;
        const square = squareFromIndices(fileIndex, 7 - rankIndex);
        this.addPiece(square, cell.type, cell.color);
      });
    });
  }

  getPiece(square: Square): PieceObject | null {
    return this.pieces.get(square) ?? null;
  }

  getSquarePosition(square: Square): Vector3 {
    return squareToVector(square).clone();
  }

  async playMove(move: ChessJsMove, options: { captured?: PieceObject | null } = {}) {
    const piece = this.pieces.get(move.from);
    if (!piece) return;

    const start = squareToVector(move.from);
    const target = squareToVector(move.to);
    const captured = options.captured ?? null;

    let captureHandled = false;
    if (captured) {
      captureHandled = await this.animatePieceAttack(piece, move, start, target, captured);
    } else {
      await this.animatePieceTravel(piece, move, start, target);
    }

    this.pieces.delete(move.from);
    piece.square = move.to;

    if (!captureHandled && captured) {
      await this.captureEffect(captured);
    }

    if (move.promotion) {
      this.scene.remove(piece.mesh);
      const promoted = createPieceMesh(piece.color, move.promotion as PieceKind);
      promoted.position.copy(target);
      promoted.castShadow = true;
      this.scene.add(promoted);
      this.pieces.set(move.to, {
        mesh: promoted,
        color: piece.color,
        kind: move.promotion as PieceKind,
        square: move.to
      });
    } else {
      piece.mesh.position.copy(target);
      piece.mesh.rotation.set(0, 0, 0);
      this.pieces.set(move.to, piece);
    }

    if (move.flags.includes("k") || move.flags.includes("q")) {
      await this.handleCastling(move);
    }
  }

  async captureEffect(piece: PieceObject) {
    const mesh = piece.mesh;
    this.pieces.delete(piece.square);

    const startY = mesh.position.y;
    const randomRotation = (Math.random() - 0.5) * Math.PI * 1.5;
    if (this.vfxIntensity > 0.05) {
      this.spawnCaptureBurst(mesh.position.clone());
    }

    await this.tween(0.25 / this.animationSpeed, (t) => {
      mesh.scale.setScalar(1 - t * 0.3);
      mesh.rotation.y = randomRotation * t;
      mesh.position.y = startY + 0.8 * easeOutCubic(t);
    });

    await this.tween(0.35 / this.animationSpeed, (t) => {
      mesh.position.y = startY + 0.8 - 1.2 * easeInQuad(t);
      mesh.scale.setScalar(0.7 - 0.7 * t);
      mesh.rotation.x = randomRotation * t;
    });

    mesh.visible = false;
    this.scene.remove(mesh);
  }

  removePiece(square: Square) {
    const piece = this.pieces.get(square);
    if (piece) {
      piece.mesh.visible = false;
      this.pieces.delete(square);
    }
  }

  highlightSquares(squares: Square[]) {
    this.tiles.forEach((tile) => tile.material.color.set(tile.userData.baseColor));
    squares.forEach((square) => {
      const tile = this.tiles.find((t) => t.userData.square === square);
      if (tile) {
        tile.material.color.set("#6ed0ff");
      }
    });
  }

  private addPiece(square: Square, kind: PieceKind, color: PieceColor) {
    const mesh = createPieceMesh(color, kind);
    mesh.position.copy(squareToVector(square));
    this.scene.add(mesh);
    this.pieces.set(square, { mesh, color, kind, square });
  }

  private async handleCastling(move: ChessJsMove) {
    const isKingSide = move.to.charCodeAt(0) > move.from.charCodeAt(0);
    const rank = move.from[1];
    const rookFrom = ((isKingSide ? "h" : "a") + rank) as Square;
    const rookTo = ((isKingSide ? "f" : "d") + rank) as Square;
    const rook = this.pieces.get(rookFrom);
    if (!rook) return;

    const start = squareToVector(rookFrom);
    const end = squareToVector(rookTo);
    const mesh = rook.mesh;

    await this.tween(0.28 / this.animationSpeed, (t) => {
      mesh.position.lerpVectors(start, end, t);
      mesh.position.y = 0.2 * Math.sin(Math.PI * t);
    });

    mesh.position.copy(end);
    this.pieces.delete(rookFrom);
    rook.square = rookTo;
    this.pieces.set(rookTo, rook);
  }

  private async animatePieceTravel(
    piece: PieceObject,
    move: ChessJsMove,
    start: Vector3,
    target: Vector3
  ) {
    const mesh = piece.mesh;
    mesh.position.copy(start);
    mesh.rotation.set(0, 0, 0);
    const durationFactor = 1 / this.animationSpeed;

    switch (piece.kind) {
      case "p":
        await this.travelArc(mesh, start, target, 0.45, 0.42 * durationFactor, easeInOutQuad);
        await this.tween(0.14 * durationFactor, (t) => {
          mesh.position.y = (1 - t) * 0.15;
        });
        break;
      case "n":
        await this.tween(0.58 * durationFactor, (t) => {
          const eased = easeInOutQuad(t);
          mesh.position.lerpVectors(start, target, eased);
          mesh.position.y = Math.sin(Math.PI * eased) * 2.3;
          mesh.rotation.z = Math.sin(Math.PI * eased) * 0.35;
          mesh.rotation.y = startAngle(move.from, move.to) * eased;
        });
        await this.tween(0.18 * durationFactor, (t) => {
          mesh.position.y = (1 - t) * 0.45;
          mesh.rotation.z *= 1 - t;
        });
        break;
      case "b":
        await this.tween(0.5 * durationFactor, (t) => {
          const eased = easeInOutQuad(t);
          mesh.position.lerpVectors(start, target, eased);
          mesh.position.y = Math.sin(Math.PI * eased) * 0.7;
          mesh.rotation.y = startAngle(move.from, move.to);
          mesh.rotation.z = eased * 0.25;
        });
        await this.tween(0.14 * durationFactor, (t) => {
          mesh.rotation.z = (1 - t) * 0.25;
        });
        break;
      case "r":
        {
          const pre = start.clone().lerp(target, 0.08);
          await this.tween(0.16 * durationFactor, (t) => {
            const eased = easeOutQuad(1 - t);
            mesh.position.lerpVectors(start, pre, eased);
            mesh.position.y = eased * 0.1;
          });
          await this.tween(0.32 * durationFactor, (t) => {
            const eased = easeInQuad(t);
            mesh.position.lerpVectors(pre, target, eased);
            mesh.position.y = (1 - eased) * 0.12;
          });
          await this.tween(0.12 * durationFactor, (t) => {
            mesh.position.y = (1 - t) * 0.1;
          });
        }
        break;
      case "q":
        {
          const mid = start.clone().lerp(target, 0.5);
          await this.tween(0.54 * durationFactor, (t) => {
            const eased = easeInOutQuad(t);
            const orbitAngle = (Math.PI * 1.5) * eased;
            const radius = 0.35 * (1 - eased) + 0.1;
            const swing = new Vector3(
              Math.cos(orbitAngle) * radius,
              Math.sin(Math.PI * eased) * 0.9,
              Math.sin(orbitAngle) * radius
            );
            mesh.position.copy(mid).add(swing);
            mesh.position.lerp(target, eased * 0.8);
            mesh.rotation.y = orbitAngle;
          });
          await this.tween(0.16 * durationFactor, (t) => {
            mesh.position.lerpVectors(mesh.position, target, t);
            mesh.rotation.y *= 1 - t;
          });
        }
        break;
      case "k":
        await this.tween(0.5 * durationFactor, (t) => {
          const eased = easeInOutQuad(t);
          mesh.position.lerpVectors(start, target, eased);
          mesh.position.y = Math.sin(Math.PI * eased) * 0.35;
          mesh.rotation.y = startAngle(move.from, move.to) * 0.5;
        });
        await this.tween(0.18 * durationFactor, (t) => {
          mesh.position.y = (1 - t) * 0.2;
          mesh.rotation.y *= 1 - t;
        });
        break;
      default:
        await this.travelArc(mesh, start, target, 0.4, 0.45 * durationFactor, easeInOutQuad);
    }
    mesh.position.copy(target);
    mesh.rotation.set(0, 0, 0);
  }

  private async animatePieceAttack(
    piece: PieceObject,
    move: ChessJsMove,
    start: Vector3,
    target: Vector3,
    captured: PieceObject
  ): Promise<boolean> {
    const mesh = piece.mesh;
    mesh.position.copy(start);
    mesh.rotation.set(0, 0, 0);
    const durationFactor = 1 / this.animationSpeed;
    let handledCapture = false;

    switch (piece.kind) {
      case "p": {
        const mid = start.clone().lerp(target, 0.45);
        await this.tween(0.22 * durationFactor, (t) => {
          const eased = easeOutQuad(t);
          mesh.position.lerpVectors(start, mid, eased);
          mesh.position.y = Math.sin(Math.PI * eased) * 0.45;
          mesh.rotation.z = -0.4 * eased;
        });
        await this.captureEffect(captured);
        handledCapture = true;
        await this.tween(0.26 * durationFactor, (t) => {
          const eased = easeOutBack(t);
          mesh.position.lerpVectors(mid, target, eased);
          mesh.rotation.z = -0.4 * (1 - t);
        });
        break;
      }
      case "n": {
        await this.tween(0.45 * durationFactor, (t) => {
          const eased = easeOutQuad(t);
          mesh.position.lerpVectors(start, target, eased);
          mesh.position.y = Math.sin(Math.PI * eased) * 2.8;
          mesh.rotation.y = startAngle(move.from, move.to) * eased;
          mesh.rotation.x = Math.sin(Math.PI * eased) * 0.5;
        });
        await this.captureEffect(captured);
        handledCapture = true;
        await this.tween(0.22 * durationFactor, (t) => {
          mesh.position.y = (1 - t) * 0.5;
          mesh.rotation.x = (1 - t) * 0.5;
        });
        break;
      }
      case "b": {
        const slashEnd = target.clone().add(new Vector3(0, 0, 0));
        await this.tween(0.32 * durationFactor, (t) => {
          const eased = easeInQuad(t);
          mesh.position.lerpVectors(start, target, eased);
          mesh.position.y = Math.sin(Math.PI * eased) * 0.9;
          mesh.rotation.y = startAngle(move.from, move.to) + eased * Math.PI * 1.25;
        });
        await this.captureEffect(captured);
        handledCapture = true;
        await this.tween(0.18 * durationFactor, (t) => {
          mesh.position.lerpVectors(mesh.position, slashEnd, t);
          mesh.rotation.y *= 1 - t * 0.4;
        });
        break;
      }
      case "r": {
        const windup = start.clone().lerp(target, -0.1);
        await this.tween(0.18 * durationFactor, (t) => {
          const eased = easeOutQuad(t);
          mesh.position.lerpVectors(start, windup, eased);
          mesh.position.y = eased * 0.2;
        });
        await this.tween(0.18 * durationFactor, (t) => {
          const eased = easeInQuad(t);
          mesh.position.lerpVectors(windup, target, eased);
          mesh.position.y = (1 - eased) * 0.28;
        });
        await this.captureEffect(captured);
        handledCapture = true;
        await this.tween(0.16 * durationFactor, (t) => {
          mesh.position.y = (1 - t) * 0.2;
        });
        break;
      }
      case "q": {
        const loop = start.clone().lerp(target, 0.5);
        await this.tween(0.34 * durationFactor, (t) => {
          const eased = easeInOutQuad(t);
          const orbit = (Math.PI * 2) * eased;
          const radius = 0.55 - eased * 0.35;
          mesh.position.set(
            loop.x + Math.cos(orbit) * radius,
            Math.sin(Math.PI * eased) * 1.2,
            loop.z + Math.sin(orbit) * radius
          );
          mesh.position.lerp(target, eased * 0.6);
          mesh.rotation.y = orbit;
        });
        await this.captureEffect(captured);
        handledCapture = true;
        await this.tween(0.22 * durationFactor, (t) => {
          mesh.position.lerpVectors(mesh.position, target, t);
          mesh.rotation.y *= 1 - t;
        });
        break;
      }
      case "k": {
        await this.tween(0.26 * durationFactor, (t) => {
          const eased = easeOutQuad(t);
          mesh.position.lerpVectors(start, target, eased);
          mesh.position.y = Math.sin(Math.PI * eased) * 0.5;
          mesh.scale.setScalar(1 + eased * 0.05);
        });
        await this.captureEffect(captured);
        handledCapture = true;
        await this.tween(0.2 * durationFactor, (t) => {
          mesh.position.y = (1 - t) * 0.4;
          mesh.scale.setScalar(1 + (1 - t) * 0.05);
        });
        break;
      }
      default:
        await this.travelArc(mesh, start, target, 0.5, 0.45 * durationFactor, easeInOutQuad);
    }

    mesh.position.copy(target);
    mesh.rotation.set(0, 0, 0);
    if (handledCapture) {
      await this.cinematicHit(target, this.cinematicIntensity(piece.kind));
    }
    return handledCapture;
  }

  private async travelArc(
    mesh: Group | Mesh,
    from: Vector3,
    to: Vector3,
    peakHeight: number,
    duration: number,
    easing: (t: number) => number
  ) {
    await this.tween(duration, (t) => {
      const progress = easing(t);
      mesh.position.lerpVectors(from, to, progress);
      mesh.position.y = Math.sin(Math.PI * progress) * peakHeight;
    });
  }

  private async cinematicHit(target: Vector3, strength = 1) {
    const limited = MathUtils.clamp(strength, 0.7, 1.6);
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const focus = target.clone().setY(0.9);
    const direction = focus.clone().sub(startTarget);
    if (direction.lengthSq() < 0.0001) {
      direction.set(1, 0, 0);
    }
    direction.normalize();
    const side = new Vector3(-direction.z, 0, direction.x).normalize();
    const approach = focus
      .clone()
      .addScaledVector(direction, -2.4 * limited)
      .addScaledVector(side, 1.3 * limited)
      .add(new Vector3(0, 2.8 * limited, 0));

    await this.tween(0.2 / this.animationSpeed, (t) => {
      const eased = easeOutQuad(t);
      this.camera.position.lerpVectors(startPos, approach, eased);
      this.controls.target.lerpVectors(startTarget, focus, eased);
    });

    await this.tween(0.22 / this.animationSpeed, (t) => {
      const oscillation = Math.sin(t * Math.PI * 6) * 0.12 * limited;
      const vertical = Math.sin(t * Math.PI * 3) * 0.09 * limited;
      const offset = side.clone().multiplyScalar(oscillation);
      this.camera.position.copy(approach).add(offset).add(new Vector3(0, vertical, 0));
      this.controls.target.copy(focus).addScaledVector(side, oscillation * 0.45);
    });

    await this.tween(0.32 / this.animationSpeed, (t) => {
      const eased = easeInOutQuad(t);
      this.camera.position.lerpVectors(approach, startPos, eased);
      this.controls.target.lerpVectors(focus, startTarget, eased);
    });
    this.controls.update();
  }

  private cinematicIntensity(kind: PieceKind) {
    switch (kind) {
      case "q":
        return 1.4;
      case "r":
      case "n":
        return 1.1;
      case "b":
        return 1.0;
      case "k":
        return 1.3;
      default:
        return 0.8;
    }
  }

  private clearPieces() {
    for (const piece of this.pieces.values()) {
      this.scene.remove(piece.mesh);
    }
    this.pieces.clear();
  }

  private tiles: Mesh[] = [];

  private setupScene() {
    this.scene.fog = null;
    const floorMaterial = new MeshStandardMaterial({
      color: new Color("#07090f"),
      roughness: 0.92,
      metalness: 0.0
    });
    const floor = new Mesh(new PlaneGeometry(70, 70), floorMaterial);
    floor.receiveShadow = true;
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.51;
    this.scene.add(floor);

    const boardGroup = new Group();
    const darkColor = new Color("#2b3758");
    const lightColor = new Color("#f1f5ff");

    for (let file = 0; file < 8; file++) {
      for (let rank = 0; rank < 8; rank++) {
        const tile = new Mesh(
          new PlaneGeometry(tileSize, tileSize),
          new MeshStandardMaterial({
            color: (file + rank) % 2 === 0 ? lightColor : darkColor,
            roughness: 0.24,
            metalness: 0.08
          })
        );
        tile.rotation.x = -Math.PI / 2;
        tile.castShadow = false;
        tile.receiveShadow = true;
        tile.position.set(boardOffset + file * tileSize, 0, boardOffset + rank * tileSize);
        tile.userData.square = squareFromIndices(file, rank);
        tile.userData.baseColor = tile.material.color.clone();
        boardGroup.add(tile);
        this.tiles.push(tile);
      }
    }

    this.scene.add(boardGroup);

    const ambient = new AmbientLight("#3e5378", 0.75);
    const directional = new DirectionalLight("#ffffff", 1.25);
    directional.position.set(7, 11, 8);
    directional.castShadow = true;
    directional.shadow.mapSize.set(2048, 2048);
    directional.shadow.camera.near = 1;
    directional.shadow.camera.far = 30;
    this.scene.add(ambient, directional);

    const backLight = new DirectionalLight("#2d9bff", 0.55);
    backLight.position.set(-7, 5, -10);
    this.scene.add(backLight);
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    const delta = this.clock.getDelta();
    this.updateTweens(delta);
    this.updateBursts(delta);
    this.renderer.render(this.scene, this.camera);
  };

  private updateTweens(delta: number) {
    const step = delta / Math.max(this.animationSpeed, 0.01);
    this.tweens.forEach((tween) => {
      tween.elapsed += step;
      const progress = Math.min(1, tween.elapsed / tween.duration);
      tween.update(tween.easing(progress));
      if (progress >= 1) {
        this.tweens.delete(tween);
        tween.resolve();
      }
    });
  }

  private updateBursts(delta: number) {
    for (let i = this.particleBursts.length - 1; i >= 0; i--) {
      const burst = this.particleBursts[i];
      burst.life += delta;
      const progress = burst.life / burst.maxLife;
      const positions = burst.points.geometry.getAttribute("position") as Float32BufferAttribute;
      const array = positions.array as Float32Array;
      for (let j = 0; j < burst.velocities.length; j += 3) {
        array[j] += burst.velocities[j] * delta;
        array[j + 1] += burst.velocities[j + 1] * delta;
        array[j + 2] += burst.velocities[j + 2] * delta;
        burst.velocities[j] *= 0.96;
        burst.velocities[j + 1] = burst.velocities[j + 1] * 0.94 - 2.5 * delta;
        burst.velocities[j + 2] *= 0.96;
      }
      positions.needsUpdate = true;
      burst.material.opacity = Math.max(0, 0.8 * (1 - progress));
      burst.material.size = Math.max(0.02, burst.material.size * (1 - delta * 1.8));
      if (progress >= 1) {
        this.scene.remove(burst.points);
        burst.points.geometry.dispose();
        burst.material.dispose();
        this.particleBursts.splice(i, 1);
      }
    }
  }

  private tween(duration: number, update: (progress: number) => void, easing: (t: number) => number = easeInOutQuad) {
    return new Promise<void>((resolve) => {
      this.tweens.add({
        elapsed: 0,
        duration,
        easing,
        update,
        resolve
      });
    });
  }

  private spawnCaptureBurst(position: Vector3) {
    const strength = Math.min(1.2, Math.max(0, this.vfxIntensity));
    const particleCount = Math.max(8, Math.floor(90 * strength));
    const geometry = new BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = (0.6 + Math.random() * 0.8) * (0.7 + strength * 0.6);
      const idx = i * 3;
      positions[idx] = 0;
      positions[idx + 1] = 0.4 * Math.random();
      positions[idx + 2] = 0;
      velocities[idx] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[idx + 1] = Math.cos(phi) * speed * 1.3;
      velocities[idx + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }

    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

    const material = new PointsMaterial({
      color: new Color("#9ad4ff"),
      size: 0.08 + strength * 0.05,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: AdditiveBlending
    });

    const points = new Points(geometry, material);
    points.position.copy(position);
    points.position.y += 0.3;
    this.scene.add(points);

    this.particleBursts.push({
      points,
      velocities,
      material,
      life: 0,
      maxLife: 0.6 + strength * 0.4
    });
  }

  private disposeParticles() {
    this.particleBursts.forEach((burst) => {
      this.scene.remove(burst.points);
      burst.points.geometry.dispose();
      burst.material.dispose();
    });
    this.particleBursts = [];
  }

  private onResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private onPointerMove = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.updateHoveredSquare();
  };

  private onPointerDown = () => {
    if (!this.hoveredSquare) return;
    this.emit("squareSelected", this.hoveredSquare);
  };

  private updateHoveredSquare() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(this.tiles, false);
    if (intersections.length > 0) {
      const tile = intersections[0].object as Mesh;
      this.hoveredSquare = tile.userData.square;
    } else {
      this.hoveredSquare = null;
    }
  }

  private emit<K extends keyof BoardSceneEvents>(event: K, payload: BoardSceneEvents[K]) {
    this.eventListeners[event].forEach((listener) => listener(payload));
  }
}

function squareToVector(square: Square) {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10) - 1;
  return new Vector3(boardOffset + file * tileSize, 0, boardOffset + rank * tileSize);
}

function squareFromIndices(file: number, rank: number): Square {
  const fileChar = String.fromCharCode(97 + file);
  const rankChar = String(rank + 1);
  return `${fileChar}${rankChar}` as Square;
}

function startAngle(from: Square, to: Square) {
  const start = squareToVector(from);
  const end = squareToVector(to);
  return Math.atan2(end.x - start.x, end.z - start.z);
}

function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function easeOutQuad(t: number) {
  return 1 - (1 - t) * (1 - t);
}

function easeOutCubic(t: number) {
  const inv = t - 1;
  return inv * inv * inv + 1;
}

function easeInQuad(t: number) {
  return t * t;
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
