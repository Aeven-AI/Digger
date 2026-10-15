// Renders a theme to a loopable audio file. The arrangements come from
// src/audio/hd/compose.ts, the same cues the live Web Audio backend plays, so a
// pre-rendered track and its fallback synthesis cannot drift apart.
//
//   npx rolldown tools/music/render-track.ts -o tmp/music/render-track.mjs --format esm --platform node
//   node tmp/music/render-track.mjs <2027|breaks|acid> <out.wav>
//
// The samples are deterministic, so re-running reproduces the same file. `npm run music`
// renders all three and encodes them into public/audio.

import { writeFileSync } from 'node:fs';
import { mainTheme2027, mainThemeAcid, mainThemeBreaks, type Cue, type Inst } from '../../src/audio/hd/compose';
import * as D from './dsp';
import * as V from './voices';

const TRACKS: Record<string, { cue: () => Cue; name: string }> = {
  '2027': { cue: mainTheme2027, name: 'club' },
  breaks: { cue: mainThemeBreaks, name: 'drum and bass' },
  acid: { cue: mainThemeAcid, name: 'acid' },
};

const id = process.argv[2] ?? '2027';
const out = process.argv[3] ?? `tmp/music/digger-${id}.wav`;
const track = TRACKS[id];
if (!track) throw new Error(`unknown track "${id}"; expected one of ${Object.keys(TRACKS).join(', ')}`);

const cue = track.cue();
const spb = 60 / cue.bpm;
const loopSec = cue.beats * spb;
const tailSec = 2.6;
const total = loopSec + tailSec;

/** Drums stand alone; the rest are grouped so each group gets its own processing. */
type Group = 'drums' | 'bass' | 'lead' | 'keys';
const GROUP: Partial<Record<Inst, Group>> = {
  kick: 'drums',
  kick2: 'drums',
  snare: 'drums',
  snare2: 'drums',
  clap: 'drums',
  hat: 'drums',
  openhat: 'drums',
  ride: 'drums',
  brush: 'drums',
  swish: 'drums',
  swell: 'drums',
  synthbass: 'bass',
  bass: 'bass',
  reese: 'bass',
  lead: 'lead',
  acid: 'lead',
  trumpet: 'lead',
  rhodes: 'keys',
  vibes: 'keys',
  strings: 'keys',
  piano: 'keys',
  stab: 'keys',
};

const VOICE: Partial<Record<Inst, V.Voice>> = {
  kick: V.kick,
  kick2: V.kick2,
  snare: V.snare,
  snare2: V.snare2,
  clap: V.clap,
  hat: V.hat,
  openhat: V.openHat,
  ride: V.ride,
  brush: V.hat,
  swish: V.swish,
  swell: V.swell,
  lead: V.lead,
  acid: V.acid,
  trumpet: V.lead,
  synthbass: V.synthbass,
  bass: V.synthbass,
  reese: V.reese,
  rhodes: V.rhodes,
  piano: V.rhodes,
  vibes: V.vibes,
  strings: V.pad,
  stab: V.stab,
};

const buses: Record<Group, D.Bus> = {
  drums: D.bus(total),
  bass: D.bus(total),
  lead: D.bus(total),
  keys: D.bus(total),
};

/** Swing shifts the off-beat eighth later in the beat; 0.5 is straight. */
const at = (beat: number) => (beat % 1 === 0.5 ? beat + (cue.swing - 0.5) : beat) * spb;

let placed = 0;
const kicks: number[] = [];
for (const n of cue.notes) {
  const group = GROUP[n.i];
  const voice = VOICE[n.i];
  if (!group || !voice) continue;
  const i0 = Math.round(at(n.t) * D.SR);
  if (i0 >= Math.round(total * D.SR)) continue;
  voice(buses[group], i0, { dur: n.d * spb * D.SR, vel: n.v, midi: n.m, pan: n.pan ?? 0 });
  placed++;
  if (n.i === 'kick' || n.i === 'kick2') kicks.push(i0);
}

// The kick pulls the low end of everything else out of its way: without this the bass
// and the pad fight the drum and the mix turns to mud on every beat.
const curve = new Float32Array(buses.bass.L.length).fill(1);
const duckDepth = cue.bpm > 150 ? 0.5 : 0.62;
for (const k of kicks) D.duck(curve, k, duckDepth, 0.005, cue.bpm > 150 ? 0.09 : 0.13);
for (let i = 0; i < curve.length; i++) {
  const g = curve[i];
  if (g === 1) continue;
  buses.bass.L[i] *= g;
  buses.bass.R[i] *= g;
  buses.lead.L[i] *= g;
  buses.lead.R[i] *= g;
  buses.keys.L[i] *= (1 + g) / 2;
  buses.keys.R[i] *= (1 + g) / 2;
}

const wet = 0.7 + cue.reverb * 2;
const verbSend = D.bus(total);
D.mixInto(verbSend, buses.drums, 0.16 * wet);
D.mixInto(verbSend, buses.keys, 0.34 * wet);
D.mixInto(verbSend, buses.lead, 0.22 * wet);
const verb = D.reverb(verbSend, total, 0.82, 0.3);

// A three-sixteenth throw on the lead: the dub tail a club mix would print.
const delay = D.pingPong(buses.lead, total, (spb * 3) / 4, 0.4);
D.scale(delay, 0.22);

const master = D.bus(total);
D.mixInto(master, buses.drums, 1.0);
D.mixInto(master, buses.bass, 0.8);
D.mixInto(master, buses.lead, 0.95);
D.mixInto(master, buses.keys, 0.7);
D.mixInto(master, delay, 1.0);
D.mixInto(master, verb, 0.9);
// Headroom before the limiter: the mix gives up about four decibels here, so the
// drum transients survive the mastering instead of being flattened into it.
D.scale(master, 0.62);

// The tail folds back over the head, so the loop repeats without a seam.
D.wrapTail(master, loopSec, tailSec);

// Master chain: clear the rumble, lift the air, saturate, then hold the peaks.
const hpL = new D.Bq(D.biquad('hp', 28, 0.7));
const hpR = new D.Bq(D.biquad('hp', 28, 0.7));
const airL = new D.Bq(D.biquad('peak', 7500, 0.8, D.SR, 2.2));
const airR = new D.Bq(D.biquad('peak', 7500, 0.8, D.SR, 2.2));
const mudL = new D.Bq(D.biquad('peak', 320, 0.9, D.SR, -1.6));
const mudR = new D.Bq(D.biquad('peak', 320, 0.9, D.SR, -1.6));
for (let i = 0; i < master.L.length; i++) {
  master.L[i] = airL.run(mudL.run(hpL.run(master.L[i])));
  master.R[i] = airR.run(mudR.run(hpR.run(master.R[i])));
}
D.softClip(master, 1.25, 1);
D.limit(master, 0.9);
// Leave the encode about 3 dB of headroom: a lossy decoder overshoots the peak.
D.normalizePeak(master, -3);

const frames = Math.round(loopSec * D.SR);
writeFileSync(out, D.wavBytes(master, frames));

const bar = 4 * spb;
const sections: string[] = [];
for (let b = 0; b < cue.beats / 4; b++) {
  const from = Math.round(b * bar * D.SR);
  const to = Math.round((b + 1) * bar * D.SR);
  const slice: D.Bus = { L: master.L.slice(from, to), R: master.R.slice(from, to) };
  sections.push(D.rmsDb(slice).toFixed(1));
}

console.log(
  JSON.stringify(
    {
      id,
      track: track.name,
      out,
      seconds: loopSec,
      bars: cue.beats / 4,
      bpm: cue.bpm,
      notes: placed,
      kicks: kicks.length,
      rmsDb: D.rmsDb(master),
      barsRmsDb: sections.join(' '),
      bytes: frames * 4 + 44,
    },
    null,
    1,
  ),
);
