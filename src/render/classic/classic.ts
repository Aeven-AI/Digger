// Classic mode: shows the sim's virtual CGA framebuffer exactly as the original did,
// scaled with nearest-neighbour filtering. An optional CSS CRT overlay adds scanlines.
import { CGA_PALETTES, HEIGHT, WIDTH } from '../../sim/pc';
import type { FrameInfo, Renderer } from '../renderer';
import type { Game } from '../../sim/game';

export class ClassicRenderer implements Renderer {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private image = this.ctx.createImageData(WIDTH, HEIGHT);
  private lut = [new Uint32Array(4), new Uint32Array(4)];

  constructor() {
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.canvas.className = 'classic-canvas';
    for (let p = 0; p < 2; p++)
      for (let v = 0; v < 4; v++) {
        const [r, g, b] = [CGA_PALETTES[p][0][v], CGA_PALETTES[p][1][v], CGA_PALETTES[p][2][v]];
        this.lut[p][v] = (255 << 24) | (b << 16) | (g << 8) | r; // little-endian RGBA
      }
  }

  render(f: FrameInfo): void {
    const px = f.game.pc.pixels;
    const lut = this.lut[f.game.pc.curpal];
    const out = new Uint32Array(this.image.data.buffer);
    for (let i = 0, d = 0; i < 16000; i++) {
      let b = px[i];
      out[d++] = lut[b & 3];
      b >>= 2;
      out[d++] = lut[b & 3];
      b >>= 2;
      out[d++] = lut[b & 3];
      b >>= 2;
      out[d++] = lut[b & 3];
    }
    this.ctx.putImageData(this.image, 0, 0);
  }

  resize(): void {
    /* CSS handles scaling */
  }

  activate(_g: Game): void {}
  deactivate(): void {}
}
