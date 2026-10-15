// PC-speaker emulation as an AudioWorklet: a straight port of the original
// Sound.js state machine (PIT timer 0 = music, timer 2 = effects). Output
// channel 0 is music, channel 1 is effects, so the host can mix them separately.
//
// Runs on the audio thread; receives the sim's sound commands over the port.

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: unknown): void;


import { BONUS_JINGLE, BACKG_JINGLE, DIRGE, NEWLEV_JINGLE as newlevjingle, EMERALD_FREQS as emfreqs } from '../tunes';

class Speaker extends AudioWorkletProcessor {
  // timer/pwm state
  wavetype = 0;
  musvol = 0;
  spkrmode = 0;
  timerrate = 0x7d0;
  timercount = 0;
  t2val = 0;
  t0val = 0;
  pulsewidth = 1;
  volume = 1;
  timerclock = 0;
  soundflag = true;
  musicflag = true;
  sndflag = false;
  soundpausedflag = false;
  soundlevdoneflag = false;
  nljpointer = 0;
  nljnoteduration = 0;
  soundfallflag = false;
  soundfallf = false;
  soundfallvalue = 0;
  soundfalln = 0;
  soundbreakflag = false;
  soundbreakduration = 0;
  soundbreakvalue = 0;
  soundwobbleflag = false;
  soundwobblen = 0;
  soundfireflag = false;
  soundfirevalue = 0;
  soundfiren = 0;
  soundexplodeflag = false;
  soundexplodevalue = 0;
  soundexplodeduration = 0;
  soundbonusflag = false;
  soundbonusn = 0;
  soundemflag = false;
  soundemeraldflag = false;
  soundemeraldduration = 0;
  emerfreq = 0;
  soundemeraldn = 0;
  soundgoldflag = false;
  soundgoldf = false;
  soundgoldvalue1 = 0;
  soundgoldvalue2 = 0;
  soundgoldduration = 0;
  soundeatmflag = false;
  soundeatmvalue = 0;
  soundeatmduration = 0;
  soundeatmn = 0;
  soundddieflag = false;
  soundddien = 0;
  soundddievalue = 0;
  sound1upflag = false;
  sound1upduration = 0;
  musicplaying = false;
  musicp = 0;
  tuneno = 0;
  noteduration = 0;
  notevalue = 0;
  musicmaxvol = 0;
  musicattackrate = 0;
  musicsustainlevel = 0;
  musicdecayrate = 0;
  musicnotewidth = 0;
  musicreleaserate = 0;
  musicstage = 0;
  musicn = 0;
  /** Table step where the current note starts, and where the next one does. */
  musicunit = 0;
  nextunit = 0;
  /** Ticks to skip into the next note loaded (set by seek). */
  seekticks = 0;
  soundt0flag = false;
  // sample generator state
  rate = Math.floor(0x1234dd / sampleRate);
  t0rate = 0;
  t2rate = 0;
  t0v = 0;
  t2v = 0;
  t2sw = false;
  randv = 12345;
  // gentle smoothing so the raw square waves are less harsh on modern speakers
  lp0 = 0;
  lp1 = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => this.command(e.data.cmd, e.data.arg);
    this.settimer2(40);
    this.t2sw = true;
    this.settimer0(0);
    this.wavetype = 2;
    this.t0val = 12000;
    this.musvol = 8;
    this.t2val = 40;
    this.soundt0flag = true;
    this.sndflag = true;
    this.spkrmode = 0;
    this.setsoundt2();
    this.soundstop();
    this.timerrate = 0x4000;
    this.settimer0(0x4000);
  }

  command(cmd: string, arg: number): void {
    switch (cmd) {
      case 'music':
        this.music(arg);
        break;
      case 'musicoff':
        this.musicoff();
        break;
      case 'seek':
        this.seek(arg);
        break;
      case 'getpos':
        this.port.postMessage({ tune: this.tuneno, pos: this.musicplaying ? this.musicunit + this.musicn / this.tunemul() : -1 });
        break;
      case 'soundstop':
        this.soundstop();
        break;
      case 'killsound':
        this.soundstop();
        break;
      case 'soundlevdone':
        this.soundstop();
        this.nljpointer = 0;
        this.nljnoteduration = 20;
        this.soundlevdoneflag = this.soundpausedflag = true;
        break;
      case 'sound1up':
        this.sound1upduration = 96;
        this.sound1upflag = true;
        break;
      case 'soundbonus':
        this.soundbonusflag = true;
        break;
      case 'soundbonusoff':
        this.soundbonusflag = false;
        this.soundbonusn = 0;
        break;
      case 'soundbreak':
        this.soundbreakduration = 3;
        if (this.soundbreakvalue < 15000) this.soundbreakvalue = 15000;
        this.soundbreakflag = true;
        break;
      case 'soundddie':
        this.soundddien = 0;
        this.soundddievalue = 20000;
        this.soundddieflag = true;
        break;
      case 'soundeatm':
        this.soundeatmduration = 20;
        this.soundeatmn = 3;
        this.soundeatmvalue = 2000;
        this.soundeatmflag = true;
        break;
      case 'soundem':
        this.soundemflag = true;
        break;
      case 'soundemerald':
        this.emerfreq = emfreqs[arg];
        this.soundemeraldduration = 7;
        this.soundemeraldn = 0;
        this.soundemeraldflag = true;
        break;
      case 'soundexplode':
        this.soundexplodevalue = 1500;
        this.soundexplodeduration = 10;
        this.soundexplodeflag = true;
        this.soundfireoff();
        break;
      case 'soundfall':
        this.soundfallvalue = 1000;
        this.soundfallflag = true;
        break;
      case 'soundfalloff':
        this.soundfallflag = false;
        this.soundfalln = 0;
        break;
      case 'soundfire':
        this.soundfirevalue = 500;
        this.soundfireflag = true;
        break;
      case 'soundfireoff':
        this.soundfireoff();
        break;
      case 'soundgold':
        this.soundgoldvalue1 = 500;
        this.soundgoldvalue2 = 4000;
        this.soundgoldduration = 30;
        this.soundgoldf = false;
        this.soundgoldflag = true;
        break;
      case 'soundwobble':
        this.soundwobbleflag = true;
        break;
      case 'soundwobbleoff':
        this.soundwobbleflag = false;
        this.soundwobblen = 0;
        break;
      case 'pause':
        this.soundpausedflag = !!arg;
        break;
    }
  }

  randno(n: number): number {
    this.randv = (Math.imul(this.randv, 0x15a4e35) + 1) & 0x7fffffff;
    return this.randv % n;
  }

  music(tune: number): void {
    this.tuneno = tune;
    this.musicp = 0;
    this.noteduration = 0;
    this.musicunit = this.nextunit = this.seekticks = this.musicn = 0;
    switch (tune) {
      case 0:
        this.musicmaxvol = 50;
        this.musicattackrate = 20;
        this.musicsustainlevel = 20;
        this.musicdecayrate = 10;
        this.musicreleaserate = 4;
        break;
      case 1:
        this.musicmaxvol = 50;
        this.musicattackrate = 50;
        this.musicsustainlevel = 8;
        this.musicdecayrate = 15;
        this.musicreleaserate = 1;
        break;
      case 2:
        this.musicmaxvol = 50;
        this.musicattackrate = 50;
        this.musicsustainlevel = 25;
        this.musicdecayrate = 5;
        this.musicreleaserate = 1;
    }
    this.musicplaying = true;
    if (tune == 2) this.soundddieflag = false;
  }

  tunetable(): readonly number[] {
    return this.tuneno == 0 ? BONUS_JINGLE : this.tuneno == 1 ? BACKG_JINGLE : DIRGE;
  }

  tunemul(): number {
    return this.tuneno == 0 ? 3 : this.tuneno == 1 ? 6 : 10;
  }

  /** Moves the current tune to `units` table steps in (wrapping), mid-note if need be. */
  seek(units: number): void {
    const tune = this.tunetable();
    let total = 0;
    for (let i = 0; tune[i] != 0x7d64; i += 2) total += tune[i + 1];
    units %= total;
    let at = 0;
    for (let i = 0; tune[i] != 0x7d64; i += 2) {
      const d = tune[i + 1];
      if (units < at + d) {
        this.musicp = i;
        this.nextunit = at;
        this.noteduration = 0;
        this.seekticks = Math.floor((units - at) * this.tunemul());
        // Report the new spot right away, before the next tick loads the note.
        this.musicunit = at;
        this.musicn = this.seekticks;
        return;
      }
      at += d;
    }
  }

  musicoff(): void {
    this.musicplaying = false;
    this.musicp = 0;
  }

  musicupdate(): void {
    if (!this.musicplaying) return;
    if (this.noteduration != 0) this.noteduration--;
    else {
      this.musicstage = this.musicn = 0;
      const tune = this.tunetable();
      const mul = this.tunemul();
      this.noteduration = tune[this.musicp + 1] * mul;
      this.musicnotewidth = this.tuneno == 1 ? 12 : this.noteduration - mul;
      this.notevalue = tune[this.musicp];
      this.musicunit = this.nextunit;
      this.nextunit += tune[this.musicp + 1];
      this.musicp += 2;
      if (tune[this.musicp] == 0x7d64) this.musicp = this.nextunit = 0;
      if (this.seekticks) {
        this.noteduration -= this.seekticks;
        this.musicn = this.seekticks;
        this.seekticks = 0;
      }
    }
    this.musicn++;
    this.wavetype = 1;
    this.t0val = this.notevalue;
    if (this.musicn >= this.musicnotewidth) this.musicstage = 2;
    switch (this.musicstage) {
      case 0:
        if (this.musvol + this.musicattackrate >= this.musicmaxvol) {
          this.musicstage = 1;
          this.musvol = this.musicmaxvol;
          break;
        }
        this.musvol += this.musicattackrate;
        break;
      case 1:
        if (this.musvol - this.musicdecayrate <= this.musicsustainlevel) {
          this.musvol = this.musicsustainlevel;
          break;
        }
        this.musvol -= this.musicdecayrate;
        break;
      case 2:
        if (this.musvol - this.musicreleaserate <= 1) {
          this.musvol = 1;
          break;
        }
        this.musvol -= this.musicreleaserate;
    }
    if (this.musvol == 1) this.t0val = 0x7d00;
  }

  setsoundmode(): void {
    this.spkrmode = this.wavetype;
    if (!this.soundt0flag && this.sndflag) {
      this.soundt0flag = true;
      this.t2sw = true;
    }
  }

  setsoundt2(): void {
    if (this.soundt0flag) {
      this.spkrmode = 0;
      this.soundt0flag = false;
      this.t2sw = true;
    }
  }

  sett0(): void {
    if (!this.sndflag) return;
    this.settimer2(this.t2val);
    if (this.t0val < 1000 && (this.wavetype == 1 || this.wavetype == 2)) this.t0val = 1000;
    this.settimer0(this.t0val);
    this.timerrate = this.t0val;
    if (this.musvol < 1) this.musvol = 1;
    if (this.musvol > 50) this.musvol = 50;
    this.pulsewidth = this.musvol * this.volume;
    this.setsoundmode();
  }

  soundfireoff(): void {
    this.soundfireflag = false;
    this.soundfiren = 0;
  }

  soundstop(): void {
    this.soundfallflag = false;
    this.soundfalln = 0;
    this.soundwobbleflag = false;
    this.soundwobblen = 0;
    this.soundfireoff();
    this.musicoff();
    this.soundbonusflag = false;
    this.soundbonusn = 0;
    this.soundexplodeflag = false;
    this.soundbreakflag = false;
    this.soundemflag = false;
    this.soundemeraldflag = false;
    this.soundgoldflag = false;
    this.soundeatmflag = false;
    this.soundddieflag = false;
    this.sound1upflag = false;
  }

  updates(): void {
    // emerald
    if (this.soundemeraldflag)
      if (this.soundemeraldduration != 0) {
        if (this.soundemeraldn == 0 || this.soundemeraldn == 1) this.t2val = this.emerfreq;
        this.soundemeraldn++;
        if (this.soundemeraldn > 7) {
          this.soundemeraldn = 0;
          this.soundemeraldduration--;
        }
      } else this.soundemeraldflag = false;
    // wobble
    if (this.soundwobbleflag) {
      this.soundwobblen++;
      if (this.soundwobblen > 63) this.soundwobblen = 0;
      switch (this.soundwobblen) {
        case 0:
          this.t2val = 0x7d0;
          break;
        case 16:
        case 48:
          this.t2val = 0x9c4;
          break;
        case 32:
          this.t2val = 0xbb8;
          break;
      }
    }
    // digger death
    if (this.soundddieflag) {
      this.soundddien++;
      if (this.soundddien == 1) this.musicoff();
      if (this.soundddien >= 1 && this.soundddien <= 10) this.soundddievalue = 20000 - this.soundddien * 1000;
      if (this.soundddien > 10) this.soundddievalue += 500;
      if (this.soundddievalue > 30000) this.soundddieflag = false;
      this.t2val = this.soundddievalue;
    }
    // break
    if (this.soundbreakflag)
      if (this.soundbreakduration != 0) {
        this.soundbreakduration--;
        this.t2val = this.soundbreakvalue;
      } else this.soundbreakflag = false;
    // gold
    if (this.soundgoldflag) {
      if (this.soundgoldduration != 0) this.soundgoldduration--;
      else this.soundgoldflag = false;
      if (this.soundgoldf) {
        this.soundgoldf = false;
        this.t2val = this.soundgoldvalue1;
      } else {
        this.soundgoldf = true;
        this.t2val = this.soundgoldvalue2;
      }
      this.soundgoldvalue1 += this.soundgoldvalue1 >> 4;
      this.soundgoldvalue2 -= this.soundgoldvalue2 >> 4;
    }
    // emerald click
    if (this.soundemflag) {
      this.t2val = 1000;
      this.soundemflag = false;
    }
    // explode
    if (this.soundexplodeflag)
      if (this.soundexplodeduration != 0) {
        this.soundexplodevalue = this.t2val = this.soundexplodevalue - (this.soundexplodevalue >> 3);
        this.soundexplodeduration--;
      } else this.soundexplodeflag = false;
    // fire
    if (this.soundfireflag) {
      if (this.soundfiren == 1) {
        this.soundfiren = 0;
        this.soundfirevalue += Math.floor(this.soundfirevalue / 55);
        this.t2val = this.soundfirevalue + this.randno(this.soundfirevalue >> 3);
        if (this.soundfirevalue > 30000) this.soundfireoff();
      } else this.soundfiren++;
    }
    // eat monster
    if (this.soundeatmflag)
      if (this.soundeatmn != 0) {
        if (this.soundeatmduration != 0) {
          if (this.soundeatmduration % 4 == 1) this.t2val = this.soundeatmvalue;
          if (this.soundeatmduration % 4 == 3) this.t2val = this.soundeatmvalue - (this.soundeatmvalue >> 4);
          this.soundeatmduration--;
          this.soundeatmvalue -= this.soundeatmvalue >> 4;
        } else {
          this.soundeatmduration = 20;
          this.soundeatmn--;
          this.soundeatmvalue = 2000;
        }
      } else this.soundeatmflag = false;
    // fall
    if (this.soundfallflag)
      if (this.soundfalln < 1) {
        this.soundfalln++;
        if (this.soundfallf) this.t2val = this.soundfallvalue;
      } else {
        this.soundfalln = 0;
        if (this.soundfallf) {
          this.soundfallvalue += 50;
          this.soundfallf = false;
        } else this.soundfallf = true;
      }
    // 1up
    if (this.sound1upflag) {
      if (Math.floor(this.sound1upduration / 3) % 2 != 0) this.t2val = (this.sound1upduration << 2) + 600;
      this.sound1upduration--;
      if (this.sound1upduration < 1) this.sound1upflag = false;
    }
    // bonus
    if (this.soundbonusflag) {
      this.soundbonusn++;
      if (this.soundbonusn > 15) this.soundbonusn = 0;
      if (this.soundbonusn >= 0 && this.soundbonusn < 6) this.t2val = 0x4ce;
      if (this.soundbonusn >= 8 && this.soundbonusn < 14) this.t2val = 0x5e9;
    }
  }

  soundint(): void {
    this.timerclock++;
    if (this.soundlevdoneflag) {
      this.soundlevdoneupdate();
      return;
    }
    if (this.sndflag && !this.soundpausedflag) {
      this.t0val = 0x7d00;
      this.t2val = 40;
      if (this.musicflag) this.musicupdate();
      this.updates();
      if (this.t0val == 0x7d00 || this.t2val != 40) this.setsoundt2();
      else {
        this.setsoundmode();
        this.sett0();
      }
      this.settimer2(this.t2val);
    } else if (this.soundpausedflag) {
      this.spkrmode = 0;
      this.settimer2(40);
    }
  }

  soundlevdoneupdate(): void {
    if (this.nljpointer < 11) this.t2val = newlevjingle[this.nljpointer];
    this.t0val = this.t2val + 35;
    this.musvol = 50;
    this.setsoundmode();
    this.sett0();
    this.settimer2(this.t2val);
    if (this.nljnoteduration > 0) this.nljnoteduration--;
    else {
      this.nljnoteduration = 20;
      this.nljpointer++;
      if (this.nljpointer > 10) {
        this.soundlevdoneflag = this.soundpausedflag = false;
        this.t2val = 40;
        this.settimer2(40);
        this.spkrmode = 0;
      }
    }
  }

  settimer2(t2: number): void {
    if (t2 == 40) this.t2rate = 0;
    else if (t2 == 0) this.t2rate = this.rate;
    else this.t2rate = Math.floor((this.rate * 65536) / t2);
  }

  settimer0(t0: number): void {
    if (t0 == 0) this.t0rate = this.rate;
    else this.t0rate = Math.floor((this.rate * 65536) / t0);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const m = out[0];
    const s = out[1] ?? out[0];
    for (let i = 0; i < m.length; i++) {
      this.t0v += this.t0rate;
      if (this.t0v >= 65536) {
        this.t0v %= 65536;
        this.timercount += this.timerrate;
        if (this.timercount >= 65536) {
          this.timercount %= 65536;
          this.soundint();
          this.timercount -= 0x4000;
          if (this.timercount < 0) this.timercount += 65536;
        }
      }
      this.t2v = (this.t2v + this.t2rate) % 65536;
      let t0 = 0;
      let t2 = 0;
      if (this.spkrmode != 0) t0 = this.t0v > this.pulsewidth * 63 ? -1 : 1;
      if (this.t2rate != 0 && this.t2sw) t2 = this.t2v > 32767 ? -1 : 1;
      this.lp0 += (t0 * 0.18 - this.lp0) * 0.35;
      this.lp1 += (t2 * 0.25 - this.lp1) * 0.35;
      m[i] = this.lp0;
      if (s !== m) s[i] = this.lp1;
      else m[i] += this.lp1;
    }
    return true;
  }
}

registerProcessor('digger-speaker', Speaker);
