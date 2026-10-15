// Wires the sim, driver, renderers, audio, input and UI together.
import { Game, type SimEvent } from '../sim/game';
import { Driver } from './driver';
import { ClassicRenderer } from '../render/classic/classic';
import type { Renderer } from '../render/renderer';
import { AudioEngine } from '../audio/engine';
import { Controls, type UiAction } from '../input/controls';
import { Ui } from '../ui/ui';
import { HighScores, loadSettings, maxLevelReached, recordLevel, saveSettings, type Quality, type Settings } from '../storage/storage';
import type { SoundCmd } from '../sim/sound';
import type { Key } from '../sim/input';
import { sanitizeName } from '../name';
import type { MusicTheme } from '../storage/storage';

export class App {
  readonly settings: Settings = loadSettings();
  readonly scores = new HighScores();
  readonly game: Game;
  readonly driver: Driver;
  private audio: AudioEngine | null = null;
  private classic = new ClassicRenderer();
  hd: Renderer | null = null;
  private hdLoading: Promise<Renderer | null> | null = null;
  private active: Renderer;
  private readonly stage: HTMLElement;
  private readonly ui: Ui;
  private readonly controls: Controls;
  private touchEl: HTMLElement | null = null;
  private last = performance.now();
  private start = performance.now();
  /** Ends the wait for the music to render (set while waiting). */
  private skipMusicWait: (() => void) | null = null;
  private wasInGame = false;
  private fadeEl: HTMLElement;
  /** Fire presses that must not reach the sim (cut-scenes, level start, a skipping press). */
  private fireBlocked = false;
  private playSince = 0;
  private lastScene = '';
  private skipArmedAt = -1;
  private skippableSince = 0;
  private wasSkippable = false;
  private lastUiScreen: string | null | undefined = undefined;

  constructor(root: HTMLElement) {
    this.stage = document.createElement('div');
    this.stage.className = 'stage';
    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'fade';
    root.appendChild(this.stage);
    this.stage.appendChild(this.fadeEl);

    this.game = new Game((Math.random() * 0x7fffffff) | 0, {
      highScores: () => this.scores.list(),
      isHighScore: (s) => this.scores.qualifies(s),
    }, { turnBuffer: this.settings.turnBuffer });

    this.driver = new Driver(this.game, (e, skipping) => {
      this.audio?.command(e.cmd, e.arg);
      if (!skipping) this.captionFor(e.cmd, e.arg);
    });
    this.driver.speed = this.settings.speed;

    this.active = this.classic;
    this.stage.appendChild(this.classic.canvas);
    // Keep the stage dark until the 3D view is ready, rather than flashing the classic screen.
    if (this.settings.graphics == 'hd') this.stage.classList.add('loading');

    this.ui = new Ui(root, this.settings, () => this.scores.list(), {
      start: (n, level) => this.startGame(n, level),
      maxLevel: () => maxLevelReached(),
      captureKey: (cb) => this.controls.captureKey(cb),
      toggleFullscreen: () => this.toggleFullscreen(),
      toggleEra: () => this.toggleEra(),
      resume: () => this.resume(),
      quit: () => this.quit(),
      settingsChanged: (s, k) => this.applySetting(s, k),
      resetScores: () => {
        this.scores.reset();
        this.ui.toast('High scores cleared');
      },
      submitInitials: (s) => this.submitInitials(s),
      typingInitials: (s) => this.game.showInitials(s),
      unlock: () => this.unlockAudio(),
      skipWait: () => this.skipMusicWait?.(),
      nextTune: () => this.nextTune(),
    });

    const app = this;
    this.controls = new Controls({
      press: (k: Key) => this.press(k),
      release: (k: Key) => this.release(k),
      action: (a) => this.action(a),
      get menuOpen() {
        return app.ui.menuOpen;
      },
    });

    this.applyAll();
    this.ui.show('boot');

    addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(this.stage);
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 300));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.autoPause();
    });
    addEventListener('blur', () => this.autoPause());
    this.resize();
    requestAnimationFrame((t) => this.frame(t));
    // Keep the sim alive where rAF is suspended but the page is still shown
    // (some embedded/background views); harmless elsewhere.
    setInterval(() => {
      if (performance.now() - this.last > 200) this.frame(performance.now(), false);
    }, 100);
  }

  // --- Actions ----------------------------------------------------------------

  private action(a: UiAction): void {
    switch (a) {
      case 'pause':
        if (this.ui.screen == 'pause') this.resume();
        else if (this.ui.screen == null && this.game.inGame && this.game.scene != 'initials') this.pause();
        else if (this.ui.screen == 'settings' || this.ui.screen == 'help' || this.ui.screen == 'scores') this.ui.back();
        break;
      case 'back':
        this.ui.back();
        break;
      case 'confirm':
        this.ui.confirm();
        break;
      case 'skip': {
        // Skipping takes two Fire presses, so a death mid-firefight isn't skipped by accident.
        // Presses in the first moment of a cut-scene don't count either.
        const now = performance.now();
        if (!this.game.skippable || now - this.skippableSince < 400) break;
        if (this.skipArmedAt > 0 && now - this.skipArmedAt < 2500) {
          this.skipArmedAt = -1;
          this.driver.skip();
        } else this.skipArmedAt = now;
        break;
      }
      case 'toggleGraphics':
        this.settings.graphics = this.settings.graphics == 'hd' ? 'classic' : 'hd';
        this.applySetting(this.settings, 'graphics');
        this.ui.toast(this.settings.graphics == 'hd' ? 'Remastered graphics' : 'Classic graphics');
        if (this.ui.screen == 'settings') this.ui.show('settings');
        break;
      case 'toggleSound':
        this.settings.audio = this.settings.audio == 'hd' ? 'classic' : 'hd';
        this.applySetting(this.settings, 'audio');
        this.ui.toast(this.settings.audio == 'hd' ? 'Jazz sound' : 'PC speaker sound');
        if (this.ui.screen == 'settings') this.ui.show('settings');
        break;
      case 'fullscreen':
        this.toggleFullscreen();
        break;
      case 'nextTune':
        this.nextTune();
        break;
      case 'mute':
        this.settings.muted = !this.settings.muted;
        this.applySetting(this.settings, 'muted');
        this.ui.toast(this.settings.muted ? 'Sound muted' : 'Sound on');
        break;
    }
  }

  devStart(level: number): void {
    this.game.requestStart(1, level);
    this.ui.show(null);
  }

  /** True while a Fire press should be swallowed instead of shooting. */
  private fireLocked(): boolean {
    return this.game.skippable || performance.now() - this.playSince < 600;
  }

  private press(k: Key): void {
    if (k == 'fire' && (this.fireBlocked || this.fireLocked())) {
      // Stays swallowed until released, so a held skip press can't become a shot.
      this.fireBlocked = true;
      return;
    }
    this.game.input.press(k);
  }

  private release(k: Key): void {
    if (k == 'fire' && this.fireBlocked) this.fireBlocked = false;
    this.game.input.release(k);
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => this.ui.toast('Fullscreen is not available here'));
  }

  /** Graphics decide the direction; the sound style goes along with them. */
  /**
   * F3, N, or the pause menu's Next tune button: step through every tune the game can
   * play — the three dance readings of the 1983 tune, the jazz trio, then the original
   * PC-speaker tunes — and remember where it stopped.
   */
  private nextTune(): void {
    const s = this.settings;
    const order: { audio: 'hd' | 'classic'; theme?: MusicTheme; label: string }[] = [
      { audio: 'hd', theme: '2027', label: '♪ Digger 2027: club mix' },
      { audio: 'hd', theme: 'breaks', label: '♪ Digger 2027: drum and bass' },
      { audio: 'hd', theme: 'acid', label: '♪ Digger 2027: acid' },
      { audio: 'hd', theme: 'jazz', label: '♪ Popcorn: 1983 swing' },
      { audio: 'classic', label: '♪ Sound: 1983 PC speaker, original tunes' },
    ];
    const at = order.findIndex((o) => o.audio == s.audio && (o.audio == 'classic' || o.theme == s.musicTheme));
    const next = order[(at + 1) % order.length];
    s.audio = next.audio;
    if (next.theme) s.musicTheme = next.theme;
    this.applySetting(s, 'audio');
    this.applySetting(s, 'musicTheme');
    this.ui.toast(next.label);
  }

  private toggleEra(): void {
    const mode = this.settings.graphics == 'hd' ? 'classic' : 'hd';
    this.settings.graphics = this.settings.audio = mode;
    this.applySetting(this.settings, 'graphics');
    this.applySetting(this.settings, 'audio');
    this.ui.toast(mode == 'hd' ? '2027: 3D graphics and jazz' : '1983: classic graphics and PC speaker');
  }

  // --- Captions -----------------------------------------------------------------

  private lastCaption = new Map<string, number>();

  private captionFor(cmd: SoundCmd, arg: number): void {
    if (!this.settings.captions) return;
    const text: Partial<Record<SoundCmd, string>> = {
      soundlevdone: '♪ Level complete fanfare',
      soundem: '[gem chime]',
      soundfall: '[bag falling]',
      soundwobble: '[bag creaking]',
      soundbreak: '[bag bursts open]',
      soundgold: '[coins jingle]',
      soundfire: '[fireball whoosh]',
      soundexplode: '[pop]',
      soundeatm: '[gulp!]',
      soundddie: '[sad trombone]',
      sound1up: '[extra life!]',
      soundbonus: '[bonus timer ping]',
    };
    let t = text[cmd];
    if (cmd == 'music') t = arg == 0 ? '♪ William Tell, as hard bop (bonus!)' : arg == 1 ? '♪ Popcorn, as swing jazz' : '♪ Funeral march';
    if (!t) return;
    // Rate-limit repeated cues so captions stay readable.
    const now = performance.now();
    if (now - (this.lastCaption.get(t) ?? 0) < 900) return;
    this.lastCaption.set(t, now);
    this.ui.caption(t);
  }

  // --- Auto quality ---------------------------------------------------------------

  private effectiveQuality: Quality = matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
  private perfFrames = 0;
  private perfTime = 0;

  private hdSettings(): Settings {
    return { ...this.settings, quality: this.settings.quality == 'auto' ? this.effectiveQuality : this.settings.quality };
  }

  /** Steps quality down when frames are consistently slow (only in 'auto'). */
  private measure(dt: number): void {
    if (this.settings.quality != 'auto' || this.active === this.classic || this.driver.paused || document.hidden) return;
    if (dt > 250) return; // tab switches, not rendering cost
    this.perfFrames++;
    this.perfTime += dt;
    // Decide after ~1.5 s of frames (or 90 frames), whichever comes first.
    if (this.perfFrames < 90 && !(this.perfTime > 1500 && this.perfFrames >= 4)) return;
    const avg = this.perfTime / this.perfFrames;
    this.perfFrames = this.perfTime = 0;
    if (avg > 140 && this.effectiveQuality == 'low') {
      // Unplayable even at the lightest 3D setting (e.g. software rendering): use classic.
      this.settings.graphics = 'classic';
      this.applySetting(this.settings, 'graphics');
      this.ui.toast('This device is too slow for 3D: using classic graphics (F2 to retry)');
      return;
    }
    if (avg > 21 && this.effectiveQuality != 'low') {
      // Very slow (software rendering): go straight to the lightest setting.
      this.effectiveQuality = avg > 60 || this.effectiveQuality == 'medium' ? 'low' : 'medium';
      (this.hd as unknown as { configure?(s: Settings): void } | null)?.configure?.(this.hdSettings());
    }
  }

  private async startGame(players: number, level = 1): Promise<void> {
    if (this.skipMusicWait) return; // already waiting to start
    await this.waitForMusic();
    this.game.requestStart(players, level);
    this.ui.show(null);
  }

  /** With jazz sound, the first game waits (with a progress bar) for the theme to finish rendering. */
  private async waitForMusic(): Promise<void> {
    const audio = this.audio;
    if (!audio || this.settings.audio != 'hd') return;
    // Only show the panel if the wait is noticeable.
    const timer = setTimeout(() => this.ui.show('loading'), 150);
    await new Promise<void>((resolve) => {
      this.skipMusicWait = resolve;
      void audio.whenReady((f) => this.ui.setLoading(f)).then(resolve, resolve);
    });
    clearTimeout(timer);
    this.skipMusicWait = null;
  }

  private pause(): void {
    this.driver.paused = true;
    this.audio?.setPaused(true);
    this.controls.releaseAll();
    this.game.input.releaseAll();
    this.ui.show('pause');
  }

  private resume(): void {
    this.driver.paused = false;
    this.audio?.setPaused(false);
    this.ui.show(null);
  }

  private autoPause(): void {
    this.controls.releaseAll();
    this.game.input.releaseAll();
    if (this.ui.screen == null && this.game.inGame && this.game.scene != 'initials') this.pause();
  }

  private quit(): void {
    this.game.quit();
    this.driver.paused = false;
    this.audio?.setPaused(false);
    this.ui.show(null);
  }

  private submitInitials(s: string): void {
    const p = this.game.pendingInitials;
    const name = sanitizeName(s) || 'ANON';
    if (p) this.scores.add({ name, score: p.score, date: new Date().toISOString() });
    this.game.submitInitials(name);
    this.ui.show(null);
  }

  private async unlockAudio(): Promise<void> {
    if (!this.audio) {
      try {
        // Play through the ringer switch on iOS (Safari 17+), like a music app.
        const nav = navigator as Navigator & { audioSession?: { type: string } };
        if (nav.audioSession) nav.audioSession.type = 'playback';
        this.audio = new AudioEngine();
        // Resume right here, still inside the user's tap: iOS ignores later resumes.
        void this.audio.ctx.resume().catch(() => {});
        // And retry on every later interaction until it is running (but not while paused).
        const retry = () => void this.audio?.unlock();
        for (const ev of ['pointerdown', 'touchend', 'keydown']) addEventListener(ev, retry, { capture: true, passive: true });
        this.audio.setHdFactory(async (engine, theme) => (await import('../audio/hd/jazz')).createJazz(engine, theme));
        this.applyVolumes();
        await this.audio.setMode(this.settings.audio, this.game.sound.tune);
      } catch (e) {
        console.warn('Audio unavailable', e);
      }
    }
    await this.audio?.unlock();
  }

  // --- Settings -----------------------------------------------------------------

  private applyAll(): void {
    for (const k of Object.keys(this.settings) as (keyof Settings)[]) this.applySetting(this.settings, k, false);
  }

  private applySetting(s: Settings, key: keyof Settings, save = true): void {
    switch (key) {
      case 'masterVolume':
      case 'musicVolume':
      case 'sfxVolume':
      case 'muted':
        this.applyVolumes();
        break;
      case 'audio':
        void this.audio?.setMode(s.audio, this.game.sound.tune);
        // Switching to PC-speaker sound needs no rendering: stop waiting for it.
        if (s.audio == 'classic') this.skipMusicWait?.();
        break;
      case 'musicTheme':
        void this.audio?.setMusicTheme(s.musicTheme);
        break;
      case 'graphics':
        this.setGraphics(s.graphics);
        break;
      case 'crt':
        this.stage.classList.toggle('crt', s.crt);
        break;
      case 'turnBuffer':
        this.game.options.turnBuffer = s.turnBuffer;
        break;
      case 'speed':
        this.driver.speed = s.speed;
        break;
      case 'keys':
        this.controls?.setKeys(s.keys);
        break;
      case 'touchControls':
        this.setTouch();
        break;
      case 'reducedMotion':
      case 'highContrast':
      case 'quality':
        (this.hd as unknown as { configure?(s: Settings): void } | null)?.configure?.(this.hdSettings());
        break;
    }
    if (save) saveSettings(s);
  }

  private applyVolumes(): void {
    const s = this.settings;
    this.audio?.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume, s.muted);
  }

  private setTouch(): void {
    const mode = this.settings.touchControls;
    const on = mode == 'on' || (mode == 'auto' && matchMedia('(pointer: coarse)').matches);
    if (on && !this.touchEl) this.touchEl = this.controls.mountTouch(document.body);
    if (this.touchEl) this.touchEl.hidden = !on;
    document.body.classList.toggle('has-touch', on);
  }

  private setGraphics(mode: 'hd' | 'classic'): void {
    if (mode == 'classic') {
      this.stage.classList.remove('loading');
      return this.useRenderer(this.classic);
    }
    if (this.hd) return this.useRenderer(this.hd);
    if (!this.hdLoading)
      this.hdLoading = import('../render/hd/hd')
        .then((m) => {
          this.hd = new m.HdRenderer(this.hdSettings());
          return this.hd;
        })
        .catch((e) => {
          console.error('3D renderer failed to load', e);
          this.stage.classList.remove('loading');
          this.ui.toast('3D graphics unavailable on this device');
          return null;
        });
    this.hdLoading.then((r) => {
      if (r && this.settings.graphics == 'hd') this.useRenderer(r);
    });
  }

  private useRenderer(r: Renderer): void {
    if (r !== this.classic) this.stage.classList.remove('loading');
    if (this.active === r) return;
    this.active.deactivate();
    this.active.canvas.remove();
    this.active = r;
    this.stage.appendChild(r.canvas);
    this.stage.dataset.mode = r === this.classic ? 'classic' : 'hd';
    r.activate(this.game);
    this.resize();
  }

  private resize(): void {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.active.resize(this.stage.clientWidth, this.stage.clientHeight, dpr);
  }

  private dock = { left: 0, bottom: 0 };

  /**
   * The title menu docks to the bottom half in portrait and to the left in landscape, so the
   * title scene plays unobstructed in the rest. Sub-screens opened from it keep that framing.
   */
  private syncDock(on: boolean): void {
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    let left = 0;
    let bottom = 0;
    if (on && h > w) bottom = Math.round(h / 2);
    // Wide screens have room for the leaderboard beside the buttons.
    else if (on) left = w >= 1100 && h > 520 ? 660 : Math.round(Math.max(300, Math.min(480, w * 0.44)));
    if (left == this.dock.left && bottom == this.dock.bottom) return;
    this.dock = { left, bottom };
    const root = this.stage.parentElement!;
    root.dataset.dock = left ? 'left' : bottom ? 'bottom' : '';
    root.style.setProperty('--dock-left', `${left}px`);
    root.style.setProperty('--dock-bottom', `${bottom}px`);
  }

  // --- Frame loop ----------------------------------------------------------------

  private frame(now: number, raf = true): void {
    const dt = now - this.last;
    this.last = now;
    this.controls.pollGamepads();
    this.measure(dt);
    const events = this.driver.update(dt);
    if (this.driver.skipped) this.audio?.resync(this.game.sound.tune);
    this.handleEvents(events);
    this.syncUi();
    this.active.render({
      game: this.game,
      prev: this.driver.prev,
      alpha: this.driver.alpha,
      dt: dt / 1000,
      time: (now - this.start) / 1000,
      events,
      paused: this.driver.paused,
      dock: this.dock,
    });
    if (raf) requestAnimationFrame((t) => this.frame(t));
  }

  private handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type == 'gameStart') this.wasInGame = true;
      if (e.type == 'levelStart') {
        recordLevel(e.level);
        this.ui.setBossHealth(0, 0);
      }
      if (e.type == 'bossSpawn') {
        this.ui.setBossHealth(e.hp, e.maxHp);
        this.ui.toast('A Warden blocks the way');
      }
      if (e.type == 'bossHit') this.ui.setBossHealth(e.hp, e.maxHp);
      if (e.type == 'bossKilled') {
        this.ui.setBossHealth(0, 0);
        this.ui.toast('Warden down  ·  +5000');
      }
      if (e.type == 'gameEnd') this.ui.setBossHealth(0, 0);
    }
  }

  private syncUi(): void {
    const g = this.game;
    if (g.pendingInitials && this.ui.screen != 'initials') {
      this.ui.show('initials');
      this.ui.setInitialsScore(g.pendingInitials.score, g.pendingInitials.player, g.main.nplayers);
    }
    if (g.scene == 'attract' && this.wasInGame && this.ui.screen == null) {
      this.wasInGame = false;
      this.ui.show('menu');
    }
    if (g.skippable && !this.wasSkippable) this.skippableSince = performance.now();
    this.wasSkippable = g.skippable;
    if (!g.skippable || performance.now() - this.skipArmedAt > 2500) this.skipArmedAt = -1;
    this.ui.showSkipHint(g.skippable && this.ui.screen == null && !this.driver.paused, this.skipArmedAt > 0);
    // Menus and the title screen get the ambient bed; the game gets the tune instead.
    this.audio?.setAmbient(this.ui.menuOpen || g.scene == 'attract');
    if (this.ui.screen != this.lastUiScreen) {
      if (this.lastUiScreen !== undefined) this.audio?.uiSound('select');
      this.lastUiScreen = this.ui.screen;
    }
    // Touch controls only while actually playing, never over menus.
    this.touchEl?.classList.toggle('away', this.ui.menuOpen || !g.inGame || g.scene == 'initials');
    if (g.scene == 'play' && this.lastScene != 'play') this.playSince = performance.now();
    this.lastScene = g.scene;
    // In 3D, fade to black once the gravestone has risen, and back up when play resumes.
    const d = g.digger;
    const dead = g.main.gamedat[g.main.curplayer].dead;
    const fade = this.active !== this.classic && ((g.scene == 'dying' && d.deathstage == 4 && d.deathtime < 30) || (g.scene == 'aftermath' && dead));
    this.fadeEl.classList.toggle('on', fade);
    const hd = this.active !== this.classic;
    this.ui.root.classList.toggle('hd-attract', this.settings.graphics == 'hd' && g.scene == 'attract');
    this.syncDock(g.scene == 'attract' && this.ui.screen != null);
    const playing = g.inGame && g.scene != 'initials';
    this.ui.updateEra(this.ui.screen == 'menu' || this.ui.screen == null);
    this.ui.setHudVisible(hd && playing);
    if (hd && playing) {
      const m = g.main;
      this.ui.updateHud({
        score1: g.scores.score1,
        score2: g.scores.score2,
        players: m.nplayers,
        cur: m.curplayer,
        lives: m.gamedat[m.curplayer].lives,
        level: m.gamedat[m.curplayer].level,
      });
    }
  }
}
