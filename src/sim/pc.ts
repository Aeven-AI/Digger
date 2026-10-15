// Virtual CGA framebuffer. The original game uses the screen itself as part of
// its game state (the fireball reads screen pixels to detect dirt), so the sim
// keeps an exact 320x200 2bpp buffer. The classic renderer simply displays it.
//
// Packing: one byte holds 4 pixels, the LOW two bits are the LEFTMOST pixel.
import { cgatable, cgatitledat } from './data/cgagrafx';
import { ascii2cga } from './data/alpha';

export const WIDTH = 320;
export const HEIGHT = 200;

/** Sprite ids drawn with drawmiscspr that shape the terrain (background tiles and tunnel blobs). */
const TERRAIN_FIRST = 93;
const TERRAIN_LAST = 107;
/** First tunnel-blob sprite id; ids below it (in the terrain range) are background tiles. */
const BLOB_FIRST = 102;

export class Pc {
  /** 4 pixels per byte. */
  readonly pixels = new Uint8Array(65536 / 4);
  /**
   * Terrain-only copy of the playfield: background dirt and dug tunnels, no sprites.
   * Byte layout matches `pixels`. The HD renderer turns this into the tunnel mask.
   */
  readonly terrain = new Uint8Array(65536 / 4);
  /** Bumped whenever `terrain` changes, so renderers can cheaply detect updates. */
  terrainVersion = 0;
  /**
   * One byte per pixel: 1 where a tunnel has been dug (by a tunnel blob),
   * 0 for solid earth. Unlike `terrain`, never-painted areas count as solid.
   */
  readonly dug = new Uint8Array(WIDTH * HEIGHT);
  /** Palette intensity: 0 normal, 1 bright (bonus mode flash). */
  curpal = 0;

  gclear(): void {
    this.pixels.fill(0);
    this.terrain.fill(0);
    this.dug.fill(0);
    this.terrainVersion++;
  }

  ggeti(x: number, y: number, p: number[], w: number, h: number): void {
    let src = 0;
    let dest = (y * WIDTH + x) >> 2;
    for (let i = 0; i < h; i++) {
      let d = dest;
      for (let j = 0; j < w; j++) {
        p[src++] = this.pixels[d++];
        if (src == p.length) return;
      }
      dest += WIDTH >> 2;
    }
  }

  ggetpix(x: number, y: number): number {
    return this.pixels[(WIDTH * y + x) >> 2];
  }

  ginten(inten: number): void {
    this.curpal = inten & 1;
  }

  gputi(x: number, y: number, p: number[], w: number, h: number): void {
    let src = 0;
    let dest = (y * WIDTH + x) >> 2;
    for (let i = 0; i < h; i++) {
      let d = dest;
      for (let j = 0; j < w; j++) {
        this.pixels[d++] = p[src++];
        if (src == p.length) return;
      }
      dest += WIDTH >> 2;
    }
  }

  gputim(x: number, y: number, ch: number, w: number, h: number): void {
    this.putim(this.pixels, x, y, ch, w, h);
    if (ch >= TERRAIN_FIRST && ch <= TERRAIN_LAST) {
      this.putim(this.terrain, x, y, ch, w, h);
      this.markdug(x, y, ch, w, h, ch >= BLOB_FIRST);
      this.terrainVersion++;
    }
  }

  private putim(buf: Uint8Array, x: number, y: number, ch: number, w: number, h: number): void {
    const spr = cgatable[ch * 2];
    const msk = cgatable[ch * 2 + 1];
    let src = 0;
    let dest = (y * WIDTH + x) >> 2;
    for (let i = 0; i < h; i++) {
      let d = dest;
      for (let j = 0; j < w; j++) {
        let px = spr[src];
        const mx = msk[src];
        let ax = buf[d];
        src++;
        if ((mx & 3) == 0) ax = (ax & ~192) | ((px & 3) << 6);
        px >>= 2;
        if ((mx & (3 << 2)) == 0) ax = (ax & ~48) | ((px & 3) << 4);
        px >>= 2;
        if ((mx & (3 << 4)) == 0) ax = (ax & ~12) | ((px & 3) << 2);
        px >>= 2;
        if ((mx & (3 << 6)) == 0) ax = (ax & ~3) | (px & 3);
        buf[d] = ax;
        d += 1;
        if (src == spr.length || src == msk.length) return;
      }
      dest += WIDTH >> 2;
    }
  }

  /** Updates the per-pixel dug mask from a terrain sprite draw. */
  private markdug(x: number, y: number, ch: number, w: number, h: number, blob: boolean): void {
    const spr = cgatable[ch * 2];
    const msk = cgatable[ch * 2 + 1];
    let src = 0;
    for (let i = 0; i < h; i++) {
      const py = y + i;
      for (let j = 0; j < w; j++) {
        if (src >= spr.length || src >= msk.length) return;
        const px = spr[src];
        const mx = msk[src];
        src++;
        if (py < 0 || py >= HEIGHT) continue;
        for (let k = 0; k < 4; k++) {
          const xx = x + j * 4 + k;
          if (xx < 0 || xx >= WIDTH) continue;
          // Bit pairs are stored MSB-first in the source data: pixel k uses bits (3-k)*2.
          const sh = (3 - k) * 2;
          if (((mx >> sh) & 3) != 0) continue;
          const v = (px >> sh) & 3;
          if (blob) {
            if (v == 0) this.dug[py * WIDTH + xx] = 1;
          } else this.dug[py * WIDTH + xx] = 0;
        }
      }
    }
  }

  gtitle(): void {
    let src = 0;
    let dest = 0;
    const dat = cgatitledat;
    while (true) {
      if (src >= dat.length) break;
      const b = dat[src++];
      let l: number;
      let c: number;
      if (b == 0xfe) {
        l = dat[src++];
        if (l == 0) l = 256;
        c = dat[src++];
      } else {
        l = 1;
        c = b;
      }
      for (let i = 0; i < l; i++) {
        const px = c;
        let adst: number;
        if (dest < 32768) adst = Math.floor(dest / 320) * 640 + (dest % 320);
        else adst = 320 + Math.floor((dest - 32768) / 320) * 640 + ((dest - 32768) % 320);
        this.pixels[adst >> 2] = (px >> 6) | ((px >> 2) & 12) | ((px << 2) & 48) | ((px << 6) & 192);
        dest += 4;
        if (dest >= 65535) break;
      }
      if (dest >= 65535) break;
    }
  }

  gwrite(x: number, y: number, chs: string, c: number): void {
    c &= 3;
    let dest = (y * WIDTH + x) >> 2;
    let ofs = 0;
    const color = c | (c << 2) | (c << 4) | (c << 6);
    const ch = chs.charCodeAt(0) - 32;
    if (ch < 0 || ch > 0x5f) return;
    const chartab = ascii2cga[ch];
    if (chartab == null) return;
    for (let i = 0; i < 12; i++) {
      let d = dest;
      for (let j = 0; j < 3; j++) {
        const px = chartab[ofs++];
        this.pixels[d] = ((px >> 6) | ((px >> 2) & 12) | ((px << 2) & 48) | ((px << 6) & 192)) & color;
        d++;
      }
      dest += WIDTH >> 2;
    }
  }
}

/** RGB palettes: [intensity][channel][pixel value]. */
export const CGA_PALETTES = [
  [
    [0, 0x00, 0xcc, 0xcc],
    [0, 0xcc, 0x00, 0x74],
    [0, 0x00, 0x00, 0x00],
  ],
  [
    [0, 0x64, 0xff, 0xff],
    [0, 0xff, 0x64, 0xff],
    [0, 0x64, 0x64, 0x64],
  ],
];
