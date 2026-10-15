// The sim never makes noise itself: every Sound.js entry point becomes a command
// in the event stream. Audio backends (classic PC-speaker emulation, HD jazz)
// subscribe to these commands.
import type { Game } from './game';

export type SoundCmd =
  | 'music'
  | 'musicoff'
  | 'soundstop'
  | 'soundlevdone'
  | 'sound1up'
  | 'soundbonus'
  | 'soundbonusoff'
  | 'soundbreak'
  | 'soundddie'
  | 'soundeatm'
  | 'soundem'
  | 'soundemerald'
  | 'soundexplode'
  | 'soundfall'
  | 'soundfalloff'
  | 'soundfire'
  | 'soundfireoff'
  | 'soundgold'
  | 'soundwobble'
  | 'soundwobbleoff'
  | 'killsound';

/** Commands that change ongoing state (as opposed to one-shot effects). */
export const STATEFUL_SOUND_CMDS: ReadonlySet<SoundCmd> = new Set<SoundCmd>([
  'music',
  'musicoff',
  'soundstop',
  'soundbonusoff',
  'soundfalloff',
  'soundfireoff',
  'soundwobbleoff',
  'killsound',
]);

export class Sound {
  /** Tracks the last requested tune so backends can resync after a skip (-1 = none). */
  tune = -1;
  /** Last-sent state of the looping effects, so repeated "off"s don't spam the stream. */
  private falling = false;
  private wobbling = false;

  constructor(private readonly g: Game) {}

  private cmd(cmd: SoundCmd, arg = 0): void {
    this.g.emit({ type: 'sound', cmd, arg });
  }

  getmusicflag(): boolean {
    return true;
  }

  music(tune: number): void {
    this.tune = tune;
    this.cmd('music', tune);
  }
  musicoff(): void {
    this.tune = -1;
    this.cmd('musicoff');
  }
  soundstop(): void {
    this.tune = -1;
    this.falling = this.wobbling = false;
    this.cmd('soundstop');
  }
  killsound(): void {
    this.cmd('killsound');
  }
  soundlevdone(): void {
    this.cmd('soundlevdone');
  }
  sound1up(): void {
    this.cmd('sound1up');
  }
  soundbonus(): void {
    this.cmd('soundbonus');
  }
  soundbonusoff(): void {
    this.cmd('soundbonusoff');
  }
  soundbreak(): void {
    this.cmd('soundbreak');
  }
  soundddie(): void {
    this.cmd('soundddie');
  }
  soundeatm(): void {
    this.cmd('soundeatm');
  }
  soundem(): void {
    this.cmd('soundem');
  }
  soundemerald(n: number): void {
    this.cmd('soundemerald', n);
  }
  soundexplode(): void {
    this.cmd('soundexplode');
  }
  soundfall(): void {
    this.falling = true;
    this.cmd('soundfall');
  }
  soundfalloff(): void {
    if (!this.falling) return;
    this.falling = false;
    this.cmd('soundfalloff');
  }
  soundfire(): void {
    this.cmd('soundfire');
  }
  soundfireoff(): void {
    this.cmd('soundfireoff');
  }
  soundgold(): void {
    this.cmd('soundgold');
  }
  soundwobble(wt: number): void {
    this.wobbling = true;
    this.cmd('soundwobble', wt);
  }
  soundwobbleoff(): void {
    if (!this.wobbling) return;
    this.wobbling = false;
    this.cmd('soundwobbleoff');
  }
}
