// The earth: a cross-section slab whose front face is carved by the sim's dug mask,
// plus the static surroundings (more earth, the grassy surface, a night sky).
import * as THREE from 'three';
import { HEIGHT, WIDTH } from '../../sim/pc';
import { FIELD_BOTTOM, FIELD_TOP, S, TUNNEL_DEPTH, wx, wy } from './space';
import { soilTextures, skyTexture, TILE_WORLD } from './textures';
import type { Theme } from './themes';
import { hash2, vnoise } from './noise';

const STEP = 2; // sim pixels per heightfield vertex
const GX = WIDTH / STEP + 1;
const GY0 = FIELD_TOP;
const GY = Math.ceil((FIELD_BOTTOM - FIELD_TOP) / STEP) + 1;

export class Terrain {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  private readonly frameMaterial: THREE.MeshStandardMaterial;
  private readonly geom: THREE.BufferGeometry;
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;
  private readonly col: Float32Array;
  private readonly height = new Float32Array(GX * GY);
  private readonly jitter = new Float32Array(GX * GY);
  private readonly blurA = new Float32Array(WIDTH * HEIGHT);
  private readonly blurB = new Float32Array(WIDTH * HEIGHT);
  private version = -1;
  private tunnelColor = new THREE.Color();
  private sky: THREE.Mesh;
  private grass: THREE.InstancedMesh;
  private grassMat: THREE.MeshStandardMaterial;
  private top: THREE.Mesh;
  readonly uniforms = { uTime: { value: 0 } };
  /** Per-cell dirt amount from the last update, used to place dig dust. */
  changed = false;

  constructor(textureSize: number) {
    const tex = soilTextures({ name: 'init', base: '#a05020', dark: '#603010', light: '#c07040', accent: '#c09040', tunnel: '#201008', ambient: '#fff', skyTop: '#000', skyHorizon: '#111' }, 64);
    this.material = new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.roughnessMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 1,
      metalness: 0,
      vertexColors: true,
    });
    this.frameMaterial = this.material.clone();
    this.frameMaterial.vertexColors = false;
    
    this.textureSize = textureSize;

    // --- Carved heightfield ---------------------------------------------------
    this.geom = new THREE.BufferGeometry();
    this.pos = new Float32Array(GX * GY * 3);
    this.nrm = new Float32Array(GX * GY * 3);
    this.col = new Float32Array(GX * GY * 3);
    const uv = new Float32Array(GX * GY * 2);
    for (let j = 0; j < GY; j++)
      for (let i = 0; i < GX; i++) {
        const k = j * GX + i;
        const sx = i * STEP;
        const sy = Math.min(FIELD_BOTTOM, GY0 + j * STEP);
        this.pos[k * 3] = wx(sx);
        this.pos[k * 3 + 1] = wy(sy);
        uv[k * 2] = wx(sx) / TILE_WORLD;
        uv[k * 2 + 1] = wy(sy) / TILE_WORLD;
        // Static irregularity so tunnel edges crumble instead of looking stamped.
        this.jitter[k] = (vnoise(sx * 0.21, sy * 0.21, 3) - 0.5) * 0.5 + (hash2(i, j, 5) - 0.5) * 0.12;
      }
    const idx: number[] = [];
    for (let j = 0; j < GY - 1; j++)
      for (let i = 0; i < GX - 1; i++) {
        const a = j * GX + i;
        const b = a + 1;
        const c = a + GX;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    this.geom.setIndex(idx);
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geom.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(this.geom, this.material);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);

    // --- Surrounding earth -------------------------------------------------
    const left = wx(0);
    const right = wx(WIDTH);
    const top = wy(FIELD_TOP);
    const bottom = wy(FIELD_BOTTOM);
    const plane = (x0: number, x1: number, y0: number, y1: number) => {
      const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0, 1, 1);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
      const p = g.attributes.position;
      const u = g.attributes.uv;
      for (let i = 0; i < p.count; i++) u.setXY(i, p.getX(i) / TILE_WORLD, p.getY(i) / TILE_WORLD);
      const m = new THREE.Mesh(g, this.frameMaterial);
      m.receiveShadow = true;
      this.group.add(m);
    };
    plane(left - 60, left, bottom - 40, top);
    plane(right, right + 60, bottom - 40, top);
    plane(left, right, bottom - 40, bottom);

    // --- Ground surface: a thin grassy top face and blades along the edge ---
    const topGeom = new THREE.PlaneGeometry(160, 6, 1, 1);
    topGeom.rotateX(-Math.PI / 2);
    topGeom.translate(0, top, -3);
    this.top = new THREE.Mesh(topGeom, new THREE.MeshStandardMaterial({ color: 0x2f4a1c, roughness: 1 }));
    this.top.receiveShadow = true;
    this.group.add(this.top);
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(160, 0.28, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x3a5a22, roughness: 0.95 }),
    );
    lip.position.set(0, top + 0.06, -0.15);
    lip.receiveShadow = true;
    this.group.add(lip);

    const blade = new THREE.ConeGeometry(0.05, 0.5, 3, 1, true);
    blade.translate(0, 0.25, 0);
    this.grassMat = new THREE.MeshStandardMaterial({ color: 0x5f8f2e, roughness: 0.8, side: THREE.DoubleSide });
    this.grassMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 3.1;
           transformed.x += sin(uTime * 1.6 + ph) * 0.06 * position.y * 2.0;`,
        );
    };
    const N = 900;
    this.grass = new THREE.InstancedMesh(blade, this.grassMat, N);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const x = -40 + hash2(i, 1, 9) * 80;
      const z = -0.05 - hash2(i, 2, 9) * 1.6;
      const s = 0.5 + hash2(i, 3, 9) * 0.9;
      e.set((hash2(i, 4, 9) - 0.5) * 0.5, hash2(i, 5, 9) * 6.28, (hash2(i, 6, 9) - 0.5) * 0.6);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, top + 0.15, z), q, new THREE.Vector3(s, s * (0.7 + hash2(i, 7, 9)), s));
      this.grass.setMatrixAt(i, m4);
      c.setHSL(0.24 + hash2(i, 8, 9) * 0.06, 0.55, 0.22 + hash2(i, 10, 9) * 0.18);
      this.grass.setColorAt(i, c);
    }
    this.grass.castShadow = true;
    this.group.add(this.grass);

    // --- Sky backdrop ----------------------------------------------------------
    this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, fog: false }),
    );
    this.sky.position.set(0, top + 16, -40);
    this.sky.renderOrder = -10;
    this.group.add(this.sky);
  }

  private textureSize: number;

  setTheme(theme: Theme): void {
    const t = soilTextures(theme, this.textureSize);
    for (const m of [this.material, this.frameMaterial]) {
      m.map = t.map;
      m.normalMap = t.normalMap;
      m.roughnessMap = t.roughnessMap;
      m.needsUpdate = true;
    }
    // Tunnel floors: a darker, desaturated version of the soil (a multiplier on the albedo).
    const tun = new THREE.Color(theme.tunnel);
    const hsl = { h: 0, s: 0, l: 0 };
    tun.getHSL(hsl);
    this.tunnelColor.setHSL(hsl.h, 0.3, 0.26);
    const skyMat = this.sky.material as THREE.MeshBasicMaterial;
    skyMat.map?.dispose();
    skyMat.map = skyTexture(theme);
    skyMat.needsUpdate = true;
    this.version = -1;
  }

  /** Rebuilds the carved surface if the dug mask changed (its version differs). */
  update(dug: Uint8Array, version: number, time: number): void {
    this.uniforms.uTime.value = time;
    this.changed = false;
    if (version == this.version) return;
    this.version = version;
    this.changed = true;
    this.rebuild(dug);
  }

  private rebuild(dug: Uint8Array): void {
    const W = WIDTH;
    const a = this.blurA;
    const b = this.blurB;
    for (let i = 0; i < W * HEIGHT; i++) a[i] = dug[i];
    // Two passes of a separable box blur ≈ a soft Gaussian falloff at tunnel edges.
    for (let pass = 0; pass < 2; pass++) {
      boxH(a, b, W, HEIGHT, 2);
      boxV(b, a, W, HEIGHT, 2);
    }
    const hgt = this.height;
    for (let j = 0; j < GY; j++) {
      const sy = Math.min(HEIGHT - 1, GY0 + j * STEP);
      for (let i = 0; i < GX; i++) {
        const sx = Math.min(W - 1, i * STEP);
        const k = j * GX + i;
        const d = a[sy * W + sx];
        const jit = this.jitter[k];
        const t = smooth(0.12 + jit * 0.25, 0.8 + jit * 0.25, d);
        hgt[k] = -TUNNEL_DEPTH * t + (t > 0.98 ? jit * 0.12 : jit * 0.04);
      }
    }
    // Positions, normals and tunnel shading.
    const tc = this.tunnelColor;
    const inv = 1 / (2 * STEP * S);
    for (let j = 0; j < GY; j++)
      for (let i = 0; i < GX; i++) {
        const k = j * GX + i;
        const z = hgt[k];
        this.pos[k * 3 + 2] = z;
        const zl = hgt[j * GX + Math.max(0, i - 1)];
        const zr = hgt[j * GX + Math.min(GX - 1, i + 1)];
        const zu = hgt[Math.max(0, j - 1) * GX + i];
        const zd = hgt[Math.min(GY - 1, j + 1) * GX + i];
        // y grows downward in grid rows, upward in world.
        let nx = -(zr - zl) * inv;
        let ny = (zd - zu) * inv;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        nz /= len;
        this.nrm[k * 3] = nx;
        this.nrm[k * 3 + 1] = ny;
        this.nrm[k * 3 + 2] = nz;
        const depth = -z / TUNNEL_DEPTH;
        // Walls get a little darker; the packed floor takes the tunnel tint.
        const wall = 1 - nz;
        const f = Math.min(1, depth * 1.1);
        const shade = 1 - wall * 0.3;
        this.col[k * 3] = (1 - f + f * tc.r) * shade;
        this.col[k * 3 + 1] = (1 - f + f * tc.g) * shade;
        this.col[k * 3 + 2] = (1 - f + f * tc.b) * shade;
      }
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.normal.needsUpdate = true;
    this.geom.attributes.color.needsUpdate = true;
  }

  /** Darkens the earth so actors stand out (accessibility). */
  setContrast(high: boolean): void {
    this.material.color.setScalar(high ? 0.5 : 1);
    this.frameMaterial.color.setScalar(high ? 0.5 : 1);
  }

  /** Depth of the carved surface at a sim position (0 = solid face). */
  depthAt(sx: number, sy: number): number {
    const i = Math.round(sx / STEP);
    const j = Math.round((sy - GY0) / STEP);
    if (i < 0 || i >= GX || j < 0 || j >= GY) return 0;
    return -this.height[j * GX + i];
  }
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * norm;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
}

function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const norm = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += src[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * norm;
      acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
}
