// Runs the sim at its own fixed rate, independent of display refresh, and
// implements pause and cut-scene skipping (fast-forward).
import { Game, TICK_MS, type SimEvent } from '../sim/game';
import { STATEFUL_SOUND_CMDS } from '../sim/sound';
import { captureSnapshot, makeSnapshot, type SpriteSnapshot } from '../render/renderer';

/** Upper bound on steps per skip; a death + level transition is well under this. */
const MAX_SKIP_STEPS = 20000;

export class Driver {
  readonly prev: SpriteSnapshot = makeSnapshot();
  private acc = 0;
  private wait = TICK_MS;
  speed = 1;
  paused = false;
  private skipRequested = false;
  /** Set when the last update() fast-forwarded; the host should resync audio. */
  skipped = false;
  /** Events from the sim not yet consumed by the presentation layer. */
  private pending: SimEvent[] = [];

  constructor(
    readonly game: Game,
    private readonly onSound: (cmd: SimEvent & { type: 'sound' }, skipping: boolean) => void,
  ) {
    captureSnapshot(game, this.prev);
  }

  /** Ask to fast-forward the current cut-scene (ignored if none is playing). */
  skip(): boolean {
    if (!this.game.skippable) return false;
    this.skipRequested = true;
    return true;
  }

  /** Progress (0..1) between the previous and current sim state. */
  get alpha(): number {
    return Math.min(1, this.acc / this.wait);
  }

  update(dtMs: number): SimEvent[] {
    const g = this.game;
    this.skipped = false;
    if (this.paused) return this.flush();
    if (this.skipRequested) {
      this.skipRequested = false;
      let n = 0;
      while (g.skippable && n++ < MAX_SKIP_STEPS) this.stepOnce(true);
      this.acc = 0;
      captureSnapshot(g, this.prev);
      // Visual events from the skipped stretch were dropped: renderers resync from state.
      this.skipped = true;
      return this.flush();
    }
    // Clamp long frames (tab switches) so the game never jumps ahead wildly.
    this.acc += Math.min(dtMs, 250) * this.speed;
    let guard = 0;
    while (this.acc >= this.wait && guard++ < 64) {
      this.acc -= this.wait;
      captureSnapshot(g, this.prev);
      this.stepOnce(false);
    }
    return this.flush();
  }

  private stepOnce(skipping: boolean): void {
    const g = this.game;
    this.wait = g.step();
    for (const e of g.drainEvents()) {
      if (e.type == 'sound') {
        if (!skipping || STATEFUL_SOUND_CMDS.has(e.cmd)) this.onSound(e, skipping);
      } else if (!skipping) this.pending.push(e);
    }
  }

  private flush(): SimEvent[] {
    const e = this.pending;
    this.pending = [];
    return e;
  }
}
