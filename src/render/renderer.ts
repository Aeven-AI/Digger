import type { Game, SimEvent } from '../sim/game';

/** Sprite table positions captured right before the latest sim step, for interpolation. */
export interface SpriteSnapshot {
  x: Int16Array;
  y: Int16Array;
  ch: Int16Array;
  en: Uint8Array;
}

export function makeSnapshot(): SpriteSnapshot {
  return { x: new Int16Array(16), y: new Int16Array(16), ch: new Int16Array(16), en: new Uint8Array(16) };
}

export function captureSnapshot(g: Game, s: SpriteSnapshot): void {
  const sp = g.sprite;
  for (let i = 0; i < 16; i++) {
    s.x[i] = sp.sprx[i];
    s.y[i] = sp.spry[i];
    s.ch[i] = sp.sprch[i];
    s.en[i] = sp.sprenf[i] ? 1 : 0;
  }
}

export interface FrameInfo {
  game: Game;
  prev: SpriteSnapshot;
  /** 0..1 progress from `prev` toward the current state. */
  alpha: number;
  /** Real seconds since the last rendered frame. */
  dt: number;
  /** Seconds since start. */
  time: number;
  /** Events produced by the sim since the last frame (empty after a skip). */
  events: SimEvent[];
  paused: boolean;
  /** CSS px of the screen the docked title menu covers; the scene is framed in the rest. */
  dock: { left: number; bottom: number };
}

export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  render(f: FrameInfo): void;
  resize(width: number, height: number, dpr: number): void;
  /** Called when the renderer becomes visible again, e.g. after a mode switch. */
  activate(g: Game): void;
  deactivate(): void;
}
