// A Standard MIDI File writer, just wide enough for the soundfont renderer: one
// track per part, absolute time in seconds converted to ticks at a fixed tempo.

/** One part: a MIDI channel with a General MIDI program and its notes. */
export interface MidiPart {
  ch: number;
  /** General MIDI program, 0-based (0 = Acoustic Grand Piano). */
  program: number;
  /** Stereo position, -1 left .. 1 right. */
  pan: number;
  notes: { t: number; d: number; m: number; v: number }[];
}

const PPQ = 960;

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  let v = n >> 7;
  while (v > 0) {
    out.push((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return out.reverse();
}

/**
 * Writes `parts` as a format-0 MIDI file.
 * @param parts parts to write, one channel each
 * @param bpm tempo, which fixes the tick length
 * @returns the file bytes
 */
export function smf(parts: MidiPart[], bpm: number): Uint8Array {
  const secPerTick = 60 / bpm / PPQ;
  type Ev = { tick: number; bytes: number[]; order: number };
  const evs: Ev[] = [];

  for (const p of parts) {
    const pan = Math.max(0, Math.min(127, Math.round((p.pan + 1) * 63.5)));
    evs.push({ tick: 0, bytes: [0xc0 | p.ch, p.program], order: 0 });
    evs.push({ tick: 0, bytes: [0xb0 | p.ch, 10, pan], order: 0 });
    for (const n of p.notes) {
      const on = Math.max(0, Math.round(n.t / secPerTick));
      const off = Math.max(on + 1, Math.round((n.t + n.d) / secPerTick));
      const vel = Math.max(1, Math.min(127, Math.round(n.v * 127)));
      // Note-offs sort before note-ons at the same tick, so a repeated pitch retriggers.
      evs.push({ tick: off, bytes: [0x80 | p.ch, n.m, 0], order: 1 });
      evs.push({ tick: on, bytes: [0x90 | p.ch, n.m, vel], order: 2 });
    }
  }
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const data: number[] = [];
  data.push(...vlq(0), 0xff, 0x51, 3, (Math.round(60000000 / bpm) >> 16) & 0xff, (Math.round(60000000 / bpm) >> 8) & 0xff, Math.round(60000000 / bpm) & 0xff);
  let last = 0;
  for (const e of evs) {
    data.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  data.push(...vlq(0), 0xff, 0x2f, 0x00);

  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff];
  const len = data.length;
  const track = [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
  return Uint8Array.from([...head, ...track, ...data]);
}
