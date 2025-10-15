import {
  AdditiveBlending,
  AmbientLight,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  BufferGeometry,
  Clock,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  LoopOnce,
  LoopRepeat,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  PMREMGenerator,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { createPieceMesh, PieceColor, PieceKind } from "./pieceFactory";
import { Move as ChessJsMove } from "chess.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

type Square = ChessJsMove["from"];

type Listener<T> = (payload: T) => void;

type AnimationLabel = "idle" | "move" | "attack" | "hit" | "death";
type AnimationBindings = Partial<Record<AnimationLabel, AnimationAction>>;

type PieceObject = {
  mesh: Group;
  color: PieceColor;
  kind: PieceKind;
  square: Square;
  battleAvatar?: PieceBattleAvatar;
};

type PieceBattleAvatar = {
  mesh: Group;
  mixer: AnimationMixer;
  animations: AnimationBindings;
  clips: Partial<Record<AnimationLabel, AnimationClip>>;
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
  private mixers = new Set<AnimationMixer>();
  private shakeDuration = 0;
  private shakeElapsed = 0;
  private shakeStrength = 0;
  private shakeOffset = new Vector3();
  private shakeTargetOffset = new Vector3();

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
      const prepared = this.preparePieceVisual(promoted);
      this.scene.add(promoted);
      const promotedPiece: PieceObject = {
        mesh: promoted,
        color: piece.color,
        kind: move.promotion as PieceKind,
        square: move.to,
        ...prepared
      };
      if (prepared.battleAvatar) {
        this.mixers.add(prepared.battleAvatar.mixer);
      }
      this.pieces.set(move.to, promotedPiece);
      this.playAnimation(promotedPiece, "idle", { fadeIn: 0.3, loop: "repeat" });
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
    const impactPosition = mesh.position.clone();
    this.pieces.delete(piece.square);
    this.playAnimation(piece, "death", { fadeIn: 0.1, loop: "once" });
    this.playAnimation(piece, "hit", { fadeIn: 0.05, loop: "once" });

    const startY = mesh.position.y;
    const randomRotation = (Math.random() - 0.5) * Math.PI * 1.5;
    if (this.vfxIntensity > 0.05) {
      this.spawnCaptureBurst(impactPosition.clone());
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
    if (piece.battleAvatar) {
      piece.battleAvatar.mixer.stopAllAction();
      this.mixers.delete(piece.battleAvatar.mixer);
    }
    this.spawnShockwave(impactPosition);
    this.shakeCamera(0.45 * this.vfxIntensity, 0.32 / this.animationSpeed);
  }

  removePiece(square: Square) {
    const piece = this.pieces.get(square);
    if (piece) {
      piece.mesh.visible = false;
      this.pieces.delete(square);
      if (piece.battleAvatar) {
        piece.battleAvatar.mixer.stopAllAction();
        this.mixers.delete(piece.battleAvatar.mixer);
      }
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
    const prepared = this.preparePieceVisual(mesh);
    this.scene.add(mesh);
    const piece: PieceObject = { mesh, color, kind, square, ...prepared };
    if (piece.battleAvatar) {
      this.mixers.add(piece.battleAvatar.mixer);
    }
    this.pieces.set(square, piece);
    this.playAnimation(piece, "idle", { fadeIn: 0.3, loop: "repeat" });
  }

  private preparePieceVisual(mesh: Group): Pick<PieceObject, "battleAvatar"> {
    const avatarMesh = mesh.userData?.battleAvatar as Group | undefined;
    if (!avatarMesh) {
      return {};
    }
    avatarMesh.visible = false;
    avatarMesh.removeFromParent();

    const clipDictionary =
      (avatarMesh.userData?.animationClips as Partial<Record<AnimationLabel, AnimationClip>> | undefined) ??
      {};
    const clips = { ...clipDictionary };
    const battleAvatar = this.createBattleAvatar(avatarMesh, clips);
    return { battleAvatar };
  }

  private playAnimation(
    piece: PieceObject,
    label: AnimationLabel,
    options: { fadeIn?: number; fadeOut?: number; loop?: "once" | "repeat"; timeScale?: number } = {}
  ) {
    if (!piece.battleAvatar) return;
    this.playAvatarAnimation(piece.battleAvatar, label, options);
  }

  private playAvatarAnimation(
    avatar: PieceBattleAvatar,
    label: AnimationLabel,
    options: { fadeIn?: number; fadeOut?: number; loop?: "once" | "repeat"; timeScale?: number } = {}
  ) {
    const action = avatar.animations[label];
    if (!action) return;
    const fadeIn = options.fadeIn ?? 0.2;
    const fadeOut = options.fadeOut ?? 0.2;
    const loopSetting = options.loop ?? (label === "idle" ? "repeat" : "once");
    const timeScale = options.timeScale ?? 1;

    Object.values(avatar.animations).forEach((other) => {
      if (other && other !== action) {
        other.fadeOut(fadeOut);
      }
    });

    action.reset();
    action.enabled = true;
    action.setEffectiveTimeScale(timeScale);
    if (loopSetting === "once") {
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    }
    action.fadeIn(fadeIn);
    action.play();
  }

  private createBattleAvatar(
    mesh: Group,
    clips: Partial<Record<AnimationLabel, AnimationClip>>
  ): PieceBattleAvatar {
    const mixer = new AnimationMixer(mesh);
    const animations: AnimationBindings = {};
    (Object.entries(clips) as [AnimationLabel, AnimationClip][]).forEach(([label, clip]) => {
      if (!clip) return;
      const action = mixer.clipAction(clip);
      if (label === "idle") {
        action.setLoop(LoopRepeat, Infinity);
        action.enabled = true;
        action.play();
      } else {
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      animations[label] = action;
    });
    return { mesh, mixer, animations, clips };
  }

  private cloneBattleAvatar(template: PieceBattleAvatar): PieceBattleAvatar {
    const clone = SkeletonUtils.clone(template.mesh) as Group;
    clone.scale.copy(template.mesh.scale);
    return this.createBattleAvatar(clone, template.clips);
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
    this.playAnimation(piece, "move", { fadeIn: 0.12, loop: "once" });

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
    this.playAnimation(piece, "idle", { fadeIn: 0.3, loop: "repeat" });
  }

  private async playDuel(
    attacker: PieceObject,
    defender: PieceObject,
    params: { start: Vector3; target: Vector3 }
  ) {
    const attackerTemplate = attacker.battleAvatar;
    const defenderTemplate = defender.battleAvatar;
    if (!attackerTemplate || !defenderTemplate) return;

    const attackerAvatar = this.cloneBattleAvatar(attackerTemplate);
    const defenderAvatar = this.cloneBattleAvatar(defenderTemplate);
    const { start, target } = params;

    const durationFactor = 1 / this.animationSpeed;
    const center = start.clone().lerp(target, 0.5);
    const forward = target.clone().sub(start).setY(0);
    if (forward.lengthSq() < 0.0001) {
      forward.set(0, 0, 1);
    }
    forward.normalize();

    const arenaOffset = 0.38;
    const attackerBase = center.clone().addScaledVector(forward, -arenaOffset);
    const defenderBase = center.clone().addScaledVector(forward, arenaOffset);
    const attackerWindup = attackerBase.clone().addScaledVector(forward, -0.22);
    const attackerLunge = attackerBase.clone().addScaledVector(forward, 0.28);
    const defenderRetreat = defenderBase.clone().addScaledVector(forward, 0.18);
    const defenderCounter = defenderBase.clone().addScaledVector(forward, -0.12);
    const defenderCollapse = defenderBase.clone().addScaledVector(forward, -0.2);

    attacker.mesh.visible = false;
    defender.mesh.visible = false;

    const attackerMesh = attackerAvatar.mesh;
    const defenderMesh = defenderAvatar.mesh;
    attackerMesh.position.copy(start);
    defenderMesh.position.copy(target);
    attackerMesh.rotation.set(0, 0, 0);
    defenderMesh.rotation.set(0, 0, 0);
    const facingAngle = Math.atan2(forward.x, forward.z);
    attackerMesh.rotation.y = facingAngle;
    defenderMesh.rotation.y = facingAngle + Math.PI;

    this.scene.add(attackerMesh, defenderMesh);
    this.mixers.add(attackerAvatar.mixer);
    this.mixers.add(defenderAvatar.mixer);

    const cleanup = () => {
      this.scene.remove(attackerMesh);
      this.scene.remove(defenderMesh);
      attackerAvatar.mixer.stopAllAction();
      defenderAvatar.mixer.stopAllAction();
      this.mixers.delete(attackerAvatar.mixer);
      this.mixers.delete(defenderAvatar.mixer);
    };

    try {
      await this.tween(0.18 * durationFactor, (t) => {
        const eased = easeInOutQuad(t);
        attackerMesh.position.lerpVectors(start, attackerBase, eased);
        defenderMesh.position.lerpVectors(target, defenderBase, eased);
      });

      this.playAvatarAnimation(attackerAvatar, "attack", {
        fadeIn: 0.08,
        loop: "once",
        timeScale: this.animationSpeed
      });
      await this.tween(0.2 * durationFactor, (t) => {
        const eased = easeOutCubic(t);
        attackerMesh.position.lerpVectors(attackerBase, attackerWindup, eased);
        attackerMesh.position.y = Math.sin(Math.PI * eased) * 0.22;
        defenderMesh.position.lerpVectors(defenderBase, defenderRetreat, eased * 0.6);
        defenderMesh.position.y = Math.sin(Math.PI * eased * 0.5) * 0.18;
      });
      await this.tween(0.08 * durationFactor, () => {});
      this.shakeCamera(0.22 * this.vfxIntensity, 0.18 * durationFactor);

      this.playAvatarAnimation(defenderAvatar, "hit", {
        fadeIn: 0.05,
        loop: "once",
        timeScale: this.animationSpeed
      });
      await this.tween(0.18 * durationFactor, (t) => {
        const eased = easeOutQuad(t);
        attackerMesh.position.lerpVectors(attackerWindup, attackerLunge, eased);
        defenderMesh.position.lerpVectors(defenderRetreat, defenderBase, eased);
        defenderMesh.position.y = Math.sin(Math.PI * eased) * 0.32;
      });
      await this.tween(0.08 * durationFactor, () => {});
      this.shakeCamera(0.28 * this.vfxIntensity, 0.18 * durationFactor);

      this.playAvatarAnimation(defenderAvatar, "attack", {
        fadeIn: 0.06,
        loop: "once",
        timeScale: this.animationSpeed
      });
      this.playAvatarAnimation(attackerAvatar, "hit", {
        fadeIn: 0.05,
        loop: "once",
        timeScale: this.animationSpeed
      });
      await this.tween(0.18 * durationFactor, (t) => {
        const eased = easeOutQuad(t);
        defenderMesh.position.lerpVectors(defenderBase, defenderCounter, eased);
        defenderMesh.position.y = Math.sin(Math.PI * eased) * 0.24;
        attackerMesh.position.lerpVectors(attackerLunge, attackerBase, eased);
        attackerMesh.position.y = Math.sin(Math.PI * eased) * 0.18;
      });
      await this.cinematicHit(center, this.cinematicIntensity(attacker.kind) * 0.75);
      await this.tween(0.1 * durationFactor, () => {});

      this.playAvatarAnimation(attackerAvatar, "attack", {
        fadeIn: 0.08,
        loop: "once",
        timeScale: this.animationSpeed
      });
      this.playAvatarAnimation(defenderAvatar, "death", {
        fadeIn: 0.12,
        loop: "once",
        timeScale: this.animationSpeed
      });
      this.shakeCamera(0.36 * this.vfxIntensity, 0.24 * durationFactor);
      await this.tween(0.22 * durationFactor, (t) => {
        const eased = easeInOutQuad(t);
        attackerMesh.position.lerpVectors(attackerBase, target, eased);
        defenderMesh.position.lerpVectors(defenderCounter, defenderCollapse, eased);
        defenderMesh.position.y = Math.sin(Math.PI * eased) * 0.28;
      });
      await this.tween(0.12 * durationFactor, () => {});
    } finally {
      cleanup();
    }

    attacker.mesh.position.copy(target);
    attacker.mesh.rotation.set(0, 0, 0);
    defender.mesh.position.copy(target);
    defender.mesh.rotation.set(0, 0, 0);
    defender.mesh.visible = true;

    try {
      await this.captureEffect(defender);
    } finally {
      attacker.mesh.visible = true;
    }
  }

  private canPlayDuel(attacker: PieceObject, defender: PieceObject) {
    const attackerAvatar = attacker.battleAvatar;
    const defenderAvatar = defender.battleAvatar;
    if (!attackerAvatar || !defenderAvatar) {
      return false;
    }
    return Boolean(
      attackerAvatar.animations.attack &&
        attackerAvatar.animations.hit &&
        defenderAvatar.animations.attack &&
        defenderAvatar.animations.hit &&
        defenderAvatar.animations.death
    );
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
    const canDuel = this.canPlayDuel(piece, captured);
    if (canDuel) {
      await this.playDuel(piece, captured, { start, target });
      mesh.position.copy(target);
      mesh.rotation.set(0, 0, 0);
      this.playAnimation(piece, "idle", { fadeIn: 0.35, loop: "repeat" });
      return true;
    }

    const durationFactor = 1 / this.animationSpeed;
    this.playAnimation(piece, "attack", { fadeIn: 0.1, loop: "once" });
    this.playAnimation(captured, "hit", { fadeIn: 0.08, loop: "once" });
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
    this.playAnimation(piece, "idle", { fadeIn: 0.35, loop: "repeat" });
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
      if (piece.battleAvatar) {
        piece.battleAvatar.mixer.stopAllAction();
        this.mixers.delete(piece.battleAvatar.mixer);
      }
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
    this.updateMixers(delta);
    this.updateBursts(delta);
    this.applyCameraShake(delta);
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

  private updateMixers(delta: number) {
    this.mixers.forEach((mixer) => mixer.update(delta));
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

  private applyCameraShake(delta: number) {
    if (this.shakeDuration <= 0) return;
    this.camera.position.sub(this.shakeOffset);
    this.controls.target.sub(this.shakeTargetOffset);

    this.shakeElapsed += delta;
    const progress = Math.min(1, this.shakeElapsed / this.shakeDuration);
    const falloff = 1 - progress;
    const magnitude = this.shakeStrength * falloff;

    this.shakeOffset.set(
      (Math.random() - 0.5) * magnitude,
      (Math.random() - 0.5) * magnitude * 0.6,
      (Math.random() - 0.5) * magnitude
    );
    this.shakeTargetOffset.copy(this.shakeOffset).multiplyScalar(0.25);

    this.camera.position.add(this.shakeOffset);
    this.controls.target.add(this.shakeTargetOffset);

    if (this.shakeElapsed >= this.shakeDuration) {
      this.camera.position.sub(this.shakeOffset);
      this.controls.target.sub(this.shakeTargetOffset);
      this.shakeDuration = 0;
      this.shakeElapsed = 0;
      this.shakeOffset.set(0, 0, 0);
      this.shakeTargetOffset.set(0, 0, 0);
    }
  }

  private shakeCamera(strength: number, duration: number) {
    this.camera.position.sub(this.shakeOffset);
    this.controls.target.sub(this.shakeTargetOffset);
    this.shakeOffset.set(0, 0, 0);
    this.shakeTargetOffset.set(0, 0, 0);
    this.shakeStrength = strength;
    this.shakeDuration = duration;
    this.shakeElapsed = 0;
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

  private spawnShockwave(position: Vector3) {
    if (this.vfxIntensity <= 0.01) return;
    const ring = new RingGeometry(0.35, 0.38, 48);
    const material = new MeshBasicMaterial({
      color: new Color("#8ed6ff"),
      transparent: true,
      opacity: 0.4,
      blending: AdditiveBlending
    });
    const mesh = new Mesh(ring, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position);
    mesh.position.y = 0.05;
    this.scene.add(mesh);

    this.tween(0.45 / this.animationSpeed, (t) => {
      const eased = easeOutQuad(t);
      const scale = 1 + eased * 4 * this.vfxIntensity;
      mesh.scale.setScalar(scale);
      material.opacity = (1 - eased) * 0.35;
    }).then(() => {
      this.scene.remove(mesh);
      material.dispose();
      ring.dispose();
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
