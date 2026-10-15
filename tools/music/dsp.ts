// Sample-level DSP for the pre-rendered music tracks. Everything here runs offline
// in Node, so a voice may spend far more arithmetic than a live Web Audio graph
// would allow: band-limited oscillators, per-sample filter envelopes, a stereo
// room, a side-chained mix and a limited master bus.

export const SR = 44100;

export interface Bus {
  L: Float32Array;
  R: Float32Array;
}

export function bus(seconds: number, sr = SR): Bus {
  const n = Math.ceil(seconds * sr) + 8;
  return { L: new Float32Array(n), R: new Float32Array(n) };
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Deterministic noise, so a re-render is byte-comparable. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Equal-power pan gains for -1 (left) .. 1 (right). */
export function panGains(pan: number): [number, number] {
  const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/** PolyBLEP correction removes the alias a naive ramp or square would fold back. */
export function blep(phase: number, dt: number): number {
  if (dt <= 0) return 0;
  if (phase < dt) {
    const t = phase / dt;
    return t + t - t * t - 1;
  }
  if (phase > 1 - dt) {
    const t = (phase - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** Exponential decay from 1 toward 0 with time constant `tau` seconds. */
export const decay = (t: number, tau: number) => Math.exp(-t / tau);

/** Attack-decay envelope: linear attack, exponential decay/release at `off`. */
export function ad(t: number, attack: number, off: number, tau: number, release: number): number {
  if (t < 0) return 0;
  const a = attack > 0 ? Math.min(1, t / attack) : 1;
  if (t <= off) return a * Math.min(1, decay(t, tau) + 0.0006);
  const end = decay(off, tau);
  return a * end * decay(t - off, release);
}

export type BiquadKind = 'lp' | 'hp' | 'bp' | 'peak';

interface Coeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ biquad coefficients: one set, run per channel with its own state. */
export function biquad(kind: BiquadKind, f: number, q: number, sr = SR, gainDb = 0): Coeffs {
  const w = (2 * Math.PI * Math.max(10, Math.min(sr / 2 - 100, f))) / sr;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const alpha = sw / (2 * Math.max(0.05, q));
  let b0: number;
  let b1: number;
  let b2: number;
  let a0 = 1 + alpha;
  let a1 = -2 * cw;
  let a2 = 1 - alpha;
  if (kind == 'lp') {
    b0 = (1 - cw) / 2;
    b1 = 1 - cw;
    b2 = b0;
  } else if (kind == 'hp') {
    b0 = (1 + cw) / 2;
    b1 = -(1 + cw);
    b2 = b0;
  } else if (kind == 'bp') {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  } else {
    const A = Math.pow(10, gainDb / 40);
    b0 = 1 + alpha * A;
    b1 = -2 * cw;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cw;
    a2 = 1 - alpha / A;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Direct-form-I biquad state for one channel. */
export class Bq {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(private c: Coeffs) {}
  set(c: Coeffs): void {
    this.c = c;
  }
  run(x: number): number {
    const { b0, b1, b2, a1, a2 } = this.c;
    const y = b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Adds a sample pair into a bus, dropping anything past the end. */
export function add(b: Bus, i: number, l: number, r: number): void {
  if (i >= 0 && i < b.L.length) {
    b.L[i] += l;
    b.R[i] += r;
  }
}

/** Freeverb-style room: eight combs and four allpasses per channel. */
const COMB = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS = [556, 441, 341, 225];
const SPREAD = 23;

class Comb {
  private buf: Float32Array;
  private i = 0;
  private damp = 0;
  constructor(n: number) {
    this.buf = new Float32Array(n);
  }
  run(x: number, fb: number, d: number): number {
    const y = this.buf[this.i];
    this.damp = y * (1 - d) + this.damp * d;
    this.buf[this.i] = x + this.damp * fb;
    this.i = (this.i + 1) % this.buf.length;
    return y;
  }
}

class Ap {
  private buf: Float32Array;
  private i = 0;
  constructor(n: number) {
    this.buf = new Float32Array(n);
  }
  run(x: number, fb: number): number {
    const y = this.buf[this.i];
    this.buf[this.i] = x + y * fb;
    this.i = (this.i + 1) % this.buf.length;
    return y - x;
  }
}

/** Applies a stereo room to a send bus and returns the wet bus. */
export function reverb(send: Bus, seconds: number, size = 0.84, damp = 0.28, width = 1): Bus {
  const out = bus(seconds);
  const cl = COMB.map((n) => new Comb(Math.round(n * width)));
  const cr = COMB.map((n) => new Comb(Math.round((n + SPREAD) * width)));
  const al = ALLPASS.map((n) => new Ap(Math.round(n * width)));
  const ar = ALLPASS.map((n) => new Ap(Math.round((n + SPREAD) * width)));
  const n = Math.min(send.L.length, out.L.length);
  for (let i = 0; i < n; i++) {
    let l = 0;
    let r = 0;
    for (let k = 0; k < cl.length; k++) {
      l += cl[k].run(send.L[i], size, damp);
      r += cr[k].run(send.R[i], size, damp);
    }
    for (let k = 0; k < al.length; k++) {
      l = al[k].run(l, 0.5);
      r = ar[k].run(r, 0.5);
    }
    out.L[i] = l * 0.16;
    out.R[i] = r * 0.16;
  }
  return out;
}

/** A ping-pong delay with a damped feedback path, for lead throws. */
export function pingPong(send: Bus, seconds: number, timeSec: number, feedback = 0.42): Bus {
  const out = bus(seconds);
  const dl = new Float32Array(Math.round(timeSec * SR) + 1);
  const dr = new Float32Array(Math.round(timeSec * SR) + 1);
  const lp: Bq = new Bq(biquad('lp', 3800, 0.7));
  const lp2: Bq = new Bq(biquad('lp', 3800, 0.7));
  let ir = 0;
  let wl = 0;
  let wr = 0;
  const n = Math.min(send.L.length, out.L.length);
  for (let i = 0; i < n; i++) {
    const rl = dl[ir];
    const rr = dr[ir];
    const fl = lp.run(rl);
    const fr = lp2.run(rr);
    dl[ir] = send.L[i] + fr * feedback;
    dr[ir] = send.R[i] + fl * feedback;
    out.L[i] = rl;
    out.R[i] = rr;
    ir = (ir + 1) % dl.length;
    void wl;
    void wr;
  }
  return out;
}

/** Sums `src` into `dst`, scaled. */
export function mixInto(dst: Bus, src: Bus, gain: number): void {
  const n = Math.min(dst.L.length, src.L.length);
  for (let i = 0; i < n; i++) {
    dst.L[i] += src.L[i] * gain;
    dst.R[i] += src.R[i] * gain;
  }
}

/** Multiplies a bus in place, sample by sample. */
export function scale(b: Bus, gain: number): void {
  for (let i = 0; i < b.L.length; i++) {
    b.L[i] *= gain;
    b.R[i] *= gain;
  }
}

/** A gain curve per sample, used for the kick-triggered duck. */
export function duck(curve: Float32Array, at: number, depth: number, attack: number, release: number): void {
  const n = curve.length;
  const a = Math.max(1, Math.round(attack * SR));
  const start = Math.max(0, at);
  for (let i = start; i < Math.min(n, start + a); i++) {
    const f = (i - start) / a;
    curve[i] = Math.min(curve[i], 1 - depth * f);
  }
  for (let i = start + a; i < n; i++) {
    const g = 1 - depth * Math.exp(-(i - start - a) / (release * SR));
    if (g >= curve[i]) break;
    curve[i] = g;
  }
}

/** Soft saturation: linear near zero, compressive past it. */
export function softClip(b: Bus, drive: number, ceiling = 1): void {
  const k = Math.tanh(drive);
  for (let i = 0; i < b.L.length; i++) {
    b.L[i] = (Math.tanh(b.L[i] * drive) / k) * ceiling;
    b.R[i] = (Math.tanh(b.R[i] * drive) / k) * ceiling;
  }
}

/** Peak-limited to `-dropDb` below full scale, with a short release. */
export function limit(b: Bus, dropDb = 0.7): void {
  const target = Math.pow(10, -dropDb / 20);
  const rel = Math.exp(-1 / (0.06 * SR));
  let g = 1;
  for (let i = 0; i < b.L.length; i++) {
    const peak = Math.max(Math.abs(b.L[i]), Math.abs(b.R[i]));
    const want = peak * g > target ? target / peak : 1;
    g = want < g ? want : g + (1 - g) * (1 - rel);
    b.L[i] *= g;
    b.R[i] *= g;
  }
}

/** Scales so the loudest peak sits at `peakDb`, returning the applied gain. */
export function normalizePeak(b: Bus, peakDb: number): number {
  let peak = 0;
  for (let i = 0; i < b.L.length; i++) peak = Math.max(peak, Math.abs(b.L[i]), Math.abs(b.R[i]));
  const g = peak > 0 ? Math.pow(10, peakDb / 20) / peak : 1;
  scale(b, g);
  return g;
}

/** RMS in dBFS over a bus. */
export function rmsDb(b: Bus): number {
  let sum = 0;
  for (let i = 0; i < b.L.length; i++) sum += b.L[i] * b.L[i] + b.R[i] * b.R[i];
  const r = Math.sqrt(sum / (b.L.length * 2));
  return 20 * Math.log10(Math.max(1e-9, r));
}

/** Wraps the tail of a loop back over its head, so a repeat has no seam. */
export function wrapTail(b: Bus, loopSec: number, tailSec: number): void {
  const loop = Math.round(loopSec * SR);
  const tail = Math.round(tailSec * SR);
  for (let i = 0; i < tail; i++) {
    const from = loop + i;
    const to = i;
    if (from >= b.L.length) break;
    b.L[to] += b.L[from];
    b.R[to] += b.R[from];
  }
}

/** Renders stereo float samples to a 16-bit PCM WAV file. */
export function wavBytes(b: Bus, frames: number): Uint8Array {
  const n = Math.min(frames, b.L.length);
  const data = new Uint8Array(44 + n * 4);
  const view = new DataView(data.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + n * 4, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, SR, true);
  view.setUint32(28, SR * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, n * 4, true);
  let at = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, b.L[i]));
    const r = Math.max(-1, Math.min(1, b.R[i]));
    view.setInt16(at, Math.round(l * 32767), true);
    view.setInt16(at + 2, Math.round(r * 32767), true);
    at += 4;
  }
  return data;
}
