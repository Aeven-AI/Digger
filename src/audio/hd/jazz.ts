// HD audio backend: jazz arrangements bounced offline into loopable buffers,
// and sound effects synthesized live, each echoing its original's pitch contour.
import type { SoundCmd } from '../../sim/sound';
import type { AudioBackend, AudioEngine } from '../engine';
import { EMERALD_FREQS, PIT_HZ } from '../tunes';
import { bonusTheme, dirge, levelDone, mainTheme, mainTheme2027, mainThemeAcid, mainThemeBreaks, type Cue, type Inst } from './compose';
import type { MusicTheme } from '../../storage/storage';
import * as I from './instruments';

type CueId = 'main' | 'bonus' | 'dirge' | 'levdone';

const LEVELS: Record<Inst, number> = {
  rhodes: 0.9,
  vibes: 1,
  bass: 1,
  trumpet: 0.75,
  strings: 1,
  piano: 1,
  ride: 0.9,
  hat: 0.8,
  openhat: 0.7,
  brush: 0.9,
  swish: 0.9,
  snare: 0.8,
  kick: 0.9,
  swell: 1,
  lead: 0.85,
  synthbass: 0.9,
  clap: 0.9,
  // The newer themes are played from their rendered tracks; these are the levels the
  // browser-synthesized fallback uses, which stands in for instruments it does not
  // have (a reese or a 303 borrows the synth bass, a tight kick the club kick).
  reese: 0.9,
  acid: 0.85,
  stab: 0.7,
  kick2: 0.9,
  snare2: 0.8,
};

const DRUMS: ReadonlySet<Inst> = new Set<Inst>(['ride', 'hat', 'openhat', 'brush', 'swish', 'snare', 'snare2', 'kick', 'kick2', 'clap']);
const drumCache = new Map<string, Promise<AudioBuffer>>();

/** Renders one drum hit at full velocity; cue renders replay it, which is far cheaper than resynthesizing. */
function drumSample(i: Inst, sampleRate: number): Promise<AudioBuffer> {
  const key = i + sampleRate;
  let p = drumCache.get(key);
  if (!p) {
    const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * (i == 'ride' ? 1.6 : 0.7)), sampleRate);
    const out = ctx.destination;
    if (i == 'ride') I.ride(ctx, out, 0, 1);
    else if (i == 'hat') I.hat(ctx, out, 0, 1);
    else if (i == 'openhat') I.hat(ctx, out, 0, 1, 0.42);
    else if (i == 'brush') I.brush(ctx, out, 0, 1);
    else if (i == 'swish') I.brush(ctx, out, 0, 1, true);
    else if (i == 'snare') I.snare(ctx, out, 0, 1);
    else if (i == 'snare2' || i == 'kick2') (i == 'snare2' ? I.snare : I.kick)(ctx, out, 0, 1);
    else if (i == 'clap') I.clap(ctx, out, 0, 1);
    else I.kick(ctx, out, 0, 1);
    p = ctx.startRendering();
    drumCache.set(key, p);
  }
  return p;
}

/** How finely notes are rounded so that near-identical ones share one synthesized voice. */
const DUR_STEP = 0.02;
const VEL_STEP = 0.1;
/** Room after note-off for every instrument's release and ring-out. */
const VOICE_TAIL = 2.5;

interface Sample {
  ch: [Float32Array, Float32Array];
  /** Length with the trailing silence trimmed off. */
  len: number;
}

function trimmed(b: AudioBuffer): Sample {
  const ch: [Float32Array, Float32Array] = [b.getChannelData(0), b.getChannelData(1)];
  let len = b.length;
  // About -80 dB: well below anything audible once the mix is normalized.
  while (len > 0 && Math.abs(ch[0][len - 1]) < 1e-4 && Math.abs(ch[1][len - 1]) < 1e-4) len--;
  return { ch, len };
}

/** Synthesizes one melodic note on its own. */
function renderVoice(i: Inst, d: number, m: number, v: number, pan: number | undefined, sampleRate: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil((d + VOICE_TAIL) * sampleRate), sampleRate);
  const out = ctx.destination;
  if (i == 'rhodes') I.rhodes(ctx, out, 0, d, m, v, pan);
  else if (i == 'vibes') I.vibes(ctx, out, 0, d, m, v, pan);
  else if (i == 'bass') I.bass(ctx, out, 0, d, m, v);
  else if (i == 'trumpet') I.trumpet(ctx, out, 0, d, m, v, pan);
  else if (i == 'strings') I.strings(ctx, out, 0, d, m, v, pan);
  else if (i == 'piano') I.piano(ctx, out, 0, d, m, v, pan);
  else if (i == 'lead') I.lead(ctx, out, 0, d, m, v, pan);
  else if (i == 'synthbass' || i == 'reese' || i == 'acid') I.synthbass(ctx, out, 0, d, m, v);
  else if (i == 'stab') I.strings(ctx, out, 0, Math.min(d, 0.4), m, v, pan);
  else if (i == 'swell') I.swell(ctx, out, 0, d, v);
  return ctx.startRendering();
}

/** Mixes a sample into `dst` at sample offset `at`, resampled by `rate` (linear interpolation). */
function mixInto(dst: Float32Array[], s: Sample, at: number, gain: number, rate = 1): void {
  for (let c = 0; c < 2; c++) {
    const src = s.ch[c];
    const out = dst[c];
    const n = Math.min(Math.floor((s.len - 1) / rate), out.length - at);
    if (rate == 1) for (let k = 0; k < n; k++) out[at + k] += src[k] * gain;
    else
      for (let k = 0; k < n; k++) {
        const x = k * rate;
        const j = x | 0;
        out[at + k] += (src[j] + (src[j + 1] - src[j]) * (x - j)) * gain;
      }
  }
}

/**
 * Renders a cue offline. Each distinct sound (instrument, pitch, length and velocity,
 * rounded) is synthesized once; the notes are then mixed in plain JS, and reverb and
 * mastering run in a single pass. Looping cues get their reverb tail folded onto the
 * start so the loop is seamless.
 */
export async function render(cue: Cue, sampleRate: number, onProgress?: (done: number) => void): Promise<AudioBuffer> {
  // Progress is weighted by measured cost: voices, then mixing, then reverb and mastering.
  const report = (stage: number, f: number) => onProgress?.([0, 0.25, 0.5][stage] + [0.25, 0.25, 0.5][stage] * f);
  const spb = 60 / cue.bpm;
  const music = cue.beats * spb;
  const toSec = (beat: number) => {
    const b = Math.floor(beat + 1e-6);
    const f = beat - b;
    // Swing: stretch the first half of each beat, compress the second.
    const sf = f < 0.5 ? (f / 0.5) * cue.swing : cue.swing + ((f - 0.5) / 0.5) * (1 - cue.swing);
    return (b + sf) * spb;
  };
  let seed = 99;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296 - 0.5);
  // Humanized timing for every note, fixed up front so the result is deterministic.
  const timed = cue.notes.map((n) => {
    const t = Math.max(0, toSec(n.t) + rnd() * 0.012);
    const d = Math.max(0.05, toSec(n.t + n.d) - toSec(n.t));
    const rate = 1 + rnd() * 0.04;
    if (DRUMS.has(n.i)) return { n, t, rate, key: n.i, d, v: 1 };
    const qd = Math.max(DUR_STEP, Math.round(d / DUR_STEP) * DUR_STEP);
    const qv = Math.max(VEL_STEP, Math.round(n.v / VEL_STEP) * VEL_STEP);
    return { n, t, rate: 1, key: [n.i, n.m, qd, qv, n.pan ?? 0].join(), d: qd, v: qv };
  });

  // Synthesize the distinct sounds, a few at a time.
 const samples = new Map<string, Sample>();
  const jobs = [...new Map(timed.map((x) => [x.key, x])).values()];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { n, key, d, v } = jobs[next++];
      const buf = DRUMS.has(n.i) ? await drumSample(n.i, sampleRate) : await renderVoice(n.i, d, n.m, v, n.pan, sampleRate);
      samples.set(key, trimmed(buf));
      report(0, ++done / jobs.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);


  // Mix the notes into one bus per reverb amount: drums and bass stay drier than the
  // melodic instruments.
  const total = Math.ceil((music + VOICE_TAIL + 4) * sampleRate);
  const sends = [0.2, 0.5, 1];
  const buses = sends.map(() => [new Float32Array(total), new Float32Array(total)]);
  let lastYield = performance.now();
  for (const [k, { n, t, rate, key, v }] of timed.entries()) {
    const send = n.i == 'bass' || n.i == 'kick' || n.i == 'kick2' ? 0 : n.i == 'ride' || n.i == 'hat' || n.i == 'openhat' ? 1 : 2;
    // Drums are rendered at full velocity; voices at a rounded one, so scale to the exact level.
    mixInto(buses[send], samples.get(key)!, Math.round(t * sampleRate), LEVELS[n.i] * (n.v / v), rate);
    // This runs on the main thread, possibly mid-game: never hold it for more than a few ms.
    if (performance.now() - lastYield > 4) {
      report(1, k / timed.length);
      await new Promise((r) => setTimeout(r));
      lastYield = performance.now();
    }
  }

  // Reverb and mastering in one pass: gentle bus compression and a softened top end.
  const master = new OfflineAudioContext(2, total, sampleRate);
  const out = master.createGain();
  const verb = master.createConvolver();
  verb.buffer = I.makeImpulse(master, 2.6, 2.4);
  verb.connect(out);
  buses.forEach((mix, k) => {
    const raw = master.createBuffer(2, total, sampleRate);
    raw.copyToChannel(mix[0], 0);
    raw.copyToChannel(mix[1], 1);
    const src = master.createBufferSource();
    src.buffer = raw;
    src.connect(out);
    const wet = master.createGain();
    wet.gain.value = sends[k] * cue.reverb;
    src.connect(wet).connect(verb);
    src.start();
  });
  const comp = master.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.01;
  comp.release.value = 0.2;
  const warmth = master.createBiquadFilter();
  warmth.type = 'highshelf';
  warmth.frequency.value = 9000;
  warmth.gain.value = -3;
  out.connect(comp).connect(warmth).connect(master.destination);
  // Firefox can't suspend an offline render; there the bar just jumps at the end.
  if (onProgress && typeof master.suspend == 'function') {
    // Pause the render every couple of seconds of audio, just to report how far it got.
    const secs = total / sampleRate;
    for (let at = 2; at < secs; at += 2)
      void master.suspend(at).then(() => {
        report(2, at / secs);
        void master.resume();
      });
  }
  const buf = await master.startRendering();
  report(2, 1);
  normalize(buf, 0.16, 0.85);
  if (!cue.loopBeats) return buf;
  const loopLen = Math.round(cue.loopBeats * spb * sampleRate);
  const loop = new AudioBuffer({ length: loopLen, numberOfChannels: 2, sampleRate });
  for (let ch = 0; ch < 2; ch++) {
    const s = buf.getChannelData(ch);
    const dst = loop.getChannelData(ch);
    dst.set(s.subarray(0, loopLen));
    for (let i = loopLen; i < s.length; i++) dst[(i - loopLen) % loopLen] += s[i];
  }
  return loop;
}

/** Scales a buffer toward a target RMS without letting peaks exceed `peak`. */
function normalize(b: AudioBuffer, rms: number, peak: number): void {
  let sum = 0;
  let max = 0;
  let n = 0;
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      sum += v * v;
      const a = Math.abs(v);
      if (a > max) max = a;
    }
    n += d.length;
  }
  const cur = Math.sqrt(sum / n) || 1;
  const k = Math.min(rms / cur, peak / (max || 1));
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}

interface Playing {
  id: CueId;
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** Context time the cue started, for beat-synced changes. */
  at: number;
}

/** Tempo of the looping cues, so changes between them land on a beat. */
const BPM: Partial<Record<CueId, number>> = { main: 168, bonus: 232 };
/** Tempo of each reading of the main theme, so a change of tune lands on a beat. */
const MAIN_BPM: Record<MusicTheme, number> = { '2027': 126, breaks: 174, acid: 130, jazz: 168 };
/** Beats per melody-table step in the arrangements (see compose). */
const STEP = 0.25;
/** The pre-rendered tracks, written by tools/music/render-track.ts. */
/** The arrangement behind each reading, played when there is no track or it will not decode. */
const CUES: Record<MusicTheme, () => Cue> = {
  '2027': mainTheme2027,
  breaks: mainThemeBreaks,
  acid: mainThemeAcid,
  jazz: mainTheme,
};

/** The rendered track for a theme, where there is one. */
const TRACKS: Partial<Record<MusicTheme, string>> = {
  '2027': './audio/digger-2027.opus',
  breaks: './audio/digger-breaks.opus',
  acid: './audio/digger-acid.opus',
};
/** Playback trim for the track, so it matches the level of the rendered cues. */
const TRACK_GAIN = 0.6;
const TUNES: CueId[] = ['bonus', 'main', 'dirge'];

/** Menu ambience: a slow four-chord bed in D minor, the key the tune is in. */
const AMBIENT_CHORDS: number[][] = [
  [50, 57, 65, 69],
  [48, 55, 62, 67],
  [46, 53, 60, 65],
  [48, 55, 62, 69],
];

const hz = (div: number) => PIT_HZ / div;
const ftom = (f: number) => 69 + 12 * Math.log2(f / 440);

class Jazz implements AudioBackend {
  private ctx: AudioContext;
  private music: AudioNode;
  private sfx: GainNode;
  private buffers = new Map<CueId, AudioBuffer>();
  private pending = new Map<CueId, Promise<AudioBuffer>>();
  private mainProgress = 0;
  private onMainProgress: ((f: number) => void) | null = null;
  private playing: Playing | null = null;
  private wanted: CueId | null = null;
  private falling: { stop(): void } | null = null;
  private firing: { stop(): void } | null = null;
  private eatCount = 0;
  private lastBonusPing = 0;
  private bonusPingHigh = false;
  private wobbleHigh = false;
  private theme: MusicTheme;
  private ambient: { gain: GainNode; timer: number } | null = null;
  /** The main cue for the selected theme; both share a tempo so they can swap on a beat. */
  private readonly mainCue = () => CUES[this.theme]();

  constructor(engine: AudioEngine, theme: MusicTheme = '2027') {
    this.theme = theme;
    this.ctx = engine.ctx;
    this.music = engine.music;
    // Effects get a little room so they sit with the music.
    this.sfx = this.ctx.createGain();
    this.sfx.connect(engine.sfx);
    const verb = this.ctx.createConvolver();
    verb.buffer = I.makeImpulse(this.ctx, 1.4, 3);
    const send = this.ctx.createGain();
    send.gain.value = 0.18;
    this.sfx.connect(send).connect(verb).connect(engine.sfx);
  }

  /** Bounces the cues in priority order. */
  async prepare(): Promise<void> {
    const order: [CueId, () => Cue][] = [
      ['main', this.mainCue],
      ['levdone', levelDone],
      ['dirge', dirge],
      ['bonus', bonusTheme],
    ];
    for (const [id, make] of order) await this.load(id, make);
  }

  private load(id: CueId, make: () => Cue): Promise<AudioBuffer> {
    let p = this.pending.get(id);
    if (!p) {
      const progress =
        id == 'main'
          ? (f: number) => {
              this.mainProgress = f;
              this.onMainProgress?.(f);
            }
          : undefined;
      const bake = () => render(make(), this.ctx.sampleRate, progress);
      // The 2027 theme ships pre-rendered, because a full club mix needs more
      // arithmetic than a live graph can afford. The live render stays as the
      // fallback wherever the track will not decode, and as the whole of the
      // swing and bonus arrangements.
      const job = id == 'main' && TRACKS[this.theme] ? this.track(progress).catch(bake) : bake();
      p = job.then((b) => {
        this.buffers.set(id, b);
        if (this.wanted == id && this.playing?.id != id) this.start(id);
        return b;
      });
      this.pending.set(id, p);
    }
    return p;
  }

  /** Fetches and decodes the pre-rendered track for the current theme. */
  private async track(progress?: (f: number) => void): Promise<AudioBuffer> {
    const url = TRACKS[this.theme]!;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    progress?.(0.55);
    const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    // The file is a mastered mix, several decibels hotter than the cues rendered
    // in the browser; trim it so the music sits where the others do.
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] *= TRACK_GAIN;
    }
    progress?.(1);
    return buf;
  }

  async whenReady(onProgress?: (f: number) => void): Promise<void> {
    onProgress?.(this.mainProgress);
    this.onMainProgress = onProgress ?? null;
    try {
      await this.load('main', this.mainCue);
    } finally {
      this.onMainProgress = null;
    }
  }

  /**
   * Swaps the main theme while the game is running: the old reading is dropped and the
   * new one loads in its place. The other cues are untouched, so this costs one track
   * rather than a whole soundtrack.
   * @param theme the reading to play from now on
   */
  async setMainTheme(theme: MusicTheme): Promise<void> {
    if (theme == this.theme) return;
    const wasPlaying = this.wanted == 'main' || this.playing?.id == 'main';
    this.theme = theme;
    // The held buffer belongs to the old reading, and the two run at different tempos,
    // so there is nothing to crossfade: stop it and let the new one come in.
    this.buffers.delete('main');
    this.pending.delete('main');
    this.mainProgress = 0;
    this.onMainProgress?.(0);
    if (this.playing?.id == 'main') this.stopMusic(0.25);
    if (!wasPlaying) return;
    this.wanted = 'main';
    // load() already falls back to rendering the cue in the browser; there is nothing
    // further to try if even that fails, and the game still has its effects.
    await this.load('main', this.mainCue).catch(() => {});
  }

  /** Tempo of a cue under the current theme. */
  private tempoOf(id: CueId): number | undefined {
    return id == 'main' ? MAIN_BPM[this.theme] : BPM[id];
  }

  private start(id: CueId, pos = 0): void {
    const buf = this.buffers.get(id);
    // Switching between the two looping cues waits for the next beat of the old one
    // (at most a third of a second), so the band changes tune in time.
    let t = this.ctx.currentTime;
    const p = this.playing;
    const bpm = p ? this.tempoOf(p.id) : undefined;
    if (p && bpm && this.tempoOf(id) && buf) {
      const beat = 60 / bpm;
      const since = t - p.at;
      t = p.at + Math.ceil(since / beat + 0.05) * beat;
    }
    this.stopMusic(0.12, t);
    if (!buf) return; // starts once rendered (see load)
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = id == 'main' || id == 'bonus';
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.04);
    src.connect(gain).connect(this.music);
    const offset = BPM[id] ? (pos * STEP * 60) / BPM[id]! % buf.duration : 0;
    src.start(t + 0.01, offset);
    this.playing = { id, src, gain, at: t + 0.01 - offset };
    src.onended = () => {
      if (this.playing?.src === src) this.playing = null;
    };
  }

  private stopMusic(fade: number, at = this.ctx.currentTime): void {
    const p = this.playing;
    if (!p) return;
    const t = Math.max(at, this.ctx.currentTime);
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setValueAtTime(p.gain.gain.value, t);
    p.gain.gain.linearRampToValueAtTime(0, t + fade);
    p.src.stop(t + fade + 0.05);
    this.playing = null;
  }

  private play(id: CueId, pos = 0): void {
    this.wanted = id;
    this.start(id, pos);
  }

  private stopLoops(): void {
    this.falling?.stop();
    this.falling = null;
    this.firing?.stop();
    this.firing = null;
  }

  command(cmd: SoundCmd, arg: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const out = this.sfx;
    switch (cmd) {
      case 'music':
        if (arg == 0) this.eatCount = 0;
        this.play(arg == 0 ? 'bonus' : arg == 1 ? 'main' : 'dirge');
        break;
      case 'musicoff':
        this.wanted = null;
        this.stopMusic(0.5);
        break;
      case 'soundstop':
      case 'killsound':
        this.wanted = null;
        this.stopMusic(0.25);
        this.stopLoops();
        break;
      case 'soundlevdone':
        this.stopLoops();
        this.play('levdone');
        break;
      case 'soundem':
        // A soft woody tick as the gem comes loose.
        I.brush(ctx, out, t, 0.6);
        break;
      case 'soundemerald': {
        const m = Math.round(ftom(hz(EMERALD_FREQS[arg] ?? EMERALD_FREQS[0])));
        I.vibes(ctx, out, t, 0.35, m, 0.75, 0.15);
        I.vibes(ctx, out, t + 0.01, 0.3, m + 12, 0.18, -0.15);
        if (arg == 7) for (const [k, d] of [7, 11, 14].entries()) I.vibes(ctx, out, t + 0.07 * (k + 1), 0.6, m + d, 0.5, 0.3);
        break;
      }
      case 'soundfall':
        this.falling?.stop();
        this.falling = this.whistle(t);
        break;
      case 'soundfalloff':
        this.falling?.stop();
        this.falling = null;
        break;
      case 'soundwobble':
        this.creak(t, (this.wobbleHigh = !this.wobbleHigh));
        break;
      case 'soundwobbleoff':
        break;
      case 'soundbreak':
        I.kick(ctx, out, t, 0.9);
        I.brush(ctx, out, t, 1, true);
        this.jingle(t + 0.03, 9, 0.5);
        break;
      case 'soundgold': {
        [84, 88, 91, 96].forEach((m, k) => I.vibes(ctx, out, t + k * 0.05, 0.4, m, 0.55, -0.2 + k * 0.15));
        this.jingle(t, 7, 0.35);
        break;
      }
      case 'soundfire':
        this.firing?.stop();
        this.firing = this.fireball(t);
        break;
      case 'soundfireoff':
        this.firing?.stop();
        this.firing = null;
        break;
      case 'soundexplode':
        this.firing?.stop();
        this.firing = null;
        this.boom(t);
        break;
      case 'soundeatm':
        this.gulp(t, this.eatCount++);
        break;
      case 'soundddie':
        this.sadTrombone(t);
        break;
      case 'sound1up':
        [62, 65, 69, 72, 76, 81].forEach((m, k) => I.vibes(ctx, out, t + k * 0.07, 0.5, m + 12, 0.55, -0.3 + k * 0.12));
        break;
      case 'soundbonus':
        // Rate-limited two-tone ping while the bonus starts and runs out.
        if (t - this.lastBonusPing > 0.14) {
          this.lastBonusPing = t;
          this.bonusPingHigh = !this.bonusPingHigh;
          I.vibes(ctx, out, t, 0.12, this.bonusPingHigh ? 93 : 88, 0.35, this.bonusPingHigh ? 0.3 : -0.3);
        }
        break;
      case 'soundbonusoff':
        break;
    }
  }

  // --- Effect recipes ------------------------------------------------------------

  /** Falling bag: a gliding whistle with a breathy whoosh, like the original's dropping tone. */
  private whistle(t: number): { stop(): void } {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.05);
    g.connect(this.sfx);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1100, t);
    o.frequency.exponentialRampToValueAtTime(330, t + 2.2);
    o.connect(g);
    o.start(t);
    const n = ctx.createBufferSource();
    n.buffer = I.noiseBuffer(ctx);
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2200, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 2.2);
    bp.Q.value = 1.5;
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    n.connect(bp).connect(ng).connect(g);
    n.start(t);
    return {
      stop: () => {
        const s = ctx.currentTime;
        g.gain.cancelScheduledValues(s);
        g.gain.setValueAtTime(g.gain.value, s);
        g.gain.linearRampToValueAtTime(0, s + 0.06);
        o.stop(s + 0.1);
        n.stop(s + 0.1);
      },
    };
  }

  /** Wobbling bag: a short leather-and-wood creak, alternating pitch like the original's warble. */
  private creak(t: number, high: boolean): void {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = I.noiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(high ? 520 : 380, t);
    bp.frequency.linearRampToValueAtTime(high ? 640 : 300, t + 0.12);
    bp.Q.value = 9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.setTargetAtTime(0, t + 0.06, 0.04);
    n.connect(bp).connect(g).connect(this.sfx);
    n.start(t, Math.random());
    n.stop(t + 0.3);
  }

  /** Coins: bright staggered pings. */
  private jingle(t: number, count: number, vel: number): void {
    const ctx = this.ctx;
    for (let k = 0; k < count; k++) {
      const at = t + k * 0.035 + Math.random() * 0.03;
      const f = 2600 + Math.random() * 2600;
      for (const r of [1, 2.76]) {
        const o = ctx.createOscillator();
        o.frequency.value = f * r;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vel * 0.06 * (r == 1 ? 1 : 0.4), at);
        g.gain.setTargetAtTime(0, at, 0.05 + Math.random() * 0.06);
        const p = ctx.createStereoPanner();
        p.pan.value = Math.random() * 1.2 - 0.6;
        o.connect(g).connect(p).connect(this.sfx);
        o.start(at);
        o.stop(at + 0.5);
      }
    }
  }

  /** Fireball: a soft "pew" launch, then a crackling hiss while it flies. */
  private fireball(t: number): { stop(): void } {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(380, t + 0.16);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.18, t);
    og.gain.setTargetAtTime(0, t + 0.05, 0.05);
    o.connect(og).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.5);
    const n = ctx.createBufferSource();
    n.buffer = I.noiseBuffer(ctx);
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 23;
    const ld = ctx.createGain();
    ld.gain.value = 600;
    lfo.connect(ld).connect(bp.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.08);
    n.connect(bp).connect(g).connect(this.sfx);
    n.start(t);
    lfo.start(t);
    return {
      stop: () => {
        const s = ctx.currentTime;
        g.gain.cancelScheduledValues(s);
        g.gain.setValueAtTime(g.gain.value, s);
        g.gain.linearRampToValueAtTime(0, s + 0.05);
        n.stop(s + 0.08);
        lfo.stop(s + 0.08);
      },
    };
  }

  private boom(t: number): void {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = I.noiseBuffer(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.setTargetAtTime(0, t, 0.12);
    n.connect(lp).connect(g).connect(this.sfx);
    n.start(t, Math.random());
    n.stop(t + 0.8);
    I.kick(ctx, this.sfx, t, 0.6);
  }

  /** Eating a monster in bonus mode: a cartoony gulp that climbs with each consecutive bite. */
  private gulp(t: number, k: number): void {
    const ctx = this.ctx;
    const up = Math.pow(2, Math.min(k, 6) * (3 / 12));
    for (let rep = 0; rep < 2; rep++) {
      const at = t + rep * 0.11;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(620 * up, at);
      o.frequency.exponentialRampToValueAtTime(150 * up, at + 0.1);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400 * up;
      lp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16, at);
      g.gain.setTargetAtTime(0, at + 0.05, 0.03);
      o.connect(lp).connect(g).connect(this.sfx);
      o.start(at);
      o.stop(at + 0.25);
    }
    I.vibes(ctx, this.sfx, t + 0.2, 0.3, 74 + Math.min(k, 6) * 3, 0.4, 0.2);
  }

  /** Digger death: a muted "wah wah wah waaah", falling like the original's sweep. */
  private sadTrombone(t: number): void {
    const ctx = this.ctx;
    const notes = [59, 58, 57, 56];
    notes.forEach((m, k) => {
      const last = k == notes.length - 1;
      I.trumpet(ctx, this.sfx, t + k * 0.32, last ? 1.1 : 0.28, m - 12, 0.75, 0);
    });
  }

  resync(tune: number, pos?: number | null): void {
    this.stopLoops();
    if (tune < 0) {
      this.wanted = null;
      this.stopMusic(0.2);
    } else this.play(TUNES[tune], pos ?? 0);
  }

  async musicPos(tune: number): Promise<number | null> {
    const p = this.playing;
    const bpm = p && p.id == TUNES[tune] ? this.tempoOf(p.id) : undefined;
    if (!p || !bpm) return null;
    const into = Math.max(0, this.ctx.currentTime - p.at) % p.src.buffer!.duration;
    return (into * bpm) / 60 / STEP;
  }

  /**
   * The menu bed: slow string pads cycling four chords with the odd sparkle on top,
   * routed through the music bus so the sliders and mute apply. Only the remastered
   * sound has one — the 1983 PC-speaker style stays silent in menus, as it was.
   * @param on true while a menu or the title screen is up
   */
  setAmbient(on: boolean): void {
    if (on == !!this.ambient) return;
    if (!on) {
      const a = this.ambient;
      this.ambient = null;
      if (!a) return;
      clearInterval(a.timer);
      a.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      a.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
      setTimeout(() => a.gain.disconnect(), 2500);
      return;
    }
    const ctx = this.ctx;
    const bed = ctx.createGain();
    bed.gain.value = 0;
    bed.gain.setTargetAtTime(0.5, ctx.currentTime, 1.4);
    bed.connect(this.music);
    let step = 0;
    const play = () => {
      const t = ctx.currentTime + 0.12;
      const chord = AMBIENT_CHORDS[step % AMBIENT_CHORDS.length];
      step++;
      for (const m of chord) I.strings(ctx, bed, t, 9, m, 0.5, ((m % 3) - 1) * 0.3);
      I.rhodes(ctx, bed, t, 2.5, chord[0] - 12, 0.16, 0.1);
      if (step % 2 == 0) I.vibes(ctx, bed, t + 3.6, 0.4, chord[2] + 12, 0.11, 0.35);
    };
    play();
    this.ambient = { gain: bed, timer: setInterval(play, 8000) as unknown as number };
  }

  /** A soft blip for menu navigation; 'select' sits a fifth above 'move'. */
  uiSound(kind: 'move' | 'select'): void {
    I.vibes(this.ctx, this.sfx, this.ctx.currentTime + 0.01, 0.14, kind == 'select' ? 81 : 74, 0.16, kind == 'select' ? 0.1 : -0.1);
  }

  setPaused(): void {
    /* The engine suspends the whole AudioContext. */
  }

  silence(): void {
    this.setAmbient(false);
    this.wanted = null;
    this.stopMusic(0.15);
    this.stopLoops();
  }
}

export async function createJazz(engine: AudioEngine, theme: MusicTheme = '2027'): Promise<AudioBackend> {
  const j = new Jazz(engine, theme);
  void j.prepare();
  return j;
}
