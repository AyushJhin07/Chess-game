import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  SRGBColorSpace
} from "three";
import { PieceAssetManager } from "../assets/pieceAssets";

export type PieceColor = "w" | "b";
export type PieceKind = "p" | "r" | "n" | "b" | "q" | "k";

const BASE_PROFILE = createLatheGeometry([
  [0, 0],
  [0.58, 0],
  [0.6, 0.06],
  [0.46, 0.1],
  [0.44, 0.16],
  [0.48, 0.2],
  [0.38, 0.26],
  [0.35, 0.32],
  [0.38, 0.36],
  [0.28, 0.42],
  [0.25, 0.48],
  [0.0, 0.5]
]);

const textures = {
  whiteSheen: createSheenTexture("#ffffff", "#cdd9ff"),
  blackSheen: createSheenTexture("#1a2236", "#05070d"),
  warmAccent: createSheenTexture("#ffbf86", "#f57d2e"),
  coolAccent: createSheenTexture("#d9e4ff", "#9fbdff")
};

const MATERIALS: Record<
  PieceColor,
  {
    primary: MeshPhysicalMaterial;
    accent: MeshPhysicalMaterial;
  }
> = {
  w: {
    primary: new MeshPhysicalMaterial({
      map: textures.whiteSheen,
      metalness: 0.25,
      roughness: 0.12,
      clearcoat: 0.65,
      clearcoatRoughness: 0.12,
      sheen: new Color("#e0ebff"),
      sheenRoughness: 0.5,
      reflectivity: 0.4
    }),
    accent: new MeshPhysicalMaterial({
      map: textures.coolAccent,
      metalness: 0.18,
      roughness: 0.18,
      clearcoat: 0.4,
      clearcoatRoughness: 0.2,
      sheen: new Color("#b7cbff"),
      sheenRoughness: 0.6
    })
  },
  b: {
    primary: new MeshPhysicalMaterial({
      map: textures.blackSheen,
      metalness: 0.32,
      roughness: 0.2,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18,
      sheen: new Color("#3a4a6f"),
      sheenRoughness: 0.45,
      reflectivity: 0.5
    }),
    accent: new MeshPhysicalMaterial({
      map: textures.warmAccent,
      metalness: 0.38,
      roughness: 0.24,
      clearcoat: 0.35,
      clearcoatRoughness: 0.18,
      sheen: new Color("#ffae6f"),
      sheenRoughness: 0.55,
      emissive: new Color("#ff9440").multiplyScalar(0.18)
    })
  }
};

const assetManager = PieceAssetManager.getInstance();

export function createPieceMesh(color: PieceColor, kind: PieceKind) {
  const assetClone = assetManager.instantiateSync(kind, color);
  if (assetClone) {
    assetClone.scale.setScalar(1);
    return assetClone;
  }

  const group = new Group();
  const { primary, accent } = MATERIALS[color];

  const base = new Mesh(BASE_PROFILE, primary);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  let body: Mesh | Group;

  switch (kind) {
    case "p":
      body = pawn(primary, accent);
      break;
    case "r":
      body = rook(primary, accent);
      break;
    case "n":
      body = knight(primary, accent);
      break;
    case "b":
      body = bishop(primary, accent);
      break;
    case "q":
      body = queen(primary, accent);
      break;
    case "k":
      body = king(primary, accent);
      break;
    default:
      body = pawn(primary, accent);
  }

  body.position.y = 0.5;
  group.add(body);
  group.userData = { color, kind };
  group.scale.setScalar(0.9);

  return group;
}

function pawn(primary: MeshStandardMaterial, accent: MeshStandardMaterial) {
  const profile = createLatheGeometry([
    [0, 0],
    [0.32, 0],
    [0.34, 0.05],
    [0.22, 0.18],
    [0.2, 0.45],
    [0.24, 0.6],
    [0.16, 0.75],
    [0.12, 0.9],
    [0, 0.95]
  ]);
  const body = new Mesh(profile, primary);
  const head = new Mesh(new SphereGeometry(0.19, 32, 32), accent);
  head.position.y = 0.98;
  body.castShadow = head.castShadow = true;

  const group = new Group();
  group.add(body, head);
  return group;
}

function rook(primary: MeshStandardMaterial, accent: MeshStandardMaterial) {
  const tower = createLatheGeometry([
    [0, 0],
    [0.4, 0],
    [0.42, 0.05],
    [0.3, 0.08],
    [0.28, 0.5],
    [0.32, 0.75],
    [0.4, 0.78],
    [0.38, 0.84],
    [0, 0.84]
  ]);
  const body = new Mesh(tower, primary);

  const crenels = new Group();
  const block = new BoxGeometry(0.22, 0.16, 0.48);
  for (let i = 0; i < 4; i++) {
    const mesh = new Mesh(block, accent);
    const angle = (i / 4) * Math.PI * 2;
    mesh.position.set(Math.cos(angle) * 0.27, 0.9, Math.sin(angle) * 0.27);
    mesh.rotation.y = angle;
    mesh.castShadow = true;
    crenels.add(mesh);
  }
  body.castShadow = true;

  const group = new Group();
  group.add(body, crenels);
  return group;
}

function bishop(primary: MeshStandardMaterial, accent: MeshStandardMaterial) {
  const stem = createLatheGeometry([
    [0, 0],
    [0.32, 0],
    [0.34, 0.05],
    [0.24, 0.08],
    [0.22, 0.5],
    [0.3, 0.75],
    [0.2, 0.9],
    [0.12, 1.02],
    [0, 1.1]
  ]);
  const body = new Mesh(stem, primary);
  body.castShadow = true;

  const collar = new Mesh(new TorusGeometry(0.24, 0.04, 14, 28), accent);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.55;
  collar.castShadow = true;

  const notch = new Mesh(new BoxGeometry(0.12, 0.5, 0.05), accent);
  notch.position.y = 0.92;
  notch.castShadow = true;

  const topOrb = new Mesh(new SphereGeometry(0.15, 24, 24), accent);
  topOrb.position.y = 1.18;
  topOrb.castShadow = true;

  const group = new Group();
  group.add(body, collar, notch, topOrb);
  return group;
}

function queen(primary: MeshStandardMaterial, accent: MeshStandardMaterial) {
  const profile = createLatheGeometry([
    [0, 0],
    [0.36, 0],
    [0.38, 0.05],
    [0.24, 0.08],
    [0.22, 0.5],
    [0.34, 0.72],
    [0.28, 0.86],
    [0.38, 0.94],
    [0.26, 1.02],
    [0.23, 1.1],
    [0.18, 1.22],
    [0, 1.3]
  ]);

  const body = new Mesh(profile, primary);
  body.castShadow = true;

  const crownBand = new Mesh(new TorusGeometry(0.3, 0.045, 14, 32), accent);
  crownBand.rotation.x = Math.PI / 2;
  crownBand.position.y = 0.96;
  crownBand.castShadow = true;

  const petals = new Group();
  const petal = new SphereGeometry(0.09, 16, 16);
  for (let i = 0; i < 6; i++) {
    const mesh = new Mesh(petal, accent);
    const angle = (i / 6) * Math.PI * 2;
    mesh.position.set(Math.cos(angle) * 0.22, 1.12, Math.sin(angle) * 0.22);
    mesh.scale.y = 1.2;
    mesh.castShadow = true;
    petals.add(mesh);
  }

  const group = new Group();
  group.add(body, crownBand, petals);
  return group;
}

function king(primary: MeshStandardMaterial, accent: MeshStandardMaterial) {
  const profile = createLatheGeometry([
    [0, 0],
    [0.36, 0],
    [0.38, 0.04],
    [0.24, 0.08],
    [0.24, 0.52],
    [0.34, 0.72],
    [0.28, 0.9],
    [0.32, 1.05],
    [0.22, 1.18],
    [0.18, 1.32],
    [0, 1.4]
  ]);
  const body = new Mesh(profile, primary);
  body.castShadow = true;

  const collar = new Mesh(new TorusGeometry(0.28, 0.045, 14, 28), accent);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.9;
  collar.castShadow = true;

  const crossStem = new Mesh(new BoxGeometry(0.08, 0.45, 0.08), accent);
  crossStem.position.y = 1.42;
  crossStem.castShadow = true;

  const crossBar = new Mesh(new BoxGeometry(0.34, 0.08, 0.08), accent);
  crossBar.position.y = 1.52;
  crossBar.castShadow = true;

  const finial = new Mesh(new SphereGeometry(0.09, 16, 16), accent);
  finial.position.y = 1.66;
  finial.castShadow = true;

  const group = new Group();
  group.add(body, collar, crossStem, crossBar, finial);
  return group;
}

function knight(primary: MeshStandardMaterial, accent: MeshStandardMaterial) {
  const profile = createLatheGeometry([
    [0, 0],
    [0.34, 0],
    [0.36, 0.04],
    [0.28, 0.08],
    [0.26, 0.58],
    [0.3, 0.72],
    [0, 0.72]
  ]);

  const base = new Mesh(profile, primary);
  base.castShadow = true;

  const neckShape = new Shape();
  neckShape.moveTo(0, 0);
  neckShape.bezierCurveTo(0.6, 0.2, 0.65, 0.6, 0.32, 0.88);
  neckShape.bezierCurveTo(0.2, 0.98, 0.2, 1.25, 0.42, 1.32);
  neckShape.bezierCurveTo(0.68, 1.38, 0.34, 1.55, 0.2, 1.56);
  neckShape.bezierCurveTo(0.02, 1.58, -0.18, 1.38, -0.08, 1.18);
  neckShape.bezierCurveTo(0.02, 0.96, -0.18, 0.82, -0.38, 0.78);
  neckShape.lineTo(-0.32, 0.62);
  neckShape.bezierCurveTo(-0.02, 0.6, -0.02, 0.24, 0, 0);

  const extrude = new ExtrudeGeometry(neckShape, {
    depth: 0.32,
    bevelEnabled: false
  });
  extrude.center();

  const head = new Mesh(extrude, primary);
  head.scale.set(0.55, 0.55, 0.55);
  head.rotation.y = Math.PI / 6;
  head.position.set(0.05, 0.75, 0);
  head.castShadow = true;

  const bridle = new Mesh(new TorusGeometry(0.22, 0.03, 12, 24), accent);
  bridle.rotation.y = Math.PI / 2;
  bridle.position.set(0.07, 0.92, 0);
  bridle.castShadow = true;

  const mane = new Mesh(new BoxGeometry(0.1, 0.4, 0.24), accent);
  mane.position.set(-0.12, 0.95, 0);
  mane.castShadow = true;

  const group = new Group();
  group.add(base, head, bridle, mane);
  return group;
}

function createLatheGeometry(points: [number, number][], segments = 48) {
  const vectors = points.map(([x, y]) => new Vector2(x, y));
  return new LatheGeometry(vectors, segments);
}

function createSheenTexture(innerHex: string, outerHex: string) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to create canvas texture context.");
  }
  const gradient = ctx.createRadialGradient(size * 0.35, size * 0.35, size * 0.1, size * 0.5, size * 0.5, size * 0.7);
  gradient.addColorStop(0, innerHex);
  gradient.addColorStop(0.45, innerHex);
  gradient.addColorStop(1, outerHex);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
