// Jazz arrangements of the original Digger tunes. Melodies come straight from
// the 1983 note tables; the harmony, bass lines, comping and drums are arranged here.
import { BACKG_JINGLE, BONUS_JINGLE, DIRGE, NEWLEV_JINGLE, PIT_HZ } from '../tunes';

export type Inst =
  | 'rhodes'
  | 'vibes'
  | 'bass'
  | 'trumpet'
  | 'strings'
  | 'piano'
  | 'lead'
  | 'synthbass'
  | 'reese'
  | 'acid'
  | 'stab'
  | 'ride'
  | 'hat'
  | 'openhat'
  | 'brush'
  | 'swish'
  | 'snare'
  | 'snare2'
  | 'kick'
  | 'kick2'
  | 'clap'
  | 'swell';

export interface Note {
  /** Start in beats. */
  t: number;
  /** Duration in beats. */
  d: number;
  m: number;
  v: number;
  i: Inst;
  pan?: number;
}

export interface Cue {
  bpm: number;
  /** Loop length in beats (0 = one-shot). */
  loopBeats: number;
  /** Total length to render, in beats (one-shots include their tail). */
  beats: number;
  /** Swing amount: position of the off-beat eighth within the beat (0.5 = straight). */
  swing: number;
  notes: Note[];
  /** Reverb send level. */
  reverb: number;
}

// --- Helpers ------------------------------------------------------------------

const divToMidi = (d: number) => Math.round(69 + 12 * Math.log2(PIT_HZ / d / 440));

/** Reads an original tune table into [startUnit, units, midi | -1]. */
function table(t: readonly number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  let at = 0;
  for (let i = 0; i + 1 < t.length && t[i] != 0x7d64; i += 2) {
    out.push([at, t[i + 1], t[i] >= 0x7d00 ? -1 : divToMidi(t[i])]);
    at += t[i + 1];
  }
  return out;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PC: Record<string, number> = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

/** Rootless voicing intervals and walking-bass chord tones for each chord quality. */
const QUALITIES: Record<string, { voice: number[]; tones: number[] }> = {
  m9: { voice: [3, 7, 10, 14], tones: [0, 3, 7, 10] },
  m7: { voice: [3, 7, 10, 12], tones: [0, 3, 7, 10] },
  m6: { voice: [3, 7, 9, 14], tones: [0, 3, 7, 9] },
  maj7: { voice: [4, 7, 11, 14], tones: [0, 4, 7, 11] },
  maj9: { voice: [4, 7, 11, 14], tones: [0, 4, 7, 11] },
  '6': { voice: [4, 7, 9, 14], tones: [0, 4, 7, 9] },
  '9': { voice: [4, 7, 10, 14], tones: [0, 4, 7, 10] },
  '13': { voice: [4, 10, 14, 21], tones: [0, 4, 7, 10] },
  '7': { voice: [4, 7, 10, 16], tones: [0, 4, 7, 10] },
  '7sus': { voice: [5, 10, 14, 19], tones: [0, 5, 7, 10] },
  '7susb9': { voice: [5, 10, 13, 19], tones: [0, 5, 7, 10] },
  '7b13': { voice: [4, 10, 14, 20], tones: [0, 4, 8, 10] },
  m: { voice: [3, 7, 12, 15], tones: [0, 3, 7, 12] },
  maj: { voice: [4, 7, 12, 16], tones: [0, 4, 7, 12] },
};

interface Chord {
  root: number;
  q: string;
  /** Start and length in beats. */
  t: number;
  d: number;
}

/** Parses "Dm9 | Bbmaj7 C9" style charts: bars separated by |, chords split the bar evenly. */
function chart(src: string, beatsPerBar = 4): Chord[] {
  const out: Chord[] = [];
  const bars = src
    .split('|')
    .map((b) => b.trim())
    .filter(Boolean);
  bars.forEach((bar, bi) => {
    const cs = bar.split(/\s+/);
    cs.forEach((c, ci) => {
      const m = /^([A-G](?:b)?)(.*)$/.exec(c)!;
      out.push({ root: PC[m[1]], q: m[2] || 'maj', t: bi * beatsPerBar + (ci * beatsPerBar) / cs.length, d: beatsPerBar / cs.length });
    });
  });
  return out;
}

function nearest(pc: number, around: number): number {
  let best = 0;
  let bd = 1e9;
  for (let o = 0; o < 10; o++) {
    const m = pc + o * 12;
    const d = Math.abs(m - around);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

/** Walking bass: root on chord changes, chord tones between, chromatic approach into the next chord. */
function walk(chords: Chord[], r: () => number, vel: number, lo = 31, hi = 50): Note[] {
  const out: Note[] = [];
  let prev = 38;
  for (let ci = 0; ci < chords.length; ci++) {
    const c = chords[ci];
    const next = chords[(ci + 1) % chords.length];
    const tones = QUALITIES[c.q].tones;
    const beats = Math.round(c.d);
    for (let b = 0; b < beats; b++) {
      let m: number;
      if (b == 0) m = nearest(c.root, prev);
      else if (b == beats - 1) {
        // Approach the next root from a semitone above or below.
        const target = nearest(next.root, prev);
        m = target + (r() < 0.5 ? -1 : 1);
      } else {
        const tone = tones[1 + Math.floor(r() * (tones.length - 1))];
        m = nearest((c.root + tone) % 12, prev + (r() < 0.5 ? -3 : 3));
      }
      while (m < lo) m += 12;
      while (m > hi) m -= 12;
      out.push({ t: c.t + b, d: 1, m, v: vel * (b == 0 ? 1 : 0.85 + r() * 0.1), i: 'bass' });
      prev = m;
    }
  }
  return out;
}

/** Rootless voicings with smooth voice leading. */
function voicing(c: Chord, center: number): number[] {
  const iv = QUALITIES[c.q].voice;
  const base = nearest(c.root, center - 6);
  return iv.map((x) => base + x).map((m) => (m > center + 10 ? m - 12 : m < center - 10 ? m + 12 : m));
}

const COMP_PATTERNS: [number, number][][] = [
  [
    [0, 0.75],
    [1.5, 0.45],
  ], // Charleston
  [
    [1, 0.4],
    [3, 0.4],
  ],
  [
    [0.5, 0.4],
    [2.5, 0.9],
  ],
  [
    [0, 1.4],
    [2.5, 0.4],
  ],
  [[1.5, 1.8]],
];

function comp(chords: Chord[], r: () => number, vel: number, inst: Inst = 'rhodes', center = 60): Note[] {
  const out: Note[] = [];
  let pat = COMP_PATTERNS[0];
  for (const c of chords) {
    if (c.t % 4 == 0) pat = COMP_PATTERNS[Math.floor(r() * COMP_PATTERNS.length)];
    const v = voicing(c, center);
    for (const [at, len] of pat) {
      const rel = at - (c.t % 4);
      if (rel < 0 || rel >= c.d) continue;
      for (const m of v) out.push({ t: c.t + rel, d: len, m, v: vel * (0.85 + r() * 0.2), i: inst, pan: -0.25 });
    }
  }
  return out;
}

/** Swing ride pattern with hi-hat on 2 and 4, brushes or sticks. */
function drums(bars: number, r: () => number, opts: { brushes: boolean; vel: number; fills?: number }): Note[] {
  const out: Note[] = [];
  const N = (t: number, i: Inst, v: number) => out.push({ t, d: 0.25, m: 0, v, i });
  for (let b = 0; b < bars; b++) {
    const t0 = b * 4;
    const fillBar = opts.fills && (b + 1) % opts.fills == 0;
    for (let beat = 0; beat < 4; beat++) {
      const t = t0 + beat;
      N(t, 'ride', opts.vel * (beat % 2 ? 0.75 : 0.95));
      if (beat % 2 == 1) {
        N(t + 0.5, 'ride', opts.vel * 0.5);
        N(t, 'hat', opts.vel * 0.6);
      }
      if (opts.brushes) {
        if (beat % 2 == 0) N(t, 'swish', opts.vel * 0.7);
        if (r() < 0.22) N(t + 0.5, 'brush', opts.vel * 0.35);
      } else {
        if (r() < 0.18) N(t + 0.5, 'snare', opts.vel * 0.18);
        if (beat == 3 && r() < 0.3) N(t + 0.5, 'snare', opts.vel * 0.3);
      }
      N(t, 'kick', opts.vel * 0.12);
    }
    if (fillBar) {
      // Triplet fill into the next phrase.
      for (let k = 0; k < 6; k++) N(t0 + 2 + k / 3, opts.brushes ? 'brush' : 'snare', opts.vel * (0.25 + k * 0.08));
      N(t0 + 4, 'kick', opts.vel * 0.5);
    }
  }
  return out;
}

function melody(t: readonly number[], beatsPerUnit: number, inst: Inst, transpose: number, vel: number, r: () => number, legato = 0.9, pan = 0.1): Note[] {
  return table(t)
    .filter(([, , m]) => m >= 0)
    .map(([at, len, m]) => ({ t: at * beatsPerUnit, d: len * beatsPerUnit * legato, m: m + transpose, v: vel * (0.88 + r() * 0.18), i: inst, pan }));
}



/** Keeps a riff-shaped bass low by dropping anything above `limit` an octave. */
function foldDown(notes: Note[], limit: number): Note[] {
  return notes.map((n) => (n.m > limit ? { ...n, m: n.m - 12 } : n));
}

function shift(notes: Note[], beats: number): Note[] {
  return notes.map((n) => ({ ...n, t: n.t + beats }));
}

/** Moves a phrase later, optionally transposing it or putting it on another instrument. */
function moved(notes: Note[], at: number, extra = 0, inst?: Inst): Note[] {
  return notes.map((n) => ({ ...n, t: n.t + at, m: n.m + extra, ...(inst ? { i: inst } : {}) }));
}

/** The notes of a phrase that start inside `[from, to)`. */
function inRange(notes: Note[], from: number, to: number): Note[] {
  return notes.filter((n) => n.t >= from && n.t < to);
}

// --- Cues -------------------------------------------------------------------------

/**
 * Popcorn as a dance track. The melody is the 1983 table, note for note, but it is
 * arranged the way a 12-inch would be: four bars of intro building on the kick, an
 * eight-bar drop with the tune on a pulse lead over a pumping riff bass and a
 * four-on-the-floor beat, a two-bar break, then eight bars where the melody lifts an
 * octave on Rhodes with a counter-line. 126 bpm, so it sits where club music sits.
 */
export function mainTheme2027(): Cue {
  const r = rng(1983);
  const ch = chart(
    `Dm9 | Dm9 | Dm9 | C9 | Dm9 | Dm9 | Dm9 | Fmaj9 |
     Fmaj9 | Fmaj9 | Am9 | G9 | Fmaj9 | Fmaj9 | Am9 | G9 |
     Dm9 | Fmaj9 | Am9 | G9`,
  );
  for (const c of ch) if (!QUALITIES[c.q]) c.q = c.q.startsWith('m') ? 'm9' : 'maj9';

  const introBars = 2;
  const outroBars = 2;
  const tuneBars = 20; // the 1983 tune, one pass
  const bars = introBars + tuneBars + outroBars;
  const beats = bars * 4;
  const T0 = introBars * 4; // the tune starts here, in beats
  const BREAK: [number, number] = [8, 10]; // tune bars where the kick drops out
  const notes: Note[] = [];

  // The 1983 single voice, split back into registers: the tune up top, the same line
  // below as the riff. Keeping both is what makes it the Digger tune rather than a
  // dance track that happens to be in D minor.
  const tune = melody(BACKG_JINGLE, 0.25, 'lead', 0, 0.95, r, 0.62, 0);
  const riff = foldDown(melody(BACKG_JINGLE, 0.25, 'synthbass', -12, 0.95, r, 0.5, 0), 50);

  // --- Intro: pad, rising sweep, and a kick-and-hat build in the last bar ------
  notes.push({ t: 0, d: introBars * 4, m: 0, v: 0.7, i: 'swell' });
  for (let b = 0; b < introBars; b++) {
    for (const m of voicing(ch[b % ch.length], 60)) notes.push({ t: b * 4, d: 4, m, v: 0.34, i: 'strings', pan: -0.15 });
    for (let k = 0; k < 4; k++) {
      const t = b * 4 + k;
      if (b == introBars - 1 || k % 2 == 0) notes.push({ t, d: 0.25, m: 0, v: b ? 0.9 : 0.6, i: 'kick' });
      notes.push({ t, d: 0.25, m: 0, v: 0.3, i: 'hat' });
      notes.push({ t: t + 0.5, d: 0.25, m: 0, v: 0.2, i: 'hat' });
    }
    if (b == introBars - 1) for (let k = 0; k < 8; k++) notes.push({ t: b * 4 + 2 + k * 0.25, d: 0.2, m: 0, v: 0.2 + k * 0.05, i: 'snare' });
  }

  // --- The tune, over the riff and the beat ------------------------------------
  notes.push(...moved(tune, T0));
  // Second half doubled an octave up on Rhodes: the lift a 12-inch would have.
  const half = T0 + 40;
  notes.push(...moved(inRange(tune, half - T0, T0 + 80 - T0), 0, 12, 'rhodes').map((n) => ({ ...n, t: n.t + T0, v: n.v * 0.42, pan: -0.3 })));
  // A sparkle on the long notes, up top.
  notes.push(...inRange(tune, 0, 80).filter((n) => n.d >= 0.5).map((n) => ({ ...n, t: n.t + T0 + 0.5, m: n.m + 24, i: 'vibes' as Inst, v: 0.12, pan: 0.32, d: 0.25 })));
  /** True inside the breakdown, where the floor drops away to set up the second drop. */
  const inBreak = (t: number) => t >= T0 + BREAK[0] * 4 && t < T0 + BREAK[1] * 4;
  notes.push(...moved(riff, T0).map((n) => (inBreak(n.t) ? { ...n, v: n.v * 0.4 } : n)));
  // Off-beat octave stabs under the riff: the push that makes it dance.
  notes.push(...moved(riff, T0).filter((n) => n.t % 1 == 0.5 && !inBreak(n.t)).map((n) => ({ ...n, m: n.m + 12, v: n.v * 0.42, d: 0.2 })));
  for (let b = 0; b < tuneBars; b++) {
    // The pad sits out the first bar of the breakdown, which is what makes the
    // return at the drop audible.
    if (b == BREAK[0]) continue;
    for (const m of voicing(ch[b % ch.length], 59)) notes.push({ t: T0 + b * 4, d: 3.6, m, v: 0.24, i: 'strings', pan: -0.1 });
  }

  // --- The beat: four on the floor, clap and snare on 2 and 4, hats in sixteenths ---
  for (let b = 0; b < tuneBars; b++) {
    const breaking = b >= BREAK[0] && b < BREAK[1];
    const rolling = b >= 12; // the last stretch runs sixteenth hats for the lift
    for (let k = 0; k < 4; k++) {
      const t = T0 + b * 4 + k;
      if (!breaking) notes.push({ t, d: 0.25, m: 0, v: 0.95 * (k == 0 ? 1 : 0.85), i: 'kick' });
      if (breaking || k % 2 == 1) {
        notes.push({ t, d: 0.25, m: 0, v: breaking ? 0.8 : 0.72, i: 'snare' });
        notes.push({ t, d: 0.25, m: 0, v: 0.58, i: 'clap' });
      }
      notes.push({ t, d: 0.25, m: 0, v: 0.4, i: 'hat' });
      // The off-beat pulse: open on the "and" of every beat, which is what makes a
      // house track move rather than march.
      notes.push({ t: t + 0.5, d: 0.25, m: 0, v: breaking ? 0.26 : 0.46, i: breaking ? 'hat' : 'openhat' });
      if (rolling) for (const o of [0.25, 0.75]) notes.push({ t: t + o, d: 0.2, m: 0, v: 0.17, i: 'hat' });
      if (k == 3) notes.push({ t: t + 0.5, d: 0.25, m: 0, v: 0.34, i: 'swish' });
    }
    if ((b + 1) % 8 == 0) for (let k = 0; k < 8; k++) notes.push({ t: T0 + b * 4 + 2 + k * 0.25, d: 0.2, m: 0, v: 0.22 + k * 0.05, i: 'snare' });
  }
  for (let k = 0; k < 8; k++) notes.push({ t: T0 + BREAK[0] * 4 - 2 + k * 0.25, d: 0.2, m: 0, v: 0.22 + k * 0.06, i: 'snare' });
  // A riser over the last bar of the breakdown, so the drop lands on the tune again.
  notes.push({ t: T0 + (BREAK[1] - 1) * 4, d: 4, m: 0, v: 0.55, i: 'swell' });

  // --- Outro: pad and kick, then round again -----------------------------------
  const O0 = T0 + 80;
  for (let b = 0; b < outroBars; b++) {
    for (const m of voicing(ch[(b + 2) % ch.length], 58)) notes.push({ t: O0 + b * 4, d: 4, m, v: 0.32, i: 'strings', pan: 0.1 });
    notes.push({ t: O0 + b * 4, d: 0.25, m: 0, v: 0.85, i: 'kick' });
    notes.push({ t: O0 + b * 4 + 2, d: 0.25, m: 0, v: 0.7, i: 'kick' });
  }
  notes.push({ t: O0 + 4, d: 3, m: 0, v: 0.5, i: 'swish' });

  const trimmed = notes.filter((n) => n.t < beats - 0.001).map((n) => ({ ...n, d: Math.min(n.d, beats - n.t) }));
  return { bpm: 126, loopBeats: beats, beats, swing: 0.5, notes: trimmed, reverb: 0.2 };
}

/** The chart the 2027 readings share: D minor, and the same twenty bars of harmony. */
const DANCE_CHART = `Dm9 | Dm9 | Dm9 | C9 | Dm9 | Dm9 | Dm9 | Fmaj9 |
  Fmaj9 | Fmaj9 | Am9 | G9 | Fmaj9 | Fmaj9 | Am9 | G9 |
  Dm9 | Fmaj9 | Am9 | G9`;

/**
 * The same tune as a drum-and-bass roller. The melody sits on top, the riff drops into
 * a reese bass, and a two-step break carries it — kick on the one, snare on two and
 * four, ghost notes between. 174 bpm, so a bar is under a second and a half.
 */
export function mainThemeBreaks(): Cue {
  const r = rng(1740);
  const ch = chart(DANCE_CHART);
  for (const c of ch) if (!QUALITIES[c.q]) c.q = c.q.startsWith('m') ? 'm9' : 'maj9';

  const introBars = 2;
  const outroBars = 2;
  const tuneBars = 20;
  const bars = introBars + tuneBars + outroBars;
  const beats = bars * 4;
  const T0 = introBars * 4;
  const notes: Note[] = [];
  const tune = melody(BACKG_JINGLE, 0.25, 'lead', 0, 0.9, r, 0.7, 0);
  const riff = foldDown(melody(BACKG_JINGLE, 0.25, 'reese', -12, 0.95, r, 0.62, 0), 46);

  /** The break: two-step, with the ghost notes that make it roll rather than march. */
  const breakbeat = (b: number, at: number, heavy: boolean) => {
    const n = (t: number, i: Inst, v: number) => notes.push({ t, d: 0.25, m: 0, v, i });
    n(at, 'kick2', heavy ? 1 : 0.8);
    if (heavy || b % 2) n(at + 2.5, 'kick2', 0.62);
    n(at + 1, 'snare2', heavy ? 0.95 : 0.72);
    n(at + 3, 'snare2', heavy ? 0.9 : 0.68);
    n(at + 0.75, 'snare2', 0.16);
    n(at + 3.5, 'snare2', 0.2);
    for (const o of [0.5, 1.5, 2.5, 3.5]) n(at + o, 'hat', 0.3);
    if (heavy) for (const o of [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25]) n(at + o, 'hat', 0.15);
    if ((b + 1) % 8 == 0) for (let k = 0; k < 8; k++) n(at + 3 + k * 0.125, 'snare2', 0.2 + k * 0.05);
  };

  // Intro: the break on its own, then the pad and a riser under the last bar.
  for (let b = 0; b < introBars; b++) {
    breakbeat(b, b * 4, false);
    for (const m of voicing(ch[b % ch.length], 58)) notes.push({ t: b * 4, d: 4, m, v: 0.3, i: 'strings', pan: -0.15 });
  }
  notes.push({ t: (introBars - 1) * 4, d: 4, m: 0, v: 0.6, i: 'swell' });

  // Drop one: the tune over the break and the reese riff.
  notes.push(...moved(tune, T0));
  notes.push(...moved(riff, T0));
  for (let b = 0; b < tuneBars; b++) {
    breakbeat(b, T0 + b * 4, b >= 8);
    for (const m of voicing(ch[b % ch.length], 60)) notes.push({ t: T0 + b * 4, d: 3.8, m, v: 0.2, i: 'strings', pan: -0.1 });
  }
  // The second drop answers the tune an octave up, which is the lift a roller wants.
  notes.push(...inRange(tune, 40, 80).map((n) => ({ ...n, t: n.t + T0, m: n.m + 12, i: 'vibes' as Inst, v: n.v * 0.2, pan: 0.35, d: 0.25 })));
  notes.push({ t: T0 + 40, d: 4, m: 0, v: 0.5, i: 'swell' });
  notes.push({ t: T0 + 8 * 4, d: 0.5, m: 0, v: 0.7, i: 'swish' });

  // Outro: the break thins out, the pad holds, and the loop turns over.
  const O0 = T0 + 80;
  for (let b = 0; b < outroBars; b++) {
    breakbeat(b + tuneBars, O0 + b * 4, false);
    for (const m of voicing(ch[(b + 3) % ch.length], 58)) notes.push({ t: O0 + b * 4, d: 4, m, v: 0.3, i: 'strings', pan: 0.1 });
  }

  const trimmed = notes.filter((n) => n.t < beats - 0.001).map((n) => ({ ...n, d: Math.min(n.d, beats - n.t) }));
  return { bpm: 174, loopBeats: beats, beats, swing: 0.5, notes: trimmed, reverb: 0.22 };
}

/**
 * The same tune as acid: one squelchy line of sixteenths on the melody, a root pedal
 * underneath, and a drum machine keeping four on the floor. 130 bpm, which is where
 * the 303 sits best.
 */
export function mainThemeAcid(): Cue {
  const r = rng(303);
  const ch = chart(DANCE_CHART);
  for (const c of ch) if (!QUALITIES[c.q]) c.q = c.q.startsWith('m') ? 'm9' : 'maj9';

  const introBars = 2;
  const outroBars = 2;
  const tuneBars = 20;
  const bars = introBars + tuneBars + outroBars;
  const beats = bars * 4;
  const T0 = introBars * 4;
  const notes: Note[] = [];
  // The acid line is the melody itself; the pedal and the pad carry the harmony.
  const acid = melody(BACKG_JINGLE, 0.25, 'acid', 0, 0.95, r, 0.72, 0);

  for (let b = 0; b < bars; b++) {
    const at = b * 4;
    const inTune = b >= introBars && b < introBars + tuneBars;
    const tuneBar = b - introBars;
    const root = nearest(ch[(inTune ? tuneBar : 0) % ch.length].root, 40) - 12;
    // Four on the floor, with the clap on two and four: the drum machine the 303 wants.
    for (let k = 0; k < 4; k++) notes.push({ t: at + k, d: 0.25, m: 0, v: k % 2 ? 0.82 : 1, i: 'kick' });
    notes.push({ t: at + 1, d: 0.25, m: 0, v: 0.75, i: 'clap' });
    notes.push({ t: at + 3, d: 0.25, m: 0, v: 0.72, i: 'clap' });
    for (let k = 0; k < 4; k++) {
      notes.push({ t: at + k, d: 0.25, m: 0, v: 0.34, i: 'hat' });
      notes.push({ t: at + k + 0.5, d: 0.25, m: 0, v: 0.4, i: 'openhat' });
    }
    if (inTune && tuneBar >= 8) for (const o of [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25]) notes.push({ t: at + o, d: 0.2, m: 0, v: 0.16, i: 'hat' });
    // The pedal: two long notes a bar, then a run of sixteenths once the tune is up.
    if (tuneBar >= 8) for (let k = 0; k < 16; k++) notes.push({ t: at + k * 0.25, d: 0.22, m: root, v: k % 4 ? 0.42 : 0.62, i: 'reese' });
    else {
      notes.push({ t: at, d: 1.6, m: root, v: 0.7, i: 'reese' });
      notes.push({ t: at + 2, d: 1.6, m: root, v: 0.62, i: 'reese' });
    }
    if (b >= introBars && (tuneBar + 1) % 8 == 0) for (let k = 0; k < 8; k++) notes.push({ t: at + 2 + k * 0.25, d: 0.2, m: 0, v: 0.2 + k * 0.06, i: 'snare2' });
    if (inTune) for (const m of voicing(ch[tuneBar % ch.length], 62)) notes.push({ t: at, d: 3.8, m, v: 0.16, i: 'strings', pan: -0.12 });
    // A rave stab on the turn of every eighth bar.
    if (b >= introBars && tuneBar % 8 == 7) for (const m of voicing(ch[tuneBar % ch.length], 64)) notes.push({ t: at + 3.5, d: 0.4, m: m + 12, v: 0.4, i: 'stab', pan: 0.2 });
  }
  notes.push({ t: T0 + 32, d: 4, m: 0, v: 0.55, i: 'swell' });
  notes.push(...moved(acid, T0));
  notes.push({ t: T0 + 80, d: 3, m: 0, v: 0.45, i: 'swish' });

  const trimmed = notes.filter((n) => n.t < beats - 0.001).map((n) => ({ ...n, d: Math.min(n.d, beats - n.t) }));
  return { bpm: 130, loopBeats: beats, beats, swing: 0.5, notes: trimmed, reverb: 0.18 };
}

/** "Popcorn", as a mid-tempo swing for vibes and a Rhodes trio. Two choruses, looped. */
export function mainTheme(): Cue {
  const r = rng(1983);
  const ch = chart(
    `Dm9 | Dm6 | Bbmaj7 | C9 A7susb9 | Dm9 | Dm6 | Bbmaj7 | C9 C9 |
     Fmaj9 | Dm9 | Am9 | G13 C7sus | Fmaj9 | Dm9 | Am9 | G13 C7sus |
     Dm9 | Bbmaj9 | Am9 | G13 A7b13`,
  );
  // Map maj9/m9 aliases.
  for (const c of ch) if (!QUALITIES[c.q]) c.q = c.q.startsWith('m') ? 'm9' : 'maj9';
  const bars = 20;
  const len = bars * 4;
  const notes: Note[] = [];
  // Chorus 1: vibes lead an octave up, brushes.
  notes.push(...melody(BACKG_JINGLE, 0.25, 'vibes', 12, 0.75, r, 0.85, 0.15));
  notes.push(...comp(ch, r, 0.42));
  notes.push(...walk(ch, r, 0.85));
  notes.push(...drums(bars, r, { brushes: true, vel: 0.8, fills: 8 }));
  // Chorus 2: Rhodes takes the tune, vibes shimmer above, sticks on the ride.
  notes.push(...shift(melody(BACKG_JINGLE, 0.25, 'rhodes', 12, 0.7, r, 0.8, 0.1), len));
  notes.push(...shift(melody(BACKG_JINGLE, 0.25, 'vibes', 24, 0.22, r, 0.6, 0.35), len));
  notes.push(...shift(comp(ch, r, 0.38, 'rhodes', 57), len));
  notes.push(...shift(walk(ch, r, 0.9), len));
  notes.push(...shift(drums(bars, r, { brushes: false, vel: 0.75, fills: 4 }), len));
  return { bpm: 168, loopBeats: len * 2, beats: len * 2, swing: 0.64, notes, reverb: 0.22 };
}

/** William Tell galop, as up-tempo hard bop with a muted trumpet. */
export function bonusTheme(): Cue {
  const r = rng(1829);
  const A = `F6 | Gm7 C7 | F6 | Gm7 C7 | F6 | Gm7 C7 | Fmaj9 | C7 F6`;
  const B = `Dm9 | Dm9 | Bbmaj7 | Gm7 A7sus | Dm9 | Dm9 | Dm9 Dm7 | G7 G7`;
  const ch = chart([A, A, B, B].join(' | '));
  const bars = 32;
  const notes: Note[] = [];
  notes.push(...melody(BONUS_JINGLE, 0.25, 'trumpet', 0, 0.8, r, 0.88, 0.05));
  notes.push(...melody(BONUS_JINGLE, 0.25, 'vibes', 12, 0.18, r, 0.5, 0.4));
  // Band "hits" on the long melody notes, plus light comping.
  for (const [at, len, m] of table(BONUS_JINGLE))
    if (m >= 0 && len >= 4) {
      const t = at * 0.25;
      const c = ch.find((c) => t >= c.t && t < c.t + c.d) ?? ch[0];
      for (const v of voicing(c, 62)) notes.push({ t, d: 0.4, m: v, v: 0.4, i: 'rhodes', pan: -0.3 });
      notes.push({ t, d: 0.25, m: 0, v: 0.35, i: 'snare' });
    }
  notes.push(...comp(ch, r, 0.25, 'rhodes', 58));
  notes.push(...walk(ch, r, 0.9));
  notes.push(...drums(bars, r, { brushes: false, vel: 0.9, fills: 8 }));
  return { bpm: 232, loopBeats: bars * 4, beats: bars * 4, swing: 0.62, notes, reverb: 0.16 };
}

/** Chopin's funeral march: a slow, tender piano over strings. */
export function dirge(): Cue {
  const r = rng(1849);
  const notes: Note[] = [];
  // One table unit = a sixteenth at 120 bpm, the original's pace.
  const mel = table(DIRGE).filter(([, , m]) => m >= 0);
  for (const [at, len, m] of mel) {
    const t = at * 0.25;
    notes.push({ t, d: len * 0.25, m, v: 0.6, i: 'piano', pan: 0.1 });
    notes.push({ t, d: len * 0.25, m: m + 12, v: 0.32, i: 'piano', pan: 0.2 });
  }
  const pads: [number, number, number[]][] = [
    [0, 5, [48, 51, 55]],
    [5, 2.5, [44, 48, 51, 55]],
    [7.5, 2, [43, 47, 50, 53]],
    [9.5, 4, [48, 51, 55, 60]],
  ];
  for (const [t, d, ms] of pads) {
    for (const m of ms) notes.push({ t, d, m, v: 0.55, i: 'strings', pan: -0.2 + r() * 0.4 });
    notes.push({ t, d, m: ms[0] - 12, v: 0.7, i: 'bass' });
  }
  return { bpm: 120, loopBeats: 0, beats: 17, swing: 0.5, notes, reverb: 0.35 };
}

/** The level-complete fanfare: rising arpeggios over lush chords. */
export function levelDone(): Cue {
  const notes: Note[] = [];
  const ms = NEWLEV_JINGLE.map(divToMidi);
  const step = 0.5;
  ms.forEach((m, k) => {
    const last = k == ms.length - 1;
    notes.push({ t: k * step, d: last ? 3 : step * 1.6, m, v: 0.7, i: 'vibes', pan: 0.2 });
  });
  const chords: [number, number, number[]][] = [
    [0, 1.5, [48, 52, 55, 59]],
    [1.5, 1.5, [50, 53, 57, 60]],
    [3, 1.5, [52, 55, 59, 62]],
    [4.5, 3.5, [48, 52, 55, 59, 62]],
  ];
  for (const [t, d, c] of chords) {
    for (const m of c) notes.push({ t, d, m, v: 0.45, i: 'rhodes', pan: -0.2 });
    notes.push({ t, d, m: c[0] - 12, v: 0.8, i: 'bass' });
  }
  notes.push({ t: 2.5, d: 2, m: 0, v: 0.8, i: 'swell' });
  notes.push({ t: 4.5, d: 0.25, m: 0, v: 0.6, i: 'ride' });
  notes.push({ t: 4.5, d: 0.25, m: 0, v: 0.5, i: 'kick' });
  return { bpm: 104, loopBeats: 0, beats: 11, swing: 0.5, notes, reverb: 0.3 };
}
