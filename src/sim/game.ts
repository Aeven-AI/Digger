// The simulation root. Owns every ported module, runs the game flow as a
// generator, and exposes a small API to the host (renderers, audio, UI).
import { Pc } from './pc';
import { Sprite } from './sprite';
import { Drawing } from './drawing';
import { Digger } from './digger';
import { Monster, type KillCause } from './monster';
import { Bags } from './bags';
import { Scores } from './scores';
import { Input } from './input';
import { Sound, type SoundCmd } from './sound';
import { Main, TICK_MS } from './main';
import { MAX_NAME } from '../name';

export { TICK_MS };

export type Scene = 'attract' | 'intro' | 'play' | 'dying' | 'aftermath' | 'levdone' | 'gameover' | 'initials';

const SKIPPABLE: ReadonlySet<Scene> = new Set<Scene>(['intro', 'dying', 'aftermath', 'levdone', 'gameover']);

export type SimEvent =
  | { type: 'sound'; cmd: SoundCmd; arg: number }
  | { type: 'emerald'; x: number; y: number; n: number }
  | { type: 'octave'; x: number; y: number }
  | { type: 'emeraldCrushed'; x: number; y: number }
  | { type: 'explode'; x: number; y: number }
  | { type: 'monsterSpawn'; mon: number }
  | { type: 'monsterKilled'; mon: number; x: number; y: number; nob: boolean; cause: KillCause }
  | { type: 'bagLand'; bag: number; x: number; y: number; breaks: boolean }
  | { type: 'gold'; x: number; y: number; byDigger: boolean }
  | { type: 'diggerHit'; x: number; y: number; bag: boolean }
  | { type: 'grave'; x: number; y: number }
  | { type: 'bonusStart' }
  | { type: 'score'; points: number; player: number }
  | { type: 'extraLife'; player: number }
  | { type: 'gameStart'; players: number }
  | { type: 'levelStart'; level: number; plan: number; player: number }
  | { type: 'lifeStart'; player: number }
  | { type: 'levelDone'; level: number; player: number }
  | { type: 'gameOver'; player: number; score: number }
  | { type: 'gameEnd' }
  | { type: 'bossSpawn'; hp: number; maxHp: number }
  | { type: 'bossHit'; mon: number; x: number; y: number; hp: number; maxHp: number }
  | { type: 'bossCharge'; x: number; y: number }
  | { type: 'bossKilled'; x: number; y: number; maxHp: number };

export interface HighScoreEntry {
  name: string;
  score: number;
}

export interface GameHost {
  highScores(): HighScoreEntry[];
  isHighScore(score: number): boolean;
}

export interface GameOptions {
  /** Ticks a buffered turn stays pending. 0 = original behaviour. */
  turnBuffer: number;
}

export class Game {
  readonly pc = new Pc();
  readonly sprite = new Sprite(this.pc);
  readonly input = new Input();
  readonly drawing: Drawing;
  readonly digger: Digger;
  readonly monster: Monster;
  readonly bags: Bags;
  readonly scores: Scores;
  readonly sound: Sound;
  readonly main: Main;

  scene: Scene = 'attract';
  attractFrame = 0;
  /** Events emitted since the host last drained them. */
  events: SimEvent[] = [];
  startRequest: { players: number; level: number } | null = null;
  pendingInitials: { player: number; score: number } | null = null;
  /** Number of generator steps taken so far. */
  steps = 0;

  private readonly flow: Generator<number>;

  constructor(
    seed: number,
    private readonly host: GameHost,
    readonly options: GameOptions = { turnBuffer: 0 },
  ) {
    this.drawing = new Drawing(this);
    this.digger = new Digger(this);
    this.monster = new Monster(this);
    this.bags = new Bags(this);
    this.scores = new Scores(this);
    this.sound = new Sound(this);
    this.main = new Main(this, seed);
    this.flow = this.run();
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  highScores(): HighScoreEntry[] {
    return this.host.highScores();
  }

  isHighScore(score: number): boolean {
    return this.host.isHighScore(score);
  }

  /** Advances the game by one step. Returns how long (ms) to wait before the next step. */
  step(): number {
    this.steps++;
    const r = this.flow.next();
    return r.done ? TICK_MS : r.value;
  }

  /** True while the game is in a cut-scene that the player may fast-forward. */
  get skippable(): boolean {
    return SKIPPABLE.has(this.scene);
  }

  get inGame(): boolean {
    return this.scene != 'attract';
  }

  setPlayers(n: number): void {
    if (this.scene == 'attract') this.main.nplayers = n == 2 ? 2 : 1;
  }

  requestStart(players: number, level = 1): void {
    this.setPlayers(players);
    this.startRequest = { players: this.main.nplayers, level: Math.max(1, Math.min(1000, level | 0)) };
  }

  /** Abandon the current game and return to the attract screen. */
  quit(): void {
    if (this.scene == 'attract') return;
    this.input.escape = true;
    this.pendingInitials = null;
  }

  /** Echo the name typed so far onto the classic screen, centred under the prompt. */
  showInitials(s: string): void {
    if (this.scene != 'initials') return;
    const name = s.toUpperCase().slice(0, MAX_NAME);
    const step = 14;
    const startX = 160 - (MAX_NAME * step) / 2;
    for (let i = 0; i < MAX_NAME; i++) {
      const ch = i < name.length ? name[i] : i == name.length ? '_' : ' ';
      this.pc.gwrite(startX + i * step, 130, ch, 3);
    }
  }

  submitInitials(s: string): void {
    this.showInitials(s);
    this.pendingInitials = null;
  }

  private *run(): Generator<number> {
    while (true) {
      yield* this.main.attract();
      const req = this.startRequest!;
      this.startRequest = null;
      this.main.nplayers = req.players;
      yield* this.main.game(req.level);
    }
  }
}
