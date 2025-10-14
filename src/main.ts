import { Move, Square } from "chess.js";
import { ChessController } from "./game/chessController";
import { DualChessClock } from "./game/clock";
import type { BoardScene } from "./scene/boardScene";
import type { PieceColor, PieceKind } from "./scene/pieceFactory";
import type { AudioManager, SpatialPosition } from "./audio/audioManager";

type DifficultyLevel = import("./game/simpleAi").DifficultyLevel;

const SETTINGS_KEY = "animated-3d-chess-settings";
type PlayMode = "human" | "ai";

type UserSettings = {
  animationSpeed: number;
  vfxIntensity: number;
  audioVolume: number;
  audioEnabled: boolean;
  playMode: PlayMode;
  aiDifficulty: DifficultyLevel;
};

const DEFAULT_SETTINGS: UserSettings = {
  animationSpeed: 1,
  vfxIntensity: 1,
  audioVolume: 0.6,
  audioEnabled: false,
  playMode: "human",
  aiDifficulty: 2
};

function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      animationSpeed: clampNumber(parsed.animationSpeed, 0.5, 2, DEFAULT_SETTINGS.animationSpeed),
      vfxIntensity: clampNumber(parsed.vfxIntensity, 0, 1.2, DEFAULT_SETTINGS.vfxIntensity),
      audioVolume: clampNumber(parsed.audioVolume, 0, 1, DEFAULT_SETTINGS.audioVolume),
      audioEnabled: parsed.audioEnabled ?? DEFAULT_SETTINGS.audioEnabled,
      playMode: parsed.playMode === "ai" ? "ai" : "human",
      aiDifficulty: validateDifficulty(parsed.aiDifficulty)
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: UserSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignored: storage may be unavailable
  }
}

const settings = loadSettings();

const canvas = document.getElementById("app") as HTMLCanvasElement;
if (!canvas) {
  throw new Error("Canvas element with id 'app' not found.");
}

const chess = new ChessController();
const clock = new DualChessClock(10, 0);
let scene!: BoardScene;
let audio!: AudioManager;

let playMode: PlayMode = settings.playMode;
let aiDifficulty: DifficultyLevel = settings.aiDifficulty;
const AI_COLOR: "w" | "b" = "b";
let aiThinking = false;
let aiTaskToken = 0;
let pendingAudioEnable = settings.audioEnabled;
let aiModule: typeof import("./game/simpleAi") | null = null;

let selectedSquare: Square | null = null;
let legalMoves: Move[] = [];
const moveHistory: Move[] = [];

bootstrap().catch((error) => {
  console.error("Failed to bootstrap application:", error);
});

const moveList = document.getElementById("move-list") as HTMLOListElement;
const statusLabel = document.getElementById("status") as HTMLParagraphElement;
const whiteTimerEl = document.getElementById("white-timer") as HTMLSpanElement;
const blackTimerEl = document.getElementById("black-timer") as HTMLSpanElement;
const undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const animationSpeedSlider = document.getElementById("animation-speed") as HTMLInputElement;
const vfxSlider = document.getElementById("vfx-intensity") as HTMLInputElement;
const audioToggleBtn = document.getElementById("audio-toggle") as HTMLButtonElement;
const audioVolumeSlider = document.getElementById("audio-volume") as HTMLInputElement;
const ambientStatus = document.getElementById("audio-status") as HTMLSpanElement;
const modeSelect = document.getElementById("mode-select") as HTMLSelectElement;
const aiDifficultySlider = document.getElementById("ai-difficulty") as HTMLInputElement;
const aiStatusLabel = document.getElementById("ai-status") as HTMLSpanElement;

function handleSquareSelection(square: Square) {
  if (playMode === "ai" && chess.getTurn() === AI_COLOR) {
    return;
  }
  const existingMove = legalMoves.find((move) => move.to === square);
  if (selectedSquare && existingMove) {
    executeMove(selectedSquare, square, existingMove);
    return;
  }

  const piece = chess.piece(square);
  if (!piece) {
    selectedSquare = null;
    legalMoves = [];
    scene.highlightSquares([]);
    return;
  }

  if (piece.color !== chess.getTurn()) {
    // allow selecting capture target if already have selection
    if (selectedSquare) {
      const captureMove = legalMoves.find((move) => move.to === square);
      if (captureMove) {
        executeMove(selectedSquare, square, captureMove);
      }
    }
    return;
  }

  selectedSquare = square;
  legalMoves = chess.moves(square) as Move[];
  const legalSquares = legalMoves.map((move) => move.to as Square);
  legalSquares.push(square);
  scene.highlightSquares(legalSquares);
}

async function executeMove(from: Square, to: Square, moveTemplate?: Move) {
  const promotionRequired =
    moveTemplate?.flags.includes("p") &&
    (to.endsWith("8") || to.endsWith("1")) &&
    (!moveTemplate.promotion || moveTemplate.promotion === "q");

  const promotion = promotionRequired ? "q" : moveTemplate?.promotion;
  const result = chess.move(from, to, promotion);

  if (!result) {
    console.warn("Illegal move attempted", { from, to });
    return;
  }

  moveHistory.push(result.move);
  selectedSquare = null;
  legalMoves = [];
  scene.highlightSquares([]);

  const captureSquare = captureSquareForMove(result.move);
  const capturedPiece = captureSquare ? scene.getPiece(captureSquare) : null;
  const moveTarget = toSpatial(scene.getSquarePosition(result.move.to as Square));
  if (result.move.captured) {
    const capturePos = captureSquare ? toSpatial(scene.getSquarePosition(captureSquare)) : moveTarget;
    audio.playCapture(capturePos);
  } else {
    audio.playMove(moveTarget);
  }
  await scene.playMove(result.move, { captured: capturedPiece ?? undefined });

  if (result.checkmate) {
    statusLabel.textContent = `Checkmate — ${colorName(result.move.color === "w" ? "b" : "w")} wins`;
    clock.pause();
    audio.playCheck(moveTarget);
  } else if (result.stalemate || result.draw) {
    statusLabel.textContent = "Drawn position";
    clock.pause();
  } else if (result.check) {
    statusLabel.textContent = `${colorName(result.turn)} to move — Check!`;
    audio.playCheck(moveTarget);
  } else {
    statusLabel.textContent = `${colorName(result.turn)} to move`;
  }

  clock.setActive(result.turn);
  refreshMoveList();
  updateAiStatus();
  void maybeTriggerAiMove();
}

function refreshBoardFromFen() {
  scene.loadPosition(mapBoard(chess.getBoard()));
}

function refreshMoveList() {
  moveList.innerHTML = "";
  for (let i = 0; i < moveHistory.length; i += 2) {
    const li = document.createElement("li");
    const whiteMove = moveHistory[i];
    const blackMove = moveHistory[i + 1];
    li.textContent = blackMove
      ? `${whiteMove.san}   ${blackMove.san}`
      : `${whiteMove.san}`;
    moveList.appendChild(li);
  }
}

function formatMs(ms: number) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.max(0, totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function colorName(color: "w" | "b") {
  return color === "w" ? "White" : "Black";
}

function captureSquareForMove(move: Move): Square | null {
  if (!move.captured) return null;
  if (move.flags.includes("e")) {
    const file = move.to[0];
    const rank = parseInt(move.to[1], 10) + (move.color === "w" ? -1 : 1);
    return `${file}${rank}` as Square;
  }
  return move.to as Square;
}

type BoardCell = { type: PieceKind; color: PieceColor } | null;

function mapBoard(board: ({ type: string; color: PieceColor } | null)[][]): BoardCell[][] {
  return board.map((rank) =>
    rank.map((cell) =>
      cell
        ? {
            type: cell.type as PieceKind,
            color: cell.color
          }
        : null
    )
  );
}

function toSpatial(vector: { x: number; z: number }): SpatialPosition {
  return { x: vector.x, z: vector.z };
}

async function bootstrap() {
  const [{ BoardScene }, { AudioManager }] = await Promise.all([
    import("./scene/boardScene"),
    import("./audio/audioManager")
  ]);

  scene = new BoardScene(canvas);
  audio = new AudioManager();

  animationSpeedSlider.value = settings.animationSpeed.toString();
  vfxSlider.value = settings.vfxIntensity.toString();
  audioVolumeSlider.value = settings.audioVolume.toString();
  modeSelect.value = playMode;
  aiDifficultySlider.value = aiDifficulty.toString();

  scene.loadPosition(mapBoard(chess.getBoard()));
  scene.setAnimationSpeed(settings.animationSpeed);
  scene.setVfxIntensity(settings.vfxIntensity);
  clock.setActive("w");
  clock.onUpdate((whiteMs, blackMs, active) => {
    whiteTimerEl.textContent = formatMs(whiteMs);
    blackTimerEl.textContent = formatMs(blackMs);
    whiteTimerEl.classList.toggle("active", active === "w");
    blackTimerEl.classList.toggle("active", active === "b");
  });

  scene.on("squareSelected", handleSquareSelection);

  if (pendingAudioEnable) {
    try {
      await audio.enable();
      audio.setVolume(settings.audioVolume);
      pendingAudioEnable = false;
      settings.audioEnabled = true;
      saveSettings(settings);
    } catch {
      pendingAudioEnable = true;
    }
  }
  audio.setVolume(settings.audioVolume);
  syncAudioUi();
  updateAiControls();

  undoBtn.addEventListener("click", () => {
    cancelAiComputation();
    const undone = chess.undo();
    if (!undone) return;
    moveHistory.pop();
    refreshBoardFromFen();
    refreshMoveList();
    selectedSquare = null;
    legalMoves = [];
    scene.highlightSquares([]);
    clock.pause();
    const toMove = chess.getTurn();
    statusLabel.textContent = `${colorName(toMove)} to move`;
    updateAiStatus();
    void maybeTriggerAiMove();
  });

  resetBtn.addEventListener("click", () => {
    cancelAiComputation();
    chess.reset();
    moveHistory.length = 0;
    refreshBoardFromFen();
    refreshMoveList();
    selectedSquare = null;
    legalMoves = [];
    scene.highlightSquares([]);
    clock.reset();
    clock.setActive("w");
    statusLabel.textContent = "White to move";
    updateAiStatus();
    void maybeTriggerAiMove();
  });

  animationSpeedSlider.addEventListener("input", (event) => {
    const value = parseFloat((event.target as HTMLInputElement).value);
    scene.setAnimationSpeed(value);
    settings.animationSpeed = value;
    saveSettings(settings);
  });

  vfxSlider.addEventListener("input", (event) => {
    const value = parseFloat((event.target as HTMLInputElement).value);
    scene.setVfxIntensity(value);
    settings.vfxIntensity = value;
    saveSettings(settings);
  });

  audioToggleBtn.addEventListener("click", async () => {
    if (audio.isEnabled()) {
      await audio.disable();
      pendingAudioEnable = false;
    } else {
      try {
        await audio.enable();
        audio.setVolume(settings.audioVolume);
        pendingAudioEnable = false;
      } catch (error) {
        console.warn("Unable to start audio context:", error);
        pendingAudioEnable = true;
        settings.audioEnabled = false;
      }
    }
    settings.audioEnabled = audio.isEnabled();
    if (!audio.isEnabled() && pendingAudioEnable) {
      settings.audioEnabled = false;
    }
    syncAudioUi();
    saveSettings(settings);
  });

  audioVolumeSlider.addEventListener("input", (event) => {
    const value = parseFloat((event.target as HTMLInputElement).value);
    audio.setVolume(value);
    settings.audioVolume = value;
    saveSettings(settings);
  });

  modeSelect.addEventListener("change", () => {
    playMode = modeSelect.value === "ai" ? "ai" : "human";
    settings.playMode = playMode;
    saveSettings(settings);
    cancelAiComputation();
    updateAiControls();
    void maybeTriggerAiMove();
  });

  aiDifficultySlider.addEventListener("input", (event) => {
    const value = Math.round(parseFloat((event.target as HTMLInputElement).value)) as DifficultyLevel;
    aiDifficulty = validateDifficulty(value);
    settings.aiDifficulty = aiDifficulty;
    saveSettings(settings);
    updateAiStatus();
    void maybeTriggerAiMove();
  });

  updateAiStatus();
  saveSettings(settings);
  void maybeTriggerAiMove();
}

function syncAudioUi() {
  if (!audio) return;
  audioVolumeSlider.value = settings.audioVolume.toString();
  const enabled = audio.isEnabled();
  audioToggleBtn.textContent = enabled ? "Disable Audio" : "Enable Audio";
  if (enabled) {
    ambientStatus.textContent = "Ambient on";
  } else if (pendingAudioEnable) {
    ambientStatus.textContent = "Tap to enable";
  } else {
    ambientStatus.textContent = "Muted";
  }
}

function updateAiControls() {
  modeSelect.value = playMode;
  aiDifficultySlider.value = aiDifficulty.toString();
  aiDifficultySlider.disabled = playMode === "human";
  aiDifficultySlider.parentElement?.classList.toggle("disabled", playMode === "human");
  updateAiStatus();
}

function updateAiStatus(message?: string) {
  if (message) {
    aiStatusLabel.textContent = message;
    return;
  }
  if (playMode === "human") {
    aiStatusLabel.textContent = "Manual play";
    return;
  }
  if (aiThinking) {
    aiStatusLabel.textContent = "Thinking...";
    return;
  }
  aiStatusLabel.textContent = chess.getTurn() === AI_COLOR ? "AI to move" : "Your turn";
}

function cancelAiComputation() {
  aiTaskToken += 1;
  aiThinking = false;
}

async function ensureAiModule() {
  if (!aiModule) {
    aiModule = await import("./game/simpleAi");
  }
  return aiModule;
}

async function maybeTriggerAiMove() {
  if (playMode !== "ai" || chess.getTurn() !== AI_COLOR || aiThinking) return;
  const module = await ensureAiModule();
  const fen = chess.getFen();
  const taskId = ++aiTaskToken;
  aiThinking = true;
  updateAiStatus();
  let overrideMessage: string | undefined;
  try {
    const move = await module.chooseBestMove(fen, {
      difficulty: aiDifficulty,
      playingAs: AI_COLOR
    });
    if (taskId !== aiTaskToken) return;
    if (!move) {
      overrideMessage = "No legal moves";
      if (chess.isCheckmate()) {
        statusLabel.textContent = `${colorName(AI_COLOR === "w" ? "b" : "w")} wins`;
      } else {
        statusLabel.textContent = "Drawn position";
      }
      return;
    }
    await executeMove(move.from as Square, move.to as Square, move);
  } catch (error) {
    if (taskId === aiTaskToken) {
      console.error("Failed to produce AI move:", error);
      overrideMessage = "Engine error";
    }
  } finally {
    if (taskId === aiTaskToken) {
      aiThinking = false;
      if (overrideMessage) {
        updateAiStatus(overrideMessage);
      } else {
        updateAiStatus();
      }
    }
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (Number.isFinite(num)) {
    return Math.min(max, Math.max(min, num));
  }
  return fallback;
}

function validateDifficulty(value: unknown): DifficultyLevel {
  const parsed = Math.round(typeof value === "number" ? value : parseFloat(String(value)));
  if (parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4) {
    return parsed;
  }
  return DEFAULT_SETTINGS.aiDifficulty;
}
