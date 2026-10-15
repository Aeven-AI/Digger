// Playfield drawing and the dig-state `field`, ported from Drawing.js.
//
// field[y*15+x] bits: 0-4 horizontal dirt slices, 6-11 vertical dirt slices,
// 0x2000 "cell untouched". A set bit means dirt is still there.
import type { Game } from './game';

const bitmasks = [0xfffe, 0xfffd, 0xfffb, 0xfff7, 0xffef, 0xffdf, 0xffbf, 0xff7f, 0xfeff, 0xfdff, 0xfbff, 0xf7ff];

const buf = (n: number) => new Array<number>(n).fill(0);

export class Drawing {
  field1 = buf(150);
  field2 = buf(150);
  field = buf(150);

  private diggerbuf = buf(480);
  private bagbufs = [0, 1, 2, 3, 4, 5, 6].map(() => buf(480));
  private monbufs = [0, 1, 2, 3, 4, 5].map(() => buf(480));
  private bonusbuf = buf(480);
  private firebuf = buf(128);

  monspr = [0, 0, 0, 0, 0, 0];
  monspd = [0, 0, 0, 0, 0, 0];
  digspr = 0;
  digspd = 0;
  firespr = 0;
  readonly fireheight = 8;

  constructor(private readonly g: Game) {}

  createdbfspr(): void {
    const s = this.g.sprite;
    this.digspd = 1;
    this.digspr = 0;
    this.firespr = 0;
    s.createspr(0, 0, this.diggerbuf, 4, 15, 0, 0);
    s.createspr(14, 81, this.bonusbuf, 4, 15, 0, 0);
    s.createspr(15, 82, this.firebuf, 2, this.fireheight, 0, 0);
  }

  creatembspr(): void {
    const s = this.g.sprite;
    for (let i = 0; i < 7; i++) s.createspr(1 + i, 62, this.bagbufs[i], 4, 15, 0, 0);
    for (let i = 0; i < 6; i++) s.createspr(8 + i, 71, this.monbufs[i], 4, 15, 0, 0);
    this.createdbfspr();
    for (let i = 0; i < 6; i++) {
      this.monspr[i] = 0;
      this.monspd[i] = 1;
    }
  }

  *drawbackg(l: number): Generator<number> {
    for (let y = 14; y < 200; y += 4) {
      for (let x = 0; x < 320; x += 20) this.g.sprite.drawmiscspr(x, y, 93 + l, 5, 4);
      yield 12;
    }
  }

  drawbonus(x: number, y: number): void {
    this.g.sprite.initspr(14, 81, 4, 15, 0, 0);
    this.g.sprite.movedrawspr(14, x, y);
  }

  private blob(x: number, y: number, ch: number, w: number, h: number): void {
    const s = this.g.sprite;
    s.initmiscspr(x, y, w, h);
    s.drawmiscspr(x, y, ch, w, h);
    s.getis();
  }

  drawbottomblob(x: number, y: number): void {
    this.blob(x - 4, y + 15, 105, 6, 6);
  }

  drawdigger(t: number, x: number, y: number, f: boolean): number {
    this.digspr += this.digspd;
    if (this.digspr == 2 || this.digspr == 0) this.digspd = -this.digspd;
    if (this.digspr > 2) this.digspr = 2;
    if (this.digspr < 0) this.digspr = 0;
    if (t >= 0 && t <= 6 && !((t & 1) != 0)) {
      this.g.sprite.initspr(0, (t + (f ? 0 : 1)) * 3 + this.digspr + 1, 4, 15, 0, 0);
      return this.g.sprite.drawspr(0, x, y);
    }
    if (t >= 10 && t <= 15) {
      this.g.sprite.initspr(0, 40 - t, 4, 15, 0, 0);
      return this.g.sprite.drawspr(0, x, y);
    }
    return 0;
  }

  drawemerald(x: number, y: number): void {
    this.blob(x, y, 108, 4, 10);
  }

  *drawfield(): Generator<number> {
    const field = this.field;
    for (let x = 0; x < 15; x++)
      for (let y = 0; y < 10; y++) {
        if ((field[y * 15 + x] & 0x2000) == 0) {
          const xp = x * 20 + 12;
          const yp = y * 18 + 18;
          if ((field[y * 15 + x] & 0xfc0) != 0xfc0) {
            field[y * 15 + x] &= 0xd03f;
            this.drawbottomblob(xp, yp - 15);
            this.drawbottomblob(xp, yp - 12);
            this.drawbottomblob(xp, yp - 9);
            this.drawbottomblob(xp, yp - 6);
            this.drawbottomblob(xp, yp - 3);
            this.drawtopblob(xp, yp + 3);
          }
          if ((field[y * 15 + x] & 0x1f) != 0x1f) {
            field[y * 15 + x] &= 0xdfe0;
            this.drawrightblob(xp - 16, yp);
            this.drawrightblob(xp - 12, yp);
            this.drawrightblob(xp - 8, yp);
            this.drawrightblob(xp - 4, yp);
            this.drawleftblob(xp + 4, yp);
          }
          if (x < 14) if ((field[y * 15 + x + 1] & 0xfdf) != 0xfdf) this.drawrightblob(xp, yp);
          if (y < 9) if ((field[(y + 1) * 15 + x] & 0xfdf) != 0xfdf) this.drawbottomblob(xp, yp);
          yield 18;
        }
      }
  }

  drawfire(x: number, y: number, t: number): number {
    const s = this.g.sprite;
    if (t == 0) {
      this.firespr++;
      if (this.firespr > 2) this.firespr = 0;
      s.initspr(15, 82 + this.firespr, 2, this.fireheight, 0, 0);
    } else s.initspr(15, 84 + t, 2, this.fireheight, 0, 0);
    return s.drawspr(15, x, y);
  }

  drawfurryblob(x: number, y: number): void {
    this.blob(x - 4, y + 15, 107, 6, 8);
  }

  drawgold(n: number, t: number, x: number, y: number): number {
    this.g.sprite.initspr(n, t + 62, 4, 15, 0, 0);
    return this.g.sprite.drawspr(n, x, y);
  }

  drawleftblob(x: number, y: number): void {
    this.blob(x - 8, y - 1, 104, 2, 18);
  }

  drawlife(t: number, x: number, y: number): void {
    this.g.sprite.drawmiscspr(x, y, t + 110, 4, 12);
  }

  drawlives(): void {
    const m = this.g.main;
    let n = m.getlives(1) - 1;
    for (let l = 1; l < 5; l++) {
      this.drawlife(n > 0 ? 0 : 2, l * 20 + 60, 0);
      n--;
    }
    if (m.getnplayers() == 2) {
      n = m.getlives(2) - 1;
      for (let l = 1; l < 5; l++) {
        this.drawlife(n > 0 ? 1 : 2, 244 - l * 20, 0);
        n--;
      }
    }
  }

  drawmon(n: number, nobf: boolean, dir: number, x: number, y: number): number {
    const s = this.g.sprite;
    this.monspr[n] += this.monspd[n];
    if (this.monspr[n] == 2 || this.monspr[n] == 0) this.monspd[n] = -this.monspd[n];
    if (this.monspr[n] > 2) this.monspr[n] = 2;
    if (this.monspr[n] < 0) this.monspr[n] = 0;
    if (nobf) s.initspr(n + 8, this.monspr[n] + 69, 4, 15, 0, 0);
    else
      switch (dir) {
        case 0:
          s.initspr(n + 8, this.monspr[n] + 73, 4, 15, 0, 0);
          break;
        case 4:
          s.initspr(n + 8, this.monspr[n] + 77, 4, 15, 0, 0);
      }
    return s.drawspr(n + 8, x, y);
  }

  drawmondie(n: number, nobf: boolean, dir: number, x: number, y: number): number {
    const s = this.g.sprite;
    if (nobf) s.initspr(n + 8, 72, 4, 15, 0, 0);
    else
      switch (dir) {
        case 0:
          s.initspr(n + 8, 76, 4, 15, 0, 0);
          break;
        case 4:
          s.initspr(n + 8, 80, 4, 14, 0, 0);
      }
    return s.drawspr(n + 8, x, y);
  }

  drawrightblob(x: number, y: number): void {
    this.blob(x + 16, y - 1, 102, 2, 18);
  }

  drawsquareblob(x: number, y: number): void {
    this.blob(x - 4, y + 17, 106, 6, 6);
  }

  *drawstatics(): Generator<number> {
    const cur = this.g.main.getcplayer() == 0 ? this.field1 : this.field2;
    for (let i = 0; i < 150; i++) this.field[i] = cur[i];
    this.g.pc.ginten(0);
    yield* this.drawbackg(this.g.main.levplan());
    yield* this.drawfield();
  }

  drawtopblob(x: number, y: number): void {
    this.blob(x - 4, y - 6, 103, 6, 6);
  }

  eatfield(x: number, y: number, dir: number): void {
    const field = this.field;
    let h = Math.floor((x - 12) / 20);
    let xr = Math.floor(((x - 12) % 20) / 4);
    let v = Math.floor((y - 18) / 18);
    let yr = Math.floor(((y - 18) % 18) / 3);
    this.g.main.incpenalty();
    switch (dir) {
      case 0:
        h++;
        field[v * 15 + h] &= bitmasks[xr];
        if ((field[v * 15 + h] & 0x1f) != 0) break;
        field[v * 15 + h] &= 0xdfff;
        break;
      case 4:
        xr--;
        if (xr < 0) {
          xr += 5;
          h--;
        }
        field[v * 15 + h] &= bitmasks[xr];
        if ((field[v * 15 + h] & 0x1f) != 0) break;
        field[v * 15 + h] &= 0xdfff;
        break;
      case 2:
        yr--;
        if (yr < 0) {
          yr += 6;
          v--;
        }
        field[v * 15 + h] &= bitmasks[6 + yr];
        if ((field[v * 15 + h] & 0xfc0) != 0) break;
        field[v * 15 + h] &= 0xdfff;
        break;
      case 6:
        v++;
        field[v * 15 + h] &= bitmasks[6 + yr];
        if ((field[v * 15 + h] & 0xfc0) != 0) break;
        field[v * 15 + h] &= 0xdfff;
    }
  }

  eraseemerald(x: number, y: number): void {
    this.blob(x, y, 109, 4, 10);
  }

  initdbfspr(): void {
    const s = this.g.sprite;
    this.digspd = 1;
    this.digspr = 0;
    this.firespr = 0;
    s.initspr(0, 0, 4, 15, 0, 0);
    s.initspr(14, 81, 4, 15, 0, 0);
    s.initspr(15, 82, 2, this.fireheight, 0, 0);
  }

  initmbspr(): void {
    const s = this.g.sprite;
    for (let i = 1; i <= 7; i++) s.initspr(i, 62, 4, 15, 0, 0);
    for (let i = 8; i <= 13; i++) s.initspr(i, 71, 4, 15, 0, 0);
    this.initdbfspr();
  }

  makefield(): void {
    const m = this.g.main;
    for (let x = 0; x < 15; x++)
      for (let y = 0; y < 10; y++) {
        const i = y * 15 + x;
        this.field[i] = -1;
        const c = m.getlevch(x, y, m.levplan());
        if (c == 'S' || c == 'V') this.field[i] &= 0xd03f;
        if (c == 'S' || c == 'H') this.field[i] &= 0xdfe0;
        if (m.getcplayer() == 0) this.field1[i] = this.field[i];
        else this.field2[i] = this.field[i];
      }
  }

  outtext(p: string, x: number, y: number, c: number): void {
    for (let i = 0; i < p.length; i++) {
      this.g.pc.gwrite(x, y, p.charAt(i), c);
      x += 12;
    }
  }

  savefield(): void {
    const dst = this.g.main.getcplayer() == 0 ? this.field1 : this.field2;
    for (let i = 0; i < 150; i++) dst[i] = this.field[i];
  }
}
