export type ClockListener = (whiteMs: number, blackMs: number, active: "w" | "b" | null) => void;

export class DualChessClock {
  private whiteMs: number;
  private blackMs: number;
  private incrementMs: number;
  private active: "w" | "b" | null = null;
  private lastTick = 0;
  private rafId = 0;
  private listeners = new Set<ClockListener>();
  private readonly baseMs: number;

  constructor(startMinutes = 10, incrementSeconds = 0) {
    this.baseMs = startMinutes * 60 * 1000;
    this.whiteMs = this.baseMs;
    this.blackMs = this.baseMs;
    this.incrementMs = incrementSeconds * 1000;
  }

  reset() {
    this.whiteMs = this.baseMs;
    this.blackMs = this.baseMs;
    this.active = null;
    this.stop();
    this.emit();
  }

  setActive(side: "w" | "b") {
    if (this.active === side) return;
    this.applyIncrement(this.active);
    this.active = side;
    this.lastTick = performance.now();
    this.tick();
  }

  pause() {
    this.applyIncrement(this.active);
    this.active = null;
    this.stop();
  }

  getTimes() {
    return { white: this.whiteMs, black: this.blackMs, active: this.active };
  }

  onUpdate(listener: ClockListener) {
    this.listeners.add(listener);
    listener(this.whiteMs, this.blackMs, this.active);
    return () => this.listeners.delete(listener);
  }

  private applyIncrement(side: "w" | "b" | null) {
    if (!side || this.incrementMs <= 0) return;
    if (side === "w") this.whiteMs += this.incrementMs;
    else this.blackMs += this.incrementMs;
  }

  private stop() {
    cancelAnimationFrame(this.rafId);
  }

  private tick = () => {
    if (!this.active) return;
    const now = performance.now();
    const delta = now - this.lastTick;
    this.lastTick = now;
    if (this.active === "w") this.whiteMs = Math.max(0, this.whiteMs - delta);
    else this.blackMs = Math.max(0, this.blackMs - delta);
    this.emit();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private emit() {
    this.listeners.forEach((listener) => listener(this.whiteMs, this.blackMs, this.active));
  }
}
