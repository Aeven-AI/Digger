// Renders a theme through a General MIDI soundfont, so the 2027 readings are played by
// sampled instruments — a real drum kit, fingered basses, a clavinet — instead of the
// hand-written oscillators. The arrangement still comes from src/audio/hd/compose.ts, so
// the baked track and the live synthesis cannot drift apart in melody or form.
//
//   npx rolldown tools/music/render-real.ts -o tmp/music/render-real.mjs --format esm --platform node
//   node tmp/music/render-real.mjs 2027 <out.wav>
//
// Needs `fluidsynth` on PATH and unpacks the MIT-licensed FluidR3Mono GM soundfont into
// tmp/music on first run. The rendered tracks are deterministic: same input, same bytes.

import { mkdirSync, writeFileSync } from 'node:fs';
import { mainTheme2027, type Cue, type Inst } from '../../src/audio/hd/compose';
import * as D from './dsp';
import { GROUP, GROUPS, INSTRUMENTS, beatTime, mixdown, type Group } from './mix';
import { smf, type MidiPart } from './midi';
import { ensureSoundfont, readWav, renderMidi } from './sf';

const TRACKS: Record<string, { cue: () => Cue; name: string }> = {
  '2027': { cue: mainTheme2027, name: 'club' },
};

/** General MIDI program per instrument, 0-based. */
const PROGRAM: Partial<Record<Inst, number>> = {
  bass: 33,
  synthbass: 37,
  reese: 38,
  acid: 86,
  lead: 81,
  trumpet: 56,
  strings: 48,
  rhodes: 4,
  piano: 0,
  vibes: 11,
  stab: 7,
};

/** General MIDI percussion note per drum instrument, and how a hit spans its duration. */
const DRUM: Partial<Record<Inst, { note: number; hits: number; pan: number }>> = {
  kick: { note: 36, hits: 1, pan: 0 },
  kick2: { note: 35, hits: 1, pan: 0 },
  snare: { note: 38, hits: 1, pan: -0.05 },
  snare2: { note: 40, hits: 1, pan: 0.05 },
  clap: { note: 39, hits: 1, pan: 0.1 },
  hat: { note: 42, hits: 1, pan: 0.16 },
  openhat: { note: 46, hits: 1, pan: 0.2 },
  ride: { note: 51, hits: 1, pan: 0.24 },
  brush: { note: 54, hits: 1, pan: 0.3 },
  swish: { note: 49, hits: 1, pan: -0.2 },
  swell: { note: 52, hits: 12, pan: -0.24 },
};

const id = process.argv[2] ?? '2027';
const out = process.argv[3] ?? `tmp/music/digger-${id}.wav`;
const track = TRACKS[id];
if (!track) throw new Error(`unknown track "${id}"; expected one of ${Object.keys(TRACKS).join(', ')}`);

const cue = track.cue();
const spb = 60 / cue.bpm;
const loopSec = (cue.loopBeats / cue.bpm) * 60;
const tailSec = 2.6;
const total = loopSec + tailSec;

const sf3 = ensureSoundfont(process.env.AEVEN_SOUNDFONT ?? 'tmp/music/FluidR3Mono_GM.sf3');

/** Melodic instruments get a channel each; the drum kit owns channel 10. */
const FREE_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
const channelOf = new Map<Inst, number>();
let next = 0;
for (const i of INSTRUMENTS) {
  if (GROUP[i] === 'drums') continue;
  const ch = FREE_CHANNELS[next++];
  if (ch == null) throw new Error('more instruments than MIDI channels');
  channelOf.set(i, ch);
}

const parts: Record<Group, MidiPart[]> = { drums: [], bass: [], lead: [], keys: [] };
const byInst = new Map<Inst, MidiPart>();
const kicks: number[] = [];

for (const n of cue.notes) {
  const group = GROUP[n.i];
  if (!group) continue;
  const at = beatTime(cue, n.t);
  if (at >= total) continue;
  const dur = Math.min(n.d * spb, total - at);

  const drum = DRUM[n.i];
  if (drum) {
    let part = byInst.get(n.i);
    if (!part) {
      part = { ch: 9, program: 0, pan: drum.pan, notes: [] };
      byInst.set(n.i, part);
      parts.drums.push(part);
    }
    for (let h = 0; h < drum.hits; h++) {
      const step = dur / drum.hits;
      part.notes.push({ t: at + h * step, d: Math.min(step, 0.2), m: drum.note, v: n.v * (0.35 + (0.65 * (h + 1)) / drum.hits) });
    }
    if (n.i === 'kick' || n.i === 'kick2') kicks.push(Math.round(at * D.SR));
    continue;
  }

  const program = PROGRAM[n.i];
  const ch = channelOf.get(n.i);
  if (program == null || ch == null) continue;
  let part = byInst.get(n.i);
  if (!part) {
    part = { ch, program, pan: n.pan ?? 0, notes: [] };
    byInst.set(n.i, part);
    parts[group].push(part);
  }
  part.notes.push({ t: at, d: dur, m: n.m, v: n.v });
}

const buses: Record<Group, D.Bus> = { drums: D.bus(total), bass: D.bus(total), lead: D.bus(total), keys: D.bus(total) };
const work = `tmp/music/${id}`;
mkdirSync(work, { recursive: true });
// A soundfont plays at the level its samples were recorded at, which is well under the
// oscillators' full-scale output; this brings the stems up to where the shared mix
// expects them, before the limiter rather than after it.
const PRE: Record<Group, number> = { drums: 2.2, bass: 2.4, lead: 2.6, keys: 2.3 };
for (const g of GROUPS) {
  const ps = parts[g].filter((p) => p.notes.length > 0);
  if (!ps.length) continue;
  buses[g] = readWav(renderMidi(sf3, smf(ps, cue.bpm), `${work}/${g}`), total);
  D.scale(buses[g], PRE[g]);
}

const master = mixdown(cue, buses, kicks);
// A sampled arrangement can be far sparser than the synthesized one (an acid line and a
// pedal have little sustaining energy), so match the three readings to one loudness.
const TARGET_RMS = -12;
const rms = D.rmsDb(master);
if (rms < TARGET_RMS) {
  D.scale(master, Math.pow(10, (TARGET_RMS - rms) / 20));
  D.limit(master, 0.9);
  D.normalizePeak(master, -3);
}
const frames = Math.round(loopSec * D.SR);
writeFileSync(out, D.wavBytes(master, frames));

const bar = 4 * spb;
const sections: string[] = [];
for (let b = 0; b < cue.beats / 4; b++) {
  const from = Math.round(b * bar * D.SR);
  const to = Math.round((b + 1) * bar * D.SR);
  sections.push(D.rmsDb({ L: master.L.slice(from, to), R: master.R.slice(from, to) }).toFixed(1));
}

console.log(
  JSON.stringify(
    {
      id,
      track: track.name,
      out,
      renderer: 'soundfont',
      seconds: loopSec,
      bars: cue.beats / 4,
      bpm: cue.bpm,
      notes: cue.notes.length,
      kicks: kicks.length,
      parts: GROUPS.map((g) => `${g}:${parts[g].reduce((a, p) => a + p.notes.length, 0)}`).join(' '),
      rmsDb: D.rmsDb(master),
      barsRmsDb: sections.join(' '),
      bytes: frames * 4 + 44,
    },
    null,
    1,
  ),
);
