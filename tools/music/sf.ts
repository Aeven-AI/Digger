// Soundfont bridge: fetch the FluidR3 GM soundfont once, render a MIDI file through
// FluidSynth, and read the result back as a stereo bus.
//
// The soundfont is FluidR3Mono GM, MIT licensed (Frank Wen, Michael Cowgill); the
// rendered tracks therefore carry no sample licence of their own beyond that notice,
// which README.md repeats. It is downloaded into tmp/ rather than committed: it is 23 MB
// and only the build needs it.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { SR, type Bus } from './dsp';

const DEB = 'https://ftp.debian.org/debian/pool/main/f/fluidr3mono-gm-soundfont/fluidr3mono-gm-soundfont_2.315-7_all.deb';
const INSIDE = 'usr/share/fluidr3mono-gm-soundfont/FluidR3Mono_GM.sf3';

function run(cmd: string, args: string[], cwd: string): void {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.error) throw new Error(`${cmd} is required to build the soundfont: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
}

/**
 * Returns the soundfont path, downloading and unpacking it on first use.
 * @param dest where to keep it
 * @returns the path to the .sf3 file
 */
export function ensureSoundfont(dest: string): string {
  if (existsSync(dest)) return dest;
  mkdirSync(dirname(dest), { recursive: true });
  const dl = join(dirname(dest), 'fluidr3.deb');
  console.log(`downloading FluidR3Mono GM (MIT) -> ${dl}`);
  run('curl', ['-fsSL', '-o', dl, DEB], dirname(dest));
  run('ar', ['x', 'fluidr3.deb'], dirname(dest));
  run('tar', ['xf', 'data.tar.xz'], dirname(dest));
  const found = join(dirname(dest), INSIDE);
  if (!existsSync(found)) throw new Error(`${INSIDE} missing from the FluidR3 package`);
  writeFileSync(dest, readFileSync(found));
  return dest;
}

/**
 * Renders `midi` through `sf3` with FluidSynth.
 * @param sf3 soundfont path
 * @param midi MIDI file bytes
 * @param work directory for the temporary .mid and .wav
 * @returns the path of the rendered WAV
 */
export function renderMidi(sf3: string, midi: Uint8Array, work: string): string {
  mkdirSync(work, { recursive: true });
  const mid = resolve(work, 'part.mid');
  const wav = resolve(work, 'part.wav');
  writeFileSync(mid, midi);
  run('fluidsynth', ['-ni', '-F', wav, '-r', String(SR), '-O', 's16', '-g', '0.8', resolve(sf3), mid], work);
  return wav;
}

/**
 * Reads a 16-bit PCM WAV into a stereo bus of exactly `seconds` samples, padded with
 * silence or truncated as needed.
 * @param path WAV file, 44100 Hz, 2 channels, Int16
 * @param seconds length the mixdown expects
 * @returns the bus
 */
export function readWav(path: string, seconds: number): Bus {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${path} is not a WAV file`);
  let at = 12;
  let data = -1;
  let length = 0;
  let channels = 2;
  while (at + 8 <= b.length) {
    const id = b.toString('ascii', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === 'fmt ') channels = b.readUInt16LE(at + 10);
    if (id === 'data') {
      data = at + 8;
      length = size;
      break;
    }
    at += 8 + size + (size % 2);
  }
  if (data < 0) throw new Error(`${path} has no data chunk`);

  const n = Math.ceil(seconds * SR) + 8;
  const out: Bus = { L: new Float32Array(n), R: new Float32Array(n) };
  const frames = Math.min(Math.floor(length / 2 / channels), n);
  for (let i = 0; i < frames; i++) {
    if (channels === 1) {
      const s = b.readInt16LE(data + i * 2) / 32768;
      out.L[i] = s;
      out.R[i] = s;
    } else {
      out.L[i] = b.readInt16LE(data + i * channels * 2) / 32768;
      out.R[i] = b.readInt16LE(data + (i * channels + 1) * 2) / 32768;
    }
  }
  return out;
}
