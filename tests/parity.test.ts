// Behavioural parity: runs the reference JS port from old/ (local only, gitignored)
// and the new sim on the same seed and the same scripted input, and compares the
// virtual framebuffer and score after every gameplay tick.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Game } from '../src/sim/game';
import type { Key } from '../src/sim/input';

const OLD = new URL('../old/src/', import.meta.url);
const hasOld = existsSync(new URL('Main.js', OLD));

const FILES = ['Bags', 'Drawing', 'Input', 'Main', 'Monster', 'Pc', 'Scores', 'Sound', 'Sprite', 'Digger', 'alpha', 'cgagrafx'];

type Timer = { id: number; at: number; every: number; fn: () => void };

function loadOld() {
  let now = 0;
  let nextId = 1;
  let timers: Timer[] = [];
  const el = () => ({ appendChild() {}, style: {}, offsetWidth: 640, offsetHeight: 400 });
  const canvas = () => ({
    ...el(),
    width: 0,
    height: 0,
    getContext: () => ({
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
      drawImage() {},
    }),
  });
  const ctx: Record<string, unknown> = {
    console,
    Math,
    Promise,
    Date: { now: () => 0 },
    window: { localStorage: { getItem: () => null, setItem() {} } },
    document: { getElementById: (id: string) => (id == 'dcont' ? el() : null), createElement: canvas },
    setInterval: (fn: () => void, ms: number) => {
      timers.push({ id: nextId, at: now + ms, every: ms, fn });
      return nextId++;
    },
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ id: nextId, at: now + ms, every: 0, fn });
      return nextId++;
    },
    clearInterval: (id: number) => {
      timers = timers.filter((t) => t.id != id);
    },
  };
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(readFileSync(new URL(f + '.js', OLD), 'utf8'), ctx, { filename: f + '.js' });
  async function runNext(): Promise<boolean> {
    if (!timers.length) return false;
    timers.sort((a, b) => a.at - b.at || a.id - b.id);
    const t = timers[0];
    now = t.at;
    if (t.every) t.at += t.every;
    else timers.shift();
    t.fn();
    await new Promise((r) => setImmediate(r));
    return true;
  }
  return { ctx: ctx as any, runNext };
}

const KEYCODES: Record<Key, [number, number]> = {
  left: [0x4b, 0xcb],
  right: [0x4d, 0xcd],
  up: [0x48, 0xc8],
  down: [0x50, 0xd0],
  fire: [0x3b, 0xbb],
};

/** Deterministic scripted input: holds a random direction for a while, fires occasionally. */
function script(seed: number, ticks: number) {
  let s = seed;
  const rnd = (n: number) => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8) % n;
  const dirs: Key[] = ['left', 'right', 'up', 'down'];
  const out: { press: Key[]; release: Key[] }[] = [];
  let held: Key | null = null;
  let hold = 0;
  for (let t = 0; t < ticks; t++) {
    const press: Key[] = [];
    const release: Key[] = [];
    if (hold-- <= 0) {
      if (held) release.push(held);
      held = rnd(6) == 0 ? null : dirs[rnd(4)];
      if (held) press.push(held);
      hold = 2 + rnd(25);
    }
    if (rnd(12) == 0) {
      press.push('fire');
      release.push('fire');
    }
    out.push({ press, release });
  }
  return out;
}

function hash(a: ArrayLike<number>, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < n; i++) h = Math.imul(h ^ (a[i] & 0xff), 16777619);
  return h >>> 0;
}

async function runOld(seed: number, inputs: ReturnType<typeof script>) {
  const { ctx, runNext } = loadOld();
  let randv = seed;
  ctx.Main.randno = (n: number) => {
    randv = (Math.imul(randv, 0x15a4e35) + 1) & 0x7fffffff;
    return (randv & 0x7fffffff) % n;
  };
  const frames: number[] = [];
  const scores: number[] = [];
  const orig = ctx.Bags.dobags;
  ctx.Bags.dobags = () => {
    orig();
    const k = frames.length;
    frames.push(hash(ctx.Pc.pixels, 16000));
    scores.push(ctx.Monster.monleft() * 1000000 + ctx.Digger.diggerx_r() * 1000 + ctx.Digger.diggery_r());
    const step = inputs[k];
    if (step) {
      for (const r of step.release) ctx.Input.processkey(KEYCODES[r][1]);
      for (const p of step.press) ctx.Input.processkey(KEYCODES[p][0]);
    }
  };
  ctx.Digger.init();
  // Let the attract screen run briefly, then "press a key" to start.
  for (let i = 0; i < 20; i++) await runNext();
  ctx.Input.processkey(0x1c);
  let guard = 0;
  while (frames.length < inputs.length && guard++ < 2e5) await runNext();
  return { frames, scores };
}

function runNew(seed: number, inputs: ReturnType<typeof script>) {
  const g = new Game(seed, { highScores: () => [], isHighScore: () => false });
  const frames: number[] = [];
  const scores: number[] = [];
  const orig = g.bags.dobags.bind(g.bags);
  g.bags.dobags = () => {
    orig();
    const k = frames.length;
    frames.push(hash(g.pc.pixels, 16000));
    scores.push(g.monster.monleft() * 1000000 + g.digger.diggerx * 1000 + g.digger.diggery);
    const step = inputs[k];
    if (step) {
      for (const r of step.release) g.input.release(r);
      for (const p of step.press) g.input.press(p);
    }
  };
  for (let i = 0; i < 20; i++) g.step();
  g.requestStart(1);
  let guard = 0;
  while (frames.length < inputs.length && guard++ < 2e5) g.step();
  return { frames, scores };
}

describe.skipIf(!hasOld)('parity with the reference port', () => {
  for (const seed of [1, 42, 1983]) {
    it(`matches tick-for-tick (seed ${seed})`, async () => {
      const inputs = script(seed, 1500);
      const a = await runOld(seed, inputs);
      const b = runNew(seed, inputs);
      const n = Math.min(a.frames.length, b.frames.length);
      // Random play usually ends in game over before the script runs out; both must end together.
      expect(a.frames.length).toBe(b.frames.length);
      expect(n).toBeGreaterThan(500);
      let first = -1;
      for (let i = 0; i < n; i++)
        if (a.frames[i] != b.frames[i] || a.scores[i] != b.scores[i]) {
          first = i;
          break;
        }
      expect(first, `first divergence at tick ${first}`).toBe(-1);
    }, 60000);
  }
});
