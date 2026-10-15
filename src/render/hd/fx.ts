// Particles, flying coins and floating score popups.
import * as THREE from 'three';
import { glowTexture } from './textures';

export interface Burst {
  x: number;
  y: number;
  z: number;
  count: number;
  color: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  speed: number;
  /** Extra velocity applied to all particles. */
  vx?: number;
  vy?: number;
  vz?: number;
  spread?: number;
  life: number;
  size: number;
  gravity?: number;
  drag?: number;
  /** Bias direction: emit mostly upward. */
  up?: number;
}

export class Particles {
  readonly points: THREE.Points;
  private n = 0;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly geom = new THREE.BufferGeometry();
  scale = 1;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTexture() }, uScale: { value: 400 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying float vA; varying vec3 vC; uniform float uScale;
        void main() {
          vA = alpha; vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying float vA; varying vec3 vC;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vC * t.rgb, t.a * vA);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }

  setViewport(heightPx: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = heightPx * 0.9;
  }

  emit(b: Burst): void {
    const c1 = new THREE.Color(b.color);
    const c2 = new THREE.Color(b.color2 ?? b.color);
    const count = Math.round(b.count * this.scale);
    for (let k = 0; k < count; k++) {
      if (this.n >= this.max) this.kill(0);
      const i = this.n++;
      const a = Math.random() * Math.PI * 2;
      const e = Math.acos(2 * Math.random() - 1);
      const sp = b.speed * (0.35 + Math.random() * 0.65);
      let vx = Math.sin(e) * Math.cos(a) * sp;
      let vy = Math.cos(e) * sp;
      const vz = Math.sin(e) * Math.sin(a) * sp * 0.6;
      if (b.up) vy = Math.abs(vy) * b.up + vy * (1 - b.up);
      vx *= b.spread ?? 1;
      const s = b.spread ? 0.1 : 0;
      this.pos[i * 3] = b.x + (Math.random() - 0.5) * s;
      this.pos[i * 3 + 1] = b.y + (Math.random() - 0.5) * s;
      this.pos[i * 3 + 2] = b.z;
      this.vel[i * 3] = vx + (b.vx ?? 0);
      this.vel[i * 3 + 1] = vy + (b.vy ?? 0);
      this.vel[i * 3 + 2] = vz + (b.vz ?? 0);
      const t = Math.random();
      this.col[i * 3] = c1.r + (c2.r - c1.r) * t;
      this.col[i * 3 + 1] = c1.g + (c2.g - c1.g) * t;
      this.col[i * 3 + 2] = c1.b + (c2.b - c1.b) * t;
      this.maxLife[i] = this.life[i] = b.life * (0.6 + Math.random() * 0.6);
      this.baseSize[i] = b.size * (0.6 + Math.random() * 0.8);
      this.grav[i] = b.gravity ?? 0;
      this.drag[i] = b.drag ?? 1.5;
    }
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i == j) return;
    for (let c = 0; c < 3; c++) {
      this.pos[i * 3 + c] = this.pos[j * 3 + c];
      this.vel[i * 3 + c] = this.vel[j * 3 + c];
      this.col[i * 3 + c] = this.col[j * 3 + c];
    }
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.baseSize[i] = this.baseSize[j];
    this.grav[i] = this.grav[j];
    this.drag[i] = this.drag[j];
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        i--;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 2.5);
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * t);
    }
    this.geom.setDrawRange(0, this.n);
    for (const a of ['position', 'color', 'size', 'alpha']) (this.geom.attributes[a] as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.n = 0;
    this.geom.setDrawRange(0, 0);
  }
}

/** Physically tossed gold coins (instanced). */
export class Coins {
  readonly mesh: THREE.InstancedMesh;
  private items: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; life: number; floor: number }[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private one = new THREE.Vector3(1, 1, 1);

  constructor(material: THREE.Material, private readonly max = 80) {
    this.mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 16), material, max);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  toss(x: number, y: number, z: number, n: number, floor: number, power = 1): void {
    for (let i = 0; i < n; i++) {
      if (this.items.length >= this.max) this.items.shift();
      const a = (Math.random() - 0.5) * 2.2;
      this.items.push({
        p: new THREE.Vector3(x + (Math.random() - 0.5) * 0.4, y, z),
        v: new THREE.Vector3(Math.sin(a) * 3 * power, (3 + Math.random() * 4) * power, (Math.random() - 0.3) * 1.5),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0),
        w: new THREE.Vector3((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 0),
        life: 1.1 + Math.random() * 0.6,
        floor,
      });
    }
  }

  update(dt: number): void {
    let k = 0;
    for (const c of this.items) {
      c.life -= dt;
      c.v.y -= 22 * dt;
      c.p.addScaledVector(c.v, dt);
      if (c.p.y < c.floor) {
        c.p.y = c.floor;
        c.v.y *= -0.35;
        c.v.x *= 0.6;
        c.w.multiplyScalar(0.6);
      }
      c.r.x += c.w.x * dt;
      c.r.y += c.w.y * dt;
      this.q.setFromEuler(c.r);
      const s = Math.min(1, c.life * 3);
      this.m4.compose(c.p, this.q, this.one.clone().multiplyScalar(s));
      if (c.life > 0) this.mesh.setMatrixAt(k++, this.m4);
    }
    this.items = this.items.filter((c) => c.life > 0);
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.items = [];
    this.mesh.count = 0;
  }
}

/** HTML score popups and title cards positioned over the 3D view. */
export class Popups {
  readonly el: HTMLElement;
  private items: { el: HTMLElement; p: THREE.Vector3; t: number; life: number }[] = [];
  private v = new THREE.Vector3();
  private card: HTMLElement;
  private cardTimer = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'popups';
    this.card = document.createElement('div');
    this.card.className = 'title-card';
    this.el.appendChild(this.card);
  }

  score(text: string, p: THREE.Vector3, big = false): void {
    const el = document.createElement('div');
    el.className = 'popup' + (big ? ' big' : '');
    el.textContent = text;
    this.el.appendChild(el);
    this.items.push({ el, p: p.clone(), t: 0, life: big ? 1.6 : 1.1 });
  }

  /** Big centred cinematic text ("Level 3", "Game Over"). */
  title(main: string, sub = '', seconds = 2.2): void {
    this.card.innerHTML = `<div class="tc-main">${main}</div>${sub ? `<div class="tc-sub">${sub}</div>` : ''}`;
    this.card.classList.remove('show');
    void this.card.offsetWidth;
    this.card.classList.add('show');
    this.cardTimer = seconds;
  }

  hideTitle(): void {
    this.card.classList.remove('show');
    this.cardTimer = 0;
  }

  update(dt: number, camera: THREE.Camera, w: number, h: number): void {
    if (this.cardTimer > 0) {
      this.cardTimer -= dt;
      if (this.cardTimer <= 0) this.card.classList.remove('show');
    }
    for (const it of this.items) {
      it.t += dt;
      this.v.copy(it.p);
      this.v.y += it.t * 0.9;
      this.v.project(camera);
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      const a = it.t < 0.15 ? it.t / 0.15 : Math.max(0, 1 - (it.t - it.life * 0.6) / (it.life * 0.4));
      it.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${0.8 + Math.min(1, it.t * 6) * 0.2})`;
      it.el.style.opacity = String(Math.min(1, a));
    }
    this.items = this.items.filter((it) => {
      if (it.t < it.life) return true;
      it.el.remove();
      return false;
    });
  }

  clear(): void {
    for (const it of this.items) it.el.remove();
    this.items = [];
    this.hideTitle();
  }
}
