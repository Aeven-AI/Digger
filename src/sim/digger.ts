// The player's Digger: movement, digging, emeralds, firing, bonus mode and death.
// Ported from Digger.js, minus all DOM/canvas code.
import type { Game } from './game';

const embox = [8, 12, 12, 9, 16, 12, 6, 9];
const deatharc = [3, 5, 6, 6, 5, 3, 0];

export function reversedir(dir: number): number {
  switch (dir) {
    case 0:
      return 4;
    case 4:
      return 0;
    case 2:
      return 6;
    case 6:
      return 2;
  }
  return dir;
}

export class Digger {
  diggerx = 0;
  diggery = 0;
  diggerh = 0;
  diggerv = 0;
  diggerrx = 0;
  diggerry = 0;
  digmdir = 0;
  digdir = 0;
  digtime = 0;
  rechargetime = 0;
  firex = 0;
  firey = 0;
  firedir = 0;
  expsn = 0;
  deathstage = 0;
  deathbag = 0;
  deathani = 0;
  deathtime = 0;
  startbonustimeleft = 0;
  bonustimeleft = 0;
  eatmsc = 0;
  emocttime = 0;
  emn = 0;
  emmask = 0;
  emfield = new Array<number>(150).fill(0);

  digonscr = false;
  notfiring = false;
  bonusvisible = false;
  bonusmode = false;
  diggervisible = false;

  /** Turn buffering (a modern QoL addition; 0 disables it). */
  pendingDir = -1;
  pendingTtl = 0;

  constructor(private readonly g: Game) {}

  checkdiggerunderbag(h: number, v: number): boolean {
    if (this.digmdir == 2 || this.digmdir == 6)
      if (Math.floor((this.diggerx - 12) / 20) == h)
        if (Math.floor((this.diggery - 18) / 18) == v || Math.floor((this.diggery - 18) / 18) + 1 == v) return true;
    return false;
  }

  countem(): number {
    let n = 0;
    for (let x = 0; x < 15; x++) for (let y = 0; y < 10; y++) if ((this.emfield[y * 15 + x] & this.emmask) != 0) n++;
    return n;
  }

  createbonus(): void {
    this.bonusvisible = true;
    this.g.drawing.drawbonus(292, 18);
  }

  diggerdie(): void {
    const { g } = this;
    switch (this.deathstage) {
      case 1:
        if (g.bags.bagy(this.deathbag) + 6 > this.diggery) this.diggery = g.bags.bagy(this.deathbag) + 6;
        g.drawing.drawdigger(15, this.diggerx, this.diggery, false);
        g.main.incpenalty();
        if (g.bags.getbagdir(this.deathbag) + 1 == 0) {
          g.sound.soundddie();
          this.deathtime = 5;
          this.deathstage = 2;
          this.deathani = 0;
          this.diggery -= 6;
        }
        break;
      case 2: {
        if (this.deathtime != 0) {
          this.deathtime--;
          break;
        }
        if (this.deathani == 0) {
          g.sound.music(2);
          g.emit({ type: 'grave', x: this.diggerx, y: this.diggery });
        }
        const clbits = g.drawing.drawdigger(14 - this.deathani, this.diggerx, this.diggery, false);
        g.main.incpenalty();
        if (this.deathani == 0 && (clbits & 0x3f00) != 0) g.monster.killmonsters(clbits);
        if (this.deathani < 4) {
          this.deathani++;
          this.deathtime = 2;
        } else {
          this.deathstage = 4;
          this.deathtime = g.sound.getmusicflag() ? 60 : 10;
        }
        break;
      }
      case 3:
        this.deathstage = 5;
        this.deathani = 0;
        this.deathtime = 0;
        break;
      case 5:
        if (this.deathani >= 0 && this.deathani <= 6) {
          g.drawing.drawdigger(15, this.diggerx, this.diggery - deatharc[this.deathani], false);
          if (this.deathani == 6) g.sound.musicoff();
          g.main.incpenalty();
          this.deathani++;
          if (this.deathani == 1) g.sound.soundddie();
          if (this.deathani == 7) {
            this.deathtime = 5;
            this.deathani = 0;
            this.deathstage = 2;
          }
        }
        break;
      case 4:
        if (this.deathtime != 0) this.deathtime--;
        else g.main.setdead(true);
    }
  }

  dodigger(): void {
    const { g } = this;
    if (this.expsn != 0) this.drawexplosion();
    else this.updatefire();
    if (this.diggervisible)
      if (this.digonscr)
        if (this.digtime != 0) {
          g.drawing.drawdigger(this.digmdir, this.diggerx, this.diggery, this.notfiring && this.rechargetime == 0);
          g.main.incpenalty();
          this.digtime--;
        } else this.updatedigger();
      else this.diggerdie();
    if (this.bonusmode && this.digonscr) {
      if (this.bonustimeleft != 0) {
        this.bonustimeleft--;
        if (this.startbonustimeleft != 0 || this.bonustimeleft < 20) {
          if (this.startbonustimeleft) this.startbonustimeleft--;
          if ((this.bonustimeleft & 1) != 0) {
            g.pc.ginten(0);
            g.sound.soundbonus();
          } else {
            g.pc.ginten(1);
            g.sound.soundbonus();
          }
          if (this.startbonustimeleft == 0) {
            g.sound.music(0);
            g.sound.soundbonusoff();
            g.pc.ginten(1);
          }
        }
      } else {
        this.endbonusmode();
        g.sound.soundbonusoff();
        g.sound.music(1);
      }
    }
    if (this.bonusmode && !this.digonscr) {
      this.endbonusmode();
      g.sound.soundbonusoff();
      g.sound.music(1);
    }
    if (this.emocttime > 0) this.emocttime--;
  }

  *drawemeralds(): Generator<number> {
    this.emmask = 1 << this.g.main.getcplayer();
    for (let x = 0; x < 15; x++) {
      for (let y = 0; y < 10; y++) {
        if ((this.emfield[y * 15 + x] & this.emmask) != 0) this.g.drawing.drawemerald(x * 20 + 12, y * 18 + 21);
      }
      yield 12;
    }
  }

  drawexplosion(): void {
    switch (this.expsn) {
      case 1:
        this.g.sound.soundexplode();
        this.g.emit({ type: 'explode', x: this.firex, y: this.firey });
      // falls through
      case 2:
      case 3:
        this.g.drawing.drawfire(this.firex, this.firey, this.expsn);
        this.g.main.incpenalty();
        this.expsn++;
        break;
      default:
        this.killfire();
        this.expsn = 0;
    }
  }

  endbonusmode(): void {
    this.bonusmode = false;
    this.g.pc.ginten(0);
  }

  erasebonus(): void {
    if (this.bonusvisible) {
      this.bonusvisible = false;
      this.g.sprite.erasespr(14);
    }
    this.g.pc.ginten(0);
  }

  erasedigger(): void {
    this.g.sprite.erasespr(0);
    this.diggervisible = false;
  }

  hitemerald(x: number, y: number, rx: number, ry: number, dir: number): boolean {
    let hit = false;
    if (dir < 0 || dir > 6 || (dir & 1) != 0) return hit;
    if (dir == 0 && rx != 0) x++;
    if (dir == 6 && ry != 0) y++;
    const r = dir == 0 || dir == 4 ? rx : ry;
    if ((this.emfield[y * 15 + x] & this.emmask) != 0) {
      if (r == embox[dir]) {
        this.g.drawing.drawemerald(x * 20 + 12, y * 18 + 21);
        this.g.main.incpenalty();
      }
      if (r == embox[dir + 1]) {
        this.g.drawing.eraseemerald(x * 20 + 12, y * 18 + 21);
        this.g.main.incpenalty();
        hit = true;
        this.emfield[y * 15 + x] &= ~this.emmask;
      }
    }
    return hit;
  }

  initbonusmode(): void {
    this.bonusmode = true;
    this.erasebonus();
    this.g.pc.ginten(1);
    this.bonustimeleft = 250 - this.g.main.levof10() * 20;
    this.startbonustimeleft = 20;
    this.eatmsc = 1;
  }

  initdigger(): void {
    this.diggerv = 9;
    this.digmdir = 4;
    this.diggerh = 7;
    this.diggerx = this.diggerh * 20 + 12;
    this.digdir = 0;
    this.diggerrx = 0;
    this.diggerry = 0;
    this.digtime = 0;
    this.digonscr = true;
    this.deathstage = 1;
    this.diggervisible = true;
    this.diggery = this.diggerv * 18 + 18;
    this.g.sprite.movedrawspr(0, this.diggerx, this.diggery);
    this.notfiring = true;
    this.emocttime = 0;
    this.emn = 0;
    this.bonusvisible = this.bonusmode = false;
    this.g.input.firepressed = false;
    this.expsn = 0;
    this.rechargetime = 0;
    this.pendingDir = -1;
    this.pendingTtl = 0;
  }

  killdigger(stage: number, bag: number): void {
    if (this.deathstage < 2 || this.deathstage > 4) {
      if (this.digonscr) this.g.emit({ type: 'diggerHit', x: this.diggerx, y: this.diggery, bag: stage == 1 });
      this.digonscr = false;
      this.deathstage = stage;
      this.deathbag = bag;
    }
  }

  killemerald(x: number, y: number): void {
    if ((this.emfield[y * 15 + x + 15] & this.emmask) != 0) {
      this.emfield[y * 15 + x + 15] &= ~this.emmask;
      this.g.drawing.eraseemerald(x * 20 + 12, (y + 1) * 18 + 21);
      this.g.emit({ type: 'emeraldCrushed', x: x * 20 + 12, y: (y + 1) * 18 + 21 });
    }
  }

  killfire(): void {
    if (!this.notfiring) {
      this.notfiring = true;
      this.g.sprite.erasespr(15);
      this.g.sound.soundfireoff();
    }
  }

  makeemfield(): void {
    const m = this.g.main;
    this.emmask = 1 << m.getcplayer();
    for (let x = 0; x < 15; x++)
      for (let y = 0; y < 10; y++)
        if (m.getlevch(x, y, m.levplan()) == 'C') this.emfield[y * 15 + x] |= this.emmask;
        else this.emfield[y * 15 + x] &= ~this.emmask;
  }

  /** Whether a turn into `d` can be taken right now (the original's alignment rule). */
  private canturn(d: number): boolean {
    if (d == 2 || d == 6) return this.diggerrx == 0;
    if (d == 0 || d == 4) return this.diggerry == 0;
    return false;
  }

  /** Applies turn buffering to the raw input direction. */
  private bufferdir(dir: number): number {
    const window = this.g.options.turnBuffer;
    if (window <= 0) return dir;
    const valid = (d: number) => d == 0 || d == 2 || d == 4 || d == 6;
    if (valid(dir) && dir != this.digdir && !this.canturn(dir)) {
      this.pendingDir = dir;
      this.pendingTtl = window;
    }
    if (this.pendingTtl > 0) {
      if (this.canturn(this.pendingDir)) {
        const d = this.pendingDir;
        this.pendingTtl = 0;
        return d;
      }
      this.pendingTtl--;
      if (dir == -1 && valid(this.digdir)) return this.digdir;
    }
    return dir;
  }

  updatedigger(): void {
    const { g } = this;
    let push = false;
    g.input.readdir();
    const dir = this.bufferdir(g.input.getdir());
    const ddir = dir == 0 || dir == 2 || dir == 4 || dir == 6 ? dir : -1;
    if (this.diggerrx == 0 && (ddir == 2 || ddir == 6)) this.digdir = this.digmdir = ddir;
    if (this.diggerry == 0 && (ddir == 4 || ddir == 0)) this.digdir = this.digmdir = ddir;
    if (dir == -1) this.digmdir = -1;
    else this.digmdir = this.digdir;
    if (
      (this.diggerx == 292 && this.digmdir == 0) ||
      (this.diggerx == 12 && this.digmdir == 4) ||
      (this.diggery == 180 && this.digmdir == 6) ||
      (this.diggery == 18 && this.digmdir == 2)
    )
      this.digmdir = -1;
    const diggerox = this.diggerx;
    const diggeroy = this.diggery;
    if (this.digmdir != -1) g.drawing.eatfield(diggerox, diggeroy, this.digmdir);
    switch (this.digmdir) {
      case 0:
        g.drawing.drawrightblob(this.diggerx, this.diggery);
        this.diggerx += 4;
        break;
      case 4:
        g.drawing.drawleftblob(this.diggerx, this.diggery);
        this.diggerx -= 4;
        break;
      case 2:
        g.drawing.drawtopblob(this.diggerx, this.diggery);
        this.diggery -= 3;
        break;
      case 6:
        g.drawing.drawbottomblob(this.diggerx, this.diggery);
        this.diggery += 3;
        break;
    }
    const eh = Math.floor((this.diggerx - 12) / 20);
    const ev = Math.floor((this.diggery - 18) / 18);
    if (this.hitemerald(eh, ev, (this.diggerx - 12) % 20, (this.diggery - 18) % 18, this.digmdir)) {
      if (this.emocttime == 0) this.emn = 0;
      g.scores.scoreemerald();
      g.sound.soundem();
      g.sound.soundemerald(this.emn);
      g.emit({ type: 'emerald', x: this.diggerx, y: this.diggery, n: this.emn });
      this.emn++;
      if (this.emn == 8) {
        this.emn = 0;
        g.scores.scoreoctave();
        g.emit({ type: 'octave', x: this.diggerx, y: this.diggery });
      }
      this.emocttime = 9;
    }
    const clbits = g.drawing.drawdigger(this.digdir, this.diggerx, this.diggery, this.notfiring && this.rechargetime == 0);
    g.main.incpenalty();
    if ((g.bags.bagbits() & clbits) != 0) {
      if (this.digmdir == 0 || this.digmdir == 4) {
        push = g.bags.pushbags(this.digmdir, clbits);
        this.digtime++;
      } else if (!g.bags.pushudbags(clbits)) push = false;
      if (!push) {
        /* Strange, push not completely defined */
        this.diggerx = diggerox;
        this.diggery = diggeroy;
        g.drawing.drawdigger(this.digmdir, this.diggerx, this.diggery, this.notfiring && this.rechargetime == 0);
        g.main.incpenalty();
        this.digdir = reversedir(this.digmdir);
      }
    }
    if ((clbits & 0x3f00) != 0 && this.bonusmode)
      for (let nmon = g.monster.killmonsters(clbits, 'eaten'); nmon != 0; nmon--) {
        g.sound.soundeatm();
        g.scores.scoreeatm();
      }
    if ((clbits & 0x4000) != 0) {
      g.scores.scorebonus();
      this.initbonusmode();
      g.emit({ type: 'bonusStart' });
    }
    this.diggerh = Math.floor((this.diggerx - 12) / 20);
    this.diggerrx = (this.diggerx - 12) % 20;
    this.diggerv = Math.floor((this.diggery - 18) / 18);
    this.diggerry = (this.diggery - 18) % 18;
  }

  updatefire(): void {
    const { g } = this;
    const pc = g.pc;
    let pix = 0;
    if (this.notfiring) {
      if (this.rechargetime != 0) this.rechargetime--;
      else if (g.input.getfirepflag())
        if (this.digonscr) {
          this.rechargetime = g.main.levof10() * 3 + 60;
          this.notfiring = false;
          switch (this.digdir) {
            case 0:
              this.firex = this.diggerx + 8;
              this.firey = this.diggery + 4;
              break;
            case 4:
              this.firex = this.diggerx;
              this.firey = this.diggery + 4;
              break;
            case 2:
              this.firex = this.diggerx + 4;
              this.firey = this.diggery;
              break;
            case 6:
              this.firex = this.diggerx + 4;
              this.firey = this.diggery + 8;
          }
          this.firedir = this.digdir;
          g.sprite.movedrawspr(15, this.firex, this.firey);
          g.sound.soundfire();
        }
    } else {
      switch (this.firedir) {
        case 0:
          this.firex += 8;
          pix = pc.ggetpix(this.firex, this.firey + 4) | pc.ggetpix(this.firex + 4, this.firey + 4);
          break;
        case 4:
          this.firex -= 8;
          pix = pc.ggetpix(this.firex, this.firey + 4) | pc.ggetpix(this.firex + 4, this.firey + 4);
          break;
        case 2:
          this.firey -= 7;
          pix = 0;
          for (let i = 0; i < 7; i++) pix |= pc.ggetpix(this.firex + 4, this.firey + i);
          pix &= 0xc0;
          break;
        case 6:
          this.firey += 7;
          pix = 0;
          for (let i = 0; i < 7; i++) pix |= pc.ggetpix(this.firex, this.firey + i);
          pix &= 3;
          break;
      }
      const clbits = g.drawing.drawfire(this.firex, this.firey, 0);
      g.main.incpenalty();
      if ((clbits & 0x3f00) != 0)
        for (let mon = 0, b = 256; mon < 6; mon++, b <<= 1)
          if ((clbits & b) != 0) {
            g.monster.killmon(mon, 'shot');
            g.scores.scorekill();
            this.expsn = 1;
          }
      if ((clbits & 0x40fe) != 0) this.expsn = 1;
      switch (this.firedir) {
        case 0:
          if (this.firex > 296) this.expsn = 1;
          else if (pix != 0 && clbits == 0) {
            this.expsn = 1;
            this.firex -= 8;
            g.drawing.drawfire(this.firex, this.firey, 0);
          }
          break;
        case 4:
          if (this.firex < 16) this.expsn = 1;
          else if (pix != 0 && clbits == 0) {
            this.expsn = 1;
            this.firex += 8;
            g.drawing.drawfire(this.firex, this.firey, 0);
          }
          break;
        case 2:
          if (this.firey < 15) this.expsn = 1;
          else if (pix != 0 && clbits == 0) {
            this.expsn = 1;
            this.firey += 7;
            g.drawing.drawfire(this.firex, this.firey, 0);
          }
          break;
        case 6:
          if (this.firey > 183) this.expsn = 1;
          else if (pix != 0 && clbits == 0) {
            this.expsn = 1;
            this.firey -= 7;
            g.drawing.drawfire(this.firex, this.firey, 0);
          }
      }
    }
  }
}
