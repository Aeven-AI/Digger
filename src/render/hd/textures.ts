// Procedurally painted textures. Everything is generated at runtime from code,
// so the game ships no image assets.
import * as THREE from 'three';
import { fbm, mulberry32, vnoise } from './noise';
import type { Theme } from './themes';

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function hex(c: string): [number, number, number] {
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Converts a height field to a tangent-space normal map. */
function heightToNormal(hf: Float32Array, w: number, h: number, strength: number): ImageData {
  const out = new ImageData(w, h);
  const d = out.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const l = hf[y * w + ((x - 1 + w) % w)];
      const r = hf[y * w + ((x + 1) % w)];
      const u = hf[((y - 1 + h) % h) * w + x];
      const dn = hf[((y + 1) % h) * w + x];
      let nx = (l - r) * strength;
      let ny = (dn - u) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  return out;
}

export interface SoilTextures {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

const soilCache = new Map<string, SoilTextures>();

/**
 * Cross-section of layered earth: wavy strata, grain, pebbles and roots.
 * Tiles seamlessly; one tile covers TILE_WORLD world units.
 */
export function soilTextures(theme: Theme, size = 512): SoilTextures {
  const key = theme.name + size;
  const cached = soilCache.get(key);
  if (cached) return cached;
  const rnd = mulberry32(theme.name.length * 7919 + size);
  const W = size;
  const H = size;
  const hf = new Float32Array(W * H);
  const col = new Float32Array(W * H * 3);
  const rough = new Float32Array(W * H);
  const base = hex(theme.base);
  const dark = hex(theme.dark);
  const light = hex(theme.light);
  const accent = hex(theme.accent);
  const P = 8; // noise lattice period for tiling
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = (x / W) * P;
      const v = (y / H) * P;
      // Strata: horizontal bands, warped by low-frequency noise.
      const warp = fbm(u * 0.5, v * 0.5, 3, 11, P / 2, P / 2) * 2.2;
      const band = Math.sin((v * 2.1 + warp) * Math.PI) * 0.5 + 0.5;
      const band2 = Math.sin((v * 5.3 + warp * 1.7) * Math.PI) * 0.5 + 0.5;
      const grain = fbm(u * 4, v * 4, 4, 3, P * 4, P * 4);
      const fine = vnoise(u * 32, v * 32, 7, P * 32, P * 32);
      const blot = fbm(u * 1.3, v * 1.3, 3, 23, P * 1.3, P * 1.3);
      let t = band * 0.55 + band2 * 0.25 + grain * 0.35 - 0.3;
      let r = mix(dark[0], base[0], smooth(0.0, 0.5, t));
      let g = mix(dark[1], base[1], smooth(0.0, 0.5, t));
      let b = mix(dark[2], base[2], smooth(0.0, 0.5, t));
      const lt = smooth(0.55, 0.95, t);
      r = mix(r, light[0], lt);
      g = mix(g, light[1], lt);
      b = mix(b, light[2], lt);
      // Accent patches (moss, clay, iron).
      const ac = smooth(0.66, 0.78, blot) * 0.55;
      r = mix(r, accent[0], ac);
      g = mix(g, accent[1], ac);
      b = mix(b, accent[2], ac);
      const shade = 0.82 + fine * 0.3;
      const i = y * W + x;
      col[i * 3] = r * shade;
      col[i * 3 + 1] = g * shade;
      col[i * 3 + 2] = b * shade;
      hf[i] = grain * 0.6 + fine * 0.25 + band2 * 0.15;
      rough[i] = 0.75 + fine * 0.2;
    }
  // Pebbles and stones.
  const stones = Math.floor(size * 0.16);
  for (let s = 0; s < stones; s++) {
    const cx = rnd() * W;
    const cy = rnd() * H;
    const big = rnd() < 0.12;
    const rx = (big ? 6 + rnd() * 9 : 1.5 + rnd() * 3.5) * (size / 512);
    const ry = rx * (0.55 + rnd() * 0.35);
    const ang = rnd() * Math.PI;
    const tone = 0.55 + rnd() * 0.9;
    const grey = rnd() < 0.5;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const R = Math.ceil(rx + 2);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const lx = (dx * ca + dy * sa) / rx;
        const ly = (-dx * sa + dy * ca) / ry;
        const d2 = lx * lx + ly * ly;
        if (d2 > 1) continue;
        const px = (((Math.round(cx + dx) % W) + W) % W) | 0;
        const py = (((Math.round(cy + dy) % H) + H) % H) | 0;
        const i = py * W + px;
        const dome = Math.sqrt(1 - d2);
        const lightSide = clamp01(0.5 - lx * 0.35 - ly * 0.45);
        const k = tone * (0.65 + 0.5 * lightSide);
        const sr = grey ? 128 : base[0] * 0.9;
        const sg = grey ? 118 : base[1] * 0.85;
        const sb = grey ? 108 : base[2] * 0.85;
        const edge = smooth(1, 0.7, d2);
        col[i * 3] = mix(col[i * 3] * 0.6, sr * k, edge);
        col[i * 3 + 1] = mix(col[i * 3 + 1] * 0.6, sg * k, edge);
        col[i * 3 + 2] = mix(col[i * 3 + 2] * 0.6, sb * k, edge);
        hf[i] = Math.max(hf[i], 0.6 + dome * (big ? 1.4 : 0.8));
        rough[i] = 0.55;
      }
  }
  // Roots: thin wandering dark curves.
  const roots = Math.floor(size / 64);
  for (let r = 0; r < roots; r++) {
    let x = rnd() * W;
    let y = rnd() * H;
    let a = Math.PI / 2 + (rnd() - 0.5) * 1.6;
    let w = (0.8 + rnd() * 1.4) * (size / 512);
    const len = 60 + rnd() * 160;
    for (let s = 0; s < len; s++) {
      a += (rnd() - 0.5) * 0.35;
      x += Math.cos(a);
      y += Math.sin(a) * 0.9;
      w *= 0.995;
      const R = Math.ceil(w);
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > w * w) continue;
          const px = (((Math.round(x + dx) % W) + W) % W) | 0;
          const py = (((Math.round(y + dy) % H) + H) % H) | 0;
          const i = py * W + px;
          col[i * 3] *= 0.55;
          col[i * 3 + 1] *= 0.5;
          col[i * 3 + 2] *= 0.45;
          hf[i] += 0.25;
        }
    }
  }
  const [cm, xm] = canvas(W, H);
  const img = xm.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4] = Math.min(255, col[i * 3]);
    img.data[i * 4 + 1] = Math.min(255, col[i * 3 + 1]);
    img.data[i * 4 + 2] = Math.min(255, col[i * 3 + 2]);
    img.data[i * 4 + 3] = 255;
  }
  xm.putImageData(img, 0, 0);
  const [cn, xn] = canvas(W, H);
  xn.putImageData(heightToNormal(hf, W, H, 2.5 * (size / 512)), 0, 0);
  const [cr, xr] = canvas(W, H);
  const rimg = xr.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const v = Math.min(255, rough[i] * 255);
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = v;
    rimg.data[i * 4 + 3] = 255;
  }
  xr.putImageData(rimg, 0, 0);
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const out = { map: tex(cm, true), normalMap: tex(cn, false), roughnessMap: tex(cr, false) };
  soilCache.set(key, out);
  return out;
}

/** World units covered by one soil texture tile. */
export const TILE_WORLD = 14;

/** Leather sack texture with a stitched dollar sign on the front. */
export function leatherTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(512, 256);
  const W = 512;
  const H = 256;
  const img = x.createImageData(W, H);
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      const n = fbm((px / W) * 16, (py / H) * 8, 4, 5, 16, 8);
      const crease = Math.pow(Math.abs(Math.sin((px / W) * 40 + n * 6)), 12) * 0.25;
      const k = 0.75 + n * 0.45 - crease;
      const i = (py * W + px) * 4;
      img.data[i] = 168 * k;
      img.data[i + 1] = 112 * k;
      img.data[i + 2] = 58 * k;
      img.data[i + 3] = 255;
    }
  x.putImageData(img, 0, 0);
  // Dollar sign on the front (u = 0.25 faces +z for a LatheGeometry rotated into place).
  x.save();
  x.translate(W * 0.25, H * 0.58);
  x.scale(0.62, 1);
  x.font = 'bold 190px Georgia, "Times New Roman", serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineWidth = 10;
  x.strokeStyle = 'rgba(40,20,5,0.75)';
  x.strokeText('$', 0, 0);
  x.fillStyle = '#f2c14e';
  x.fillText('$', 0, 0);
  x.setLineDash([6, 6]);
  x.lineWidth = 3;
  x.strokeStyle = '#ffe9a8';
  x.strokeText('$', 0, 0);
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Weathered stone with "RIP" carved in, for the gravestone face. */
export function graveTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(256, 256);
  const img = x.createImageData(256, 256);
  for (let py = 0; py < 256; py++)
    for (let px = 0; px < 256; px++) {
      const n = fbm(px / 32, py / 32, 5, 9);
      const k = 0.55 + n * 0.55;
      const i = (py * 256 + px) * 4;
      img.data[i] = 150 * k;
      img.data[i + 1] = 150 * k;
      img.data[i + 2] = 158 * k;
      img.data[i + 3] = 255;
    }
  x.putImageData(img, 0, 0);
  x.font = 'bold 76px Georgia, "Times New Roman", serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = 'rgba(255,255,255,0.18)';
  x.fillText('RIP', 128, 132);
  x.fillStyle = 'rgba(20,20,26,0.85)';
  x.fillText('RIP', 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft round sprite used for glows and particles. */
export function glowTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Four-pointed twinkle for gem sparkles. */
export function sparkleTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(128);
  x.translate(64, 64);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 20);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(-64, -64, 128, 128);
  x.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 4; i++) {
    x.rotate(Math.PI / 2);
    x.beginPath();
    x.moveTo(0, -3);
    x.lineTo(62, 0);
    x.lineTo(0, 3);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Night sky with stars, for the strip above ground. */
export function skyTexture(theme: Theme): THREE.CanvasTexture {
  const [c, x] = canvas(1024, 256);
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, theme.skyTop);
  g.addColorStop(1, theme.skyHorizon);
  x.fillStyle = g;
  x.fillRect(0, 0, 1024, 256);
  const rnd = mulberry32(99);
  for (let i = 0; i < 260; i++) {
    const sx = rnd() * 1024;
    const sy = rnd() * 200;
    const a = rnd() * 0.8 * (1 - sy / 256);
    x.fillStyle = `rgba(255,${230 + rnd() * 25},${200 + rnd() * 55},${a})`;
    x.fillRect(sx, sy, rnd() < 0.08 ? 2 : 1, rnd() < 0.08 ? 2 : 1);
  }
  // Distant hills.
  for (let layer = 0; layer < 2; layer++) {
    x.fillStyle = layer == 0 ? 'rgba(10,8,16,0.55)' : 'rgba(6,5,10,0.85)';
    x.beginPath();
    x.moveTo(0, 256);
    for (let sx = 0; sx <= 1024; sx += 8) {
      const hgt = 40 + layer * -14 + fbm(sx / 180 + layer * 5, layer, 3, 4 + layer) * 70;
      x.lineTo(sx, 256 - hgt);
    }
    x.lineTo(1024, 256);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
