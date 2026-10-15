// The remastered 3D view: a lit cross-section diorama of the playfield.
// Reads the sim's sprite table and dug mask every frame; never changes the sim.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { FrameInfo, Renderer } from '../renderer';
import type { Game, SimEvent } from '../../sim/game';
import type { Settings } from '../../storage/storage';
import { Terrain } from './terrain';
import { themeFor, type Theme } from './themes';
import { ACTOR_Z, S, TUNNEL_DEPTH, spriteCx, spriteCy, wx, wy } from './space';
import {
  emeraldGeometry,
  emeraldMaterial,
  goldMaterial,
  makeBag,
  makeWarden,
  makeCherry,
  makeDigger,
  makeGold,
  makeGrave,
  makeHobbin,
  makeNobbin,
  type BagModel,
  type WardenModel,
  type DiggerModel,
  type GoldModel,
  type Materials,
  type HobbinModel,
  type NobbinModel,
} from './models';
import { Coins, Particles, Popups } from './fx';
import { glowTexture, sparkleTexture } from './textures';
import { WIDTH } from '../../sim/pc';
import { vnoise } from './noise';

/** Bags and gold protrude from the earth's face, or sit inside a tunnel once dug free. */
const BAG_Z_SOLID = 0.05;
const EMERALD_Z = 0.16;

const qRight = new THREE.Quaternion();
const qLeft = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const zAxis = new THREE.Vector3(0, 0, 1);
const qUpR = new THREE.Quaternion().setFromAxisAngle(zAxis, Math.PI / 2);
const qDownR = new THREE.Quaternion().setFromAxisAngle(zAxis, -Math.PI / 2);
const qUpL = new THREE.Quaternion().setFromAxisAngle(zAxis, -Math.PI / 2).multiply(qLeft);
const qDownL = new THREE.Quaternion().setFromAxisAngle(zAxis, Math.PI / 2).multiply(qLeft);
const qFlip = new THREE.Quaternion().setFromAxisAngle(zAxis, Math.PI);
/** Three-quarter view towards the camera, for the victory dance. */
const qFront = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -1.1);
/** Seconds per hop of the victory dance; every fourth hop is a spinning leap. */
const WIN_BEAT = 0.4;

const damp = (a: number, b: number, k: number, dt: number) => b + (a - b) * Math.exp(-k * dt);

/** Overshooting ease for entrances: 0 → 1 with a little bounce past 1. */
const easeOutBack = (t: number) => {
  if (t >= 1) return 1;
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** Entrance scale for something that appeared `age` seconds ago. */
const entrance = (age: number, len = 0.45) => Math.max(0.001, easeOutBack(Math.max(0, age) / len));

interface MonsterState {
  nob: NobbinModel;
  hob: HobbinModel;
  /** The room Warden, shown instead of the other two when this slot is the boss. */
  warden: WardenModel;
  /** 0 = Nobbin, 1 = Hobbin; animated through a squash-and-pop morph. */
  morph: number;
  face: number;
  wasOn: boolean;
  squash: number;
  lastX: number;
  phase: number;
  blink: number;
  /** Seconds since it appeared (drives the entrance animation). */
  age: number;
}

interface BagState {
  bag: BagModel;
  gold: GoldModel;
  wasCh: number;
  tilt: number;
  goldShown: number;
  age: number;
}

export class HdRenderer implements Renderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(14, 16 / 9, 1, 400);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private terrain: Terrain;
  private env: THREE.Texture;
  private mats: Materials;

  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  private headlamp: THREE.SpotLight;
  private fireLight: THREE.PointLight;
  private flashLight: THREE.PointLight;
  private cherryLight: THREE.PointLight;

  private digger: DiggerModel;
  private diggerQ = new THREE.Quaternion();
  private lastH: 0 | 4 = 0;
  private hoopUp = 1;
  private diggerAge = 9;
  private cherryAge = 9;
  private cherryWasOn = false;
  private emAge = new Float32Array(151).fill(9);
  private diggerWasOn = false;
  /** Victory dance clock and the last hop that set off its fireworks. */
  private winT = 0;
  private winBeat = -1;
  private grave: THREE.Group;
  private monsters: MonsterState[] = [];
  private bags: BagState[] = [];
  private cherry: THREE.Group;
  private fire: THREE.Group;
  private fireCore: THREE.Mesh;
  private fireGlow: THREE.Sprite;
  private emeralds: THREE.InstancedMesh;
  private emShown = new Uint8Array(151);
  private emPhase = new Float32Array(151);
  private sparkles: THREE.Points;
  private sparkleData = new Float32Array(64 * 4);

  private sparks = new Particles(1400, true);
  private dust = new Particles(900, false);
  private coins: Coins;
  private popups = new Popups();
  private labels: HTMLElement;

  private theme: Theme | null = null;
  private plan = -1;
  private attractMask: Uint8Array | null = null;
  private size = { w: 1, h: 1 };
  private shake = 0;
  private flash = 0;
  private zoom = 0;
  /** Eased copy of the title menu's dock (CSS px); null until the first frame. */
  private dock: { left: number; bottom: number } | null = null;
  private lastPos = new THREE.Vector3();
  private lastScene = '';
  private reducedMotion = false;
  private highContrast = false;
  private quality: Settings['quality'] = 'high';
  private v = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  /** Dev aid: overrides the camera to inspect a spot up close. */
  debugCamera: { x: number; y: number; d: number } | null = null;

  constructor(settings: Settings) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hd-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap was removed in this Three release (it silently fell back and
    // logged a warning); plain PCF with a larger map is crisper at the same cost.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.mats = { env: this.env };

    this.scene.background = new THREE.Color(0x07060a);
    this.scene.fog = new THREE.Fog(0x07060a, 60, 140);

    // --- Lights -------------------------------------------------------------
    this.hemi = new THREE.HemisphereLight(0xffe2c0, 0x2a160c, 0.85);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff0dc, 2.4);
    this.key.position.set(-9, 16, 22);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -19;
    sc.right = 19;
    sc.top = 13;
    sc.bottom = -12;
    sc.near = 1;
    sc.far = 70;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.03;
    this.scene.add(this.key);
    this.fill = new THREE.DirectionalLight(0x9fb8ff, 0.45);
    this.fill.position.set(14, 4, 12);
    this.scene.add(this.fill);

    this.headlamp = new THREE.SpotLight(0xffe6b0, 0, 11, 0.55, 0.7, 1.4);
    this.scene.add(this.headlamp, this.headlamp.target);
    this.fireLight = new THREE.PointLight(0xff9a3a, 0, 9, 1.6);
    this.flashLight = new THREE.PointLight(0xffc070, 0, 14, 1.4);
    this.cherryLight = new THREE.PointLight(0xff3050, 0, 5, 1.6);
    this.scene.add(this.fireLight, this.flashLight, this.cherryLight);

    // --- World ------------------------------------------------------------------
    this.terrain = new Terrain(settings.quality == 'low' ? 256 : 512);
    this.scene.add(this.terrain.group);

    this.digger = makeDigger(this.mats);
    this.scene.add(this.digger.root);
    this.grave = makeGrave();
    this.grave.visible = false;
    this.scene.add(this.grave);

    for (let i = 0; i < 6; i++) {
      const nob = makeNobbin(this.mats);
      const hob = makeHobbin(this.mats);
      const warden = makeWarden(this.mats);
      nob.root.visible = hob.root.visible = warden.root.visible = false;
      this.scene.add(nob.root, hob.root, warden.root);
      this.monsters.push({ nob, hob, warden, morph: 0, face: 1, wasOn: false, squash: 0, lastX: 0, phase: Math.random() * 6, blink: 2 + Math.random() * 3, age: 9 });
    }
    for (let i = 0; i < 7; i++) {
      const bag = makeBag(this.mats);
      const gold = makeGold(this.mats);
      bag.root.visible = gold.root.visible = false;
      this.scene.add(bag.root, gold.root);
      this.bags.push({ bag, gold, wasCh: 0, tilt: 0, goldShown: 0, age: 9 });
    }
    this.cherry = makeCherry(this.mats);
    this.cherry.visible = false;
    this.scene.add(this.cherry);

    this.fire = new THREE.Group();
    this.fireCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 20, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 1.2) }),
    );
    this.fireGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff8a30, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.fireGlow.scale.setScalar(1.8);
    this.fire.add(this.fireCore, this.fireGlow);
    this.fire.visible = false;
    this.scene.add(this.fire);

    this.emeralds = new THREE.InstancedMesh(emeraldGeometry(), emeraldMaterial(this.mats), 151);
    this.emeralds.castShadow = true;
    this.emeralds.count = 0;
    this.emeralds.frustumCulled = false;
    for (let i = 0; i < 151; i++) this.emPhase[i] = Math.random() * Math.PI * 2;
    this.scene.add(this.emeralds);

    // Gem twinkles
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    sg.setAttribute('size', new THREE.BufferAttribute(new Float32Array(64), 1));
    this.sparkles = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({
        uniforms: { map: { value: sparkleTexture() }, uScale: { value: 400 } },
        vertexShader: `attribute float size; uniform float uScale;
          void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size*uScale/-mv.z; gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform sampler2D map; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vec3(1.,1.,.92)*t.rgb*1.6, t.a); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.sparkles.frustumCulled = false;
    this.scene.add(this.sparkles);

    this.coins = new Coins(goldMaterial(this.mats));
    this.scene.add(this.sparks.points, this.dust.points, this.coins.mesh);

    // --- Post-processing ------------------------------------------------------------
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Modest bloom: enough for the emerald and lamp glints, cheap enough to leave on.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.labels = document.createElement('div');
    this.labels.className = 'cast-labels';
    this.configure(settings);
  }

  configure(s: Settings): void {
    this.reducedMotion = s.reducedMotion;
    // High contrast: darker earth, brighter actors and gems, violet monsters.
    this.highContrast = s.highContrast;
    this.terrain.setContrast(s.highContrast);
    (this.emeralds.material as THREE.MeshPhysicalMaterial).emissiveIntensity = s.highContrast ? 1.1 : 0.6;
    this.key.intensity = s.highContrast ? 2.9 : 2.4;
    this.quality = s.quality;
    const q = s.quality;
    this.renderer.shadowMap.enabled = q != 'low';
    this.key.castShadow = q != 'low';
    this.key.shadow.mapSize.setScalar(q == 'high' ? 2048 : 1024);
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null as never;
    this.bloom.enabled = q != 'low';
    this.sparks.scale = this.dust.scale = q == 'low' ? 0.5 : 1;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
    });
    this.resize(this.size.w, this.size.h, devicePixelRatio || 1);
  }

  activate(g: Game): void {
    const host = this.canvas.parentElement;
    if (host) host.append(this.popups.el, this.labels);
    this.plan = -1;
    this.syncTheme(g);
    this.emShown.fill(0);
  }

  deactivate(): void {
    this.popups.clear();
    this.popups.el.remove();
    this.labels.remove();
    this.headlamp.intensity = 0;
  }

  resize(w: number, h: number, dpr: number): void {
    if (!w || !h) return;
    this.size = { w, h };
    // Pixel ratio is the single biggest cost here: bloom and shadows both scale with
    // it, and the diorama does not need native 2x to look sharp.
    const ratio = this.quality == 'low' ? 1 : this.quality == 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 1.5);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    this.sparks.setViewport(h * ratio);
    this.dust.setViewport(h * ratio);
    (this.sparkles.material as THREE.ShaderMaterial).uniforms.uScale.value = h * ratio * 0.9;
  }

  // ------------------------------------------------------------------------------

  private syncTheme(g: Game): void {
    const plan = g.scene == 'attract' ? 1 : g.main.levplan();
    if (plan == this.plan) return;
    this.plan = plan;
    this.theme = themeFor(plan);
    this.terrain.setTheme(this.theme);
    this.hemi.color.set(this.theme.ambient);
  }

  render(f: FrameInfo): void {
    const g = f.game;
    const dt = Math.min(f.dt, 0.1);
    this.syncTheme(g);
    if (g.scene != this.lastScene) this.sceneChanged(g, this.lastScene);
    this.lastScene = g.scene;

    // Terrain: the real dug mask in game, a staged set of tunnels on the title screen.
    if (g.scene == 'attract') {
      this.attractMask ??= buildAttractMask();
      this.terrain.update(this.attractMask, -100, f.time);
    } else this.terrain.update(g.pc.dug, g.pc.terrainVersion, f.time);

    if (!f.paused) for (const e of f.events) this.onEvent(e, g);

    this.updateCast(f);
    this.updateDigger(f, dt);
    this.updateMonsters(f, dt);
    this.updateBags(f, dt);
    this.updateEmeralds(f, dt);
    this.updateCherryAndFire(f, dt);
    this.updateLabels(f);

    if (!f.paused) {
      this.sparks.update(dt);
      this.dust.update(dt);
      this.coins.update(dt);
    }
    this.updateCamera(f, dt);
    this.popups.update(f.paused ? 0 : dt, this.camera, this.size.w, this.size.h);

    // Bonus mode: the original flashed the palette; here the light warms and pulses.
    const bright = g.pc.curpal == 1;
    this.renderer.toneMappingExposure = damp(this.renderer.toneMappingExposure, bright ? 1.35 : 1.05, 14, dt);
    this.flash = damp(this.flash, 0, 6, dt);
    this.flashLight.intensity = this.flash * 60;

    if (this.bloom.enabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  private sceneChanged(g: Game, prev: string): void {
    if (g.scene == 'attract') {
      this.popups.clear();
      this.sparks.clear();
      this.dust.clear();
      this.coins.clear();
    }
    if (g.scene == 'gameover') this.popups.title('Game Over', '', 2.4);
    if (g.scene == 'play' && prev == 'intro') this.popups.hideTitle();
  }

  private onEvent(e: SimEvent, g: Game): void {
    const P = (x: number, y: number, z = ACTOR_Z) => new THREE.Vector3(spriteCx(x), spriteCy(y), z);
    switch (e.type) {
      case 'levelStart': {
        const theme = themeFor(e.plan);
        const who = g.main.nplayers > 1 ? `Player ${e.player + 1} · ` : '';
        this.popups.title(`Level ${e.level}`, who + theme.name, 2.4);
        this.emShown.fill(0);
        break;
      }
      case 'levelDone':
        this.popups.title('Level Complete', '', 2.6);
        // Any monsters left vanish in a puff rather than blinking out.
        for (const st of this.monsters) {
          if (!st.wasOn) continue;
          const p = (st.morph > 0.5 ? st.hob : st.nob).root.position;
          this.dust.emit({ x: p.x, y: p.y, z: ACTOR_Z + 0.3, count: 24, color: 0xb6ff9e, color2: 0x2a7a2a, speed: 3.5, life: 0.7, size: 0.7, drag: 3 });
        }
        break;
      case 'emerald': {
        const p = P(e.x, e.y);
        this.lastPos.copy(p);
        break;
      }
      case 'octave':
        this.popups.score('8 in a row  +250', P(e.x, e.y).add(new THREE.Vector3(0, 0.8, 0)), true);
        this.sparks.emit({ x: spriteCx(e.x), y: spriteCy(e.y), z: ACTOR_Z, count: 60, color: 0x7dffb8, color2: 0xffffff, speed: 7, life: 0.9, size: 0.35, drag: 2.5 });
        break;
      case 'explode':
        this.sparks.emit({ x: wx(e.x + 4), y: wy(e.y + 4), z: ACTOR_Z, count: 45, color: 0xffb24a, color2: 0xff4a1a, speed: 9, life: 0.5, size: 0.45, drag: 3 });
        this.flashLight.position.set(wx(e.x + 4), wy(e.y + 4), 0.8);
        this.flash = 1;
        this.kick(0.12);
        break;
      case 'monsterSpawn':
        this.dust.emit({ x: spriteCx(292), y: spriteCy(18), z: ACTOR_Z, count: 30, color: 0x88ff88, color2: 0x2a6a2a, speed: 3, life: 0.8, size: 0.6, drag: 3 });
        break;
      case 'bossSpawn': {
        const p = new THREE.Vector3(spriteCx(292), spriteCy(18), ACTOR_Z);
        this.popups.title('The Warden', `Break through it ${e.maxHp} times`, 2.6);
        this.dust.emit({ x: p.x, y: p.y, z: p.z, count: 70, color: 0xff8a4a, color2: 0x6b1f3a, speed: 6, life: 1, size: 0.75, drag: 2.5 });
        this.sparks.emit({ x: p.x, y: p.y, z: p.z, count: 90, color: 0xffd36a, color2: 0xff4a1a, speed: 10, life: 0.9, size: 0.4, gravity: 10, drag: 2 });
        this.flash = 1;
        this.kick(0.4);
        break;
      }
      case 'bossHit': {
        const p = P(e.x, e.y);
        this.sparks.emit({ x: p.x, y: p.y, z: p.z, count: 70, color: 0xffd36a, color2: 0xffffff, speed: 9, life: 0.7, size: 0.4, gravity: 8, drag: 2 });
        this.flash = Math.max(this.flash, 0.7);
        this.kick(0.3);
        break;
      }
      case 'bossCharge': {
        const p = P(e.x, e.y).add(new THREE.Vector3(0, 1.2, 0));
        this.popups.score('CHARGE', p, true);
        this.flash = Math.max(this.flash, 0.45);
        this.kick(0.14);
        break;
      }
      case 'bossKilled': {
        const p = P(e.x, e.y);
        this.sparks.emit({ x: p.x, y: p.y, z: p.z, count: 160, color: 0xffe08a, color2: 0xff4a1a, speed: 13, life: 1.3, size: 0.55, gravity: 6, drag: 1.6 });
        this.coins.toss(p.x, p.y, p.z + 0.5, 24, p.y - 0.8, 1.1);
        this.popups.score('Warden down  +5000', p.add(new THREE.Vector3(0, 1.3, 0)), true);
        this.flash = 1;
        this.kick(0.5);
        break;
      }
      case 'monsterKilled': {
        const p = P(e.x, e.y);
        this.lastPos.copy(p);
        this.sparks.emit({ x: p.x, y: p.y, z: p.z, count: 40, color: 0x7dff6a, color2: 0x1e9a2a, speed: 8, life: 0.8, size: 0.45, gravity: 14, drag: 1.2 });
        this.dust.emit({ x: p.x, y: p.y, z: p.z, count: 20, color: 0x3a8a3a, speed: 4, life: 0.7, size: 0.8, drag: 4 });
        if (e.cause == 'eaten') this.flash = Math.max(this.flash, 0.5);
        break;
      }
      case 'bagLand': {
        const p = P(e.x, e.y, ACTOR_Z);
        this.dust.emit({ x: p.x, y: p.y - 0.65, z: p.z + 0.3, count: e.breaks ? 40 : 18, color: 0x8a6a4a, color2: 0x4a3020, speed: 3.5, life: 0.9, size: 0.9, drag: 3.5, up: 0.7 });
        this.kick(e.breaks ? 0.18 : 0.08);
        if (e.breaks) {
          this.coins.toss(p.x, p.y - 0.2, p.z + 0.4, 10, p.y - 0.6, 0.8);
          this.sparks.emit({ x: p.x, y: p.y, z: p.z + 0.4, count: 40, color: 0xffd36a, color2: 0xffffff, speed: 6, life: 0.7, size: 0.3, drag: 2 });
        }
        break;
      }
      case 'gold': {
        const p = P(e.x, e.y, ACTOR_Z);
        this.lastPos.copy(p);
        this.coins.toss(p.x, p.y - 0.3, p.z + 0.4, e.byDigger ? 8 : 4, p.y - 0.7, 0.7);
        this.sparks.emit({ x: p.x, y: p.y - 0.2, z: p.z + 0.4, count: 50, color: 0xffe08a, color2: 0xffffff, speed: 6, life: 0.8, size: 0.32, drag: 2.2, up: 0.5 });
        break;
      }
      case 'diggerHit': {
        const p = P(e.x, e.y);
        this.sparks.emit({ x: p.x, y: p.y, z: p.z, count: 50, color: 0xff7040, color2: 0xffe0a0, speed: 9, life: 0.7, size: 0.4, drag: 2 });
        this.kick(0.35);
        break;
      }
      case 'grave': {
        const p = P(e.x, e.y);
        this.dust.emit({ x: p.x, y: p.y - 0.6, z: p.z, count: 26, color: 0x8a7060, speed: 2.5, life: 1.2, size: 0.9, drag: 2.5, up: 0.8 });
        break;
      }
      case 'bonusStart':
        this.flash = 1;
        this.flashLight.position.set(spriteCx(g.digger.diggerx), spriteCy(g.digger.diggery), 1);
        this.sparks.emit({ x: spriteCx(g.digger.diggerx), y: spriteCy(g.digger.diggery), z: ACTOR_Z, count: 70, color: 0xff3a5a, color2: 0xffd0d8, speed: 8, life: 0.9, size: 0.4, drag: 2 });
        this.lastPos.set(spriteCx(g.digger.diggerx), spriteCy(g.digger.diggery), ACTOR_Z);
        break;
      case 'extraLife':
        this.popups.score('1 UP', new THREE.Vector3(spriteCx(g.digger.diggerx), spriteCy(g.digger.diggery) + 1.2, ACTOR_Z), true);
        break;
      case 'score':
        if (e.points >= 200) {
          const label = e.points == 1000 ? 'BONUS  +1000' : `+${e.points}`;
          this.popups.score(label, this.lastPos.clone().add(new THREE.Vector3(0, 0.5, 0)), e.points >= 800);
        }
        break;
    }
  }

  private kick(amount: number): void {
    if (!this.reducedMotion) this.shake = Math.min(0.6, this.shake + amount);
  }

  /** Interpolated sprite position (top-left, sim pixels). */
  private spritePos(f: FrameInfo, i: number): [number, number] {
    const sp = f.game.sprite;
    const x = sp.sprx[i];
    const y = sp.spry[i];
    const p = f.prev;
    if (!p.en[i] || Math.abs(p.x[i] - x) > 8 || Math.abs(p.y[i] - y) > 8 || f.game.scene == 'intro') return [x, y];
    const a = f.alpha;
    return [p.x[i] + (x - p.x[i]) * a, p.y[i] + (y - p.y[i]) * a];
  }

  private updateDigger(f: FrameInfo, dt: number): void {
    const g = f.game;
    const d = this.digger;
    const on = g.sprite.sprenf[0] && this.castOn(g, 0);
    const ch = g.sprite.sprch[0];
    const [sx, sy] = this.spritePos(f, 0);
    const x = spriteCx(sx);
    const y = spriteCy(sy);
    this.grave.visible = false;
    // The sim takes the Digger off the field as soon as the level is won; keep it for the dance.
    if (g.scene == 'levdone' || (g.scene == 'aftermath' && g.main.gamedat[g.main.curplayer].levdone)) {
      this.celebrate(f, dt);
      return;
    }
    this.winT = 0;
    this.winBeat = -1;
    if (!on || ch < 1 || ch > 30) {
      d.root.visible = false;
      this.headlamp.intensity = 0;
      this.diggerWasOn = false;
      return;
    }
    if (ch >= 26) {
      // Gravestone rising out of the tunnel floor.
      d.root.visible = false;
      this.headlamp.intensity = 0;
      const k = (ch - 25) / 5;
      this.grave.visible = true;
      this.grave.position.set(x, y - 1.25 + k * 1.25, ACTOR_Z);
      return;
    }
    d.root.visible = true;
    if (!this.diggerWasOn && ch < 25) {
      this.diggerAge = 0;
      this.sparks.emit({ x, y, z: ACTOR_Z + 0.3, count: 40, color: 0xffe0a0, color2: 0xff7040, speed: 5, life: 0.6, size: 0.35, drag: 3 });
    }
    if (!f.paused) this.diggerAge += dt;
    const ds = entrance(this.diggerAge, 0.5);
    d.root.scale.setScalar(ds * this.castExit);
    d.root.rotation.set(0, (1 - Math.min(1, this.diggerAge / 0.5)) * Math.PI * 2, 0);
    const moved = Math.hypot(x - d.root.position.x, y - d.root.position.y);
    d.root.position.set(x, y, ACTOR_Z);
    if (ch == 25) {
      // Knocked upside down.
      this.diggerQ.slerp(qFlip, 1 - Math.exp(-12 * dt));
      d.body.quaternion.copy(this.diggerQ);
      d.beaconMat.emissiveIntensity = 0;
      d.lampMat.emissiveIntensity = 0.2;
      this.headlamp.intensity = 0;
      if (Math.random() < dt * 8)
        this.dust.emit({ x, y: y + 0.3, z: ACTOR_Z, count: 2, color: 0x555555, color2: 0x222222, speed: 0.8, vy: 1.5, life: 1.2, size: 0.7, drag: 1 });
      return;
    }
    const dir = Math.floor((ch - 1) / 6) * 2;
    const ready = (ch - 1) % 6 < 3;
    if (dir == 0) this.lastH = 0;
    if (dir == 4) this.lastH = 4;
    const target = dir == 0 ? qRight : dir == 4 ? qLeft : dir == 2 ? (this.lastH == 0 ? qUpR : qUpL) : this.lastH == 0 ? qDownR : qDownL;
    if (!this.diggerWasOn) this.diggerQ.copy(target);
    this.diggerWasOn = true;
    this.diggerQ.slerp(target, 1 - Math.exp(-22 * dt));
    d.body.quaternion.copy(this.diggerQ);

    const moving = moved > 0.002 && !f.paused;
    if (!f.paused) {
      d.spinner.rotation.x += (moving ? 28 : 16) * dt;
      for (const w of d.wheels) w.rotation.z -= (moving ? 9 : 0) * dt;
    }
    // The original's sprite cycles its scoop in and out every tick, even standing still;
    // here the drill pumps on its piston with the same three frames.
    const frame = (ch - 1) % 3;
    const pumpTarget = 0.62 - frame * 0.13;
    d.drill.position.x = damp(d.drill.position.x, pumpTarget, 30, dt);
    // Engine rumble, stronger while driving.
    d.body.position.y = Math.sin(f.time * (moving ? 60 : 38)) * (moving ? 0.018 : 0.01);

    // Ready to fire: the yellow hoop stands tall and glows, as on the CGA sprite;
    // while recharging it sinks into the cab and dims.
    const recharge = g.digger.rechargetime;
    const total = g.main.levof10() * 3 + 60;
    const up = ready ? 1 : 0;
    this.hoopUp = damp(this.hoopUp, up, ready ? 14 : 8, dt);
    const pop = ready ? 1 + Math.max(0, Math.sin(Math.min(1, this.hoopUp) * Math.PI)) * 0.25 : 1;
    d.hoop.scale.set(pop, 0.3 + this.hoopUp * 0.95 * pop, pop);
    d.hoop.position.y = 0.42 + this.hoopUp * 0.13;
    d.hoopMat.emissiveIntensity = ready ? 0.8 + Math.sin(f.time * 7) * 0.3 : 0.05;
    d.hoopMat.color.set(ready ? 0xffd040 : 0x8a6a20);
    if (ready) {
      d.beaconMat.color.set(0x3cff9a);
      d.beaconMat.emissive.set(0x3cff9a);
      d.beaconMat.emissiveIntensity = 2.4 + Math.sin(f.time * 6) * 0.6;
    } else {
      d.beaconMat.color.set(0xff3a2a);
      d.beaconMat.emissive.set(0xff3a2a);
      d.beaconMat.emissiveIntensity = 0.3 + (1 - recharge / total) * 1.2;
    }
    d.lampMat.emissiveIntensity = 1.4;

    // Headlamp spot.
    d.lampAnchor.getWorldPosition(this.v);
    this.headlamp.position.copy(this.v);
    const fwd = new THREE.Vector3(1, -0.15, 0).applyQuaternion(this.diggerQ);
    this.headlamp.target.position.copy(this.v).addScaledVector(fwd, 4);
    this.headlamp.intensity = g.scene == 'attract' ? 14 : 22;

    // Dirt crumbs when digging fresh earth.
    if (moving && this.terrain.changed && g.digger.digmdir >= 0) {
      const front = new THREE.Vector3(0.85, 0, 0).applyQuaternion(this.diggerQ);
      this.dust.emit({
        x: x + front.x,
        y: y + front.y,
        z: ACTOR_Z + 0.5,
        count: 3,
        color: this.theme?.light ?? 0x9a6a3a,
        color2: this.theme?.dark ?? 0x4a2a10,
        speed: 2,
        life: 0.6,
        size: 0.32,
        gravity: 9,
        drag: 1,
      });
    }
  }

  /**
   * Level complete: the Digger steps out of its tunnel towards the camera and hops to
   * the jingle, rocking side to side, with fireworks over the field on every beat.
   */
  private celebrate(f: FrameInfo, dt: number): void {
    const g = f.game;
    const d = this.digger;
    // Stands still until the jingle starts (bags may still be falling).
    if (g.scene == 'levdone' && !f.paused) this.winT += dt;
    const t = this.winT;
    const x = spriteCx(g.digger.diggerx);
    const y = spriteCy(g.digger.diggery);
    const out = Math.min(1, t / 0.35);
    const z = ACTOR_Z + out * 1.5;
    const beat = Math.floor(t / WIN_BEAT);
    const u = (t / WIN_BEAT) % 1;
    const leap = beat % 4 == 3;
    const air = Math.sin(u * Math.PI);
    // Stretch in the air, squash on landing.
    const stretch = 1 + (air - 0.4) * 0.22 * out;
    const wide = 1 / Math.sqrt(stretch);
    d.root.visible = true;
    d.root.position.set(x, y + air * (leap ? 0.9 : 0.4) * out, z);
    d.root.scale.set(wide, stretch, wide);
    d.root.rotation.set(0, leap ? u * Math.PI * 2 : 0, Math.sin((t / WIN_BEAT) * Math.PI) * 0.2 * out);
    this.diggerQ.slerp(qFront, 1 - Math.exp(-10 * dt));
    d.body.quaternion.copy(this.diggerQ);
    d.body.position.y = 0;
    this.diggerWasOn = false;
    this.headlamp.intensity = 0;

    if (!f.paused) {
      d.spinner.rotation.x += 34 * dt;
      for (const w of d.wheels) w.rotation.z -= 12 * dt;
    }
    d.drill.position.x = 0.5 + air * 0.12;
    this.hoopUp = 1;
    d.hoop.scale.set(1, 1.25 + air * 0.3, 1);
    d.hoop.position.y = 0.55;
    d.hoopMat.emissiveIntensity = 0.8 + air * 0.6;
    d.hoopMat.color.set(0xffd040);
    d.beaconMat.color.setHSL((t * 1.5) % 1, 1, 0.6);
    d.beaconMat.emissive.copy(d.beaconMat.color);
    d.beaconMat.emissiveIntensity = 3;
    d.lampMat.emissiveIntensity = 1.4;

    if (g.scene != 'levdone' || beat == this.winBeat) return;
    this.winBeat = beat;
    // Each landing kicks up sparks, and a firework bursts somewhere over the field.
    this.sparks.emit({ x, y: y - 0.5, z, count: 24, color: 0xffe08a, color2: 0x7dffb8, speed: 5, life: 0.7, size: 0.3, gravity: 8, drag: 1.5, up: 0.8 });
    const hue = new THREE.Color().setHSL(Math.random(), 1, 0.6);
    this.sparks.emit({ x: (Math.random() - 0.5) * 24, y: wy(30 + Math.random() * 90), z: 1.2, count: 90, color: hue, color2: hue.clone().lerp(new THREE.Color(0xffffff), 0.5), speed: 9, life: 1.2, size: 0.5, gravity: 5, drag: 2.2 });
    if (beat % 4 == 0) this.coins.toss(x, y, z, 10, y - 0.75, 0.9);
  }

  private updateMonsters(f: FrameInfo, dt: number): void {
    const g = f.game;
    const dx = spriteCx(g.sprite.sprx[0]);
    const dy = spriteCy(g.sprite.spry[0]);
    for (let i = 0; i < 6; i++) {
      const st = this.monsters[i];
      const slot = 8 + i;
      const warden = g.monster.mondat[i].boss;
      const on = g.sprite.sprenf[slot] && this.castOn(g, slot);
      const ch = g.sprite.sprch[slot];
      const { nob, hob } = st;
      if (!on || (!warden && (ch < 69 || ch > 80))) {
        nob.root.visible = hob.root.visible = st.warden.root.visible = false;
        st.wasOn = false;
        continue;
      }
      const [sx, sy] = this.spritePos(f, slot);
      const x = spriteCx(sx);
      const y = spriteCy(sy);
      if (warden) {
        st.wasOn = true;
        if (!f.paused) st.age += dt;
        nob.root.visible = hob.root.visible = false;
        this.updateWarden(st, g, i, x, y, dt);
        continue;
      }
      const hobbin = ch >= 73;
      const dying = ch == 72 || ch == 76 || ch == 80;
      if (!st.wasOn) {
        st.morph = hobbin ? 1 : 0;
        st.lastX = x;
        st.squash = 0;
        st.age = 0;
      }
      if (!f.paused) st.age += dt;
      const pop = entrance(st.age, 0.5) * this.castExit;
      st.wasOn = true;
      const vx = (x - st.lastX) / Math.max(dt, 1e-3);
      st.lastX = x;
      const moving = Math.abs(vx) > 0.05 || Math.abs(y - (hobbin ? hob.root.position.y : nob.root.position.y)) > 0.002;
      const was = st.morph;
      st.morph = damp(st.morph, hobbin ? 1 : 0, 9, dt);
      // A puff of smoke as it changes form.
      if (!f.paused && (was < 0.5) != (st.morph < 0.5))
        this.dust.emit({ x, y, z: ACTOR_Z + 0.3, count: 22, color: 0xb6ff9e, color2: 0x2a7a2a, speed: 3.5, life: 0.6, size: 0.7, drag: 3 });
      st.squash = damp(st.squash, dying ? 1 : 0, 18, dt);
      const faceDir = ch >= 77 ? -1 : ch >= 73 ? 1 : 0;
      if (faceDir) st.face = faceDir;
      else if (Math.abs(vx) > 0.05) st.face = Math.sign(vx);
      if (!f.paused) st.phase += dt * (moving ? 13 : 5);
      const sq = st.squash;
      const bounce = Math.sin(st.phase * 2) * 0.05 * (moving ? 1 : 0.8);
      // Morph: one form shrinks away as the other pops in.
      const nobScale = Math.max(0, 1 - st.morph * 2);
      const hobScale = Math.max(0, st.morph * 2 - 1);
      const scared = g.digger.bonusmode;
      const tint = (mat: THREE.MeshPhysicalMaterial, base: number) => {
        const c = new THREE.Color(base);
        if (scared) c.lerp(new THREE.Color(0x7fb6ff), 0.45 + Math.sin(f.time * 10) * 0.1);
        mat.color.lerp(c, 1 - Math.exp(-10 * dt));
      };

      // --- Nobbin: front-on, two yellow eyes, red legs stepping wide ---
      nob.root.visible = nobScale > 0.01;
      if (nob.root.visible) {
        nob.root.position.set(x, y, ACTOR_Z);
        nob.root.scale.set(pop * nobScale * (1 + sq * 0.45), pop * nobScale * (1 - sq * 0.62), pop * nobScale);
        nob.root.rotation.y = st.face * 0.3;
        nob.body.scale.set(1 + bounce, 1 - bounce, 1 + bounce);
        for (let k = 0; k < 2; k++) {
          const side = k == 0 ? -1 : 1;
          const step = Math.sin(st.phase + k * Math.PI);
          nob.legs[k].rotation.z = side * 0.45 + step * 0.35 * (moving ? 1 : 0.15);
          nob.legs[k].position.y = -0.25 + Math.max(0, step) * 0.05 * (moving ? 1 : 0);
        }
        const lx = THREE.MathUtils.clamp((dx - x) * 0.03, -0.06, 0.06);
        const ly = THREE.MathUtils.clamp((dy - y) * 0.03, -0.05, 0.05);
        for (const p of nob.pupils) p.position.set(lx, ly, 0.21 * 0.78);
        st.blink -= dt;
        if (st.blink < -0.12) st.blink = 2 + Math.random() * 4;
        const lid = Math.max(sq, st.blink < 0 ? 1 : 0, scared ? 0.5 : 0);
        for (const l of nob.lids) l.rotation.x = -1.6 + lid * 1.45;
        for (let k = 0; k < 2; k++) nob.eyes[k].position.y = 0.36 + Math.sin(st.phase * 2 + k) * 0.02;
        tint(nob.bodyMat, this.highContrast ? 0x9a4dff : 0x2fae36);
      }

      // --- Hobbin: side-on, chomping red jaws, facing its travel direction ---
      hob.root.visible = hobScale > 0.01;
      if (hob.root.visible) {
        hob.root.position.set(x, y, ACTOR_Z);
        hob.root.scale.set(pop * hobScale * (1 + sq * 0.45), pop * hobScale * (1 - sq * 0.62), pop * hobScale);
        const targetYaw = st.face > 0 ? -0.35 : Math.PI + 0.35;
        hob.facing.rotation.y = damp(hob.facing.rotation.y, targetYaw, 14, dt);
        const chomp = dying ? 0.05 : (Math.sin(st.phase * 1.4) * 0.5 + 0.5) * 0.55 + 0.1;
        hob.upperJaw.rotation.z = chomp * 0.6;
        hob.lowerJaw.rotation.z = -chomp * 0.6;
        hob.body.scale.set(1 + bounce, 1 - bounce, 1);
        for (let k = 0; k < 2; k++) hob.legs[k].rotation.z = Math.sin(st.phase + k * Math.PI) * 0.6 * (moving ? 1 : 0.1);
        tint(hob.bodyMat, this.highContrast ? 0x7a3adf : 0x249a3a);
        if (moving && this.terrain.changed && !dying && !f.paused)
          this.dust.emit({ x: x + st.face * 0.7, y, z: ACTOR_Z + 0.5, count: 2, color: this.theme?.light ?? 0x9a6a3a, color2: this.theme?.dark ?? 0x4a2a10, speed: 2, life: 0.5, size: 0.3, gravity: 9, drag: 1 });
      }
    }
  }

  /**
   * Poses the room Warden: a giant crowned Nobbin, its eyes lit while it charges
   * and dimmed while it is stunned between hits. Its motion follows the ordinary
   * Nobbin, so it reads as the same creature grown large.
   * @param st render state for this monster slot
   * @param g the running sim
   * @param i monster slot index
   * @param x world x of the sprite
   * @param y world y of the sprite
   * @param dt seconds since the previous frame
   */
  private updateWarden(st: MonsterState, g: Game, i: number, x: number, y: number, dt: number): void {
    const m = g.monster.mondat[i];
    const w = st.warden;
    const charging = m.charging > 0;
    const stunned = m.stun > 0;
    const pop = entrance(st.age, 0.7) * this.castExit;
    st.phase += dt * (charging ? 20 : 7);
    const bounce = Math.sin(st.phase * 2) * 0.05;
    const scale = pop * 1.75;
    w.root.visible = true;
    w.root.position.set(x, y, ACTOR_Z);
    w.root.scale.set(scale * (1 + bounce * 0.5), scale * (1 - bounce * 0.5), scale);
    if (m.dir == 0) st.face = 1;
    else if (m.dir == 4) st.face = -1;
    w.root.rotation.y = damp(w.root.rotation.y, st.face > 0 ? 0.22 : -0.22, 8, dt);
    w.body.scale.set(1 + bounce, 1 - bounce, 1 + bounce);
    for (let k = 0; k < 2; k++) {
      const side = k == 0 ? -1 : 1;
      const step = Math.sin(st.phase + k * Math.PI);
      w.legs[k].rotation.z = side * 0.45 + step * 0.3;
      w.legs[k].position.y = -0.25 + Math.max(0, step) * 0.05;
    }
    // The eyes follow the digger, as every other monster's do.
    const lx = THREE.MathUtils.clamp((spriteCx(g.sprite.sprx[0]) - x) * 0.03, -0.06, 0.06);
    const ly = THREE.MathUtils.clamp((spriteCy(g.sprite.spry[0]) - y) * 0.03, -0.05, 0.05);
    for (const p of w.pupils) p.position.set(lx, ly, 0.21 * 0.78);
    for (const l of w.lids) l.rotation.x = -1.6 + (stunned ? 0.75 : 0) * 1.45;
    w.eyesMat.emissiveIntensity = charging ? 3.4 + Math.sin(st.phase * 3) * 1.2 : stunned ? 0.8 : 1.9;
    w.crown.rotation.y += (charging ? 4 : 0.6) * dt;
  }

  private updateBags(f: FrameInfo, dt: number): void {
    const g = f.game;
    for (let i = 0; i < 7; i++) {
      const st = this.bags[i];
      const slot = 1 + i;
      const on = g.sprite.sprenf[slot] && this.castOn(g, slot);
      const ch = g.sprite.sprch[slot];
      if (!on || ch < 62 || ch > 68) {
        st.bag.root.visible = st.gold.root.visible = false;
        st.wasCh = 0;
        st.age = 0;
        continue;
      }
      const [sx, sy] = this.spritePos(f, slot);
      const x = spriteCx(sx);
      const y = spriteCy(sy);
      const freed = Math.min(1, this.terrain.depthAt(sx + 8, sy + 9) / TUNNEL_DEPTH);
      const BAG_Z = BAG_Z_SOLID + (ACTOR_Z - BAG_Z_SOLID) * freed;
      if (ch >= 66) {
        st.bag.root.visible = false;
        st.gold.root.visible = true;
        st.gold.root.position.set(x, y, BAG_Z);
        const target = ch == 66 ? 0.35 : ch == 67 ? 0.7 : 1;
        if (st.wasCh < 66) {
          st.goldShown = 0.15;
          this.coins.toss(x, y, BAG_Z + 0.4, 6, y - 0.6, 0.7);
        }
        st.goldShown = damp(st.goldShown, target, 10, dt);
        const n = Math.round(st.gold.pieces.length * st.goldShown);
        st.gold.pieces.forEach((p, k) => (p.visible = k < n));
        if (Math.random() < dt * 3) {
          const p = st.gold.pieces[Math.floor(Math.random() * n)];
          if (p) this.twinkle(x + p.position.x, y + p.position.y, BAG_Z + p.position.z + 0.15);
        }
      } else {
        st.gold.root.visible = false;
        st.bag.root.visible = true;
        if (!f.paused) st.age += dt;
        const drop = 1 - Math.min(1, st.age / 0.4);
        st.bag.root.position.set(x, y + drop * drop * 2.5, BAG_Z);
        st.bag.root.scale.setScalar(entrance(st.age, 0.55) * this.castExit);
        const tilt = ch == 63 ? -0.2 : ch == 64 ? 0.2 : 0;
        st.tilt = damp(st.tilt, tilt, 30, dt);
        st.bag.pivot.rotation.z = st.tilt;
        const falling = ch == 65;
        st.bag.sack.scale.set(falling ? 0.94 : 1, falling ? 1.08 : 1, 1);
        st.bag.sack.rotation.z = falling ? Math.sin(f.time * 30) * 0.05 : 0;
      }
      st.wasCh = ch;
    }
  }

  private twinkle(x: number, y: number, z: number): void {
    const d = this.sparkleData;
    for (let i = 0; i < 64; i++)
      if (d[i * 4 + 3] <= 0) {
        d[i * 4] = x;
        d[i * 4 + 1] = y;
        d[i * 4 + 2] = z;
        d[i * 4 + 3] = 1;
        return;
      }
  }

  private updateEmeralds(f: FrameInfo, dt: number): void {
    const g = f.game;
    const show = new Uint8Array(151);
    if (g.scene == 'attract') {
      if (g.attractFrame >= 198 && this.castExit > 0.01) show[150] = 1;
    } else if (g.scene != 'initials') {
      const mask = g.digger.emmask;
      for (let i = 0; i < 150; i++) if (g.digger.emfield[i] & mask) show[i] = 1;
    }
    let k = 0;
    const t = f.time;
    for (let i = 0; i < 151; i++) {
      const was = this.emShown[i];
      const x = i == 150 ? spriteCx(184) : spriteCx((i % 15) * 20 + 12);
      const y = i == 150 ? wy(141 + 5) : wy(Math.floor(i / 15) * 18 + 21 + 5);
      if (was && !show[i] && g.scene != 'intro' && !f.paused) {
        // Collected or crushed: a burst of green shards and light.
        this.sparks.emit({ x, y, z: EMERALD_Z + 0.3, count: 26, color: 0x5dffb0, color2: 0xe8fff4, speed: 6, life: 0.6, size: 0.3, drag: 2.5 });
        this.sparks.emit({ x, y, z: EMERALD_Z + 0.3, count: 10, color: 0x1fd17a, speed: 3, life: 0.9, size: 0.18, gravity: 10, drag: 0.6 });
      }
      if (!was && show[i]) this.emAge[i] = -((i % 15) * 0.05 + Math.floor(i / 15) * 0.015);
      if (!f.paused) this.emAge[i] += dt;
      this.emShown[i] = show[i];
      if (!show[i]) continue;
      const ph = this.emPhase[i];
      this.q.setFromEuler(new THREE.Euler(0.1 * Math.sin(t * 0.7 + ph), Math.sin(t * 0.9 + ph) * 0.6, 0));
      this.v.set(x, y + Math.sin(t * 1.3 + ph) * 0.03, EMERALD_Z);
      this.m4.compose(this.v, this.q, new THREE.Vector3(1, 1, 1).multiplyScalar(entrance(this.emAge[i], 0.4) * (i == 150 ? this.castExit : 1)));
      this.emeralds.setMatrixAt(k++, this.m4);
      if (!f.paused && Math.random() < dt * 0.25) this.twinkle(x + (Math.random() - 0.5) * 0.6, y + 0.15, EMERALD_Z + 0.35);
    }
    this.emeralds.count = k;
    this.emeralds.instanceMatrix.needsUpdate = true;

    // Advance twinkles.
    const d = this.sparkleData;
    const pos = this.sparkles.geometry.attributes.position as THREE.BufferAttribute;
    const size = this.sparkles.geometry.attributes.size as THREE.BufferAttribute;
    for (let i = 0; i < 64; i++) {
      if (d[i * 4 + 3] > 0 && !f.paused) d[i * 4 + 3] -= dt * 1.8;
      const life = Math.max(0, d[i * 4 + 3]);
      pos.setXYZ(i, d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      size.setX(i, Math.sin(life * Math.PI) * 0.9);
    }
    pos.needsUpdate = size.needsUpdate = true;
  }

  private updateCherryAndFire(f: FrameInfo, dt: number): void {
    const g = f.game;
    const sp = g.sprite;
    // Bonus cherry
    if (sp.sprenf[14] && sp.sprch[14] == 81 && this.castOn(g, 14)) {
      const [sx, sy] = this.spritePos(f, 14);
      this.cherry.visible = true;
      if (!this.cherryWasOn) {
        this.cherryAge = 0;
        this.sparks.emit({ x: spriteCx(sx), y: spriteCy(sy), z: ACTOR_Z + 0.3, count: 30, color: 0xff6a80, color2: 0xffffff, speed: 4, life: 0.6, size: 0.3, drag: 3 });
      }
      this.cherryWasOn = true;
      if (!f.paused) this.cherryAge += dt;
      this.cherry.scale.setScalar(entrance(this.cherryAge, 0.6) * this.castExit);
      this.cherry.position.set(spriteCx(sx), spriteCy(sy) + Math.sin(f.time * 2.5) * 0.08, ACTOR_Z + 0.1);
      this.cherry.rotation.y = Math.sin(f.time * 1.4) * 0.5;
      this.cherryLight.position.set(this.cherry.position.x, this.cherry.position.y, 0.6);
      this.cherryLight.intensity = 6 + Math.sin(f.time * 5) * 2;
    } else {
      this.cherry.visible = false;
      this.cherryWasOn = false;
      this.cherryLight.intensity = 0;
    }
    // Fireball and explosion
    const on = sp.sprenf[15];
    const ch = sp.sprch[15];
    if (on && ch >= 82 && ch <= 87) {
      const [sx, sy] = this.spritePos(f, 15);
      const x = wx(sx + 4);
      const y = wy(sy + 4);
      this.fire.visible = true;
      this.fire.position.set(x, y, ACTOR_Z + 0.1);
      const exploding = ch >= 85;
      const k = exploding ? (ch - 84) / 3 : 0;
      this.fireCore.scale.setScalar(exploding ? 1 + k * 1.8 : 0.9 + Math.sin(f.time * 40) * 0.12);
      (this.fireCore.material as THREE.MeshBasicMaterial).color.setRGB(4, 2.4 - k, 1.1 - k * 0.8);
      this.fireGlow.scale.setScalar(exploding ? 2 + k * 3 : 1.7 + Math.sin(f.time * 33) * 0.2);
      this.fireLight.position.set(x, y, 0.4);
      this.fireLight.intensity = exploding ? 30 * (1 - k * 0.5) : 18;
      if (!exploding && !f.paused)
        this.sparks.emit({ x, y, z: ACTOR_Z + 0.1, count: 3, color: 0xffa040, color2: 0xff5010, speed: 0.8, life: 0.35, size: 0.4, drag: 4 });
    } else {
      this.fire.visible = false;
      this.fireLight.intensity = damp(this.fireLight.intensity, 0, 20, dt);
    }
  }

  /**
   * Title screen: the original loops its cast introduction every 250 frames, leaving
   * the old sprites in place in between. In 3D each character appears only from its
   * cue, pops in, and everyone bows out together before the loop restarts.
   */
  private castExit = 1;
  private castExitAt = -1;

  private static readonly CAST_ENTRY: Record<number, number> = { 8: 50, 9: 90, 0: 130, 1: 178, 14: 218 };

  private castOn(g: Game, slot: number): boolean {
    if (g.scene != 'attract') return true;
    const at = HdRenderer.CAST_ENTRY[slot];
    return at == undefined || (g.attractFrame >= at && this.castExit > 0.01);
  }

  private updateCast(f: FrameInfo): void {
    const g = f.game;
    if (g.scene != 'attract' || g.attractFrame < 236) {
      this.castExit = 1;
      this.castExitAt = -1;
      return;
    }
    if (this.castExitAt < 0) {
      this.castExitAt = f.time;
      // A puff where each character stood.
      for (const slot of [8, 9, 0, 1, 14]) {
        if (!g.sprite.sprenf[slot]) continue;
        this.dust.emit({ x: spriteCx(g.sprite.sprx[slot]), y: spriteCy(g.sprite.spry[slot]), z: ACTOR_Z + 0.3, count: 16, color: 0xe8d8c0, color2: 0x8a7060, speed: 2.5, life: 0.7, size: 0.7, drag: 3 });
      }
    }
    const t = (f.time - this.castExitAt) / 0.4;
    // Anticipate (a small swell), then shrink away.
    this.castExit = t < 0.25 ? 1 + t * 0.4 : Math.max(0, 1.1 * (1 - (t - 0.25) / 0.75));
  }

  private updateLabels(f: FrameInfo): void {
    const g = f.game;
    if (g.scene != 'attract') {
      if (this.labels.childElementCount) this.labels.innerHTML = '';
      return;
    }
    const fr = g.attractFrame;
    const cast: [string, number, number, number][] = [
      ['Nobbin', 83, 216, 64],
      ['Hobbin', 123, 216, 83],
      ['Digger', 163, 216, 102],
      ['Gold', 183, 216, 121],
      ['Emerald', 203, 216, 140],
      ['Bonus', 223, 216, 159],
    ];
    if (this.labels.childElementCount != cast.length)
      this.labels.innerHTML = cast.map(([n]) => `<div class="cast-label">${n}</div>`).join('');
    cast.forEach(([, at, x, y], i) => {
      const el = this.labels.children[i] as HTMLElement;
      const visible = fr >= at && this.castExit > 0.5;
      el.classList.toggle('show', visible);
      this.v.set(wx(x + 10), wy(y + 6), 0.2).project(this.camera);
      el.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * this.size.w}px, ${(-this.v.y * 0.5 + 0.5) * this.size.h}px) translateY(-50%)`;
    });
  }

  private updateCamera(f: FrameInfo, dt: number): void {
    const g = f.game;
    // Frame the scene in the part of the screen the docked title menu leaves free, sliding
    // over as the menu comes and goes.
    const snap = !this.dock || this.reducedMotion;
    const dock = (this.dock ??= { left: 0, bottom: 0 });
    dock.left = snap ? f.dock.left : damp(dock.left, f.dock.left, 7, dt);
    dock.bottom = snap ? f.dock.bottom : damp(dock.bottom, f.dock.bottom, 7, dt);
    const viewW = Math.max(1, this.size.w - dock.left);
    const viewH = Math.max(1, this.size.h - dock.bottom);
    const aspect = viewW / viewH;
    this.camera.aspect = aspect;
    if (dock.left > 0.5 || dock.bottom > 0.5) this.camera.setViewOffset(viewW, viewH, -dock.left, 0, this.size.w, this.size.h);
    else this.camera.clearViewOffset();
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    // Fit the playfield plus the grassy surface and a band of sky for the HUD.
    const halfW = (WIDTH * S) / 2 + 0.8;
    let top = wy(0) + 1.4;
    const bottom = wy(200) - 0.5;
    const fit = (t: number) => Math.max((t - bottom) / 2 / Math.tan(fov / 2), halfW / (Math.tan(fov / 2) * aspect));
    // The HUD needs ~70 px above the grass; on short landscape phones that is a lot of world.
    const worldPerPx = (2 * fit(top) * Math.tan(fov / 2)) / viewH;
    top += Math.max(0, 74 * worldPerPx - (wy(0) - wy(14) + 1.4));
    const dist = fit(top);
    // On tall screens the width sets the distance: keep the playfield at the top, where the
    // 1983 screen sits, and leave the spare height below it for the thumbs.
    const halfH = dist * Math.tan(fov / 2);
    const cy = Math.min((top + bottom) / 2, top - halfH + (20 * 2 * halfH) / viewH);
    // A gentler look: near-orthographic framing keeps the diorama readable as a
    // playfield instead of a wide-angle shot, and costs less to render than 2x DPR.
    // Straight on: the 1983 playfield is a flat side view, not a wide-angle shot.
    const tilt = 0;
    let tx = 0;
    let ty = cy;
    // Ease in toward the Digger while it dies, and a little for its victory dance.
    const won = g.scene == 'levdone';
    const focus = this.reducedMotion ? 0 : g.scene == 'dying' ? 1 : won ? 0.6 : 0;
    this.zoom = damp(this.zoom, focus, 2.2, dt);
    const zx = spriteCx(won ? g.digger.diggerx : g.sprite.sprx[0]);
    const zy = spriteCy(won ? g.digger.diggery : g.sprite.spry[0]);
    tx += (zx - tx) * this.zoom * 0.25;
    ty += (zy - ty) * this.zoom * 0.25;
    const d = dist * (1 - this.zoom * 0.18);
    // Fog stays behind the playfield however far back the camera sits (tall screens).
    const fog = this.scene.fog as THREE.Fog;
    fog.near = dist + 25;
    fog.far = dist + 110;
    this.camera.far = dist + 200;
    this.camera.updateProjectionMatrix();
    let ox = 0;
    let oy = 0;
    if (!this.reducedMotion) {
      ox = Math.sin(f.time * 0.21) * 0.02;
      oy = Math.sin(f.time * 0.17) * 0.015;
      if (this.shake > 0) {
        ox += (Math.random() - 0.5) * this.shake;
        oy += (Math.random() - 0.5) * this.shake;
        this.shake = damp(this.shake, 0, 7, dt);
        if (this.shake < 0.005) this.shake = 0;
      }
    }
    if (this.debugCamera) {
      const c = this.debugCamera;
      this.camera.position.set(c.x, c.y + Math.sin(tilt) * c.d, Math.cos(tilt) * c.d);
      this.camera.lookAt(c.x, c.y, -0.6);
      return;
    }
    this.camera.position.set(tx + ox, ty + Math.sin(tilt) * d + oy, Math.cos(tilt) * d);
    this.camera.lookAt(tx + ox * 0.5, ty, -0.6);
  }
}

/** A cave for the title screen "cast" line-up, entered by a shaft from the surface. */
function buildAttractMask(): Uint8Array {
  const m = new Uint8Array(WIDTH * 200);
  const inCave = (x: number, y: number) => {
    // Rounded chamber with a noisy rim.
    const cx = 244;
    const cy = 116;
    const rx = 74 + (vnoise(y * 0.08, 1, 4) - 0.5) * 10;
    const ry = 62 + (vnoise(x * 0.08, 2, 4) - 0.5) * 10;
    const dx = Math.abs(x - cx) / rx;
    const dy = Math.abs(y - cy) / ry;
    return Math.pow(dx, 4) + Math.pow(dy, 4) < 1;
  };
  for (let y = 14; y < 200; y++)
    for (let x = 0; x < WIDTH; x++) {
      const shaft = x >= 290 && x < 308 && y < 70;
      if (shaft || inCave(x, y)) m[y * WIDTH + x] = 1;
    }
  return m;
}
