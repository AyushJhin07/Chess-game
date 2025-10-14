import type { PieceColor } from "../scene/pieceFactory";
import { loadPieceAssets, PieceAssetConfig, PieceAssetManager } from "./pieceAssets";

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
  const sharedAnimations = {
    idle: "Idle",
    move: "Move",
    attack: "Attack",
    hit: "Hit",
    death: "Death"
  };

  const assetConfigs: PieceAssetConfig[] = [
    {
      kind: "p",
      color: "both",
      url: "/assets/pieces/pawn.gltf",
      animations: sharedAnimations
    },
    {
      kind: "r",
      color: "both",
      url: "/assets/pieces/rook.gltf",
      animations: sharedAnimations
    },
    {
      kind: "n",
      color: "both",
      url: "/assets/pieces/knight.gltf",
      animations: sharedAnimations
    },
    {
      kind: "b",
      color: "both",
      url: "/assets/pieces/bishop.gltf",
      animations: sharedAnimations
    },
    {
      kind: "q",
      color: "both",
      url: "/assets/pieces/queen.gltf",
      animations: sharedAnimations
    },
    {
      kind: "k",
      color: "both",
      url: "/assets/pieces/king.gltf",
      animations: sharedAnimations
    }
  ];
  await loadPieceAssets(assetConfigs);

  for (const config of assetConfigs) {
    const sampleColor: PieceColor =
      config.color && config.color !== "both" ? config.color : "w";
    const sample = PieceAssetManager.getInstance().instantiateSync(config.kind, sampleColor);
    if (sample) {
      const clips = sample.userData.animationClips ?? {};
      const missing = ["idle", "move", "attack", "hit", "death"].filter(
        (label) => !clips[label]
      );
      if (missing.length) {
        console.warn(
          `Missing animations for ${config.kind} (${sampleColor}): ${missing.join(", ")}`
        );
      }
    }
  }
}

export type { PieceAssetConfig } from "./pieceAssets";
