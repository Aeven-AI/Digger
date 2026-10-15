// The 2027 theme is meant to be the 1983 tune arranged as a real dance track:
// these checks hold it to the melody, the form and the beat.
import { describe, expect, it } from 'vitest';
import { mainTheme2027, mainThemeAcid, mainThemeBreaks, type Cue } from '../src/audio/hd/compose';
import { BACKG_JINGLE, PIT_HZ } from '../src/audio/tunes';

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const divToMidi = (d: number) => Math.round(69 + 12 * Math.log2(PIT_HZ / d / 440));

/** The 1983 table as [start in beats, midi | -1], at the unit the arrangements use. */
function tableLine(): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (let i = 0; i + 1 < BACKG_JINGLE.length && BACKG_JINGLE[i] != 0x7d64; i += 2) {
    const div = BACKG_JINGLE[i];
    out.push([at * 0.25, div >= 0x7d00 ? -1 : divToMidi(div)]);
    at += BACKG_JINGLE[i + 1];
  }
  return out;
}

const line = (cue: Cue, inst: string, transpose = 0) =>
  cue.notes
    .filter((n) => n.i == inst)
    .map((n) => [Number(n.t.toFixed(4)), n.m - transpose] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

const INTRO = 8; // beats before the tune lands: two bars
const TUNE = 80; // beats of the 1983 tune

describe('the 2027 main theme', () => {
  it('plays the 1983 melody note for note', () => {
    const expected = tableLine().filter(([, m]) => m >= 0);
    const lead = line(mainTheme2027(), 'lead');
    expect(lead.map(([t, m]) => [Number((t - INTRO).toFixed(4)), m])).toEqual(expected);
  });

  it('is a dance track: club tempo, song form, four on the floor', () => {
    const c = mainTheme2027();
    expect(c.bpm).toBe(126);
    expect(c.swing).toBe(0.5); // straight, not swung
    expect(c.loopBeats).toBe(96); // 24 bars: 2 intro, the 20-bar tune, 2 outro
    expect(c.beats).toBe(c.loopBeats);
    const kicks = c.notes.filter((n) => n.i == 'kick').map((n) => n.t);
    for (let b = 0; b < 20; b++) {
      if (b == 8 || b == 9) continue; // the two-bar break drops the kick on purpose
      for (const k of [0, 1, 2, 3]) {
        const t = INTRO + b * 4 + k;
        expect(kicks.some((x) => Math.abs(x - t) < 1e-6)).toBe(true);
      }
    }
  });

  it('has a full kit, and the riff bass under the tune', () => {
    const c = mainTheme2027();
    const insts = new Set(c.notes.map((n) => n.i));
    for (const i of ['kick', 'snare', 'clap', 'hat', 'swish', 'synthbass', 'lead', 'rhodes', 'vibes', 'strings', 'swell']) {
      expect([...insts]).toContain(i);
    }
    const expected = tableLine().filter(([, m]) => m >= 0);
    const bass = c.notes.filter((n) => n.i == 'synthbass' && n.t >= INTRO && n.t < INTRO + TUNE);
    for (const [t, m] of expected) {
      const abs = t + INTRO;
      // The riff is folded into the low register (-12 or -24); the off-beat stabs
      // sit an octave above the riff.
      expect(bass.some((n) => Math.abs(n.t - abs) < 1e-6 && [m, m - 12, m - 24].includes(n.m))).toBe(true);
    }
    expect(bass.some((n) => Math.abs((n.t % 1) - 0.5) < 1e-6)).toBe(true);
  });

  it('keeps the melody consonant with the chart, bar by bar', () => {
    const bars = new Map<number, Set<string>>();
    for (const [t, m] of tableLine()) {
      if (m < 0) continue;
      const bar = Math.floor(t / 4);
      if (!bars.has(bar)) bars.set(bar, new Set());
      bars.get(bar)!.add(NAMES[m % 12]);
    }
    expect(bars.size).toBe(20);
    expect([...bars.get(0)!].sort()).toEqual(['A', 'C', 'D', 'F']);
    expect([...bars.get(3)!].sort()).toEqual(['Bb', 'C', 'D', 'E']);
    expect([...bars.get(8)!].sort()).toEqual(['A', 'C', 'F', 'G']);
    expect([...bars.get(11)!].sort()).toEqual(['A', 'B', 'F', 'G']);
  });
});

describe('the drum-and-bass reading', () => {
  it('plays the 1983 melody note for note', () => {
    const expected = tableLine().filter(([, m]) => m >= 0);
    const lead = line(mainThemeBreaks(), 'lead');
    expect(lead.map(([t, m]) => [Number((t - INTRO).toFixed(4)), m])).toEqual(expected);
  });

  it('rolls at 174 with a two-step break and the riff in the bass', () => {
    const c = mainThemeBreaks();
    expect(c.bpm).toBe(174);
    expect(c.loopBeats).toBe(96);
    expect(c.swing).toBe(0.5);
    const kicks = c.notes.filter((n) => n.i == 'kick2').map((n) => n.t);
    const snares = c.notes.filter((n) => n.i == 'snare2' && n.v > 0.5).map((n) => n.t);
    for (let b = 0; b < 24; b++) {
      expect(kicks.some((x) => Math.abs(x - b * 4) < 1e-6)).toBe(true);
      for (const beat of [1, 3]) expect(snares.some((x) => Math.abs(x - (b * 4 + beat)) < 1e-6)).toBe(true);
    }
    // The riff is the tune an octave down, in the new bass voice.
    const expected = tableLine().filter(([, m]) => m >= 0);
    const bass = c.notes.filter((n) => n.i == 'reese' && n.t >= INTRO);
    for (const [t, m] of expected) expect(bass.some((n) => Math.abs(n.t - (t + INTRO)) < 1e-6 && [m - 12, m - 24].includes(n.m))).toBe(true);
  });
});

describe('the acid reading', () => {
  it('plays the 1983 melody note for note on the acid line', () => {
    const expected = tableLine().filter(([, m]) => m >= 0);
    const acid = line(mainThemeAcid(), 'acid');
    expect(acid.map(([t, m]) => [Number((t - INTRO).toFixed(4)), m])).toEqual(expected);
  });

  it('is a drum machine at 130, four on the floor, with a sixteenth pedal', () => {
    const c = mainThemeAcid();
    expect(c.bpm).toBe(130);
    expect(c.loopBeats).toBe(96);
    const kicks = c.notes.filter((n) => n.i == 'kick').map((n) => n.t);
    for (let k = 0; k < 96; k++) expect(kicks.some((x) => Math.abs(x - k) < 1e-6)).toBe(true);
    const pedal = c.notes.filter((n) => n.i == 'reese');
    expect(pedal.length).toBeGreaterThan(200);
    expect(c.notes.some((n) => n.i == 'openhat')).toBe(true);
    expect(c.notes.some((n) => n.i == 'stab')).toBe(true);
  });
});
