// Scoring and on-screen score display, ported from Scores.js.
// The high-score table itself lives outside the sim (see src/storage).
import type { Game } from './game';

export const BONUS_SCORE = 20000;

export class Scores {
  score1 = 0;
  score2 = 0;
  nextbs1 = 0;
  nextbs2 = 0;

  constructor(private readonly g: Game) {}

  addscore(score: number): void {
    const { g } = this;
    if (g.main.getcplayer() == 0) {
      this.score1 += score;
      if (this.score1 > 999999) this.score1 = 0;
      this.writenum(this.score1, 0, 0, 6, 1);
      if (this.score1 >= this.nextbs1) {
        if (g.main.getlives(1) < 5) {
          g.main.addlife(1);
          g.drawing.drawlives();
        }
        this.nextbs1 += BONUS_SCORE;
      }
    } else {
      this.score2 += score;
      if (this.score2 > 999999) this.score2 = 0;
      if (this.score2 < 100000) this.writenum(this.score2, 236, 0, 6, 1);
      else this.writenum(this.score2, 248, 0, 6, 1);
      if (this.score2 > this.nextbs2) {
        /* Player 2 doesn't get the life until >20,000 ! */
        if (g.main.getlives(2) < 5) {
          g.main.addlife(2);
          g.drawing.drawlives();
        }
        this.nextbs2 += BONUS_SCORE;
      }
    }
    g.main.incpenalty();
    g.main.incpenalty();
    g.main.incpenalty();
    if (score > 0) g.emit({ type: 'score', points: score, player: g.main.getcplayer() });
  }

  drawscores(): void {
    this.writenum(this.score1, 0, 0, 6, 3);
    if (this.g.main.getnplayers() == 2)
      if (this.score2 < 100000) this.writenum(this.score2, 236, 0, 6, 3);
      else this.writenum(this.score2, 248, 0, 6, 3);
  }

  initscores(): void {
    this.addscore(0);
  }

  scorebonus(): void {
    this.addscore(1000);
  }
  scoreeatm(): void {
    this.addscore(this.g.digger.eatmsc * 200);
    this.g.digger.eatmsc <<= 1;
  }
  scoreemerald(): void {
    this.addscore(25);
  }
  scoregold(): void {
    this.addscore(500);
  }
  scorekill(): void {
    this.addscore(250);
  }
  scoreoctave(): void {
    this.addscore(250);
  }

  showtable(table: { name: string; score: number }[]): void {
    const d = this.g.drawing;
    d.outtext('HIGH SCORES', 16, 25, 3);
    let col = 2;
    for (let i = 0; i < 10; i++) {
      const e = table[i];
      const name = (e?.name ?? '...').toUpperCase().padEnd(12, ' ').slice(0, 12);
      d.outtext(name + numtostring(e?.score ?? 0), 16, 31 + 13 * (i + 1), col);
      col = 1;
    }
  }

  writecurscore(c: number): void {
    if (this.g.main.getcplayer() == 0) this.writenum(this.score1, 0, 0, 6, c);
    else if (this.score2 < 100000) this.writenum(this.score2, 236, 0, 6, c);
    else this.writenum(this.score2, 248, 0, 6, c);
  }

  writenum(n: number, x: number, y: number, w: number, c: number): void {
    let xp = (w - 1) * 12 + x;
    while (w > 0) {
      const d = n % 10;
      if (w > 1 || d > 0) this.g.pc.gwrite(xp, y, String(d), c);
      n = Math.floor(n / 10);
      w--;
      xp -= 12;
    }
  }

  zeroscores(): void {
    this.score2 = 0;
    this.score1 = 0;
    this.nextbs1 = BONUS_SCORE;
    this.nextbs2 = BONUS_SCORE;
  }
}

export function numtostring(n: number): string {
  let x = 0;
  let p = '';
  for (; x < 6; x++) {
    p = String(n % 10) + p;
    n = Math.floor(n / 10);
    if (n == 0) {
      x++;
      break;
    }
  }
  for (; x < 6; x++) p = ' ' + p;
  return p;
}
