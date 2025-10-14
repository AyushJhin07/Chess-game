import { loadPieceAssets, PieceAssetConfig } from "./pieceAssets";

/**
 * Loads configured GLTF assets for chess pieces.
 *
 * Update the `assetConfigs` array with your own GLB/GLTF files.
 * Example entry:
 * {
 *   kind: "n",
 *   color: "w",
 *   url: "/assets/knight-white.glb",
 *   animations: { idle: "Idle", move: "Walk", attack: "Slash", hit: "Hit", death: "Death" }
 * }
 */
export async function loadConfiguredAssets() {
  const assetConfigs: PieceAssetConfig[] = [];
  await loadPieceAssets(assetConfigs);
}

export type { PieceAssetConfig } from "./pieceAssets";
