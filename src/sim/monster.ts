// Nobbins, Hobbins and the room Warden: spawning, chase AI, transformation and death.
// Ported from Monster.js; the Warden is this remake's addition.
import type { Game } from './game';
import { reversedir } from './digger';

export class MonsterData {
  x = 0;
  y = 0;
  h = 0;
  v = 0;
  xr = 0;
  yr = 0;
  dir = 0;
  hdir = 0;
  t = 0;
  hnt = 0;
  death = 0;
  bag = 0;
  dtime = 0;
  stime = 0;
  flag = false;
  nob = false;
  alive = false;
  /** Warden only: hits left before it dies. */
  hp = 0;
  /** Warden only: true while it is one of the room's end bosses. */
  boss = false;
  /** Warden only: ticks frozen after taking a hit. */
  stun = 0;
  /** Warden only: ticks left of its charge (a burst of full-speed pursuit). */
  charging = 0;
}

export type KillCause = 'shot' | 'eaten' | 'squashed' | 'grave';

/** Every fifth room ends with a single big monster instead of a cherry. */
export const BOSS_EVERY = 5;
/** Hits it takes to bring a Warden down in its first room, plus one per ten rooms. */
export function bossHealth(room: number): number {
  return Math.min(6, 3 + Math.floor(room / 10));
}
export function isBossLevel(room: number): boolean {
  return room >= BOSS_EVERY && room % BOSS_EVERY === 0;
}

/** Ticks the Warden freezes after each hit: long enough to line up the next shot. */
const BOSS_HIT_STUN = 14;
/** Ticks between charge telegraphs (13 Hz ticks, so roughly four seconds). */
const BOSS_CHARGE_EVERY = 52;
/** Ticks of full-speed pursuit once a charge fires. */
const BOSS_CHARGE_TICKS = 18;
/** Points for finishing a Warden, on top of the usual kill score. */
export const BOSS_SCORE = 5000;
/** Regular monsters sharing a boss room: a light escort, not a crowd. */
function bossEscort(room: number): number {
  return Math.max(1, Math.min(3, 1 + Math.floor(room / 10)));
}

export class Monster {
  mondat = [0, 1, 2, 3, 4, 5].map(() => new MonsterData());
  nextmonster = 0;
  totalmonsters = 0;
  maxmononscr = 0;
  nextmontime = 0;
  mongaptime = 0;
  unbonusflag = false;
  mongotgold = false;
  /** Warden state for the current room. `pending` keeps the room alive until it appears. */
  boss = { pending: false, active: false, slot: -1, maxHp: 0, chargeIn: 0 };

  constructor(private readonly g: Game) {}

  checkcoincide(mon: number, bits: number): void {
    const md = this.mondat;
    for (let m = 0, b = 256; m < 6; m++, b <<= 1)
      if ((bits & b) != 0 && md[mon].dir == md[m].dir && md[m].stime == 0 && md[mon].stime == 0)
        md[m].dir = reversedir(md[m].dir);
  }

  checkmonscared(h: number): void {
    for (let m = 0; m < 6; m++) if (h == this.mondat[m].h && this.mondat[m].dir == 2) this.mondat[m].dir = 6;
  }

  createmonster(): void {
    for (let i = 0; i < 6; i++) {
      const m = this.mondat[i];
      if (!m.flag) {
        m.flag = true;
        m.alive = true;
        m.t = 0;
        m.nob = true;
        m.hnt = 0;
        m.h = 14;
        m.v = 0;
        m.x = 292;
        m.y = 18;
        m.xr = 0;
        m.yr = 0;
        m.dir = 4;
        m.hdir = 4;
        this.nextmonster++;
        this.nextmontime = this.mongaptime;
        m.stime = 5;
        this.g.sprite.movedrawspr(i + 8, m.x, m.y);
        this.g.emit({ type: 'monsterSpawn', mon: i });
        break;
      }
    }
  }

  domonsters(): void {
    const { g } = this;
    if (this.nextmontime > 0) this.nextmontime--;
    else {
      if (this.nextmonster < this.totalmonsters && this.nmononscr() < this.maxmononscr && g.digger.digonscr && !g.digger.bonusmode)
        this.createmonster();
      if (this.unbonusflag && this.nextmonster == this.totalmonsters && this.nextmontime == 0)
        if (g.digger.digonscr) {
          if (this.boss.pending && !this.boss.active) {
            /* The escort is out; the Warden takes the field instead of the cherry. */
            if (this.spawnboss()) this.unbonusflag = false;
          } else {
            this.unbonusflag = false;
            g.digger.createbonus();
          }
        }
    }
    /* The original turns Nobbins into Hobbins as the counter climbs; the opening
       rooms hold them back so a first game is not a digging contest. */
    const hobbinAt = g.main.levof10() <= 2 ? 99 : 10 - g.main.levof10();
    for (let i = 0; i < 6; i++) {
      const m = this.mondat[i];
      if (m.flag) {
        if (!m.boss && m.hnt > hobbinAt) {
          if (m.nob) {
            m.nob = false;
            m.hnt = 0;
          }
        }
        if (m.alive) {
          if (m.boss) this.bossbeat(m);
          if (m.stun > 0) m.stun--;
          else if (m.t == 0) {
            this.monai(i);
            if (g.main.randno(15 - g.main.levof10()) == 0 && m.nob) this.monai(i);
            /* A charging Warden gets a second step, so it closes in at full speed. */
            if (m.boss && m.charging > 0) this.monai(i);
          } else m.t--;
        } else this.mondie(i);
      }
    }
  }

  erasemonsters(): void {
    if (this.boss.active) this.g.drawing.outtext('      ', 236, 0, 3);
    for (let i = 0; i < 6; i++) if (this.mondat[i].flag) this.g.sprite.erasespr(i + 8);
  }

  fieldclear(dir: number, x: number, y: number): boolean {
    const gf = (a: number, b: number) => this.getfield(a, b);
    switch (dir) {
      case 0:
        if (x < 14) if ((gf(x + 1, y) & 0x2000) == 0) if ((gf(x + 1, y) & 1) == 0 || (gf(x, y) & 0x10) == 0) return true;
        break;
      case 4:
        if (x > 0) if ((gf(x - 1, y) & 0x2000) == 0) if ((gf(x - 1, y) & 0x10) == 0 || (gf(x, y) & 1) == 0) return true;
        break;
      case 2:
        if (y > 0) if ((gf(x, y - 1) & 0x2000) == 0) if ((gf(x, y - 1) & 0x800) == 0 || (gf(x, y) & 0x40) == 0) return true;
        break;
      case 6:
        if (y < 9) if ((gf(x, y + 1) & 0x2000) == 0) if ((gf(x, y + 1) & 0x40) == 0 || (gf(x, y) & 0x800) == 0) return true;
    }
    return false;
  }

  getfield(x: number, y: number): number {
    return this.g.drawing.field[y * 15 + x];
  }

  incmont(n: number): void {
    if (n > 6) n = 6;
    for (let m = 1; m < n; m++) this.mondat[m].t++;
  }

  incpenalties(bits: number): void {
    for (let m = 0, b = 256; m < 6; m++, b <<= 1) {
      if ((bits & b) != 0) this.g.main.incpenalty();
      b <<= 1;
    }
  }

  initmonsters(): void {
    const lev = this.g.main.levof10();
    const room = this.g.main.levno();
    for (let i = 0; i < 6; i++) {
      const m = this.mondat[i];
      m.flag = false;
      m.boss = false;
      m.hp = 0;
      m.stun = 0;
      m.charging = 0;
    }
    this.nextmonster = 0;
    this.mongaptime = 45 - (lev << 1);
    const bossRoom = isBossLevel(room);
    this.boss.pending = bossRoom;
    this.boss.active = false;
    this.boss.slot = -1;
    this.boss.maxHp = bossRoom ? bossHealth(room) : 0;
    this.boss.chargeIn = 0;
    this.totalmonsters = bossRoom ? bossEscort(room) : lev + 5;
    switch (lev) {
      case 1:
        this.maxmononscr = 3;
        break;
      case 2:
      case 3:
      case 4:
      case 5:
      case 6:
      case 7:
        this.maxmononscr = 4;
        break;
      case 8:
      case 9:
      case 10:
        this.maxmononscr = 5;
    }
    if (bossRoom) this.maxmononscr = Math.min(this.maxmononscr, 3);
    this.nextmontime = 10;
    this.unbonusflag = true;
  }

  /**
   * The room Warden: a slow, armoured monster that replaces the bonus cherry in
   * every fifth room. It takes several hits, freezes between them, and telegraphs
   * a charge before closing in — a bag dropped on it still kills it outright.
   * @returns true when it took the field, false while every slot is busy.
   */
  private spawnboss(): boolean {
    const slot = this.mondat.findIndex((m) => !m.flag);
    if (slot < 0) return false;
    const m = this.mondat[slot];
    m.flag = true;
    m.alive = true;
    m.boss = true;
    m.hp = this.boss.maxHp;
    m.nob = true;
    m.hnt = 0;
    m.t = 0;
    m.stun = BOSS_HIT_STUN;
    m.charging = 0;
    m.death = 0;
    m.dtime = 0;
    m.h = 14;
    m.v = 0;
    m.x = 292;
    m.y = 18;
    m.xr = 0;
    m.yr = 0;
    m.dir = 4;
    m.hdir = 4;
    m.stime = 5;
    this.nextmonster++;
    this.totalmonsters++;
    this.boss.active = true;
    this.boss.slot = slot;
    this.boss.chargeIn = BOSS_CHARGE_EVERY;
    this.g.sprite.movedrawspr(slot + 8, m.x, m.y);
    this.g.emit({ type: 'bossSpawn', hp: m.hp, maxHp: this.boss.maxHp });
    this.g.sound.soundexplode();
    this.drawbosshud();
    return true;
  }

  /** Runs the Warden's charge clock: telegraph, then a stretch of full-speed pursuit. */
  private bossbeat(m: MonsterData): void {
    if (m.charging > 0) {
      m.charging--;
      return;
    }
    if (this.boss.chargeIn > 0) {
      this.boss.chargeIn--;
      if (this.boss.chargeIn == 0) {
        m.charging = BOSS_CHARGE_TICKS;
        this.boss.chargeIn = BOSS_CHARGE_EVERY;
        this.g.emit({ type: 'bossCharge', x: m.x, y: m.y });
        this.g.sound.soundfall();
      }
    }
  }

  /** True while the active Warden is mid-charge, so the pace gate lets it through. */
  bossCharging(): boolean {
    const m = this.mondat[this.boss.slot];
    return this.boss.active && m != null && m.charging > 0;
  }

  /** Classic mode has no room for a bar, so the hit points read out on the top line. */
  private drawbosshud(): void {
    const m = this.mondat[this.boss.slot];
    const left = m && m.flag ? m.hp : 0;
    this.g.drawing.outtext(left > 0 ? 'BOSS ' + left : '      ', 236, 0, 3);
  }

  killmon(mon: number, cause: KillCause = 'shot'): void {
    const m = this.mondat[mon];
    if (!m.flag) return;
    /* A Warden shrugs off everything but a falling bag, which finishes it outright. */
    if (m.boss && cause != 'squashed' && m.hp > 1) {
      m.hp--;
      m.stun = BOSS_HIT_STUN;
      this.g.emit({ type: 'bossHit', mon, x: m.x, y: m.y, hp: m.hp, maxHp: this.boss.maxHp });
      this.g.sound.soundeatm();
      this.drawbosshud();
      return;
    }
    const wasBoss = m.boss;
    const x = m.x;
    const y = m.y;
    const maxHp = this.boss.maxHp;
    this.g.emit({ type: 'monsterKilled', mon, x, y, nob: m.nob, cause });
    m.flag = m.alive = false;
    m.boss = false;
    this.g.sprite.erasespr(mon + 8);
    if (this.g.digger.bonusmode) this.totalmonsters++;
    if (wasBoss) {
      this.boss.active = false;
      this.boss.pending = false;
      this.boss.slot = -1;
      this.g.scores.addscore(BOSS_SCORE);
      this.g.emit({ type: 'bossKilled', x, y, maxHp });
      this.drawbosshud();
    }
  }

  killmonsters(bits: number, cause: KillCause = 'grave'): number {
    let n = 0;
    for (let m = 0, b = 256; m < 6; m++, b <<= 1)
      if ((bits & b) != 0) {
        this.killmon(m, cause);
        n++;
      }
    return n;
  }

  monai(mon: number): void {
    const { g } = this;
    const m = this.mondat[mon];
    const lev = g.main.levof10();
    let mdirp1 = 0;
    let mdirp2 = 0;
    let mdirp3 = 0;
    let mdirp4 = 0;
    let t: number;
    let dir: number;
    const monox = m.x;
    const monoy = m.y;
    if (m.xr == 0 && m.yr == 0) {
      /* Turn hobbin back into nobbin if it's had its time */
      if (m.hnt > 30 + (lev << 1))
        if (!m.nob) {
          m.hnt = 0;
          m.nob = true;
        }

      /* Set up monster direction properties to chase dig */
      const dx = g.digger.diggerx;
      const dy = g.digger.diggery;
      if (Math.abs(dy - m.y) > Math.abs(dx - m.x)) {
        if (dy < m.y) {
          mdirp1 = 2;
          mdirp4 = 6;
        } else {
          mdirp1 = 6;
          mdirp4 = 2;
        }
        if (dx < m.x) {
          mdirp2 = 4;
          mdirp3 = 0;
        } else {
          mdirp2 = 0;
          mdirp3 = 4;
        }
      } else {
        if (dx < m.x) {
          mdirp1 = 4;
          mdirp4 = 0;
        } else {
          mdirp1 = 0;
          mdirp4 = 4;
        }
        if (dy < m.y) {
          mdirp2 = 2;
          mdirp3 = 6;
        } else {
          mdirp2 = 6;
          mdirp3 = 2;
        }
      }

      /* In bonus mode, run away from digger */
      if (g.digger.bonusmode) {
        t = mdirp1;
        mdirp1 = mdirp4;
        mdirp4 = t;
        t = mdirp2;
        mdirp2 = mdirp3;
        mdirp3 = t;
      }

      /* Adjust priorities so that monsters don't reverse direction unless they really have to */
      dir = reversedir(m.dir);
      if (dir == mdirp1) {
        mdirp1 = mdirp2;
        mdirp2 = mdirp3;
        mdirp3 = mdirp4;
        mdirp4 = dir;
      }
      if (dir == mdirp2) {
        mdirp2 = mdirp3;
        mdirp3 = mdirp4;
        mdirp4 = dir;
      }
      if (dir == mdirp3) {
        mdirp3 = mdirp4;
        mdirp4 = dir;
      }

      /* Introduce a random element on levels <6 : occasionally swap p1 and p3 */
      if (g.main.randno(lev + 5) == 1 && lev < 6) {
        t = mdirp1;
        mdirp1 = mdirp3;
        mdirp3 = t;
      }

      /* Check field and find direction */
      if (this.fieldclear(mdirp1, m.h, m.v)) dir = mdirp1;
      else if (this.fieldclear(mdirp2, m.h, m.v)) dir = mdirp2;
      else if (this.fieldclear(mdirp3, m.h, m.v)) dir = mdirp3;
      else if (this.fieldclear(mdirp4, m.h, m.v)) dir = mdirp4;

      /* Hobbins don't care about the field: they go where they want. */
      if (!m.nob) dir = mdirp1;

      /* Monsters take a time penalty for changing direction */
      if (m.dir != dir) m.t++;

      m.dir = dir;
    }

    /* If monster is about to go off edge of screen, stop it. */
    if ((m.x == 292 && m.dir == 0) || (m.x == 12 && m.dir == 4) || (m.y == 180 && m.dir == 6) || (m.y == 18 && m.dir == 2))
      m.dir = -1;

    /* Change hdir for hobbin */
    if (m.dir == 4 || m.dir == 0) m.hdir = m.dir;

    /* Hobbins dig */
    if (!m.nob) g.drawing.eatfield(m.x, m.y, m.dir);

    /* (Draw new tunnels) and move monster */
    switch (m.dir) {
      case 0:
        if (!m.nob) g.drawing.drawrightblob(m.x, m.y);
        m.x += 4;
        break;
      case 4:
        if (!m.nob) g.drawing.drawleftblob(m.x, m.y);
        m.x -= 4;
        break;
      case 2:
        if (!m.nob) g.drawing.drawtopblob(m.x, m.y);
        m.y -= 3;
        break;
      case 6:
        if (!m.nob) g.drawing.drawbottomblob(m.x, m.y);
        m.y += 3;
        break;
    }

    /* Hobbins can eat emeralds */
    if (!m.nob) g.digger.hitemerald(Math.floor((m.x - 12) / 20), Math.floor((m.y - 18) / 18), (m.x - 12) % 20, (m.y - 18) % 18, m.dir);

    /* If digger's gone, don't bother */
    if (!g.digger.digonscr) {
      m.x = monox;
      m.y = monoy;
    }

    /* If monster's just started, don't move yet */
    if (m.stime != 0) {
      m.stime--;
      m.x = monox;
      m.y = monoy;
    }

    /* Increase time counter for hobbin */
    if (!m.nob && m.hnt < 100) m.hnt++;

    /* Draw monster */
    let push = true;
    const clbits = g.drawing.drawmon(mon, m.nob, m.hdir, m.x, m.y);
    g.main.incpenalty();

    /* Collision with another monster */
    if ((clbits & 0x3f00) != 0) {
      m.t++;
      this.checkcoincide(mon, clbits);
      this.incpenalties(clbits);
    }

    /* Check for collision with bag */
    if ((clbits & g.bags.bagbits()) != 0) {
      m.t++;
      this.mongotgold = false;
      if (m.dir == 4 || m.dir == 0) {
        push = g.bags.pushbags(m.dir, clbits);
        m.t++;
      } else if (!g.bags.pushudbags(clbits)) push = false;
      if (this.mongotgold) m.t = 0;
      if (!m.nob && m.hnt > 1) g.bags.removebags(clbits); /* Hobbins eat bags */
    }

    /* Increase hobbin cross counter */
    if (m.nob && (clbits & 0x3f00) != 0 && g.digger.digonscr) m.hnt++;

    /* See if bags push monster back */
    if (!push) {
      m.x = monox;
      m.y = monoy;
      g.drawing.drawmon(mon, m.nob, m.hdir, m.x, m.y);
      g.main.incpenalty();
      if (m.nob) m.hnt++; /* The other way to create hobbin: stuck on h-bag */
      if ((m.dir == 2 || m.dir == 6) && m.nob) m.dir = reversedir(m.dir);
    }

    /* Collision with digger */
    if ((clbits & 1) != 0 && g.digger.digonscr)
      if (g.digger.bonusmode) {
        this.killmon(mon, 'eaten');
        g.scores.scoreeatm();
        g.sound.soundeatm();
      } else g.digger.killdigger(3, 0);

    m.h = Math.floor((m.x - 12) / 20);
    m.v = Math.floor((m.y - 18) / 18);
    m.xr = (m.x - 12) % 20;
    m.yr = (m.y - 18) % 18;
  }

  mondie(mon: number): void {
    const m = this.mondat[mon];
    const { g } = this;
    switch (m.death) {
      case 1:
        if (g.bags.bagy(m.bag) + 6 > m.y) m.y = g.bags.bagy(m.bag);
        g.drawing.drawmondie(mon, m.nob, m.hdir, m.x, m.y);
        g.main.incpenalty();
        if (g.bags.getbagdir(m.bag) == -1) {
          m.dtime = 1;
          m.death = 4;
        }
        break;
      case 4:
        if (m.dtime != 0) m.dtime--;
        else {
          this.killmon(mon, 'squashed');
          g.scores.scorekill();
        }
    }
  }

  mongold(): void {
    this.mongotgold = true;
  }

  monleft(): number {
    /* A Warden still to appear keeps its room alive. */
    const waiting = this.boss.pending && !this.boss.active ? 1 : 0;
    return this.nmononscr() + this.totalmonsters - this.nextmonster + waiting;
  }

  nmononscr(): number {
    let n = 0;
    for (let i = 0; i < 6; i++) if (this.mondat[i].flag) n++;
    return n;
  }

  squashmonster(mon: number, death: number, bag: number): void {
    const m = this.mondat[mon];
    m.alive = false;
    m.death = death;
    m.bag = bag;
  }

  squashmonsters(bag: number, bits: number): void {
    for (let m = 0, b = 256; m < 6; m++, b <<= 1)
      if ((bits & b) != 0) if (this.mondat[m].y >= this.g.bags.bagy(bag)) this.squashmonster(m, 1, bag);
  }
}
