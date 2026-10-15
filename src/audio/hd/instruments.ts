// Synthesized jazz instruments built from Web Audio nodes. They work in both a
// live AudioContext (sound effects) and an OfflineAudioContext (music bounces).

export type Ctx = BaseAudioContext;

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const noiseCache = new WeakMap<Ctx, AudioBuffer>();

export function noiseBuffer(ctx: Ctx): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) | 0;
      d[i] = ((seed >>> 8) & 0xffff) / 32768 - 1;
    }
    noiseCache.set(ctx, b);
  }
  return b;
}

function noise(ctx: Ctx, t: number, dur: number): AudioBufferSourceNode {
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx);
  n.loop = true;
  n.start(t, Math.random() * 1.5);
  n.stop(t + dur);
  return n;
}

function osc(ctx: Ctx, type: OscillatorType, f: number, t: number, dur: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.start(t);
  o.stop(t + dur);
  return o;
}

function gain(ctx: Ctx, v = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function panner(ctx: Ctx, pan: number, dest: AudioNode): AudioNode {
  if (!pan) return dest;
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  p.connect(dest);
  return p;
}

/** Envelope: linear attack to `peak`, exponential decay toward `floor` with time constant `tau`, release at `off`. */
function adsr(g: AudioParam, t: number, attack: number, peak: number, tau: number, floor: number, off: number, release: number): number {
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + attack);
  g.setTargetAtTime(floor, t + attack, tau);
  g.setTargetAtTime(0, off, release);
  return off + release * 6;
}

export interface Voice {
  (ctx: Ctx, out: AudioNode, t: number, dur: number, midi: number, vel: number, pan?: number): void;
}

/** Electric piano (two-operator FM with a bell "tine"), warm and bell-like. */
export const rhodes: Voice = (ctx, out, t, dur, midi, vel, pan = 0) => {
  const f = mtof(midi);
  const dest = panner(ctx, pan, out);
  const hi = Math.max(0, (midi - 60) / 30);
  const decay = 1.6 - hi * 0.9;
  const off = t + dur;
  const end = off + 0.6;
  const amp = gain(ctx);
  adsr(amp.gain, t, 0.004, vel * 0.32, decay, 0.0001, off, 0.09);
  amp.connect(dest);
  for (const det of [1, 1.0035]) {
    const car = osc(ctx, 'sine', f * det, t, end - t);
    const mod = osc(ctx, 'sine', f * det, t, end - t);
    const idx = gain(ctx);
    idx.gain.setValueAtTime(f * (0.9 + vel * 2.2), t);
    idx.gain.setTargetAtTime(f * 0.25, t, 0.25);
    mod.connect(idx).connect(car.frequency);
    const g = gain(ctx, 0.5);
    car.connect(g).connect(amp);
  }
  // Tine: a short metallic overtone that gives the attack its bark.
  const tine = osc(ctx, 'sine', f * 7.02, t, 0.35);
  const tg = gain(ctx);
  tg.gain.setValueAtTime(vel * 0.05 * (1 - hi * 0.5), t);
  tg.gain.setTargetAtTime(0, t, 0.05);
  tine.connect(tg).connect(dest);
};

/** Vibraphone: inharmonic bar partials with motor tremolo and a soft mallet tick. */
export const vibes: Voice = (ctx, out, t, dur, midi, vel, pan = 0) => {
  const f = mtof(midi);
  const dest = panner(ctx, pan, out);
  const off = t + Math.max(dur, 0.25);
  const end = off + 1.2;
  const trem = gain(ctx, 1);
  const lfo = osc(ctx, 'sine', 5.2, t, end - t);
  const depth = gain(ctx, 0.22);
  lfo.connect(depth).connect(trem.gain);
  trem.connect(dest);
  const parts: [number, number, number][] = [
    [1, 1, 2.2],
    [3.99, 0.32, 0.55],
    [9.9, 0.08, 0.18],
  ];
  for (const [r, a, tau] of parts) {
    const o = osc(ctx, 'sine', f * r, t, end - t);
    const g = gain(ctx);
    adsr(g.gain, t, 0.002, vel * 0.2 * a, tau, 0.0001, off, 0.18);
    o.connect(g).connect(trem);
  }
  const click = noise(ctx, t, 0.03);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(9000, f * 6);
  const cg = gain(ctx);
  cg.gain.setValueAtTime(vel * 0.05, t);
  cg.gain.setTargetAtTime(0, t, 0.006);
  click.connect(bp).connect(cg).connect(dest);
};

/** Upright bass: a plucked, low-passed triangle with a woody thump. */
export const bass: Voice = (ctx, out, t, dur, midi, vel) => {
  const f = mtof(midi);
  const off = t + dur * 0.92;
  const end = off + 0.3;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.4;
  lp.frequency.setValueAtTime(500 + vel * 900, t);
  lp.frequency.setTargetAtTime(f * 2.2 + 120, t, 0.09);
  const amp = gain(ctx);
  adsr(amp.gain, t, 0.006, vel * 0.55, 0.45, vel * 0.18, off, 0.05);
  lp.connect(amp).connect(out);
  const o1 = osc(ctx, 'triangle', f, t, end - t);
  const o2 = osc(ctx, 'sine', f, t, end - t);
  o1.frequency.setValueAtTime(f * 1.012, t);
  o1.frequency.setTargetAtTime(f, t, 0.02);
  const g2 = gain(ctx, 0.7);
  o1.connect(lp);
  o2.connect(g2).connect(lp);
  const thump = noise(ctx, t, 0.05);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 700;
  bp.Q.value = 1.2;
  const tg = gain(ctx);
  tg.gain.setValueAtTime(vel * 0.08, t);
  tg.gain.setTargetAtTime(0, t, 0.012);
  thump.connect(bp).connect(tg).connect(out);
};

/**
 * The tune's own voice, fattened up: three detuned pulse waves through a snappy
 * lowpass. This is the PC speaker's square wave with a filter on it, which is what
 * the 1983 tune is made of — asked for the 2027 reading of it.
 */
export const lead: Voice = (ctx, out, t, dur, midi, vel, pan = 0) => {
  const f = mtof(midi);
  const dest = panner(ctx, pan, out);
  const off = t + dur * 0.88;
  const end = off + 0.22;
  // A fast upward blip at the attack: the synth "pew" the PC speaker could only hint at.
  const blip = ctx.createOscillator();
  const blipGain = gain(ctx);
  blip.type = 'sawtooth';
  blip.frequency.setValueAtTime(f * 0.7, t);
  blip.frequency.exponentialRampToValueAtTime(f, t + 0.035);
  blip.start(t);
  blip.stop(t + 0.05);
  blipGain.gain.setValueAtTime(0, t);
  blipGain.gain.linearRampToValueAtTime(vel * 0.12, t + 0.004);
  blipGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  blip.connect(blipGain).connect(dest);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 5;
  lp.frequency.setValueAtTime(Math.min(8000, f * 9), t);
  lp.frequency.setTargetAtTime(Math.min(5200, f * 4 + 500), t, 0.07);
  const amp = gain(ctx);
  adsr(amp.gain, t, 0.004, vel * 0.2, 0.7, vel * 0.15, off, 0.05);
  lp.connect(amp).connect(dest);
  for (const [det, v] of [
    [1, 0.6],
    [1.007, 0.34],
    [0.993, 0.34],
  ] as [number, number][]) {
    osc(ctx, 'square', f * det, t, end - t)
      .connect(gain(ctx, v))
      .connect(lp);
  }
};

/** Square-wave synth bass: short and punchy, with a click on the attack. */
export const synthbass: Voice = (ctx, out, t, dur, midi, vel) => {
  const f = mtof(midi);
  const off = t + dur * 0.84;
  const end = off + 0.18;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 3.5;
  lp.frequency.setValueAtTime(Math.min(2800, f * 7), t);
  lp.frequency.setTargetAtTime(f * 2.6 + 140, t, 0.05);
  const amp = gain(ctx);
  adsr(amp.gain, t, 0.003, vel * 0.4, 0.32, vel * 0.16, off, 0.04);
  lp.connect(amp).connect(out);
  osc(ctx, 'square', f, t, end - t)
    .connect(gain(ctx, 0.75))
    .connect(lp);
  osc(ctx, 'sawtooth', f * 0.5, t, end - t)
    .connect(gain(ctx, 0.32))
    .connect(lp);
  const click = noise(ctx, t, 0.02);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1100;
  const cg = gain(ctx);
  cg.gain.setValueAtTime(vel * 0.05, t);
  cg.gain.setTargetAtTime(0, t, 0.008);
  click.connect(hp).connect(cg).connect(out);
};

/** Clap: a stack of short noise bursts, the classic machine clap. */
export function clap(ctx: Ctx, out: AudioNode, t: number, vel: number, pan = 0): void {
  const dest = panner(ctx, pan, out);
  for (const [at, v] of [
    [0, 1],
    [0.008, 0.7],
    [0.017, 0.45],
  ] as [number, number][]) {
    const n = noise(ctx, t + at, 0.16);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.8;
    const g = gain(ctx);
    g.gain.setValueAtTime(vel * 0.22 * v, t + at);
    g.gain.setTargetAtTime(0.0001, t + at, 0.02);
    n.connect(bp).connect(g).connect(dest);
  }
}

/** Muted trumpet: a vibrato'd sawtooth through Harmon-mute-like formants. */
export const trumpet: Voice = (ctx, out, t, dur, midi, vel, pan = 0) => {
  const f = mtof(midi);
  const dest = panner(ctx, pan, out);
  const off = t + dur * 0.9;
  const end = off + 0.2;
  const o = osc(ctx, 'sawtooth', f, t, end - t);
  const o2 = osc(ctx, 'sawtooth', f * 1.004, t, end - t);
  const vib = osc(ctx, 'sine', 5.6, t, end - t);
  const vd = gain(ctx);
  vd.gain.setValueAtTime(0, t);
  vd.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.4, dur));
  vib.connect(vd);
  vd.connect(o.frequency);
  vd.connect(o2.frequency);
  // Slight scoop up into the note.
  o.frequency.setValueAtTime(f * 0.97, t);
  o.frequency.setTargetAtTime(f, t, 0.025);
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 1500;
  f1.Q.value = 1.6;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'peaking';
  f2.frequency.value = 2700;
  f2.gain.value = 6;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1800 + vel * 2500, t);
  lp.frequency.setTargetAtTime(1600 + vel * 1200, t + 0.05, 0.2);
  const amp = gain(ctx);
  adsr(amp.gain, t, 0.03, vel * 0.5, 0.6, vel * 0.33, off, 0.05);
  o.connect(f1);
  o2.connect(f1);
  f1.connect(f2).connect(lp).connect(amp).connect(dest);
};

/** String pad: detuned saws, slow attack. */
export const strings: Voice = (ctx, out, t, dur, midi, vel, pan = 0) => {
  const f = mtof(midi);
  const dest = panner(ctx, pan, out);
  const off = t + dur;
  const end = off + 1.5;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900 + vel * 900;
  const amp = gain(ctx);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(vel * 0.09, t + 0.7);
  amp.gain.setTargetAtTime(0, off, 0.35);
  lp.connect(amp).connect(dest);
  for (const det of [0.996, 1, 1.0045]) osc(ctx, 'sawtooth', f * det, t, end - t).connect(lp);
};

/** Grand-ish piano: brighter FM with a hammer transient, for the dirge. */
export const piano: Voice = (ctx, out, t, dur, midi, vel, pan = 0) => {
  const f = mtof(midi);
  const dest = panner(ctx, pan, out);
  const off = t + dur;
  const end = off + 1;
  const amp = gain(ctx);
  adsr(amp.gain, t, 0.002, vel * 0.3, 1.4, 0.0001, off, 0.25);
  amp.connect(dest);
  const car = osc(ctx, 'sine', f, t, end - t);
  const mod = osc(ctx, 'sine', f * 2, t, end - t);
  const idx = gain(ctx);
  idx.gain.setValueAtTime(f * (0.6 + vel * 1.4), t);
  idx.gain.setTargetAtTime(f * 0.1, t, 0.4);
  mod.connect(idx).connect(car.frequency);
  car.connect(amp);
  const h2 = osc(ctx, 'sine', f * 2.003, t, end - t);
  const hg = gain(ctx);
  adsr(hg.gain, t, 0.002, vel * 0.08, 0.6, 0.0001, off, 0.2);
  h2.connect(hg).connect(dest);
  const ham = noise(ctx, t, 0.03);
  const hp = ctx.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.value = 2500;
  const ng = gain(ctx);
  ng.gain.setValueAtTime(vel * 0.04, t);
  ng.gain.setTargetAtTime(0, t, 0.008);
  ham.connect(hp).connect(ng).connect(dest);
};

// --- Drum kit -----------------------------------------------------------------

/** Cymbal-like metallic noise from inharmonic square waves (the classic 808 recipe). */
function metal(ctx: Ctx, t: number, dur: number, base: number): AudioNode {
  const sum = gain(ctx, 0.15);
  for (const r of [1, 1.483, 1.932, 2.546, 2.63, 3.897]) osc(ctx, 'square', base * r, t, dur).connect(sum);
  return sum;
}

export function ride(ctx: Ctx, out: AudioNode, t: number, vel: number, pan = 0.25): void {
  const dest = panner(ctx, pan, out);
  const m = metal(ctx, t, 1.2, 320);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6500;
  const bp = ctx.createBiquadFilter();
  bp.type = 'peaking';
  bp.frequency.value = 9000;
  bp.gain.value = 4;
  const g = gain(ctx);
  g.gain.setValueAtTime(vel * 0.16, t);
  g.gain.setTargetAtTime(vel * 0.04, t, 0.03);
  g.gain.setTargetAtTime(0, t + 0.05, 0.35);
  m.connect(hp).connect(bp).connect(g).connect(dest);
  // "Ping" of the bell.
  const ping = osc(ctx, 'sine', 4100, t, 0.4);
  const pg = gain(ctx);
  pg.gain.setValueAtTime(vel * 0.012, t);
  pg.gain.setTargetAtTime(0, t, 0.1);
  ping.connect(pg).connect(dest);
}

export function hat(ctx: Ctx, out: AudioNode, t: number, vel: number, open = 0.04, pan = -0.2): void {
  const dest = panner(ctx, pan, out);
  const m = metal(ctx, t, open * 8, 380);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7500;
  const g = gain(ctx);
  g.gain.setValueAtTime(vel * 0.14, t);
  g.gain.setTargetAtTime(0, t, open);
  m.connect(hp).connect(g).connect(dest);
}

/** Brush on the snare: a soft swish (long) or tap (short). */
export function brush(ctx: Ctx, out: AudioNode, t: number, vel: number, swish = false, pan = -0.1): void {
  const dest = panner(ctx, pan, out);
  const len = swish ? 0.5 : 0.12;
  const n = noise(ctx, t, len + 0.1);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(swish ? 1800 : 3200, t);
  if (swish) bp.frequency.linearRampToValueAtTime(3400, t + len);
  bp.Q.value = 0.7;
  const g = gain(ctx);
  if (swish) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.06, t + len * 0.6);
    g.gain.linearRampToValueAtTime(0, t + len);
  } else {
    g.gain.setValueAtTime(vel * 0.16, t);
    g.gain.setTargetAtTime(0, t, 0.035);
  }
  n.connect(bp).connect(g).connect(dest);
}

/** Stick snare hit (for the up-tempo bonus band). */
export function snare(ctx: Ctx, out: AudioNode, t: number, vel: number): void {
  const n = noise(ctx, t, 0.3);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2200;
  bp.Q.value = 0.6;
  const g = gain(ctx);
  g.gain.setValueAtTime(vel * 0.3, t);
  g.gain.setTargetAtTime(0, t, 0.06);
  n.connect(bp).connect(g).connect(out);
  const body = osc(ctx, 'triangle', 190, t, 0.2);
  body.frequency.setTargetAtTime(150, t, 0.03);
  const bg = gain(ctx);
  bg.gain.setValueAtTime(vel * 0.25, t);
  bg.gain.setTargetAtTime(0, t, 0.04);
  body.connect(bg).connect(out);
}

export function kick(ctx: Ctx, out: AudioNode, t: number, vel: number): void {
  const o = osc(ctx, 'sine', 110, t, 0.5);
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.09);
  const g = gain(ctx);
  g.gain.setValueAtTime(vel * 0.7, t);
  g.gain.setTargetAtTime(0, t + 0.02, 0.09);
  o.connect(g).connect(out);
}

/** Soft cymbal swell for endings. */
export function swell(ctx: Ctx, out: AudioNode, t: number, len: number, vel: number): void {
  const m = metal(ctx, t, len + 1.5, 300);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 5000;
  const g = gain(ctx);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * 0.1, t + len);
  g.gain.setTargetAtTime(0, t + len, 0.5);
  m.connect(hp).connect(g).connect(out);
}

/** A plate-ish stereo reverb impulse response. */
export function makeImpulse(ctx: Ctx, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const b = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let seed = 777 + ch * 31;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) | 0;
      const n = ((seed >>> 8) & 0xffff) / 32768 - 1;
      const tt = i / rate;
      // Gently darkening tail.
      const k = 0.35 + 0.6 * Math.exp(-tt * 2);
      lp += (n - lp) * k;
      const pre = tt < 0.012 ? 0 : 1;
      d[i] = lp * Math.pow(1 - i / len, decay) * pre * 0.6;
    }
  }
  return b;
}
