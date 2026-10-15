// Game flow: attract screen, levels, lives, players, game over.
// Ported from Main.js. The original used async loops with setInterval/sleep;
// here every wait is a `yield <milliseconds>`, which keeps the sim fully
// deterministic and lets the host fast-forward (skip) any cut-scene.
import type { Game } from './game';
import { LEVELS } from './levels';

/** One gameplay tick, as in the reference port: 1000/13 ms (about 13 Hz). */
export const TICK_MS = Math.floor(1000 / 13);

const digsprorder = [14, 13, 7, 6, 5, 4, 3, 2, 1, 12, 11, 10, 9, 8, 15, 0];
const victoryhop = [0, 4, 6, 4];
const victoryspin = [0, 6, 4, 2];

class GameData {
  lives = 0;
  level = 0;
  dead = false;
  levdone = false;
}

export class Main {
  gamedat = [new GameData(), new GameData()];
  curplayer = 0;
  nplayers = 1;
  penalty = 0;
  /** Ticks since the room started, for the monster pace gate. */
  private monClock = 0;
  levnotdrawn = false;
  flashplayer = false;
  randv: number;

  constructor(
    private readonly g: Game,
    seed: number,
  ) {
    this.randv = seed | 0;
  }

  addlife(pl: number): void {
    this.gamedat[pl - 1].lives++;
    this.g.sound.sound1up();
    this.g.emit({ type: 'extraLife', player: pl - 1 });
  }

  checklevdone(): void {
    const { g } = this;
    /* A room with a Warden in it (or one still to come) is only over when it is down. */
    const warden = g.monster.boss.pending || g.monster.boss.active;
    this.gamedat[this.curplayer].levdone =
      (g.digger.countem() == 0 || g.monster.monleft() == 0) && g.digger.digonscr && !warden;
  }

  cleartopline(): void {
    this.g.drawing.outtext('                          ', 0, 0, 3);
    this.g.drawing.outtext(' ', 308, 0, 3);
  }

  *drawscreen(): Generator<number> {
    const { g } = this;
    g.drawing.creatembspr();
    yield* g.drawing.drawstatics();
    yield* g.bags.drawbags();
    yield* g.digger.drawemeralds();
    g.digger.initdigger();
    g.monster.initmonsters();
  }

  getnplayers(): number {
    return this.nplayers;
  }
  getcplayer(): number {
    return this.curplayer;
  }
  getlevch(x: number, y: number, l: number): string {
    if (l == 0) l++;
    return LEVELS[l - 1][y].charAt(x);
  }
  getlives(pl: number): number {
    return this.gamedat[pl - 1].lives;
  }
  incpenalty(): void {
    this.penalty++;
  }

  initchars(): void {
    this.g.drawing.initmbspr();
    this.g.digger.initdigger();
    this.g.monster.initmonsters();
  }

  initlevel(): void {
    const { g } = this;
    this.gamedat[this.curplayer].levdone = false;
    g.drawing.makefield();
    g.digger.makeemfield();
    g.bags.initbags();
    this.levnotdrawn = true;
  }

  levno(): number {
    return this.gamedat[this.curplayer].level;
  }
  levof10(): number {
    const l = this.gamedat[this.curplayer].level;
    return l > 10 ? 10 : l;
  }
  /** Level plan: 12345678, 678, (5678) 247 times, 5 forever */
  levplan(): number {
    let l = this.levno();
    if (l > 8) l = (l & 3) + 5;
    return l;
  }

  randno(n: number): number {
    this.randv = (Math.imul(this.randv, 0x15a4e35) + 1) & 0x7fffffff;
    return (this.randv & 0x7fffffff) % n;
  }

  setdead(b: boolean): void {
    this.gamedat[this.curplayer].dead = b;
  }

  shownplayers(): void {
    const d = this.g.drawing;
    if (this.nplayers == 1) {
      d.outtext('ONE', 220, 25, 3);
      d.outtext(' PLAYER ', 192, 39, 3);
    } else {
      d.outtext('TWO', 220, 25, 3);
      d.outtext(' PLAYERS', 184, 39, 3);
    }
  }

  // ---------------------------------------------------------------------------
  // Flows

  /** Title screen with the Nobbin/Hobbin/Digger/Gold/Emerald/Bonus introductions. Runs until a game is requested. */
  *attract(): Generator<number> {
    const { g } = this;
    const d = g.drawing;
    g.scene = 'attract';
    g.sound.soundstop();
    g.sprite.setsprorder(digsprorder);
    d.creatembspr();
    g.pc.gclear();
    g.pc.gtitle();
    d.outtext('D I G G E R', 100, 0, 3);
    this.shownplayers();
    g.scores.showtable(g.highScores());
    // The original idles ~4 s before the first introduction; start closer to it.
    let frame = 40;
    let x = 0;
    let shown = this.nplayers;
    while (g.startRequest == null) {
      yield TICK_MS;
      if (shown != this.nplayers) {
        shown = this.nplayers;
        this.shownplayers();
      }
      if (frame == 0) for (let t = 54; t < 174; t += 12) d.outtext('            ', 164, t, 0);
      if (frame == 50) {
        g.sprite.movedrawspr(8, 292, 63);
        x = 292;
      }
      if (frame > 50 && frame <= 77) {
        x -= 4;
        d.drawmon(0, true, 4, x, 63);
      }
      if (frame > 77) d.drawmon(0, true, 0, 184, 63);
      if (frame == 83) d.outtext('NOBBIN', 216, 64, 2);
      if (frame == 90) {
        g.sprite.movedrawspr(9, 292, 82);
        d.drawmon(1, false, 4, 292, 82);
        x = 292;
      }
      if (frame > 90 && frame <= 117) {
        x -= 4;
        d.drawmon(1, false, 4, x, 82);
      }
      if (frame > 117) d.drawmon(1, false, 0, 184, 82);
      if (frame == 123) d.outtext('HOBBIN', 216, 83, 2);
      if (frame == 130) {
        g.sprite.movedrawspr(0, 292, 101);
        d.drawdigger(4, 292, 101, true);
        x = 292;
      }
      if (frame > 130 && frame <= 157) {
        x -= 4;
        d.drawdigger(4, x, 101, true);
      }
      if (frame > 157) d.drawdigger(0, 184, 101, true);
      if (frame == 163) d.outtext('DIGGER', 216, 102, 2);
      if (frame == 178) {
        g.sprite.movedrawspr(1, 184, 120);
        d.drawgold(1, 0, 184, 120);
      }
      if (frame == 183) d.outtext('GOLD', 216, 121, 2);
      if (frame == 198) d.drawemerald(184, 141);
      if (frame == 203) d.outtext('EMERALD', 216, 140, 2);
      if (frame == 218) d.drawbonus(184, 158);
      if (frame == 223) d.outtext('BONUS', 216, 159, 2);
      g.attractFrame = frame;
      frame++;
      if (frame > 250) frame = 0;
    }
  }

  *game(startLevel: number): Generator<number> {
    const { g } = this;
    const gd = this.gamedat;
    // Clear the attract-screen sprites.
    for (let i = 0; i < 16; i++) g.sprite.sprenf[i] = false;
    gd[0].level = startLevel;
    gd[0].lives = 3;
    if (this.nplayers == 2) {
      gd[1].level = startLevel;
      gd[1].lives = 3;
    } else gd[1].lives = 0;
    g.pc.gclear();
    this.curplayer = 0;
    this.initlevel();
    this.curplayer = 1;
    this.initlevel();
    g.scores.zeroscores();
    g.digger.bonusvisible = true;
    if (this.nplayers == 2) this.flashplayer = true;
    this.curplayer = 0;
    g.emit({ type: 'gameStart', players: this.nplayers });
    while ((gd[0].lives != 0 || gd[1].lives != 0) && !g.input.escape) {
      gd[this.curplayer].dead = false;
      while (!gd[this.curplayer].dead && gd[this.curplayer].lives != 0 && !g.input.escape) {
        g.drawing.initmbspr();
        yield* this.play();
      }
      if (gd[1 - this.curplayer].lives != 0) {
        this.curplayer = 1 - this.curplayer;
        this.flashplayer = this.levnotdrawn = true;
      }
    }
    g.input.escape = false;
    g.sound.soundstop();
    g.emit({ type: 'gameEnd' });
  }

  private tick(): void {
    const { g } = this;
    this.penalty = 0;
    g.digger.dodigger();
    /* Monster step gate: see monsterPace(). A charging Warden ignores it. */
    this.monClock++;
    const pace = this.monsterPace();
    if (pace <= 1 || this.monClock % pace == 0 || g.monster.bossCharging()) g.monster.domonsters();
    g.bags.dobags();
    if (this.penalty > 8) g.monster.incmont(this.penalty - 8);
    this.checklevdone();
  }

  /**
   * Ticks between monster steps. The original moved every monster on every tick;
   * here the opening rooms run a slower cadence so a first game is survivable, and
   * the schedule closes on the original speed by the time the first Warden appears.
   * @returns ticks per monster step, 1 meaning the original cadence.
   */
  monsterPace(): number {
    const l = this.levno();
    if (l <= 1) return 4;
    if (l <= 3) return 3;
    if (l <= 6) return 2;
    return 1;
  }

  *play(): Generator<number> {
    const { g } = this;
    const gd = this.gamedat;
    const cur = () => gd[this.curplayer];

    if (this.levnotdrawn) {
      this.levnotdrawn = false;
      g.scene = 'intro';
      g.emit({ type: 'levelStart', level: this.levno(), plan: this.levplan(), player: this.curplayer });
      yield* this.drawscreen();
      if (this.flashplayer) {
        this.flashplayer = false;
        const pldispbuf = 'PLAYER ' + (this.curplayer == 0 ? '1' : '2');
        this.cleartopline();
        for (let t = 0; t < 15; t++)
          for (let c = 1; c <= 3; c++) {
            g.drawing.outtext(pldispbuf, 108, 0, c);
            g.scores.writecurscore(c);
            yield 40;
            if (g.input.escape) return;
          }
        g.scores.drawscores();
        g.scores.addscore(0);
      }
    } else {
      this.initchars();
      g.emit({ type: 'lifeStart', player: this.curplayer });
    }

    g.drawing.outtext('        ', 108, 0, 3);
    g.scores.initscores();
    g.drawing.drawlives();
    g.sound.music(1);
    g.input.readdir();
    g.scene = 'play';

    while (true) {
      yield TICK_MS;
      if (cur().dead || cur().levdone || g.input.escape) break;
      this.tick();
      g.scene = g.digger.digonscr ? 'play' : 'dying';
    }

    g.digger.erasedigger();
    g.sound.musicoff();
    g.scene = 'aftermath';
    let t = 20;
    while (true) {
      yield TICK_MS;
      if (!((g.bags.getnmovingbags() != 0 || t != 0) && !g.input.escape)) break;
      if (t != 0) t--;
      this.penalty = 0;
      g.bags.dobags();
      g.digger.dodigger();
      g.monster.domonsters();
      if (this.penalty < 8) t = 0; // side effect of the original's delay loop
    }

    g.sound.soundstop();
    g.digger.killfire();
    g.digger.erasebonus();
    g.bags.cleanupbags();
    g.drawing.savefield();
    g.monster.erasemonsters();

    if (cur().levdone) {
      g.scene = 'levdone';
      g.emit({ type: 'levelDone', level: this.levno(), player: this.curplayer });
      g.sound.soundlevdone();
      yield* this.victorydance();
    }
    if (g.digger.countem() == 0 || cur().levdone) {
      cur().level++;
      if (cur().level > 1000) cur().level = 1000;
      this.initlevel();
    } else if (cur().dead) {
      cur().lives--;
      g.drawing.drawlives();
      if (cur().lives == 0 && !g.input.escape) yield* this.endofgame();
    }
  }

  /**
   * A modern addition: the original left an empty field for the 3.2 s of the
   * level-complete jingle. Here the Digger comes back and hops on the spot, turning
   * left and right, with a pirouette to finish. Nothing but its own sprite changes.
   */
  *victorydance(): Generator<number> {
    const { g } = this;
    const x = g.digger.diggerx;
    const y = g.digger.diggery;
    g.sprite.initspr(0, 1, 4, 15, 0, 0);
    g.sprite.movedrawspr(0, x, y);
    for (let i = 0; i < 64; i++) {
      if ((i & 1) == 0) {
        const k = i >> 1;
        const dir = k >= 24 ? victoryspin[k & 3] : (k & 4) != 0 ? 4 : 0;
        g.drawing.drawdigger(dir, x, y - victoryhop[k & 3], (k & 1) == 0);
      }
      yield 50;
    }
    g.sprite.erasespr(0);
  }

  *endofgame(): Generator<number> {
    const { g } = this;
    const d = g.drawing;
    g.scores.addscore(0);
    const score = this.curplayer == 0 ? g.scores.score1 : g.scores.score2;
    g.emit({ type: 'gameOver', player: this.curplayer, score });
    if (g.isHighScore(score)) {
      g.pc.gclear();
      g.scores.drawscores();
      d.outtext('PLAYER ' + (this.curplayer + 1), 108, 0, 2);
      d.outtext(' NEW HIGH SCORE ', 64, 40, 2);
      d.outtext('ENTER YOUR', 100, 70, 3);
      d.outtext('   NAME', 100, 90, 3);
      g.sound.killsound();
      g.scene = 'initials';
      g.pendingInitials = { player: this.curplayer, score };
      g.showInitials('');
      while (g.pendingInitials) yield 50;
      g.pc.gclear();
      g.pc.ginten(0);
    } else {
      this.cleartopline();
      d.outtext('GAME OVER', 104, 0, 3);
      g.sound.killsound();
      g.scene = 'gameover';
      for (let j = 0; j < 20; j++)
        for (let i = 0; i < 2; i++) {
          g.pc.ginten((1 - i) & 1);
          yield 50;
        }
      d.outtext('         ', 104, 0, 3);
    }
  }
}
