// Behaviour of this remake's two gameplay additions: the gentler opening-room
// monster pace, and the Warden that closes every fifth room. These drive the sim
// directly, so they are deterministic and need no renderer.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { bossHealth, isBossLevel } from '../src/sim/monster';
import { sanitizeName } from '../src/name';

const host = { highScores: () => [], isHighScore: () => true };

/** Steps the sim until `stop` holds or `limit` steps have run. */
function run(g: Game, limit: number, stop?: () => boolean): void {
  for (let n = 0; n < limit; n++) {
    g.step();
    if (stop?.()) return;
  }
  throw new Error(`sim did not settle within ${limit} steps (scene ${g.scene})`);
}

/** A game sitting in the play scene of `level`. */
function playing(level: number, seed = 5): Game {
  const g = new Game(seed, host);
  g.requestStart(1, level);
  run(g, 6000, () => g.scene == 'play');
  return g;
}

/** Monster AI steps the sim takes over `ticks` gameplay ticks. */
function monsterSteps(level: number, ticks: number): number {
  const g = playing(level);
  let calls = 0;
  const real = g.monster.domonsters.bind(g.monster);
  g.monster.domonsters = () => {
    calls++;
    real();
  };
  for (let i = 0; i < ticks; i++) g.step();
  expect(g.scene).toBe('play');
  return calls;
}

describe('opening-room monster pace', () => {
  it('slows monsters down early and returns to the original cadence by mid-game', () => {
    const pace = (level: number) => playing(level).main.monsterPace();
    expect(pace(1)).toBe(4);
    expect(pace(3)).toBe(3);
    expect(pace(5)).toBe(2);
    expect(pace(7)).toBe(1);
    expect(pace(20)).toBe(1);
  });

  it('moves monsters far less often in room 1 than in room 7', () => {
    const easy = monsterSteps(1, 60);
    const classic = monsterSteps(7, 60);
    expect(easy).toBeLessThan(classic / 2);
  });
});

describe('the Warden', () => {
  it('guards every fifth room, not the rooms in between', () => {
    expect([4, 5, 9, 10, 15, 20].map(isBossLevel)).toEqual([false, true, false, true, true, true]);
    expect(bossHealth(5)).toBe(3);
    expect(bossHealth(10)).toBe(4);
    expect(bossHealth(60)).toBe(6);
  });

  it('takes the field once the escort is gone, then takes several hits to kill', () => {
    const g = playing(5);
    expect(g.monster.boss.pending).toBe(true);
    expect(g.monster.boss.active).toBe(false);

    // Clear the escort the way a fireball would, until the Warden walks in.
    run(g, 6000, () => {
      for (let i = 0; i < 6; i++) {
        const m = g.monster.mondat[i];
        if (m.flag && !m.boss) g.monster.killmon(i, 'shot');
      }
      return g.monster.boss.active;
    });

    const slot = g.monster.boss.slot;
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(g.monster.mondat[slot].boss).toBe(true);
    expect(g.monster.mondat[slot].hp).toBe(bossHealth(5));

    // It shrugs off hits one at a time, and freezes between them.
    const hits = g.monster.mondat[slot].hp;
    for (let left = hits - 1; left > 0; left--) {
      g.monster.killmon(slot, 'shot');
      expect(g.monster.mondat[slot].hp).toBe(left);
      expect(g.monster.mondat[slot].flag).toBe(true);
      expect(g.monster.mondat[slot].stun).toBeGreaterThan(0);
      expect(g.monster.boss.active).toBe(true);
    }

    // The last hit finishes it and clears the room.
    g.monster.killmon(slot, 'shot');
    expect(g.monster.boss.active).toBe(false);
    expect(g.monster.boss.pending).toBe(false);
    expect(g.monster.monleft()).toBe(0);
  });

  it('keeps the room alive while a Warden is still to come', () => {
    const g = playing(5);
    // Escort gone in one go: with nothing else on the field the room would end,
    // except that the Warden is still waiting off-screen.
    for (let i = 0; i < 6; i++) if (g.monster.mondat[i].flag) g.monster.killmon(i, 'shot');
    expect(g.monster.boss.active).toBe(false);
    expect(g.monster.monleft()).toBeGreaterThan(0);
    g.main.checklevdone();
    expect(g.main.gamedat[0].levdone).toBe(false);
  });

  it('is killed outright by a falling bag', () => {
    const g = playing(5);
    run(g, 6000, () => {
      for (let i = 0; i < 6; i++) {
        const m = g.monster.mondat[i];
        if (m.flag && !m.boss) g.monster.killmon(i, 'shot');
      }
      return g.monster.boss.active;
    });
    const slot = g.monster.boss.slot;
    g.monster.killmon(slot, 'squashed');
    expect(g.monster.boss.active).toBe(false);
    expect(g.monster.mondat[slot].flag).toBe(false);
  });
});

describe('high-score names', () => {
  it('keeps letters, spaces and punctuation within the cap', () => {
    expect(sanitizeName('ada lovelace')).toBe('ADA LOVELACE');
    expect(sanitizeName('  olivier   de jong  ')).toBe('OLIVIER DE J');
    expect(sanitizeName('O\u2019Neil-Jr.')).toBe("O'NEIL-JR.");
    // Accents and markup fold away instead of breaking the table.
    expect(sanitizeName('Dr. Zolt\u00e1n')).toBe('DR. ZOLTAN');
    expect(sanitizeName('<b>bo</b>')).toBe('BBOB');
    expect(sanitizeName('')).toBe('');
  });
});
