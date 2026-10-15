import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';

const host = { highScores: () => [], isHighScore: () => true };

describe('which rooms have a Warden', () => {
  it('reports the flag per room', () => {
    const rows: string[] = [];
    for (let room = 1; room <= 12; room++) {
      const g = new Game(9, host);
      g.requestStart(1, room);
      for (let i = 0; i < 6000 && g.scene != 'play'; i++) g.step();
      rows.push(`${room}:${g.monster.boss.pending ? 'BOSS' : '-'}`);
    }
    console.log('rooms ->', rows.join('  '));
    expect(rows.filter((r) => r.endsWith('BOSS')).map((r) => r.split(':')[0])).toEqual(['5', '10']);
  });
});
