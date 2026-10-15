// The mix the pre-rendered tracks share, whether their notes come from the
// synthesized voices or from a soundfont. Both renderers hand in one bus per group.

import type { Cue, Inst } from '../../src/audio/hd/compose';
import * as D from './dsp';

/** Drums stand alone; the rest are grouped so each group gets its own processing. */
export type Group = 'drums' | 'bass' | 'lead' | 'keys';

export const GROUPS: Group[] = ['drums', 'bass', 'lead', 'keys'];

export const GROUP: Partial<Record<Inst, Group>> = {
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

/** Every instrument, in the order the renderers walk them. */
export const INSTRUMENTS: Inst[] = [
  'kick',
  'kick2',
  'snare',
  'snare2',
  'clap',
  'hat',
  'openhat',
  'ride',
  'brush',
  'swish',
  'swell',
  'bass',
  'synthbass',
  'reese',
  'lead',
  'acid',
  'trumpet',
  'rhodes',
  'vibes',
  'strings',
  'piano',
  'stab',
];

/** Swing shifts the off-beat eighth later in the beat; 0.5 is straight. */
export function beatTime(cue: Cue, beat: number): number {
  const spb = 60 / cue.bpm;
  return (beat % 1 === 0.5 ? beat + (cue.swing - 0.5) : beat) * spb;
}

/**
 * Balances the four groups, ducks the melodic ones under each kick, and masters the
 * result: a club-style mixdown for the loopable themes.
 * @param cue the arrangement, for tempo and reverb amount
 * @param buses one bus per group, all the same length
 * @returns the mastered stereo bus
 */
export function mixdown(cue: Cue, buses: Record<Group, D.Bus>, kicks: number[]): D.Bus {
  const total = buses.drums.L.length / D.SR;
  const spb = 60 / cue.bpm;

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

  const loopSec = (cue.loopBeats / cue.bpm) * 60;
  // The tail folds back over the head, so the loop repeats without a seam.
  D.wrapTail(master, loopSec, total - loopSec);

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
  return master;
}
