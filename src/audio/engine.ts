// Audio mixing: one AudioContext, master/music/sfx buses, and two swappable
// backends that both consume the sim's sound commands.
import type { SoundCmd } from '../sim/sound';
import type { MusicTheme } from '../storage/storage';
import speakerUrl from './classic/speaker.worklet.ts?worker&url';

export interface AudioBackend {
  command(cmd: SoundCmd, arg: number): void;
  /** Swap the main theme at the next opportunity (styles without themes ignore this). */
  setMainTheme?(theme: MusicTheme): Promise<void>;
  /** Menu bed on or off (styles without one ignore this). */
  setAmbient?(on: boolean): void;
  /** A soft blip for menu navigation. */
  uiSound?(kind: 'move' | 'select'): void;
  /** Bring music back in line with the sim after a mode switch or a skip (-1 = silence),
   *  optionally starting `pos` melody-table steps in. */
  resync(tune: number, pos?: number | null): void;
  /** How far into `tune` the music is, in melody-table steps, or null if it isn't playing. */
  musicPos(tune: number): Promise<number | null>;
  setPaused(paused: boolean): void;
  /** Stop everything immediately (used when switching away from this backend). */
  silence(): void;
  /** Resolves once the main music can play, reporting progress (0..1) meanwhile. */
  whenReady?(onProgress?: (f: number) => void): Promise<void>;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly music: GainNode;
  readonly sfx: GainNode;
  private backends: Partial<Record<'hd' | 'classic', AudioBackend>> = {};
  private mode: 'hd' | 'classic' = 'hd';
  private ready: Promise<void>;
  private hdFactory: ((engine: AudioEngine, theme: MusicTheme) => Promise<AudioBackend>) | null = null;
  private musicTheme: MusicTheme = '2027';
  /** The latest mode switch, which may still be loading the HD backend. */
  private switching: Promise<void> = Promise.resolve();
  private paused = false;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.music = this.ctx.createGain();
    this.sfx = this.ctx.createGain();
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.ready = this.initClassic();
  }

  private async initClassic(): Promise<void> {
    try {
      await this.ctx.audioWorklet.addModule(speakerUrl);
      this.backends.classic = new ClassicAudio(this);
    } catch (e) {
      console.warn('Classic audio unavailable', e);
    }
  }

  /** Registers the HD backend loader; it is created lazily the first time it is needed. */
  setHdFactory(f: (engine: AudioEngine, theme: MusicTheme) => Promise<AudioBackend>): void {
    this.hdFactory = f;
  }

  /**
   * Chooses which main theme the remastered soundtrack plays.
   * @param theme '2027' for this remake's own hook, 'jazz' for the 1983 melody arranged
   * @returns resolves once the new theme is rendered and playing
   */
  async setMusicTheme(theme: MusicTheme): Promise<void> {
    this.musicTheme = theme;
    await this.backends.hd?.setMainTheme?.(theme);
  }

  /** Resumes the context unless the game deliberately paused it. */
  async unlock(): Promise<void> {
    if (!this.paused && this.ctx.state != 'running') await this.ctx.resume().catch(() => {});
  }

  setVolumes(master: number, music: number, sfx: number, muted: boolean): void {
    const t = this.ctx.currentTime;
    // Perceptual curve: squaring the slider value feels linear to the ear.
    this.master.gain.setTargetAtTime(muted ? 0 : master * master, t, 0.02);
    this.music.gain.setTargetAtTime(music * music, t, 0.02);
    this.sfx.gain.setTargetAtTime(sfx * sfx, t, 0.02);
  }

  setMode(mode: 'hd' | 'classic', tune: number): Promise<void> {
    return (this.switching = this.switchMode(mode, tune));
  }

  /** Resolves once the current sound style can play its music. */
  async whenReady(onProgress?: (f: number) => void): Promise<void> {
    await this.switching;
    await this.backends[this.mode]?.whenReady?.(onProgress);
  }

  private async switchMode(mode: 'hd' | 'classic', tune: number): Promise<void> {
    await this.ready;
    if (mode == 'hd' && !this.backends.hd && this.hdFactory) {
      const f = this.hdFactory;
      this.hdFactory = null;
      try {
        this.backends.hd = await f(this, this.musicTheme);
      } catch (e) {
        console.warn('HD audio unavailable, using classic', e);
      }
    }
    const prev = this.backends[this.mode];
    const next = this.backends[mode];
    // Switching sound styles carries on from the same spot in the tune.
    const pos = prev && prev !== next && tune >= 0 ? await prev.musicPos(tune) : null;
    this.mode = mode;
    if (prev && prev !== next) prev.silence();
    next?.resync(tune, pos);
  }

  private get active(): AudioBackend | undefined {
    return this.backends[this.mode] ?? this.backends.classic;
  }

  command(cmd: SoundCmd, arg: number): void {
    this.active?.command(cmd, arg);
  }

  resync(tune: number): void {
    this.active?.resync(tune);
  }

  /** Starts or stops the menu ambience on the active backend. */
  setAmbient(on: boolean): void {
    this.active?.setAmbient?.(on);
  }

  /** Plays a menu navigation blip, if the active backend has one. */
  uiSound(kind: 'move' | 'select'): void {
    this.active?.uiSound?.(kind);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const b of Object.values(this.backends)) b?.setPaused(paused);
    // Freezing the whole context pauses music and effects mid-note, sample-accurately.
    if (paused) void this.ctx.suspend().catch(() => {});
    else void this.ctx.resume().catch(() => {});
  }
}

/** The original PC-speaker sound, emulated in an AudioWorklet. */
class ClassicAudio implements AudioBackend {
  private node: AudioWorkletNode;

  constructor(engine: AudioEngine) {
    const ctx = engine.ctx;
    this.node = new AudioWorkletNode(ctx, 'digger-speaker', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const split = ctx.createChannelSplitter(2);
    this.node.connect(split);
    split.connect(engine.music, 0);
    split.connect(engine.sfx, 1);
  }

  command(cmd: SoundCmd, arg: number): void {
    this.node.port.postMessage({ cmd, arg });
  }

  resync(tune: number, pos?: number | null): void {
    this.command('soundstop', 0);
    if (tune < 0) return;
    this.command('music', tune);
    if (pos) this.node.port.postMessage({ cmd: 'seek', arg: pos });
  }

  musicPos(tune: number): Promise<number | null> {
    return new Promise((resolve) => {
      // The worklet may be unable to answer (e.g. a suspended context); then just restart the tune.
      const timer = setTimeout(() => resolve(null), 150);
      this.node.port.onmessage = (e: MessageEvent<{ tune: number; pos: number }>) => {
        clearTimeout(timer);
        this.node.port.onmessage = null;
        resolve(e.data.tune == tune && e.data.pos >= 0 ? e.data.pos : null);
      };
      this.node.port.postMessage({ cmd: 'getpos', arg: 0 });
    });
  }

  setPaused(paused: boolean): void {
    this.node.port.postMessage({ cmd: 'pause', arg: paused ? 1 : 0 });
  }

  silence(): void {
    this.command('soundstop', 0);
  }
}
