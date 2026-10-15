// The voices of the pre-rendered 2027 track. Each one writes samples straight into
// a bus, so there is no node graph and no realtime budget: filters, oscillator
// stacks and transient shaping can all be as heavy as they need to be.

import { Bq, blep, biquad, decay, mtof, panGains, rng, SR, type Bus, add } from './dsp';

export interface Params {
  /** Note length in samples (drums ignore it). */
  dur: number;
  vel: number;
  midi: number;
  pan: number;
}

export type Voice = (dst: Bus, i0: number, p: Params) => void;

const rand = rng(0x5eed);
const noise = () => rand() * 2 - 1;

/** Band-limited saw: a naive ramp plus the PolyBLEP correction at each wrap. */
function saw(phase: number, dt: number): number {
  return 2 * phase - 1 - blep(phase, dt);
}

/** Band-limited square. */
function square(phase: number, dt: number): number {
  const s = phase < 0.5 ? 1 : -1;
  return s + blep(phase, dt) - blep((phase + 0.5) % 1, dt);
}

/** Advances a phase and keeps it inside [0, 1). */
function step(phase: number, dt: number): number {
  const p = phase + dt;
  return p >= 1 ? p - Math.floor(p) : p;
}

// --- Drums --------------------------------------------------------------------

/** Club kick: a fast pitch drop, a saturated body and a click on top. */
export const kick: Voice = (dst, i0, p) => {
  const n = Math.round(0.55 * SR);
  let phase = 0;
  const clickHp = new Bq(biquad('hp', 1400, 0.7));
  const clickLp = new Bq(biquad('lp', 7000, 0.7));
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    phase = step(phase, (47 + 135 * decay(t, 0.03)) / SR);
    const body = Math.sin(2 * Math.PI * phase) * Math.min(1, t / 0.0015) * decay(t, 0.2);
    const click = clickLp.run(clickHp.run(noise() * decay(t, 0.0035))) * 0.32;
    const y = Math.tanh((body + click) * p.vel * 2.1) / Math.tanh(2.1);
    add(dst, i0 + i, y, y);
  }
};

/** Snare: a two-tone drum head under a band of noise. */
export const snare: Voice = (dst, i0, p) => {
  const n = Math.round(0.4 * SR);
  const bp = new Bq(biquad('bp', 1900, 0.9));
  const hp = new Bq(biquad('hp', 500, 0.7));
  let ph1 = 0;
  let ph2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph1 = step(ph1, 186 / SR);
    ph2 = step(ph2, 331 / SR);
    const head = (Math.sin(2 * Math.PI * ph1) * 0.62 + Math.sin(2 * Math.PI * ph2) * 0.38) * decay(t, 0.055);
    const air = bp.run(hp.run(noise())) * Math.min(1, t / 0.001) * decay(t, 0.1);
    const y = Math.tanh((head * 0.55 + air * 1.5) * p.vel * 1.5) / Math.tanh(1.5);
    add(dst, i0 + i, y, y);
  }
};

/** Clap: three quick slaps plus the room tail behind them. */
export const clap: Voice = (dst, i0, p) => {
  const n = Math.round(0.4 * SR);
  const bp = new Bq(biquad('bp', 1250, 1.1));
  const hp = new Bq(biquad('hp', 800, 0.7));
  const [gl, gr] = panGains(p.pan);
  const at = [0, 0.009, 0.019, 0.029];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env = 0;
    for (let k = 0; k < at.length; k++) {
      const d = t - at[k];
      if (d < 0) continue;
      env += decay(d, k == at.length - 1 ? 0.14 : 0.01) * (k == at.length - 1 ? 0.55 : 1);
    }
    const x = bp.run(hp.run(noise())) * env * p.vel * 0.9;
    add(dst, i0 + i, x * gl, x * gr);
  }
};

/** Closed and open hats: filtered noise with a touch of metal above it. */
export function hatVoice(open: boolean): Voice {
  return (dst, i0, p) => {
    const tau = open ? 0.16 : 0.028;
    const n = Math.round((open ? 0.6 : 0.16) * SR);
    const hp = new Bq(biquad('hp', 8200, 0.7));
    const bp = new Bq(biquad('bp', 11500, 1.4));
    const [gl, gr] = panGains(p.pan);
    const jitter = 0.94 + rand() * 0.12;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.0006) * decay(t * jitter, tau);
      const x = (hp.run(noise()) * 0.85 + bp.run(noise()) * 0.5) * env * p.vel * 1.5;
      add(dst, i0 + i, x * gl, x * gr);
    }
  };
}

export const hat = hatVoice(false);
export const openHat = hatVoice(true);

/** Ride: a ping over a wash of cymbal noise. */
export const ride: Voice = (dst, i0, p) => {
  const n = Math.round(0.7 * SR);
  const hp = new Bq(biquad('hp', 5200, 0.7));
  const bp = new Bq(biquad('bp', 7000, 1.2));
  const [gl, gr] = panGains(p.pan);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph = step(ph, 2650 / SR);
    const ping = Math.sin(2 * Math.PI * ph) * decay(t, 0.25) * 0.25;
    const wash = (hp.run(noise()) * 0.7 + bp.run(noise()) * 0.5) * decay(t, 0.32);
    const x = (wash + ping) * p.vel * 0.7;
    add(dst, i0 + i, x * gl, x * gr);
  }
};

/** Swish: a band of noise sweeping up and away. */
export const swish: Voice = (dst, i0, p) => {
  const n = Math.round(0.3 * SR);
  const [gl, gr] = panGains(p.pan);
  const bp = new Bq(biquad('bp', 400, 1.6));
  const hp = new Bq(biquad('hp', 900, 0.7));
  for (let i = 0; i < n; i++) {
    const f = i / n;
    bp.set(biquad('bp', 400 * Math.pow(22, f), 1.6));
    const env = Math.sin(Math.PI * f) * 0.9;
    const x = hp.run(bp.run(noise())) * env * p.vel * 1.1;
    add(dst, i0 + i, x * gl, x * gr);
  }
};

/** Riser: noise and a detuned stack opening up over `dur`, ending where the drop lands. */
export const swell: Voice = (dst, i0, p) => {
  const n = Math.max(1, p.dur);
  const [gl, gr] = panGains(p.pan);
  const lp1 = new Bq(biquad('lp', 300, 0.8));
  const lp2 = new Bq(biquad('lp', 400, 0.8));
  let ph1 = 0;
  let ph2 = 0;
  let ph3 = 0;
  for (let i = 0; i < n; i++) {
    const f = i / n;
    lp1.set(biquad('lp', 240 * Math.pow(26, f), 0.9));
    lp2.set(biquad('lp', 1200 * Math.pow(9, f), 0.7));
    ph1 = step(ph1, (mtof(38) * (1 + f * 0.5)) / SR);
    ph2 = step(ph2, (mtof(50) * (1 + f * 0.5) * 1.007) / SR);
    ph3 = step(ph3, (mtof(45) * (1 + f * 0.5) * 0.993) / SR);
    const stack = (saw(ph1, 0.02) + saw(ph2, 0.02) + saw(ph3, 0.02)) * 0.3;
    const air = lp2.run(lp1.run(noise())) * 0.5;
    const x = (stack + air) * Math.pow(f, 1.6) * p.vel * 0.7;
    add(dst, i0 + i, x * gl, x * gr);
  }
};

// --- Tuned instruments --------------------------------------------------------

/** Supersaw lead: five detuned saws over a square sub, a filter envelope and vibrato. */
export const lead: Voice = (dst, i0, p) => {
  const f = mtof(p.midi);
  const n = Math.round(p.dur + 0.35 * SR);
  /** Detune in semitones (about 14 cents either way) and the side each voice leans to. */
  const det = [-0.14, -0.07, 0, 0.07, 0.14];
  const lean = [0.6, 0.25, 0, -0.25, -0.6];
  const phases = det.map(() => rand());
  let subPh = rand();
  const lpL = new Bq(biquad('lp', 6000, 1.1));
  const lpR = new Bq(biquad('lp', 6000, 1.1));
  const hpL = new Bq(biquad('hp', 170, 0.7));
  const hpR = new Bq(biquad('hp', 170, 0.7));
  const off = p.dur / SR;
  const [gl, gr] = panGains(p.pan);
  const drive = 1.6;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const vib = Math.sin(2 * Math.PI * 5.4 * t) * 0.006 * Math.min(1, Math.max(0, (t - 0.12) / 0.25));
    lpL.set(biquad('lp', 900 + 5200 * decay(t, 0.22), 1.1));
    lpR.set(biquad('lp', 900 + 5200 * decay(t, 0.22), 1.1));
    let l = 0;
    let r = 0;
    for (let k = 0; k < det.length; k++) {
      const hz = f * Math.pow(2, det[k] + vib);
      const dt = hz / SR;
      phases[k] = step(phases[k], dt);
      const v = saw(phases[k], dt);
      l += v * (0.5 + lean[k] * 0.5);
      r += v * (0.5 - lean[k] * 0.5);
    }
    subPh = step(subPh, f / 2 / SR);
    const sub = square(subPh, f / 2 / SR) * 0.42;
    const vl = hpL.run(lpL.run(l / 3 + sub));
    const vr = hpR.run(lpR.run(r / 3 + sub));
    const a = Math.min(1, t / 0.006) * (0.72 * decay(t, 0.55) + 0.28) * (t > off ? decay(t - off, 0.07) : 1);
    const e = a * p.vel * 1.15;
    add(dst, i0 + i, (Math.tanh(vl * drive) / Math.tanh(drive)) * e * gl, (Math.tanh(vr * drive) / Math.tanh(drive)) * e * gr);
  }
};

/** Riff bass: a saw and a sub sine under a snappy filter envelope. */
export const synthbass: Voice = (dst, i0, p) => {
  const f = mtof(p.midi);
  const n = Math.round(p.dur + 0.2 * SR);
  const lp = new Bq(biquad('lp', 2400, 2.4));
  const hp = new Bq(biquad('hp', 42, 0.7));
  let ph = rand();
  let sub = rand();
  const off = p.dur / SR;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    lp.set(biquad('lp', 340 + 2100 * decay(t, 0.1), 2.4));
    ph = step(ph, f / SR);
    sub = step(sub, f / 2 / SR);
    const x = lp.run(hp.run(saw(ph, f / SR) * 0.75 + Math.sin(2 * Math.PI * sub) * 0.55));
    const a = Math.min(1, t / 0.004) * (0.42 * decay(t, 0.13) + 0.58) * (t > off ? decay(t - off, 0.045) : 1);
    const y = Math.tanh(x * 2.4) / Math.tanh(2.4);
    add(dst, i0 + i, y * a * p.vel, y * a * p.vel);
  }
};

/** Electric piano: a carrier with a fast-decaying modulator and a bell partial on top. */
export const rhodes: Voice = (dst, i0, p) => {
  const f = mtof(p.midi);
  const n = Math.round(p.dur + 0.7 * SR);
  const [gl, gr] = panGains(p.pan);
  let c = rand();
  let m = rand();
  let c2 = rand();
  let m2 = rand();
  const off = p.dur / SR;
  const tau = 0.9 + 30 / f;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const idx = f * (1.4 + p.vel * 2.6) * decay(t, 0.22);
    const idx2 = f * 3.2 * decay(t, 0.045);
    c = step(c, f / SR);
    m = step(m, f / SR);
    c2 = step(c2, (f * 1.004) / SR);
    m2 = step(m2, (f * 2) / SR);
    const v1 = Math.sin(2 * Math.PI * c + Math.sin(2 * Math.PI * m) * idx);
    const v2 = Math.sin(2 * Math.PI * c2 + Math.sin(2 * Math.PI * m2) * idx2) * 0.22;
    const a = Math.min(1, t / 0.004) * decay(t, tau) * (t > off ? decay(t - off, 0.11) : 1);
    const x = (v1 * 0.8 + v2) * a * p.vel * 0.42;
    add(dst, i0 + i, x * gl, x * gr);
  }
};

/** Vibraphone: a bell-like four-to-one FM pair with a mallet hit. */
export const vibes: Voice = (dst, i0, p) => {
  const f = mtof(p.midi);
  const n = Math.round(p.dur + 1.1 * SR);
  const [gl, gr] = panGains(p.pan);
  let c = rand();
  let m = rand();
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const idx = f * 2.4 * decay(t, 0.5);
    c = step(c, f / SR);
    m = step(m, (f * 4) / SR);
    const body = Math.sin(2 * Math.PI * c + Math.sin(2 * Math.PI * m) * idx) * Math.min(1, t / 0.002) * decay(t, 0.55);
    const mallet = noise() * decay(t, 0.0035) * 0.25;
    const x = (body + mallet) * p.vel * 0.36;
    add(dst, i0 + i, x * gl, x * gr);
  }
};

/** Pad: three slow saws under a lowpass, widened with a chorus. */
export const pad: Voice = (dst, i0, p) => {
  const f = mtof(p.midi);
  const n = Math.round(p.dur + 0.9 * SR);
  const det = [-0.11, 0, 0.11];
  const phases = det.map(() => rand());
  const lpL = new Bq(biquad('lp', 2100, 0.8));
  const lpR = new Bq(biquad('lp', 2100, 0.8));
  const off = p.dur / SR;
  const dl = new Float32Array(Math.round(0.03 * SR));
  const dr = new Float32Array(Math.round(0.03 * SR));
  let wi = 0;
  const [gl, gr] = panGains(p.pan);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let l = 0;
    let r = 0;
    for (let k = 0; k < det.length; k++) {
      const hz = f * Math.pow(2, det[k] / 12);
      phases[k] = step(phases[k], hz / SR);
      const v = saw(phases[k], hz / SR) * 0.34;
      l += v * (0.5 + det[k] * 2);
      r += v * (0.5 - det[k] * 2);
    }
    l = lpL.run(l);
    r = lpR.run(r);
    const my = Math.round((0.012 + 0.006 * Math.sin(2 * Math.PI * 0.31 * t)) * SR);
    const j = (wi - my + dl.length) % dl.length;
    dl[wi] = l;
    dr[wi] = r;
    const cl = dl[j];
    const cr = dr[j];
    wi = (wi + 1) % dl.length;
    const a = Math.min(1, t / 0.35) * (t > off ? decay(t - off, 0.35) : 1) * p.vel;
    add(dst, i0 + i, (l * 0.7 + cl * 0.5) * a * gl, (r * 0.7 + cr * 0.5) * a * gr);
  }
};

/** Chord stab: a short, driven push for the off-beats. */
export const stab: Voice = (dst, i0, p) => {
  const f = mtof(p.midi);
  const n = Math.round(p.dur + 0.25 * SR);
  const phases = [rand(), rand(), rand()];
  const lp = new Bq(biquad('lp', 3200, 1.2));
  const [gl, gr] = panGains(p.pan);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let x = 0;
    for (let k = 0; k < 3; k++) {
      const hz = f * Math.pow(2, (k - 1) * 0.03);
      phases[k] = step(phases[k], hz / SR);
      x += saw(phases[k], hz / SR) * 0.34;
    }
    const env = Math.min(1, t / 0.004) * decay(t, 0.09);
    const y = Math.tanh(lp.run(x) * 1.8) / Math.tanh(1.8);
    add(dst, i0 + i, y * env * p.vel * gl * 0.8, y * env * p.vel * gr * 0.8);
  }
};

/** A tight kick for the faster readings: higher, shorter, more click than body. */
export const kick2: Voice = (dst, i0, p) => {
  const n = Math.round(0.32 * SR);
  let phase = 0;
  const clickHp = new Bq(biquad('hp', 1800, 0.7));
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    phase = step(phase, (52 + 90 * decay(t, 0.018)) / SR);
    const body = Math.sin(2 * Math.PI * phase) * Math.min(1, t / 0.001) * decay(t, 0.11);
    const click = clickHp.run(noise()) * decay(t, 0.004) * 0.42;
    const y = Math.tanh((body + click) * p.vel * 2.4) / Math.tanh(2.4);
    add(dst, i0 + i, y, y);
  }
};

/** A snappy snare for the faster readings: a short crack over a tight drum head. */
export const snare2: Voice = (dst, i0, p) => {
  const n = Math.round(0.26 * SR);
  const bp = new Bq(biquad('bp', 2400, 0.8));
  const hp = new Bq(biquad('hp', 700, 0.7));
  let ph1 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph1 = step(ph1, 205 / SR);
    const head = Math.sin(2 * Math.PI * ph1) * decay(t, 0.032) * 0.7;
    const crack = bp.run(hp.run(noise())) * Math.min(1, t / 0.0008) * decay(t, 0.055);
    const y = Math.tanh((head + crack * 1.7) * p.vel * 1.7) / Math.tanh(1.7);
    add(dst, i0 + i, y, y);
  }
};

/** Reese bass: two saws a few cents apart, low and sustained, with a sub under them. */
export const reese: Voice = (dst, i0, p) => {
  const f = mtof(p.midi);
  const n = Math.round(p.dur + 0.18 * SR);
  const lp = new Bq(biquad('lp', 900, 1.6));
  const hp = new Bq(biquad('hp', 38, 0.7));
  let a = rand();
  let b = rand();
  let sub = rand();
  const off = p.dur / SR;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    lp.set(biquad('lp', 520 + 260 * Math.sin(2 * Math.PI * 0.6 * t), 1.6));
    a = step(a, (f * Math.pow(2, -0.11 / 12)) / SR);
    b = step(b, (f * Math.pow(2, 0.11 / 12)) / SR);
    sub = step(sub, f / 2 / SR);
    const beat = saw(a, f / SR) * 0.45 + saw(b, f / SR) * 0.45 + Math.sin(2 * Math.PI * sub) * 0.5;
    const env = Math.min(1, t / 0.006) * (t > off ? decay(t - off, 0.05) : 1);
    const x = hp.run(lp.run(beat)) * env * p.vel;
    add(dst, i0 + i, x, x);
  }
};

/** Acid: one saw through a squelchy resonant filter, with an accent on the loud notes. */
export const acid: Voice = (dst, i0, p) => {
  const f = mtof(p.midi);
  const n = Math.round(p.dur + 0.12 * SR);
  const lp = new Bq(biquad('lp', 1200, 11));
  const hp = new Bq(biquad('hp', 120, 0.7));
  let ph = rand();
  const accent = 0.55 + p.vel * 0.9;
  const off = p.dur / SR;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const cut = 260 + 2600 * accent * decay(t, 0.09);
    lp.set(biquad('lp', Math.min(6000, cut), 11));
    ph = step(ph, f / SR);
    const x = hp.run(lp.run(saw(ph, f / SR)));
    const env = Math.min(1, t / 0.002) * decay(t, 0.11) * (t > off ? decay(t - off, 0.03) : 1);
    const y = Math.tanh(x * (1.2 + accent) ) / Math.tanh(1.2 + accent);
    add(dst, i0 + i, y * env * p.vel, y * env * p.vel);
  }
};
