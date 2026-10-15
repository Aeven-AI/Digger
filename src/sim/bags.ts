// Gold bags: wobble, fall, push, break into gold. Ported from Bags.js.
import type { Game } from './game';
import { reversedir } from './digger';

export class BagData {
  x = 0;
  y = 0;
  h = 0;
  v = 0;
  xr = 0;
  yr = 0;
  dir = 0;
  wt = 0;
  gt = 0;
  fallh = 0;
  wobbling = false;
  unfallen = false;
  exist = false;

  copyFrom(t: BagData): void {
    Object.assign(this, t);
  }
}

const wblanim = [2, 0, 1, 0];
const bags8 = () => [0, 1, 2, 3, 4, 5, 6, 7].map(() => new BagData());

export class Bags {
  bagdat1 = bags8();
  bagdat2 = bags8();
  bagdat = bags8();
  pushcount = 0;
  goldtime = 0;

  constructor(private readonly g: Game) {}

  bagbits(): number {
    let bags = 0;
    for (let bag = 1, b = 2; bag < 8; bag++, b <<= 1) if (this.bagdat[bag].exist) bags |= b;
    return bags;
  }

  baghitground(bag: number): void {
    const bd = this.bagdat[bag];
    if (bd.dir == 6 && bd.fallh > 1) bd.gt = 1;
    else bd.fallh = 0;
    if (bd.dir == 6) this.g.emit({ type: 'bagLand', bag, x: bd.x, y: bd.y, breaks: bd.gt == 1 });
    bd.dir = -1;
    bd.wt = 15;
    bd.wobbling = false;
    const clbits = this.g.drawing.drawgold(bag, 0, bd.x, bd.y);
    this.g.main.incpenalty();
    for (let bn = 1, b = 2; bn < 8; bn++, b <<= 1) if ((b & clbits) != 0) this.removebag(bn);
  }

  bagy(bag: number): number {
    return this.bagdat[bag].y;
  }

  cleanupbags(): void {
    this.g.sound.soundfalloff();
    for (let bpa = 1; bpa < 8; bpa++) {
      const b = this.bagdat[bpa];
      if (b.exist && ((b.h == 7 && b.v == 9) || b.xr != 0 || b.yr != 0 || b.gt != 0 || b.fallh != 0 || b.wobbling)) {
        b.exist = false;
        this.g.sprite.erasespr(bpa);
      }
      if (this.g.main.getcplayer() == 0) this.bagdat1[bpa].copyFrom(b);
      else this.bagdat2[bpa].copyFrom(b);
    }
  }

  dobags(): void {
    const { g } = this;
    let soundfalloffflag = true;
    let soundwobbleoffflag = true;
    for (let bag = 1; bag < 8; bag++) {
      const b = this.bagdat[bag];
      if (b.exist) {
        if (b.gt != 0) {
          if (b.gt == 1) {
            g.sound.soundbreak();
            g.drawing.drawgold(bag, 4, b.x, b.y);
            g.main.incpenalty();
          }
          if (b.gt == 3) {
            g.drawing.drawgold(bag, 5, b.x, b.y);
            g.main.incpenalty();
          }
          if (b.gt == 5) {
            g.drawing.drawgold(bag, 6, b.x, b.y);
            g.main.incpenalty();
          }
          b.gt++;
          if (b.gt == this.goldtime) this.removebag(bag);
          else if (b.v < 9 && b.gt < this.goldtime - 10)
            if ((g.monster.getfield(b.h, b.v + 1) & 0x2000) == 0) b.gt = this.goldtime - 10;
        } else this.updatebag(bag);
      }
    }
    for (let bag = 1; bag < 8; bag++) {
      const b = this.bagdat[bag];
      if (b.dir == 6 && b.exist) soundfalloffflag = false;
      if (b.dir != 6 && b.wobbling && b.exist) soundwobbleoffflag = false;
    }
    if (soundfalloffflag) g.sound.soundfalloff();
    if (soundwobbleoffflag) g.sound.soundwobbleoff();
  }

  *drawbags(): Generator<number> {
    for (let bag = 1; bag < 8; bag++) {
      const src = this.g.main.getcplayer() == 0 ? this.bagdat1 : this.bagdat2;
      this.bagdat[bag].copyFrom(src[bag]);
      if (this.bagdat[bag].exist) this.g.sprite.movedrawspr(bag, this.bagdat[bag].x, this.bagdat[bag].y);
      yield 12;
    }
  }

  getbagdir(bag: number): number {
    if (this.bagdat[bag].exist) return this.bagdat[bag].dir;
    return -1;
  }

  getgold(bag: number): void {
    const { g } = this;
    const b = this.bagdat[bag];
    const clbits = g.drawing.drawgold(bag, 6, b.x, b.y);
    g.main.incpenalty();
    if ((clbits & 1) != 0) {
      g.emit({ type: 'gold', x: b.x, y: b.y, byDigger: true });
      g.scores.scoregold();
      g.sound.soundgold();
      g.digger.digtime = 0;
    } else {
      g.monster.mongold();
      g.emit({ type: 'gold', x: b.x, y: b.y, byDigger: false });
    }
    this.removebag(bag);
  }

  getnmovingbags(): number {
    let n = 0;
    for (let bag = 1; bag < 8; bag++) {
      const b = this.bagdat[bag];
      if (b.exist && b.gt < 10 && (b.gt != 0 || b.wobbling)) n++;
    }
    return n;
  }

  initbags(): void {
    const m = this.g.main;
    this.pushcount = 0;
    this.goldtime = 150 - m.levof10() * 10;
    for (let bag = 1; bag < 8; bag++) this.bagdat[bag].exist = false;
    let bag = 1;
    for (let x = 0; x < 15; x++)
      for (let y = 0; y < 10; y++)
        if (m.getlevch(x, y, m.levplan()) == 'B')
          if (bag < 8) {
            const b = this.bagdat[bag++];
            b.exist = true;
            b.gt = 0;
            b.fallh = 0;
            b.dir = -1;
            b.wobbling = false;
            b.wt = 15;
            b.unfallen = true;
            b.x = x * 20 + 12;
            b.y = y * 18 + 18;
            b.h = x;
            b.v = y;
            b.xr = 0;
            b.yr = 0;
          }
    const dst = m.getcplayer() == 0 ? this.bagdat1 : this.bagdat2;
    for (let i = 1; i < 8; i++) dst[i].copyFrom(this.bagdat[i]);
  }

  pushbag(bag: number, dir: number): boolean {
    const { g } = this;
    const bd = this.bagdat[bag];
    let clbits: number;
    let push = true;
    const ox = bd.x;
    const oy = bd.y;
    let x = ox;
    let y = oy;
    const h = bd.h;
    const v = bd.v;
    if (bd.gt != 0) {
      this.getgold(bag);
      return true;
    }
    if (bd.dir == 6 && (dir == 4 || dir == 0)) {
      clbits = g.drawing.drawgold(bag, 3, x, y);
      g.main.incpenalty();
      if ((clbits & 1) != 0 && g.digger.diggery >= y) g.digger.killdigger(1, bag);
      if ((clbits & 0x3f00) != 0) g.monster.squashmonsters(bag, clbits);
      return true;
    }
    if ((x == 292 && dir == 0) || (x == 12 && dir == 4) || (y == 180 && dir == 6) || (y == 18 && dir == 2)) push = false;
    if (push) {
      switch (dir) {
        case 0:
          x += 4;
          break;
        case 4:
          x -= 4;
          break;
        case 6:
          if (bd.unfallen) {
            bd.unfallen = false;
            g.drawing.drawsquareblob(x, y);
            g.drawing.drawtopblob(x, y + 21);
          } else g.drawing.drawfurryblob(x, y);
          g.drawing.eatfield(x, y, dir);
          g.digger.killemerald(h, v);
          y += 6;
      }
      switch (dir) {
        case 6:
          clbits = g.drawing.drawgold(bag, 3, x, y);
          g.main.incpenalty();
          if ((clbits & 1) != 0 && g.digger.diggery >= y) g.digger.killdigger(1, bag);
          if ((clbits & 0x3f00) != 0) g.monster.squashmonsters(bag, clbits);
          break;
        case 0:
        case 4:
          bd.wt = 15;
          bd.wobbling = false;
          clbits = g.drawing.drawgold(bag, 0, x, y);
          g.main.incpenalty();
          this.pushcount = 1;
          if ((clbits & 0xfe) != 0)
            if (!this.pushbags(dir, clbits)) {
              x = ox;
              y = oy;
              g.drawing.drawgold(bag, 0, ox, oy);
              g.main.incpenalty();
              push = false;
            }
          if ((clbits & 1) != 0 || (clbits & 0x3f00) != 0) {
            x = ox;
            y = oy;
            g.drawing.drawgold(bag, 0, ox, oy);
            g.main.incpenalty();
            push = false;
          }
      }
      if (push) bd.dir = dir;
      else bd.dir = reversedir(dir);
      bd.x = x;
      bd.y = y;
      bd.h = Math.floor((x - 12) / 20);
      bd.v = Math.floor((y - 18) / 18);
      bd.xr = (x - 12) % 20;
      bd.yr = (y - 18) % 18;
    }
    return push;
  }

  pushbags(dir: number, bits: number): boolean {
    let push = true;
    for (let bag = 1, bit = 2; bag < 8; bag++, bit <<= 1) if ((bits & bit) != 0) if (!this.pushbag(bag, dir)) push = false;
    return push;
  }

  pushudbags(bits: number): boolean {
    let push = true;
    for (let bag = 1, b = 2; bag < 8; bag++, b <<= 1)
      if ((bits & b) != 0)
        if (this.bagdat[bag].gt != 0) this.getgold(bag);
        else push = false;
    return push;
  }

  removebag(bag: number): void {
    if (this.bagdat[bag].exist) {
      this.bagdat[bag].exist = false;
      this.g.sprite.erasespr(bag);
    }
  }

  removebags(bits: number): void {
    for (let bag = 1, b = 2; bag < 8; bag++, b <<= 1) if (this.bagdat[bag].exist && (bits & b) != 0) this.removebag(bag);
  }

  updatebag(bag: number): void {
    const { g } = this;
    const bd = this.bagdat[bag];
    const { x, h, xr, y, v, yr } = bd;
    switch (bd.dir) {
      case -1:
        if (y < 180 && xr == 0) {
          if (bd.wobbling) {
            if (bd.wt == 0) {
              bd.dir = 6;
              g.sound.soundfall();
              break;
            }
            bd.wt--;
            const wbl = bd.wt % 8;
            if (!((wbl & 1) != 0)) {
              g.drawing.drawgold(bag, wblanim[wbl >> 1], x, y);
              g.main.incpenalty();
              g.sound.soundwobble(bd.wt);
            }
          } else if ((g.monster.getfield(h, v + 1) & 0xfdf) != 0xfdf)
            if (!g.digger.checkdiggerunderbag(h, v + 1)) bd.wobbling = true;
        } else {
          bd.wt = 15;
          bd.wobbling = false;
        }
        break;
      case 0:
      case 4:
        if (xr == 0)
          if (y < 180 && (g.monster.getfield(h, v + 1) & 0xfdf) != 0xfdf) {
            bd.dir = 6;
            bd.wt = 0;
            g.sound.soundfall();
          } else this.baghitground(bag);
        break;
      case 6:
        if (yr == 0) bd.fallh++;
        if (y >= 180) this.baghitground(bag);
        else if ((g.monster.getfield(h, v + 1) & 0xfdf) == 0xfdf) if (yr == 0) this.baghitground(bag);
        g.monster.checkmonscared(bd.h);
    }
    if (bd.dir != -1)
      if (bd.dir != 6 && this.pushcount != 0) this.pushcount--;
      else this.pushbag(bag, bd.dir);
  }
}
