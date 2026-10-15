// Brings the licensed songs into the game: downloads each source file from the Internet
// Archive, folds the tail over the head so it loops without a seam, matches it to the
// loudness of the rendered tracks, and encodes it to Opus beside them.
//
//   npx rolldown tools/music/songs.ts -o tmp/music/songs.mjs --format esm --platform node
//   node tmp/music/songs.mjs [id ...]        # default: every song in SONGS
//
// Sources are not committed: only the encoded loop is. Each song keeps its licence and
// credit, listed here and in README.md. The CC0 tracks carry no conditions; the CC BY
// tracks must be credited where the game is distributed.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as D from './dsp';
import { readWav } from './sf';

interface Song {
  /** Theme id, matching MusicTheme and the file name in public/audio. */
  id: string;
  title: string;
  artist: string;
  licence: string;
  /** Internet Archive item and the file inside it. */
  item: string;
  file: string;
}

export const SONGS: Song[] = [
  {
    id: 'novahead',
    title: 'Fractured Light',
    artist: 'nova head',
    licence: 'CC0 1.0',
    item: 'nova-head-fractured-light',
    file: 'nova head - Fractured Light v2.mp3',
  },
  {
    id: 'shegal',
    title: 'Pixel gangster Mario is drinking in Miami',
    artist: 'Vlad Shegal',
    licence: 'CC BY 3.0',
    item: 'fsr017',
    file: 'Vlad Shegal - Pixel gangster Mario is drinking in Miami.mp3',
  },
  {
    id: 'nihilore',
    title: 'The Water and the Well',
    artist: 'Nihilore',
    licence: 'CC BY 4.0',
    item: 'nihilore-broken-parts',
    file: 'Nihilore - Broken Parts - 04 The Water and the Well.mp3',
  },
];

/** Loop length of a song, in seconds, and the tail folded back over its head. */
const LOOP = 180;
const TAIL = 3;
/** Loudness the rendered tracks sit at, so a song change does not jump in level. */
const TARGET_RMS = -13;

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error) throw new Error(`${cmd} is required: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr}`);
}

const source = (s: Song) => `tmp/music/songs/${s.id}.mp3`;

function download(s: Song): string {
  const dest = source(s);
  if (existsSync(dest)) return dest;
  mkdirSync('tmp/music/songs', { recursive: true });
  run('curl', ['-fsSL', '-o', dest, `https://archive.org/download/${s.item}/${encodeURIComponent(s.file)}`]);
  return dest;
}

const wanted = process.argv.slice(2);
const todo = wanted.length ? SONGS.filter((s) => wanted.includes(s.id)) : SONGS;
if (!todo.length) throw new Error(`no song matched ${wanted.join(', ')}; known: ${SONGS.map((s) => s.id).join(', ')}`);

for (const s of todo) {
  const mp3 = download(s);
  const raw = resolve(`tmp/music/songs/${s.id}.wav`);
  // Decode one tail's worth beyond the loop, so the fold has something to work with.
  run('ffmpeg', ['-y', '-v', 'error', '-i', mp3, '-t', String(LOOP + TAIL), '-ar', String(D.SR), '-ac', '2', '-c:a', 'pcm_s16le', raw]);
  const bus = readWav(raw, LOOP + TAIL);

  // Fold: the head is crossfaded into the tail, so the end of the loop runs back into
  // the start without a jump and the last bar is not cut off mid-phrase.
  const n = Math.round(LOOP * D.SR);
  const t = Math.round(TAIL * D.SR);
  for (let i = 0; i < t; i++) {
    const w = i / t;
    bus.L[i] = bus.L[i] * w + bus.L[n + i] * (1 - w);
    bus.R[i] = bus.R[i] * w + bus.R[n + i] * (1 - w);
  }
  const loop: D.Bus = { L: bus.L.subarray(0, n), R: bus.R.subarray(0, n) };

  const rms = D.rmsDb(loop);
  D.scale(loop, Math.pow(10, (TARGET_RMS - rms) / 20));
  D.limit(loop, 0.95);
  D.normalizePeak(loop, -1.5);

  const wav = `tmp/music/songs/${s.id}-loop.wav`;
  writeFileSync(wav, D.wavBytes(loop, n));
  const out = `public/audio/digger-${s.id}.opus`;
  run('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-c:a', 'libopus', '-b:a', '96k', '-application', 'audio', out]);

  console.log(
    JSON.stringify({
      id: s.id,
      artist: s.artist,
      title: s.title,
      licence: s.licence,
      source: `https://archive.org/details/${s.item}`,
      loopSeconds: LOOP,
      rmsDb: Number(D.rmsDb(loop).toFixed(2)),
      out,
    }),
  );
}
