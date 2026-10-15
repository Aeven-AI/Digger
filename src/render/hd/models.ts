// Procedural 3D models, built from Three.js primitives in code. Each model keeps
// the silhouette and colour cues of its original CGA sprite.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { graveTexture, leatherTexture } from './textures';

export interface Materials {
  env: THREE.Texture | null;
}

const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
const phys = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o);

function shadow<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

// -----------------------------------------------------------------------------
// Digger

export interface DiggerModel {
  root: THREE.Group;
  /** Rotates to face the travel direction. */
  body: THREE.Group;
  /** The green front drill: slides in and out like the original's scoop frames. */
  drill: THREE.Object3D;
  /** Spins inside `drill`. */
  spinner: THREE.Object3D;
  wheels: THREE.Object3D[];
  /** The yellow hoop on top: raised tall when the weapon is ready, lowered while recharging. */
  hoop: THREE.Object3D;
  hoopMat: THREE.MeshStandardMaterial;
  beacon: THREE.Mesh;
  beaconMat: THREE.MeshStandardMaterial;
  lampMat: THREE.MeshStandardMaterial;
  /** Where the headlamp sits, in body space. */
  lampAnchor: THREE.Object3D;
  paint: THREE.MeshPhysicalMaterial;
}

export function makeDigger(m: Materials): DiggerModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = phys({ color: 0xd2321e, roughness: 0.32, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.2, envMap: m.env, envMapIntensity: 0.8 });
  const dark = std({ color: 0x1c1b1f, roughness: 0.85 });
  const steel = std({ color: 0xc8ccd2, roughness: 0.28, metalness: 1, envMap: m.env, envMapIntensity: 1.2 });
  const brass = std({ color: 0xe7b24a, roughness: 0.25, metalness: 1, envMap: m.env, envMapIntensity: 1.2 });
  const yellow = phys({ color: 0xf2b630, roughness: 0.4, metalness: 0.1, clearcoat: 0.6, envMap: m.env, envMapIntensity: 0.6 });

  // Chassis
  const chassis = new THREE.Mesh(new RoundedBoxGeometry(1.15, 0.5, 0.9, 3, 0.12), paint);
  chassis.position.set(-0.05, -0.05, 0);
  body.add(chassis);
  // Yellow hazard stripe along the side
  const stripe = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.1, 0.92, 2, 0.04), yellow);
  stripe.position.set(-0.05, -0.12, 0);
  body.add(stripe);

  // Cab with a glass canopy
  const cab = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.42, 0.74, 3, 0.12), paint);
  cab.position.set(-0.28, 0.36, 0);
  body.add(cab);
  const glass = phys({ color: 0x8fd3ff, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.85, clearcoat: 1, envMap: m.env, envMapIntensity: 1.5, emissive: 0x0b2a40 });
  const window = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.26, 0.78, 2, 0.06), glass);
  window.position.set(-0.18, 0.4, 0);
  body.add(window);

  // Headlamp on the cab
  const lampMat = std({ color: 0xfff1c0, emissive: 0xffd27a, emissiveIntensity: 1.4, roughness: 0.2 });
  const lampHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.12, 16), brass);
  lampHousing.rotation.z = Math.PI / 2;
  lampHousing.position.set(0.03, 0.42, 0.2);
  body.add(lampHousing);
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), lampMat);
  lamp.rotation.y = Math.PI / 2;
  lamp.position.set(0.1, 0.42, 0.2);
  body.add(lamp);
  const lampAnchor = new THREE.Object3D();
  lampAnchor.position.set(0.12, 0.42, 0.2);
  body.add(lampAnchor);

  // "Ready to fire" beacon
  const beaconMat = std({ color: 0x3cff9a, emissive: 0x3cff9a, emissiveIntensity: 2.5, roughness: 0.2 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), beaconMat);
  beacon.position.set(-0.52, 0.62, 0.2);
  body.add(beacon);
  const beaconBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.06, 12), steel);
  beaconBase.position.set(-0.52, 0.57, 0.2);
  body.add(beaconBase);

  // Exhaust stack
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.32, 10), steel);
  stack.position.set(-0.55, 0.32, -0.22);
  body.add(stack);

  // Treads with wheels
  const wheels: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const tread = new THREE.Mesh(new RoundedBoxGeometry(1.32, 0.36, 0.2, 3, 0.16), dark);
    tread.position.set(-0.02, -0.34, side * 0.42);
    body.add(tread);
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Group();
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 14), brass);
      hub.rotation.x = Math.PI / 2;
      w.add(hub);
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.06), dark);
      w.add(spoke);
      w.position.set(-0.45 + i * 0.43, -0.34, side * 0.53);
      body.add(w);
      wheels.push(w);
    }
  }

  // The front drill, painted green like the original's scoop, with a brass flute.
  const greenPaint = phys({ color: 0x3fbf3a, roughness: 0.3, metalness: 0.45, clearcoat: 0.8, envMap: m.env, envMapIntensity: 1 });
  const drill = new THREE.Group();
  const spinner = new THREE.Group();
  drill.add(spinner);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.62, 24, 1), greenPaint);
  cone.rotation.z = -Math.PI / 2;
  cone.position.x = 0.31;
  spinner.add(cone);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const r = 0.3 * (1 - t) + 0.015;
    const a = t * Math.PI * 7;
    pts.push(new THREE.Vector3(t * 0.6, Math.cos(a) * r, Math.sin(a) * r));
  }
  const flute = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.028, 6), brass);
  spinner.add(flute);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.1, 24), greenPaint);
  collar.rotation.z = Math.PI / 2;
  spinner.add(collar);
  // Piston the drill slides on.
  const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 12), steel);
  piston.rotation.z = Math.PI / 2;
  piston.position.x = -0.2;
  drill.add(piston);
  drill.position.set(0.52, -0.05, 0);
  body.add(drill);

  // The "ready" hoop: a big yellow arch on the cab roof, as on the CGA sprite.
  const hoopMat = std({ color: 0xffc83a, emissive: 0xffb020, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.3, envMap: m.env });
  const hoop = new THREE.Group();
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 10, 28, Math.PI), hoopMat);
  arch.position.y = 0.16;
  hoop.add(arch);
  for (const sx of [-0.17, 0.17]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10), hoopMat);
    post.position.set(sx, 0.08, 0);
    hoop.add(post);
  }
  hoop.position.set(-0.28, 0.55, 0);
  body.add(hoop);

  shadow(root);
  return { root, body, drill, spinner, wheels, hoop, hoopMat, beacon, beaconMat, lampMat, lampAnchor, paint };
}

// -----------------------------------------------------------------------------
// Nobbin / Hobbin
//
// From the CGA sprites: a Nobbin is a green body with two big yellow eyes on
// top and red legs planted wide. A Hobbin is seen side-on: a spiky green body,
// one yellow eye and big red jaws gaping in the direction it travels.

function monsterMats(m: Materials) {
  return {
    green: phys({ color: 0x2fae36, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2, sheen: 0.25, sheenColor: new THREE.Color(0x3a8a30), emissive: 0x041a04, envMap: m.env, envMapIntensity: 0.35 }),
    yellow: phys({ color: 0xffd23a, roughness: 0.2, clearcoat: 1, emissive: 0x2a1c00, envMap: m.env, envMapIntensity: 0.5 }),
    black: std({ color: 0x0a0a0c, roughness: 0.25 }),
    red: phys({ color: 0xd8321e, roughness: 0.35, clearcoat: 0.6, envMap: m.env, envMapIntensity: 0.4 }),
    lid: phys({ color: 0x228a2c, roughness: 0.35, clearcoat: 0.8 }),
    tooth: std({ color: 0xfff8e8, roughness: 0.4 }),
    mouth: std({ color: 0x3a0608, roughness: 0.7 }),
  };
}

type MonsterMats = ReturnType<typeof monsterMats>;

function eye(mat: MonsterMats, r: number): { g: THREE.Group; pupil: THREE.Mesh; lid: THREE.Mesh } {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), mat.yellow));
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.42, 16, 12), mat.black);
  pupil.position.z = r * 0.78;
  g.add(pupil);
  const lid = new THREE.Mesh(new THREE.SphereGeometry(r * 1.06, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat.lid);
  lid.rotation.x = -1.6;
  g.add(lid);
  return { g, pupil, lid };
}

function leg(mat: MonsterMats, len: number, splay: number): THREE.Group {
  const g = new THREE.Group();
  const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, len, 6, 10), mat.red);
  shin.position.y = -len / 2;
  g.add(shin);
  const foot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), mat.red);
  foot.scale.set(1.5, 0.55, 1.1);
  foot.position.set(splay * 0.08, -len - 0.06, 0.05);
  g.add(foot);
  g.rotation.z = splay * 0.45;
  return g;
}

export interface NobbinModel {
  root: THREE.Group;
  body: THREE.Mesh;
  bodyMat: THREE.MeshPhysicalMaterial;
  eyes: THREE.Group[];
  pupils: THREE.Mesh[];
  lids: THREE.Mesh[];
  legs: THREE.Group[];
}

export function makeNobbin(m: Materials): NobbinModel {
  const mat = monsterMats(m);
  const root = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.42, 36, 24);
  geo.scale(1.15, 0.85, 0.95);
  const body = new THREE.Mesh(geo, mat.green);
  body.position.y = -0.02;
  root.add(body);
  const eyes: THREE.Group[] = [];
  const pupils: THREE.Mesh[] = [];
  const lids: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const e = eye(mat, 0.21);
    e.g.position.set(side * 0.24, 0.36, 0.12);
    root.add(e.g);
    eyes.push(e.g);
    pupils.push(e.pupil);
    lids.push(e.lid);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 16, Math.PI), mat.mouth);
  mouth.rotation.z = Math.PI;
  mouth.position.set(0, -0.06, 0.4);
  root.add(mouth);
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const l = leg(mat, 0.26, side);
    l.position.set(side * 0.3, -0.25, 0);
    root.add(l);
    legs.push(l);
  }
  shadow(root);
  return { root, body, bodyMat: mat.green, eyes, pupils, lids, legs };
}

export interface HobbinModel {
  root: THREE.Group;
  /** Turns to face the travel direction (built facing +x). */
  facing: THREE.Group;
  body: THREE.Mesh;
  bodyMat: THREE.MeshPhysicalMaterial;
  upperJaw: THREE.Group;
  lowerJaw: THREE.Group;
  pupils: THREE.Mesh[];
  legs: THREE.Group[];
}

export function makeHobbin(m: Materials): HobbinModel {
  const mat = monsterMats(m);
  const root = new THREE.Group();
  const facing = new THREE.Group();
  root.add(facing);
  const geo = new THREE.SphereGeometry(0.42, 36, 24);
  geo.scale(1.05, 0.95, 0.9);
  const body = new THREE.Mesh(geo, mat.green);
  body.position.set(-0.12, 0.05, 0);
  facing.add(body);
  // Back spikes, like the jagged outline of the sprite.
  for (let k = 0; k < 5; k++) {
    const a = 0.5 + k * 0.42;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 8), mat.green);
    spike.position.set(-0.12 + Math.cos(a) * 0.44, 0.05 + Math.sin(a) * 0.4, 0);
    spike.rotation.z = a - Math.PI / 2;
    facing.add(spike);
  }
  // One big yellow eye, visible from both sides.
  const pupils: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const e = eye(mat, 0.17);
    e.g.position.set(0.08, 0.24, side * 0.3);
    e.g.rotation.y = side * 0.5;
    e.lid.visible = false;
    facing.add(e.g);
    pupils.push(e.pupil);
  }
  // Red jaws gaping forward, lined with teeth.
  const jaw = (upper: boolean) => {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 12, 0, Math.PI * 2, upper ? 0 : Math.PI / 2, Math.PI / 2), mat.red);
    shell.scale.set(1.35, 0.55, 0.85);
    shell.position.x = 0.24;
    g.add(shell);
    const inside = new THREE.Mesh(new THREE.CircleGeometry(0.29, 20), mat.mouth);
    inside.rotation.x = upper ? Math.PI / 2 : -Math.PI / 2;
    inside.scale.set(1.3, 0.82, 1);
    inside.position.set(0.24, upper ? 0.002 : -0.002, 0);
    g.add(inside);
    for (let k = 0; k < 4; k++) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 6), mat.tooth);
      t.position.set(0.12 + k * 0.1, upper ? -0.04 : 0.04, 0.16 - k * 0.02);
      if (upper) t.rotation.x = Math.PI;
      g.add(t);
      const t2 = t.clone();
      t2.position.z = -t.position.z;
      g.add(t2);
    }
    g.position.set(0.12, -0.02, 0);
    return g;
  };
  const upperJaw = jaw(true);
  const lowerJaw = jaw(false);
  facing.add(upperJaw, lowerJaw);
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const l = leg(mat, 0.22, 0);
    l.position.set(-0.1, -0.3, side * 0.16);
    facing.add(l);
    legs.push(l);
  }
  shadow(root);
  return { root, facing, body, bodyMat: mat.green, upperJaw, lowerJaw, pupils, legs };
}

// -----------------------------------------------------------------------------
// The Warden (every fifth room's end boss)

export interface WardenModel {
  root: THREE.Group;
  body: THREE.Mesh;
  bodyMat: THREE.MeshPhysicalMaterial;
  eyes: THREE.Group[];
  pupils: THREE.Mesh[];
  lids: THREE.Mesh[];
  legs: THREE.Group[];
  /** Gold spikes on its head; spins slowly, and whips around while charging. */
  crown: THREE.Group;
  /** Its own eye material, lit up on a hit and while charging. */
  eyesMat: THREE.MeshStandardMaterial;
}

/**
 * A giant crowned Nobbin. Deliberately the same silhouette the player already
 * reads as a monster, in its own colours, so the end boss still looks like this
 * game rather than a new creature. Each call gets its own materials, so tinting
 * the Warden leaves the ordinary Nobbins alone.
 * @param m shared materials (environment map)
 */
export function makeWarden(m: Materials): WardenModel {
  const nob = makeNobbin(m);
  nob.bodyMat.color.set(0x6e2bd6);
  nob.bodyMat.sheenColor.set(0x8a5cff);
  nob.bodyMat.emissive.set(0x1a0630);
  const eyesMat = std({ color: 0xffe0b0, emissive: new THREE.Color(0xff6a1a), emissiveIntensity: 1.8, roughness: 0.4 });
  for (const e of nob.eyes) {
    (e.children[0] as THREE.Mesh).material = eyesMat;
    e.scale.setScalar(1.15);
  }
  const gold = std({ color: 0xf1b94a, roughness: 0.28, metalness: 0.65, envMap: m.env, envMapIntensity: 0.8 });
  const crown = new THREE.Group();
  for (let k = 0; k < 5; k++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.3, 8), gold);
    spike.position.set((k - 2) * 0.15, 0.52 - Math.abs(k - 2) * 0.02, 0.06);
    spike.rotation.z = (k - 2) * -0.22;
    crown.add(spike);
  }
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 24), gold);
  band.rotation.x = Math.PI / 2;
  band.scale.set(1, 0.8, 1);
  band.position.set(0, 0.44, 0.06);
  crown.add(band);
  crown.position.y = 0.06;
  shadow(crown);
  nob.root.add(crown);
  return { ...nob, crown, eyesMat };
}

// -----------------------------------------------------------------------------
// Gold bag and gold

export interface BagModel {
  root: THREE.Group;
  /** Pivot at the base for wobbling. */
  pivot: THREE.Group;
  sack: THREE.Group;
}

let leather: THREE.CanvasTexture | null = null;

export function makeBag(m: Materials): BagModel {
  leather ??= leatherTexture();
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.y = -0.62;
  root.add(pivot);
  const sack = new THREE.Group();
  sack.position.y = 0.62;
  pivot.add(sack);
  const mat = std({ map: leather, color: 0xd8b088, roughness: 0.82, metalness: 0, envMap: m.env, envMapIntensity: 0.2 });
  const profile: THREE.Vector2[] = [];
  const pts: [number, number][] = [
    [0.0, -0.62],
    [0.4, -0.6],
    [0.62, -0.46],
    [0.7, -0.22],
    [0.64, 0.04],
    [0.46, 0.24],
    [0.24, 0.34],
    [0.15, 0.4],
    [0.22, 0.5],
    [0.34, 0.6],
    [0.28, 0.66],
    [0.12, 0.62],
    [0.0, 0.6],
  ];
  for (const [x, y] of pts) profile.push(new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(new THREE.SplineCurve(profile).getPoints(40), 40);
  // Add lumpy irregularity so it reads as a soft sack.
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + Math.sin(a * 5 + y * 3) * 0.035 * (y < 0.3 ? 1 : 0.3);
    p.setX(i, x * k);
    p.setZ(i, z * k * 0.85);
  }
  g.computeVertexNormals();
  const body = new THREE.Mesh(g, mat);
  body.rotation.y = -Math.PI / 2; // put the "$" (u = 0.25) on the front
  sack.add(body);
  const rope = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 8, 24), std({ color: 0xd9b26a, roughness: 0.9 }));
  rope.rotation.x = Math.PI / 2;
  rope.position.y = 0.44;
  sack.add(rope);
  shadow(root);
  return { root, pivot, sack };
}

export interface GoldModel {
  root: THREE.Group;
  pieces: THREE.Object3D[];
}

export function goldMaterial(m: Materials): THREE.MeshStandardMaterial {
  return std({ color: 0xffc13b, roughness: 0.22, metalness: 1, envMap: m.env, envMapIntensity: 1.6, emissive: 0x3a2200 });
}

/** A heap of coins and nuggets; `pieces` are revealed progressively as the bag bursts. */
export function makeGold(m: Materials): GoldModel {
  const root = new THREE.Group();
  const mat = goldMaterial(m);
  const coin = new THREE.CylinderGeometry(0.16, 0.16, 0.045, 20);
  const nugget = new THREE.DodecahedronGeometry(0.13, 0);
  const pieces: THREE.Object3D[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 34; i++) {
    const isCoin = i % 3 != 0;
    const mesh = new THREE.Mesh(isCoin ? coin : nugget, mat);
    const r = Math.sqrt(rnd()) * 0.62;
    const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.6;
    const y = -0.6 + (0.62 - r) * 0.55 + rnd() * 0.08;
    mesh.position.set(x, y, z);
    mesh.rotation.set(rnd() * 1.2 - 0.6 + (isCoin ? Math.PI / 2 : 0), rnd() * 6, rnd() * 1.2 - 0.6);
    if (!isCoin) mesh.scale.setScalar(0.7 + rnd() * 0.6);
    root.add(mesh);
    pieces.push(mesh);
  }
  // Highest pieces last, so the heap grows upward.
  pieces.sort((a, b) => a.position.y - b.position.y);
  shadow(root);
  return { root, pieces };
}

// -----------------------------------------------------------------------------
// Emerald

export function emeraldGeometry(): THREE.BufferGeometry {
  // A step-cut gem: an octagonal crown and pavilion, flat-shaded for crisp facets.
  const profile = [
    new THREE.Vector2(0.0, -0.42),
    new THREE.Vector2(0.3, -0.1),
    new THREE.Vector2(0.42, 0.04),
    new THREE.Vector2(0.4, 0.14),
    new THREE.Vector2(0.24, 0.27),
    new THREE.Vector2(0.0, 0.27),
  ];
  const g = new THREE.LatheGeometry(profile, 8);
  g.scale(1.55, 1.15, 0.8);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

export function emeraldMaterial(m: Materials): THREE.MeshPhysicalMaterial {
  return phys({
    color: 0x0c9a48,
    roughness: 0.12,
    metalness: 0.0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
    flatShading: true,
    emissive: 0x03552a,
    emissiveIntensity: 0.6,
    envMap: m.env,
    envMapIntensity: 0.75,
    specularIntensity: 0.7,
    specularColor: new THREE.Color(0x9affc8),
  });
}

// -----------------------------------------------------------------------------
// Bonus cherry

export function makeCherry(m: Materials): THREE.Group {
  const root = new THREE.Group();
  const red = phys({ color: 0xe0182e, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0x3a0008, envMap: m.env, envMapIntensity: 1.2 });
  const stemMat = std({ color: 0x5b7a25, roughness: 0.6 });
  const tops: THREE.Vector3[] = [];
  for (const [x, y, r] of [
    [-0.26, -0.22, 0.27],
    [0.24, -0.3, 0.25],
  ]) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), red);
    c.position.set(x, y, 0.05);
    c.scale.set(1, 0.93, 1);
    root.add(c);
    tops.push(new THREE.Vector3(x, y + r * 0.9, 0.05));
  }
  const knot = new THREE.Vector3(0.05, 0.45, 0);
  for (const t of tops) {
    const mid = t.clone().lerp(knot, 0.5).add(new THREE.Vector3(t.x * 0.3, 0.05, 0));
    const curve = new THREE.QuadraticBezierCurve3(t, mid, knot);
    root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.025, 6), stemMat));
  }
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.16, 0.12, 0.34, 0);
  leafShape.quadraticCurveTo(0.16, -0.08, 0, 0);
  const leaf = new THREE.Mesh(new THREE.ShapeGeometry(leafShape, 8), std({ color: 0x4f9a2a, roughness: 0.5, side: THREE.DoubleSide }));
  leaf.position.copy(knot);
  leaf.rotation.set(0.3, 0.2, 0.5);
  root.add(leaf);
  shadow(root);
  return root;
}

// -----------------------------------------------------------------------------
// Gravestone

export function makeGrave(): THREE.Group {
  const root = new THREE.Group();
  const tex = graveTexture();
  const stone = std({ color: 0xbfc0c6, roughness: 0.9 });
  const face = std({ map: tex, roughness: 0.85 });
  const shape = new THREE.Shape();
  shape.moveTo(-0.45, -0.6);
  shape.lineTo(-0.45, 0.2);
  shape.absarc(0, 0.2, 0.45, Math.PI, 0, true);
  shape.lineTo(0.45, -0.6);
  shape.lineTo(-0.45, -0.6);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.24, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
  g.translate(0, 0, -0.12);
  // Planar UVs on the front for the "RIP" engraving.
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 0.5) / 1.0, (p.getY(i) + 0.6) / 1.3);
  const mesh = new THREE.Mesh(g, [face, stone]);
  root.add(mesh);
  const mound = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: 0x4a3020, roughness: 1 }));
  mound.scale.set(1.2, 0.3, 0.7);
  mound.position.y = -0.62;
  root.add(mound);
  shadow(root);
  return root;
}
