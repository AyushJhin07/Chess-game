import { AnimationClip, Group, Mesh, MeshStandardMaterial, SkinnedMesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { PieceColor, PieceKind } from "../scene/pieceFactory";

export type PieceAnimationLabel = "idle" | "move" | "attack" | "hit" | "death";

export type PieceAnimationMap = Partial<Record<PieceAnimationLabel, string>>;

export type PieceAssetConfig = {
  kind: PieceKind;
  color?: PieceColor | "both";
  url: string;
  animations?: PieceAnimationMap;
  materialOverride?: MeshStandardMaterial;
};

type ClipDictionary = Partial<Record<PieceAnimationLabel, AnimationClip>>;

type LoadedAsset = {
  base: Group;
  clips: ClipDictionary;
};

type AssetKey = `${PieceKind}:${PieceColor | "both"}`;

export class PieceAssetManager {
  private static singleton: PieceAssetManager | null = null;
  static getInstance() {
    if (!PieceAssetManager.singleton) {
      PieceAssetManager.singleton = new PieceAssetManager();
    }
    return PieceAssetManager.singleton;
  }

  private loader = new GLTFLoader();
  private registry = new Map<AssetKey, LoadedAsset>();

  async loadAssets(configs: PieceAssetConfig[]) {
    this.registry.clear();
    if (!configs.length) return;
    await Promise.all(configs.map((config) => this.loadConfig(config)));
  }

  instantiateSync(kind: PieceKind, color: PieceColor) {
    const key = this.resolveKey(kind, color);
    if (!key) return null;
    const asset = this.registry.get(key);
    if (!asset) return null;
    const clone = SkeletonUtils.clone(asset.base) as Group;
    clone.traverse((child) => {
      if ("castShadow" in child) {
        (child as Mesh).castShadow = true;
        (child as Mesh).receiveShadow = true;
      }
    });
    clone.userData.animationClips = asset.clips;
    return clone;
  }

  private async loadConfig(config: PieceAssetConfig) {
    const gltf = await this.loader.loadAsync(config.url);
    const base = gltf.scene;
    base.traverse((child) => {
      if ((child as Mesh).isMesh || (child as SkinnedMesh).isSkinnedMesh) {
        (child as Mesh).castShadow = true;
        (child as Mesh).receiveShadow = true;
        if (config.materialOverride) {
          (child as Mesh).material = config.materialOverride;
        }
      }
    });

    const clips: ClipDictionary = {};
    const available = gltf.animations ?? [];
    if (config.animations) {
      (Object.keys(config.animations) as PieceAnimationLabel[]).forEach((label) => {
        const clipName = config.animations![label];
        if (!clipName) return;
        const clip =
          AnimationClip.findByName(available, clipName) ??
          available.find((candidate) => candidate.name.toLowerCase() === clipName.toLowerCase());
        if (clip) {
          clips[label] = clip;
        }
      });
    } else if (available.length) {
      clips.idle = available[0];
      if (available[1]) clips.attack = available[1];
    }

    const keySingle: AssetKey = `${config.kind}:${config.color ?? "both"}`;
    this.registry.set(keySingle, { base, clips });

    if (!config.color || config.color === "both") {
      const keyWhite: AssetKey = `${config.kind}:w`;
      const keyBlack: AssetKey = `${config.kind}:b`;
      this.registry.set(keyWhite, { base, clips });
      this.registry.set(keyBlack, { base, clips });
    }
  }

  private resolveKey(kind: PieceKind, color: PieceColor) {
    const direct: AssetKey = `${kind}:${color}`;
    if (this.registry.has(direct)) return direct;
    const fallback: AssetKey = `${kind}:both`;
    return this.registry.has(fallback) ? fallback : null;
  }
}

export async function loadPieceAssets(configs: PieceAssetConfig[]) {
  await PieceAssetManager.getInstance().loadAssets(configs);
}
