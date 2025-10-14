import { Chess, Move as ChessJsMove, PieceSymbol, Square } from "chess.js";

export type MoveResult = {
  move: ChessJsMove;
  captured?: ChessJsMove["captured"];
  promotion?: ChessJsMove["promotion"];
  san: string;
  fen: string;
  turn: "w" | "b";
  check: boolean;
  checkmate: boolean;
  stalemate: boolean;
  draw: boolean;
  insufficient_material: boolean;
};

export class ChessController {
  private readonly chess = new Chess();
  private listeners = new Set<(result: MoveResult) => void>();
  private resetListeners = new Set<() => void>();

  getTurn() {
    return this.chess.turn();
  }

  getBoard() {
    return this.chess.board();
  }

  getFen() {
    return this.chess.fen();
  }

  piece(square: Square) {
    return this.chess.get(square);
  }

  moves(from?: Square) {
    return this.chess.moves({ square: from, verbose: true });
  }

  move(from: Square, to: Square, promotion?: PieceSymbol) {
    const move = this.chess.move({ from, to, promotion });
    if (!move) return null;
    const result: MoveResult = {
      move,
      captured: move.captured,
      promotion: move.promotion,
      san: move.san,
      fen: this.chess.fen(),
      turn: this.chess.turn(),
      check: this.chess.inCheck(),
      checkmate: this.chess.isCheckmate(),
      stalemate: this.chess.isStalemate(),
      draw: this.chess.isDraw(),
      insufficient_material: this.chess.isInsufficientMaterial()
    };
    this.listeners.forEach((listener) => listener(result));
    return result;
  }

  undo() {
    const move = this.chess.undo();
    if (move) {
      const result: MoveResult = {
        move,
        captured: move.captured,
        promotion: move.promotion,
        san: move.san,
        fen: this.chess.fen(),
        turn: this.chess.turn(),
        check: this.chess.inCheck(),
        checkmate: this.chess.isCheckmate(),
        stalemate: this.chess.isStalemate(),
        draw: this.chess.isDraw(),
        insufficient_material: this.chess.isInsufficientMaterial()
      };
      this.listeners.forEach((listener) => listener(result));
      return result;
    }
    return null;
  }

  reset() {
    this.chess.reset();
    this.resetListeners.forEach((listener) => listener());
  }

  onMove(listener: (result: MoveResult) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onReset(listener: () => void) {
    this.resetListeners.add(listener);
    return () => this.resetListeners.delete(listener);
  }
}
