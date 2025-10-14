import { Chess, Move, PieceSymbol, Square } from "chess.js";

export type DifficultyLevel = 1 | 2 | 3 | 4;

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0
};

const pawnTable = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, -20, -20, 10, 10, 5,
  5, -5, -10, 0, 0, -10, -5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, 5, 10, 25, 25, 10, 5, 5,
  10, 10, 20, 30, 30, 20, 10, 10,
  50, 50, 50, 50, 50, 50, 50, 50,
  0, 0, 0, 0, 0, 0, 0, 0
];

const knightTable = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50
];

const bishopTable = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20
];

const rookTable = [
  0, 0, 0, 5, 5, 0, 0, 0,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  5, 10, 10, 10, 10, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0
];

const queenTable = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20
];

const kingTable = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20
];

const pieceSquareTablesWhite: Record<PieceSymbol, readonly number[]> = {
  p: pawnTable,
  n: knightTable,
  b: bishopTable,
  r: rookTable,
  q: queenTable,
  k: kingTable
};

const pieceSquareTablesBlack: Record<PieceSymbol, number[]> = {
  p: mirrorTable(pawnTable),
  n: mirrorTable(knightTable),
  b: mirrorTable(bishopTable),
  r: mirrorTable(rookTable),
  q: mirrorTable(queenTable),
  k: mirrorTable(kingTable)
};

const DEPTH_BY_DIFFICULTY: Record<DifficultyLevel, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 3
};

const WINDOW_BY_DIFFICULTY: Record<DifficultyLevel, number> = {
  1: 4,
  2: 3,
  3: 2,
  4: 1
};

const TIME_LIMIT_MS: Record<DifficultyLevel, number> = {
  1: 50,
  2: 180,
  3: 350,
  4: 550
};

const MATE_SCORE = 1_000_000;

export type AiOptions = {
  difficulty: DifficultyLevel;
  playingAs: "w" | "b";
};

export async function chooseBestMove(fen: string, options: AiOptions): Promise<Move | null> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(computeBestMove(fen, options));
    }, 0);
  });
}

function computeBestMove(fen: string, { difficulty, playingAs }: AiOptions): Move | null {
  const chess = new Chess(fen);
  const moves = orderMoves(chess.moves({ verbose: true }));
  if (moves.length === 0) return null;

  const depth = DEPTH_BY_DIFFICULTY[difficulty];
  const deadline = getNow() + TIME_LIMIT_MS[difficulty];
  const scoredMoves: { move: Move; score: number }[] = [];

  for (const move of moves) {
    chess.move(move);
    const score = search(chess, depth - 1, -Infinity, Infinity, chess.turn() === "w", deadline);
    chess.undo();
    scoredMoves.push({ move, score });
  }

  const maximizing = playingAs === "w";
  scoredMoves.sort((a, b) => (maximizing ? b.score - a.score : a.score - b.score));

  const window = Math.max(1, Math.min(scoredMoves.length, WINDOW_BY_DIFFICULTY[difficulty]));
  const choiceIndex = Math.floor(Math.random() * window);
  return scoredMoves[choiceIndex]?.move ?? scoredMoves[0]?.move ?? null;
}

function search(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  deadline: number
): number {
  if (depth <= 0 || chess.isGameOver() || getNow() >= deadline) {
    return evaluateBoard(chess);
  }

  const moves = orderMoves(chess.moves({ verbose: true }));
  if (moves.length === 0) {
    return evaluateBoard(chess);
  }

  if (maximizing) {
    let value = -Infinity;
    for (const move of moves) {
      chess.move(move);
      value = Math.max(value, search(chess, depth - 1, alpha, beta, chess.turn() === "w", deadline));
      chess.undo();
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  } else {
    let value = Infinity;
    for (const move of moves) {
      chess.move(move);
      value = Math.min(value, search(chess, depth - 1, alpha, beta, chess.turn() === "w", deadline));
      chess.undo();
      beta = Math.min(beta, value);
      if (alpha >= beta) break;
    }
    return value;
  }
}

function evaluateBoard(chess: Chess): number {
  if (chess.isCheckmate()) {
    return chess.turn() === "w" ? -MATE_SCORE : MATE_SCORE;
  }
  if (chess.isDraw()) {
    return 0;
  }

  let score = 0;
  const board = chess.board();

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const piece = board[rank][file];
      if (!piece) continue;
      const idx = rank * 8 + file;
      const positional =
        piece.color === "w"
          ? pieceSquareTablesWhite[piece.type][idx]
          : pieceSquareTablesBlack[piece.type][idx];
      const value = PIECE_VALUES[piece.type] + positional;
      score += piece.color === "w" ? value : -value;
    }
  }

  // Tempo encourages the side to move
  score += chess.turn() === "w" ? 15 : -15;

  return score;
}

function orderMoves(moves: Move[]) {
  return moves.sort((a, b) => {
    const captureScore = (b.captured ? 1 : 0) - (a.captured ? 1 : 0);
    if (captureScore !== 0) return captureScore;
    const promoScore = (b.promotion ? 1 : 0) - (a.promotion ? 1 : 0);
    if (promoScore !== 0) return promoScore;
    return 0;
  });
}

function mirrorTable(table: readonly number[]): number[] {
  const mirrored = Array<number>(64);
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const srcIndex = rank * 8 + file;
      const dstIndex = (7 - rank) * 8 + file;
      mirrored[dstIndex] = table[srcIndex];
    }
  }
  return mirrored;
}

function getNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export type AiMoveResult = {
  from: Square;
  to: Square;
  promotion?: Move["promotion"];
};
