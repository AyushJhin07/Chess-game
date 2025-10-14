# Animated 3D Chess

This project implements a fully legal chess experience with stylised 3D figurines, animated captures, smooth orbital camera controls, clocks, a reactive audio layer, and a running move list. It is built with Vite + TypeScript, [Three.js](https://threejs.org/) for rendering, and [chess.js](https://github.com/jhlywa/chess.js) for the rule engine.

## Getting Started

```bash
npm install
npm run dev
```

Open the printed local URL (defaults to `http://localhost:5173`) to play. The production bundle can be generated with:

```bash
npm run build
npm run preview
```

## Features

- Full chess rules (castling, en passant, promotion, stalemate, repetition) via chess.js.
- Dual clocks with configurable animation speed slider, undo, and reset controls.
- Three.js 3D board with original figurine designs, dynamic lighting, shadows, and smooth 360° orbit camera.
- Animated movement arcs, capture reactions with “ragdoll” collapse, rook auto-moves on castling, and piece swaps on promotion.
- Web Audio ambient bed plus move/capture/check cues with on/off, volume controls, and spatialised playback tied to board coordinates.
- Particle-infused capture bursts with adjustable VFX intensity.
- Versus-AI mode (engine plays Black) with four difficulty presets and automated responses.
- Remembers animation, VFX, audio, and opponent preferences via localStorage.
- Premium surface shading with clearcoat/sheen materials and HDR environment lighting for board and pieces.
- Cinematic capture sequences blend bespoke battle animations with reactive camera sweeps.
- PGN-style move list with SAN notation and capture/check indicators.
- Responsive glassmorphism-inspired UI overlay for timers, status, and controls.

## Controls

- **Undo / Reset** – step back or restart the current game state.
- **Animation Speed** – slows down or accelerates move/capture tweening.
- **VFX Intensity** – scales capture particle bursts from subtle to dramatic.
- **Mode** – swap between human-vs-human and AI opponent (AI controls Black pieces).
- **Difficulty** – selects one of four engine search depths (higher is tougher but slower).
- **Audio Toggle & Volume** – enables the ambient pad + event cues and sets global loudness.

## Custom Assets

You can swap the procedural pieces for your own rigged GLTF/GLB chess set:

1. Export (or purchase) rigged pieces with animation clips (idle/move/attack/hit/death).
2. Place the files in `public/assets` (or host them elsewhere) and update `assetConfigs` inside `src/assets/defaultAssets.ts` with the paths and clip names.
3. On load the `PieceAssetManager` clones each GLTF, wires up `AnimationMixer`s, and the existing capture choreography will trigger your clips automatically.

If a piece asset is missing, the engine quietly falls back to the procedural models, so you can integrate pieces incrementally.

## Structure

- `src/game` – chess engine wrapper and dual clock.
- `src/scene` – Three.js setup, piece factory, and animation logic.
- `src/main.ts` – orchestration of rule engine, UI, and scene actions.

## Enhancements to Explore

1. Swap in a stronger external engine (e.g., Stockfish WASM/NNUE) and expose search stats or move hints.
2. Add online multiplayer with authoritative game state sync and reconnection handling.
3. Introduce cinematic replays, camera presets, and timeline scrubbing.
4. Offer accessibility toggles: board coordinates, high-contrast palettes, animation skip/slow mode.
5. Import/export PGN or live-share the current position via FEN links.

## Notes

- Initial load now streams a light control bundle (~45 kB gz) and lazily downloads the Three.js scene module (~125 kB gz). Further code-splitting or asset compression can push this even lower if needed.
- The clock defaults to 10 minutes with no increment. Adjust in `DualChessClock` construction within `src/main.ts`.
- Audio is opt-in: click **Enable Audio** (or adjust the volume slider) after loading due to browser autoplay policies.
- Preferences are saved to `localStorage` under `animated-3d-chess-settings`; clear storage to reset to defaults.
- Tested locally with Node.js 20; ensure your environment matches for consistent tooling.
