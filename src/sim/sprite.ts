// Sprite table and bounding-box collision, ported from Sprite.js.
// Slots: 0 digger, 1-7 bags, 8-13 monsters, 14 bonus cherry, 15 fireball, 16 misc.
import type { Pc } from './pc';

const N = 17;

export class Sprite {
  sprrdrwf = new Array<boolean>(N).fill(false);
  sprrecf = new Array<boolean>(N).fill(false);
  sprenf = new Array<boolean>(16).fill(false);
  sprch = new Array<number>(N).fill(0);
  sprmov: (number[] | null)[] = new Array(16).fill(null);
  sprx = new Array<number>(N).fill(0);
  spry = new Array<number>(N).fill(0);
  sprwid = new Array<number>(N).fill(0);
  sprhei = new Array<number>(N).fill(0);
  sprbwid = new Array<number>(16).fill(0);
  sprbhei = new Array<number>(16).fill(0);
  sprnch = new Array<number>(16).fill(0);
  sprnwid = new Array<number>(16).fill(0);
  sprnhei = new Array<number>(16).fill(0);
  sprnbwid = new Array<number>(16).fill(0);
  sprnbhei = new Array<number>(16).fill(0);

  private readonly defsprorder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  sprorder = this.defsprorder;

  constructor(private readonly pc: Pc) {}

  bcollide(bx: number, si: number): boolean {
    const { sprx, spry, sprwid, sprhei, sprbwid, sprbhei } = this;
    if (sprx[bx] >= sprx[si]) {
      if (sprx[bx] + sprbwid[bx] > sprwid[si] * 4 + sprx[si] - sprbwid[si] - 1) return false;
    } else if (sprx[si] + sprbwid[si] > sprwid[bx] * 4 + sprx[bx] - sprbwid[bx] - 1) return false;
    if (spry[bx] >= spry[si]) {
      if (spry[bx] + sprbhei[bx] <= sprhei[si] + spry[si] - sprbhei[si] - 1) return true;
      return false;
    }
    if (spry[si] + sprbhei[si] <= sprhei[bx] + spry[bx] - sprbhei[bx] - 1) return true;
    return false;
  }

  bcollides(bx: number): number {
    const si = bx;
    let ax = 0;
    let dx = 0;
    bx = 0;
    do {
      if (this.sprenf[bx] && bx != si) {
        if (this.bcollide(bx, si)) ax |= 1 << dx;
        this.sprx[bx] += 320;
        this.spry[bx] -= 2;
        if (this.bcollide(bx, si)) ax |= 1 << dx;
        this.sprx[bx] -= 640;
        this.spry[bx] += 4;
        if (this.bcollide(bx, si)) ax |= 1 << dx;
        this.sprx[bx] += 320;
        this.spry[bx] -= 2;
      }
      bx++;
      dx++;
    } while (dx != 16);
    return ax;
  }

  clearrdrwf(): void {
    this.clearrecf();
    this.sprrdrwf.fill(false);
  }

  clearrecf(): void {
    this.sprrecf.fill(false);
  }

  collide(bx: number, si: number): boolean {
    const { sprx, spry, sprwid, sprhei } = this;
    if (sprx[bx] >= sprx[si]) {
      if (sprx[bx] > sprwid[si] * 4 + sprx[si] - 1) return false;
    } else if (sprx[si] > sprwid[bx] * 4 + sprx[bx] - 1) return false;
    if (spry[bx] >= spry[si]) {
      if (spry[bx] <= sprhei[si] + spry[si] - 1) return true;
      return false;
    }
    if (spry[si] <= sprhei[bx] + spry[bx] - 1) return true;
    return false;
  }

  createspr(n: number, ch: number, mov: number[], wid: number, hei: number, bwid: number, bhei: number): void {
    n &= 15;
    this.sprnch[n] = this.sprch[n] = ch;
    this.sprmov[n] = mov;
    this.sprnwid[n] = this.sprwid[n] = wid;
    this.sprnhei[n] = this.sprhei[n] = hei;
    this.sprnbwid[n] = this.sprbwid[n] = bwid;
    this.sprnbhei[n] = this.sprbhei[n] = bhei;
    this.sprenf[n] = false;
  }

  drawmiscspr(x: number, y: number, ch: number, wid: number, hei: number): void {
    this.sprx[16] = x & -4;
    this.spry[16] = y;
    this.sprch[16] = ch;
    this.sprwid[16] = wid;
    this.sprhei[16] = hei;
    this.pc.gputim(this.sprx[16], this.spry[16], this.sprch[16], this.sprwid[16], this.sprhei[16]);
  }

  drawspr(n: number, x: number, y: number): number {
    const bx = n & 15;
    x &= -4;
    this.clearrdrwf();
    this.setrdrwflgs(bx);
    const t1 = this.sprx[bx];
    const t2 = this.spry[bx];
    const t3 = this.sprwid[bx];
    const t4 = this.sprhei[bx];
    this.sprx[bx] = x;
    this.spry[bx] = y;
    this.sprwid[bx] = this.sprnwid[bx];
    this.sprhei[bx] = this.sprnhei[bx];
    this.clearrecf();
    this.setrdrwflgs(bx);
    this.sprhei[bx] = t4;
    this.sprwid[bx] = t3;
    this.spry[bx] = t2;
    this.sprx[bx] = t1;
    this.sprrdrwf[bx] = true;
    this.putis();
    this.sprx[bx] = x;
    this.spry[bx] = y;
    this.sprch[bx] = this.sprnch[bx];
    this.sprwid[bx] = this.sprnwid[bx];
    this.sprhei[bx] = this.sprnhei[bx];
    this.sprbwid[bx] = this.sprnbwid[bx];
    this.sprbhei[bx] = this.sprnbhei[bx];
    this.pc.ggeti(this.sprx[bx], this.spry[bx], this.sprmov[bx]!, this.sprwid[bx], this.sprhei[bx]);
    this.putims();
    return this.bcollides(bx);
  }

  erasespr(n: number): void {
    const bx = n & 15;
    this.pc.gputi(this.sprx[bx], this.spry[bx], this.sprmov[bx]!, this.sprwid[bx], this.sprhei[bx]);
    this.sprenf[bx] = false;
    this.clearrdrwf();
    this.setrdrwflgs(bx);
    this.putims();
  }

  getis(): void {
    for (let i = 0; i < 16; i++)
      if (this.sprrdrwf[i]) this.pc.ggeti(this.sprx[i], this.spry[i], this.sprmov[i]!, this.sprwid[i], this.sprhei[i]);
    this.putims();
  }

  initmiscspr(x: number, y: number, wid: number, hei: number): void {
    this.sprx[16] = x;
    this.spry[16] = y;
    this.sprwid[16] = wid;
    this.sprhei[16] = hei;
    this.clearrdrwf();
    this.setrdrwflgs(16);
    this.putis();
  }

  initspr(n: number, ch: number, wid: number, hei: number, bwid: number, bhei: number): void {
    n &= 15;
    this.sprnch[n] = ch;
    this.sprnwid[n] = wid;
    this.sprnhei[n] = hei;
    this.sprnbwid[n] = bwid;
    this.sprnbhei[n] = bhei;
  }

  movedrawspr(n: number, x: number, y: number): number {
    const bx = n & 15;
    this.sprx[bx] = x & -4;
    this.spry[bx] = y;
    this.sprch[bx] = this.sprnch[bx];
    this.sprwid[bx] = this.sprnwid[bx];
    this.sprhei[bx] = this.sprnhei[bx];
    this.sprbwid[bx] = this.sprnbwid[bx];
    this.sprbhei[bx] = this.sprnbhei[bx];
    this.clearrdrwf();
    this.setrdrwflgs(bx);
    this.putis();
    this.pc.ggeti(this.sprx[bx], this.spry[bx], this.sprmov[bx]!, this.sprwid[bx], this.sprhei[bx]);
    this.sprenf[bx] = true;
    this.sprrdrwf[bx] = true;
    this.putims();
    return this.bcollides(bx);
  }

  putims(): void {
    for (let i = 0; i < 16; i++) {
      const j = this.sprorder[i];
      if (this.sprrdrwf[j]) this.pc.gputim(this.sprx[j], this.spry[j], this.sprch[j], this.sprwid[j], this.sprhei[j]);
    }
  }

  putis(): void {
    for (let i = 0; i < 16; i++)
      if (this.sprrdrwf[i]) this.pc.gputi(this.sprx[i], this.spry[i], this.sprmov[i]!, this.sprwid[i], this.sprhei[i]);
  }

  setrdrwflgs(n: number): void {
    if (this.sprrecf[n]) return;
    this.sprrecf[n] = true;
    for (let i = 0; i < 16; i++)
      if (this.sprenf[i] && i != n) {
        if (this.collide(i, n)) {
          this.sprrdrwf[i] = true;
          this.setrdrwflgs(i);
        }
        this.sprx[i] += 320;
        this.spry[i] -= 2;
        if (this.collide(i, n)) {
          this.sprrdrwf[i] = true;
          this.setrdrwflgs(i);
        }
        this.sprx[i] -= 640;
        this.spry[i] += 4;
        if (this.collide(i, n)) {
          this.sprrdrwf[i] = true;
          this.setrdrwflgs(i);
        }
        this.sprx[i] += 320;
        this.spry[i] -= 2;
      }
  }

  setsprorder(order: number[] | null): void {
    this.sprorder = order ?? this.defsprorder;
  }
}
