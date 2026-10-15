// HTML overlay: title menu, settings, pause, high scores, initials entry, HUD, toasts.
import { DEFAULT_KEYS, type BindAction, type Settings } from '../storage/storage';
import type { HighScore } from '../storage/storage';
import { MAX_NAME, sanitizeName } from '../name';

export type Screen = 'boot' | 'menu' | 'loading' | 'settings' | 'pause' | 'scores' | 'help' | 'initials' | null;

export interface UiCallbacks {
  start(players: number, level: number): void;
  /** Highest level reached so far (for the starting-level picker). */
  maxLevel(): number;
  /** Hands the next key press to `cb` ('' when cancelled). */
  captureKey(cb: (code: string) => void): void;
  toggleFullscreen(): void;
  /** Switches graphics and sound together between 2027 and 1983. */
  toggleEra(): void;
  /** Steps to the next tune, as the pause menu's button does. */
  nextTune(): void;
  resume(): void;
  quit(): void;
  settingsChanged(s: Settings, key: keyof Settings): void;
  resetScores(): void;
  submitInitials(s: string): void;
  typingInitials(s: string): void;
  unlock(): void;
  /** Start the game without waiting for the music to finish rendering. */
  skipWait(): void;
}

const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

/** Human-friendly name for a KeyboardEvent.code. */
export function keyName(code: string): string {
  const named: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'Space',
    ControlLeft: 'Ctrl',
    ControlRight: 'Right Ctrl',
    ShiftLeft: 'Shift',
    ShiftRight: 'Right Shift',
    AltLeft: 'Alt',
    AltRight: 'Right Alt',
    Escape: 'Esc',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Tab: 'Tab',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Ui {
  readonly root: HTMLElement;
  private panel: HTMLElement;
  private hud: HTMLElement;
  private wardenEl: HTMLElement;
  private toastEl: HTMLElement;
  private skipEl: HTMLElement;
  private captionEl: HTMLElement;
  private eraEl: HTMLElement;
  private captionTimer = 0;
  private startLevel = 1;
  screen: Screen = null;
  private returnTo: Screen = null;
  private toastTimer = 0;
  private initials = '';

  constructor(
    host: HTMLElement,
    private settings: Settings,
    private scores: () => HighScore[],
    private cb: UiCallbacks,
  ) {
    this.root = h(`<div class="ui"></div>`);
    this.hud = h(`<div class="hud" hidden>
      <div class="hud-p hud-p1"><span class="hud-label">Score</span><span class="hud-score">0</span></div>
      <div class="hud-mid"><span class="hud-title">DIGGER <b>2027</b></span><span class="hud-level">Level 1</span><span class="hud-lives"></span></div>
      <div class="hud-p hud-p2" hidden><span class="hud-label">Player 2</span><span class="hud-score">0</span></div>
      <div class="warden" hidden>
        <span class="warden-name">The Warden</span>
        <span class="warden-bar"><i></i><i></i><i></i><i></i><i></i><i></i></span>
      </div>
    </div>`);
    this.wardenEl = this.hud.querySelector<HTMLElement>('.warden')!;
    this.panel = h(`<div class="panel-wrap" hidden></div>`);
    this.toastEl = h(`<div class="toast" role="status" aria-live="polite"></div>`);
    this.skipEl = h(`<div class="skip-hint" hidden></div>`);
    this.captionEl = h(`<div class="caption" aria-live="polite"></div>`);
    // Not focusable: Space and Enter belong to the game, and F2/F4 cover the keyboard.
    this.eraEl = h(`<button class="era" tabindex="-1" hidden></button>`);
    this.eraEl.addEventListener('click', () => {
      this.eraEl.blur();
      this.cb.toggleEra();
    });
    this.root.append(this.hud, this.skipEl, this.captionEl, this.panel, this.eraEl, this.toastEl);
    host.appendChild(this.root);
    this.panel.addEventListener('keydown', (e) => this.navKeys(e));
  }

  get menuOpen(): boolean {
    return this.screen != null;
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1600);
  }

  /** A short subtitle-style caption for a sound cue. */
  caption(text: string): void {
    this.captionEl.textContent = text;
    this.captionEl.classList.add('show');
    clearTimeout(this.captionTimer);
    this.captionTimer = window.setTimeout(() => this.captionEl.classList.remove('show'), 1800);
  }

  showSkipHint(on: boolean, armed = false): void {
    this.skipEl.hidden = !on;
    const text = armed ? 'Press Fire again to skip' : 'Fire twice to skip';
    if (this.skipEl.textContent != text) this.skipEl.textContent = text;
    this.skipEl.classList.toggle('armed', armed);
  }

  /** The corner switch between the 2027 and 1983 presentations, labelled with the current one. */
  updateEra(on: boolean): void {
    this.eraEl.hidden = !on;
    const era = this.era();
    if (this.eraEl.dataset.era != era) {
      this.eraEl.dataset.era = era;
      this.eraEl.textContent = era;
      const other = era == '2027' ? '1983: classic graphics and PC-speaker sound' : '2027: 3D graphics and jazz';
      this.eraEl.title = `Switch to ${other}`;
      this.eraEl.setAttribute('aria-label', `${era}. Switch to ${other}`);
    }
    // The big one on the first screen.
    const boot = this.panel.querySelector<HTMLElement>('.era-boot');
    if (boot && boot.dataset.era != era) {
      boot.dataset.era = era;
      boot.innerHTML = this.eraBootLabel();
    }
  }

  private era(): '2027' | '1983' {
    return this.settings.graphics == 'hd' ? '2027' : '1983';
  }

  private eraBootLabel(): string {
    return this.era() == '2027'
      ? `<b>2027</b><small>3D graphics and jazz · switch to 1983</small>`
      : `<b>1983</b><small>CGA and PC speaker · switch to 2027</small>`;
  }

  // --- HUD ------------------------------------------------------------------

  setHudVisible(on: boolean): void {
    this.hud.hidden = !on;
  }

  /**
   * Shows the Warden's remaining hit points in the HUD. hp 0 hides the bar.
   * @param hp hits the Warden has left
   * @param maxHp hits it started the room with
   */
  setBossHealth(hp: number, maxHp: number): void {
    const on = hp > 0 && maxHp > 0;
    this.wardenEl.hidden = !on;
    if (!on) return;
    this.wardenEl.querySelectorAll<HTMLElement>('.warden-bar i').forEach((pip, i) => {
      pip.hidden = i >= maxHp;
      pip.classList.toggle('spent', i >= hp);
    });
  }

  private hudKey = '';
  updateHud(p: { score1: number; score2: number; players: number; cur: number; lives: number; level: number }): void {
    const key = JSON.stringify(p);
    if (key == this.hudKey) return;
    this.hudKey = key;
    const [s1, s2] = this.hud.querySelectorAll<HTMLElement>('.hud-score');
    s1.textContent = p.score1.toLocaleString();
    s2.textContent = p.score2.toLocaleString();
    const p2 = this.hud.querySelector<HTMLElement>('.hud-p2')!;
    p2.hidden = p.players < 2;
    this.hud.querySelector('.hud-p1 .hud-label')!.textContent = p.players < 2 ? 'Score' : 'Player 1';
    this.hud.querySelector('.hud-p1')!.classList.toggle('active', p.players > 1 && p.cur == 0);
    p2.classList.toggle('active', p.cur == 1);
    this.hud.querySelector('.hud-level')!.textContent = `Level ${p.level}  ·  Esc for menu`;
    const lives = this.hud.querySelector('.hud-lives')!;
    lives.innerHTML = '';
    for (let i = 0; i < Math.max(0, p.lives - 1); i++) lives.appendChild(h(`<i class="life"></i>`));
  }

  private loadingProgress = 0;

  /** Updates the music-rendering progress bar (0..1). */
  setLoading(f: number): void {
    this.loadingProgress = f;
    const pct = Math.round(f * 100);
    const bar = this.panel.querySelector<HTMLElement>('.progress');
    if (!bar) return;
    bar.setAttribute('aria-valuenow', String(pct));
    bar.querySelector<HTMLElement>('i')!.style.width = `${pct}%`;
    this.panel.querySelector('.progress-pct')!.textContent = `${pct}%`;
  }

  // --- Screens ---------------------------------------------------------------

  show(screen: Screen): void {
    // Re-showing the same screen (e.g. refreshing Settings after F2) must keep where Back goes.
    if ((screen == 'settings' || screen == 'scores' || screen == 'help') && screen != this.screen) this.returnTo = this.screen;
    this.screen = screen;
    this.panel.innerHTML = '';
    this.panel.hidden = screen == null;
    this.root.classList.toggle('dim', screen != null && screen != 'menu' && screen != 'boot');
    this.root.classList.toggle('title', screen == 'menu' || screen == 'boot');
    if (!screen) return;
    const el = this.build(screen);
    this.panel.appendChild(el);
    requestAnimationFrame(() => el.querySelector<HTMLElement>('[autofocus], button:not(.close), input')?.focus());
  }

  back(): void {
    switch (this.screen) {
      case 'settings':
      case 'scores':
      case 'help':
        this.show(this.returnTo ?? 'menu');
        break;
      case 'pause':
        this.cb.resume();
        break;
      case 'loading':
        this.cb.skipWait();
        break;
    }
  }

  /** Activates the focused control (gamepad A). */
  confirm(): void {
    (document.activeElement as HTMLElement | null)?.click();
  }

  private build(screen: Exclude<Screen, null>): HTMLElement {
    switch (screen) {
      case 'boot': {
        const el = h(`<div class="panel boot">
          <h1 class="logo">DIGGER<span>2027</span></h1>
          <button class="primary big" autofocus>Press any key to begin</button>
          <button class="era-boot" tabindex="-1" data-era="${this.era()}">${this.eraBootLabel()}</button>
          <p class="fine">A fan-made, modern version of the original 1983 Digger by Windmill Software</p>
        </div>`);
        const go = () => {
          removeEventListener('keydown', key, true);
          this.cb.unlock();
          this.show('menu');
        };
        const key = (e: KeyboardEvent) => {
          if (e.code == 'F2' || e.code == 'Tab') return;
          e.preventDefault();
          e.stopPropagation();
          go();
        };
        addEventListener('keydown', key, true);
        el.querySelector('button')!.addEventListener('click', go);
        el.querySelector('.era-boot')!.addEventListener('click', () => {
          this.cb.toggleEra();
          el.querySelector<HTMLElement>('button')!.focus();
        });
        return el;
      }
      case 'menu': {
        const el = h(`<div class="panel menu">
          <h1 class="logo">DIGGER<span>2027</span></h1>
          <nav class="buttons">
            <button class="primary" data-a="1" autofocus>1 Player</button>
            <button data-a="2">2 Players</button>
            <button data-a="scores">High Scores</button>
            <button data-a="settings">Settings</button>
            <button data-a="help">How to Play</button>
            <a class="button" href="https://github.com/ubershmekel/digger-2027" target="_blank" rel="noopener">Source on GitHub</a>
          </nav>
          ${this.levelPicker()}
          ${this.menuScores()}
          <p class="fine">F2 graphics · F4 sound · M mute · Esc pause</p>
        </div>`);
        el.addEventListener('click', (e) => {
          const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
          if (a == '1' || a == '2') this.cb.start(+a, this.startLevel);
          else if (a == 'scores' || a == 'settings' || a == 'help') this.show(a);
          else if (a == 'lvl-' || a == 'lvl+') {
            const max = this.cb.maxLevel();
            this.startLevel = Math.max(1, Math.min(max, this.startLevel + (a == 'lvl+' ? 1 : -1)));
            el.querySelector('.lvl-num')!.textContent = String(this.startLevel);
          }
        });
        return el;
      }
      case 'loading': {
        const el = h(`<div class="panel loading">
          <h2>Tuning up the band</h2>
          <p>Rendering the jazz soundtrack <span class="progress-pct">0%</span></p>
          <div class="progress" role="progressbar" aria-label="Rendering music" aria-valuemin="0" aria-valuemax="100"><i></i></div>
          <nav class="buttons row"><button data-a="skip">Play now, music joins later</button></nav>
          <p class="fine">Once per visit · F4 for PC-speaker sound</p>
        </div>`);
        el.querySelector('[data-a=skip]')!.addEventListener('click', () => this.cb.skipWait());
        queueMicrotask(() => this.setLoading(this.loadingProgress));
        return el;
      }
      case 'pause': {
        const el = h(`<div class="panel pause">
          <h2>Paused</h2>
          <nav class="buttons">
            <button class="primary" data-a="resume" autofocus>Resume</button>
            <button data-a="settings">Settings</button>
            <button data-a="help">How to Play</button>
            <button data-a="nextTune">Next tune ▸</button>
            <button data-a="quit">Quit to Title</button>
          </nav>
        </div>`);
        el.addEventListener('click', (e) => {
          const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
          if (a == 'resume') this.cb.resume();
          else if (a == 'quit') this.cb.quit();
          else if (a == 'nextTune') this.cb.nextTune();
          else if (a == 'settings' || a == 'help') this.show(a);
        });
        return el;
      }
      case 'scores': {
        const list = this.scores();
        const rows = Array.from({ length: 10 }, (_, i) => {
          const e = list[i];
          return `<li><span class="rank">${i + 1}</span><span class="ini">${esc(e?.name ?? '...')}</span><span class="pts">${
            e ? e.score.toLocaleString() : '—'
          }</span></li>`;
        }).join('');
        const el = h(`<div class="panel scores">
          <button class="close" data-a="back" aria-label="Close">×</button>
          <h2>High Scores</h2>
          <ol class="table">${rows}</ol>
          <nav class="buttons row"><button data-a="back" autofocus>Back</button></nav>
        </div>`);
        el.querySelectorAll('[data-a=back]').forEach((b) => b.addEventListener('click', () => this.back()));
        return el;
      }
      case 'help': {
        const el = h(`<div class="panel help">
          <button class="close" data-a="back" aria-label="Close">×</button>
          <h2>How to Play</h2>
          <div class="help-grid">
            <p><b>Dig</b> with the arrow keys or WASD. Collect every <b class="em">emerald</b>, or defeat every monster, to clear the level.</p>
            <p><b>Fire</b> with Space (or Ctrl, F1, Z). The shot needs time to recharge.</p>
            <p>Dig under a <b class="gold">gold bag</b> and it wobbles, then falls. If it drops more than one row it bursts into gold worth 500. Falling bags squash monsters, and you.</p>
            <p><b>Nobbins</b> follow tunnels. <b>Hobbins</b> dig their own, eating emeralds and bags.</p>
            <p>When the <b class="cherry">cherry</b> appears, grab it: for a short time you can eat the monsters. 200, 400, 800…</p>
            <p>Eight emeralds in a row: +250. Extra life every 20,000 points.</p>
          </div>
          <p class="fine">Esc pause · F2 classic graphics · F4 classic sound · M mute · Fire twice skips a cut-scene · gamepads supported</p>
          <nav class="buttons row"><button data-a="back" autofocus>Back</button></nav>
        </div>`);
        el.querySelectorAll('[data-a=back]').forEach((b) => b.addEventListener('click', () => this.back()));
        return el;
      }
      case 'settings':
        return this.buildSettings();
      case 'initials':
        return this.buildInitials();
    }
  }

  /** Starting-level selector, offered once the player has reached level 2 or beyond. */
  private levelPicker(): string {
    const max = this.cb.maxLevel();
    if (max < 2) return '';
    this.startLevel = Math.min(this.startLevel, max);
    return `<div class="lvl-pick"><span>Start at level</span>
      <button data-a="lvl-" aria-label="Lower starting level">−</button>
      <b class="lvl-num">${this.startLevel}</b>
      <button data-a="lvl+" aria-label="Higher starting level">+</button></div>`;
  }

  /** Compact top-ten shown beside the title menu (the 3D title has no CGA score table). */
  private menuScores(): string {
    const list = this.scores();
    const rows = Array.from({ length: 10 }, (_, i) => {
      const e = list[i];
      return `<li><span class="ini">${esc(e?.name ?? '...')}</span><span class="pts">${e ? e.score.toLocaleString() : '0'}</span></li>`;
    }).join('');
    return `<section class="menu-scores"><h3>High Scores</h3><ol>${rows}</ol></section>`;
  }

  private keyRows(): string {
    const labels: [BindAction, string][] = [
      ['left', 'Left'],
      ['right', 'Right'],
      ['up', 'Up'],
      ['down', 'Down'],
      ['fire', 'Fire'],
      ['pause', 'Pause'],
    ];
    return labels
      .map(([k, label]) => {
        const codes = this.settings.keys[k];
        const shown = codes.slice(0, 2).map(keyName).join(' · ') || 'unbound';
        return `<div class="key-row"><span>${label}</span><button data-bind="${k}" title="Click, then press a new key">${esc(shown)}</button></div>`;
      })
      .join('');
  }

  private buildSettings(): HTMLElement {
    const s = this.settings;
    const seg = (key: keyof Settings, opts: [string | number | boolean, string][]) =>
      `<div class="seg" role="radiogroup" data-key="${key}">${opts
        .map(
          ([v, label]) =>
            `<button role="radio" data-v="${String(v)}" aria-checked="${String(s[key]) == String(v)}">${label}</button>`,
        )
        .join('')}</div>`;
    const slider = (key: keyof Settings, label: string) =>
      `<label class="slider"><span>${label}</span><input type="range" min="0" max="100" step="1" data-key="${key}" value="${Math.round(
        (s[key] as number) * 100,
      )}"><output>${Math.round((s[key] as number) * 100)}</output></label>`;
    const el = h(`<div class="panel settings">
      <button class="close" data-a="back" aria-label="Close">×</button>
      <h2>Settings</h2>
      <div class="settings-grid">
        <section>
          <h3>Audio</h3>
          ${slider('masterVolume', 'Master')}
          ${slider('musicVolume', 'Music')}
          ${slider('sfxVolume', 'Effects')}
          <div class="row-label">Sound style <kbd>F4</kbd></div>
          ${seg('audio', [
            ['hd', 'Jazz'],
            ['classic', 'PC speaker'],
          ])}
          <div class="row-label">Main theme · Popcorn <kbd>N</kbd></div>
          ${seg('musicTheme', [
            ['2027', 'Club'],
            ['breaks', 'Drum & bass'],
            ['acid', 'Acid'],
            ['jazz', '1983 swing'],
          ])}
          <div class="row-label">Mute</div>
          ${seg('muted', [
            [false, 'Off'],
            [true, 'On'],
          ])}
        </section>
        <section>
          <h3>Graphics</h3>
          <div class="row-label">Style <kbd>F2</kbd></div>
          ${seg('graphics', [
            ['hd', 'Remastered 3D'],
            ['classic', 'Classic CGA'],
          ])}
          <div class="row-label">Quality</div>
          ${seg('quality', [
            ['auto', 'Auto'],
            ['low', 'Low'],
            ['medium', 'Medium'],
            ['high', 'High'],
          ])}
          <div class="row-label">CRT effect (classic)</div>
          ${seg('crt', [
            [false, 'Off'],
            [true, 'On'],
          ])}
          <div class="row-label">Display <kbd>F</kbd></div>
          <button data-a="fullscreen">Toggle fullscreen</button>
        </section>
        <section>
          <h3>Accessibility</h3>
          <div class="row-label">Reduced motion</div>
          ${seg('reducedMotion', [
            [false, 'Off'],
            [true, 'On'],
          ])}
          <div class="row-label">High contrast</div>
          ${seg('highContrast', [
            [false, 'Off'],
            [true, 'On'],
          ])}
          <p class="hint">Darker earth and brighter actors; monsters turn violet so they never blend with emeralds.</p>
          <div class="row-label">Sound captions</div>
          ${seg('captions', [
            [false, 'Off'],
            [true, 'On'],
          ])}
        </section>
        <section class="keys-section">
          <h3>Controls</h3>
          ${this.keyRows()}
          <button data-a="keys-reset">Reset to defaults</button>
        </section>
        <section>
          <h3>All hotkeys</h3>
          <dl class="hotkeys">
            <dt>Esc / P</dt><dd>Pause and menu</dd>
            <dt>F2</dt><dd>Remastered ⇄ classic graphics</dd>
            <dt>N / F3</dt><dd>Next tune: Digger 2027 → Popcorn swing → 1983 PC speaker</dd>
            <dt>F4</dt><dd>Jazz ⇄ PC-speaker sound</dd>
            <dt>M</dt><dd>Mute</dd>
            <dt>F</dt><dd>Fullscreen</dd>
            <dt>Fire ×2</dt><dd>Skip a cut-scene</dd>
            <dt>Gamepad</dt><dd>D-pad or stick to move, A to fire, Start to pause</dd>
          </dl>
        </section>
        <section>
          <h3>Gameplay</h3>
          <div class="row-label">Turn buffering <span class="tag">experimental</span></div>
          ${seg('turnBuffer', [
            [0, 'Off'],
            [2, 'Short'],
            [4, 'Normal'],
            [7, 'Long'],
          ])}
          <p class="hint">Remembers a turn pressed just before a junction. Off plays exactly like 1983.</p>
          <div class="row-label">Game speed</div>
          ${seg('speed', [
            [0.75, 'Slow'],
            [1, 'Original'],
            [1.25, 'Fast'],
          ])}
          <div class="row-label">Touch controls</div>
          ${seg('touchControls', [
            ['auto', 'Auto'],
            ['on', 'On'],
            ['off', 'Off'],
          ])}
          <div class="row-label">High scores</div>
          <button class="danger" data-a="reset">Reset high scores…</button>
        </section>
      </div>
      <nav class="buttons row"><button data-a="back">Done</button></nav>
    </div>`);
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const b = t.closest<HTMLElement>('.seg button');
      if (b) {
        const group = b.parentElement!;
        const key = group.dataset.key as keyof Settings;
        const raw = b.dataset.v!;
        const cur = s[key];
        const v = typeof cur == 'number' ? parseFloat(raw) : typeof cur == 'boolean' ? raw == 'true' : raw;
        (s as unknown as Record<string, unknown>)[key] = v;
        group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        this.cb.settingsChanged(s, key);
        return;
      }
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a == 'back') this.back();
      if (a == 'fullscreen') this.cb.toggleFullscreen();
      const bind = t.closest<HTMLElement>('[data-bind]')?.dataset.bind as BindAction | undefined;
      if (bind) {
        const btn = t.closest<HTMLButtonElement>('button')!;
        btn.textContent = 'Press a key…';
        btn.classList.add('listening');
        this.cb.captureKey((code) => {
          if (code) {
            // A key does one thing: take it away from any other action first.
            for (const k of Object.keys(s.keys) as BindAction[]) s.keys[k] = s.keys[k].filter((c) => c != code);
            s.keys[bind] = [code, ...s.keys[bind]].slice(0, 4);
            this.cb.settingsChanged(s, 'keys');
          }
          el.querySelector('.keys-section')!.outerHTML = `<section class="keys-section"><h3>Controls</h3>${this.keyRows()}<button data-a="keys-reset">Reset to defaults</button></section>`;
        });
        return;
      }
      if (a == 'keys-reset') {
        s.keys = JSON.parse(JSON.stringify(DEFAULT_KEYS));
        this.cb.settingsChanged(s, 'keys');
        el.querySelector('.keys-section')!.outerHTML = `<section class="keys-section"><h3>Controls</h3>${this.keyRows()}<button data-a="keys-reset">Reset to defaults</button></section>`;
      }
      if (a == 'reset') {
        const btn = t.closest<HTMLButtonElement>('button')!;
        if (btn.dataset.confirm) {
          this.cb.resetScores();
          btn.textContent = 'High scores cleared';
          btn.disabled = true;
        } else {
          btn.dataset.confirm = '1';
          btn.textContent = 'Click again to confirm';
        }
      }
    });
    el.addEventListener('input', (e) => {
      const inp = e.target as HTMLInputElement;
      const key = inp.dataset.key as keyof Settings;
      if (!key) return;
      (s as unknown as Record<string, unknown>)[key] = +inp.value / 100;
      inp.nextElementSibling!.textContent = inp.value;
      this.cb.settingsChanged(s, key);
    });
    return el;
  }

  private buildInitials(): HTMLElement {
    this.initials = '';
    const el = h(`<div class="panel initials">
      <h2>New High Score</h2>
      <p class="big-score"></p>
      <p>Enter your name</p>
      <input class="ini-input" maxlength="${MAX_NAME}" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Your name" placeholder="YOUR NAME" autofocus>
      <p class="ini-hint">Up to ${MAX_NAME} characters · letters, numbers, spaces</p>
      <nav class="buttons row"><button class="primary" data-a="ok">Save</button></nav>
    </div>`);
    const input = el.querySelector<HTMLInputElement>('input')!;
    input.addEventListener('input', () => {
      this.initials = sanitizeName(input.value);
      input.value = this.initials;
      this.cb.typingInitials(this.initials);
    });
    const done = () => this.cb.submitInitials(this.initials || 'ANON');
    input.addEventListener('keydown', (e) => {
      if (e.key == 'Enter') done();
      e.stopPropagation();
    });
    el.querySelector('[data-a=ok]')!.addEventListener('click', done);
    this.cb.typingInitials('');
    return el;
  }

  setInitialsScore(score: number, player: number, players: number): void {
    const p = this.panel.querySelector('.big-score');
    if (p) p.textContent = (players > 1 ? `Player ${player + 1} · ` : '') + score.toLocaleString();
  }

  private navKeys(e: KeyboardEvent): void {
    if (e.key != 'ArrowDown' && e.key != 'ArrowUp' && e.key != 'ArrowLeft' && e.key != 'ArrowRight') return;
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.type == 'range' && (e.key == 'ArrowLeft' || e.key == 'ArrowRight')) return;
    if (t instanceof HTMLInputElement && t.type != 'range') return;
    const focusables = Array.from(this.panel.querySelectorAll<HTMLElement>('button:not([disabled]), input'));
    let i = focusables.indexOf(t);
    if (i < 0) return;
    // Left/right move within a segmented control; up/down move between rows.
    const inSeg = t.parentElement?.classList.contains('seg');
    if ((e.key == 'ArrowLeft' || e.key == 'ArrowRight') && inSeg) {
      const sib = (e.key == 'ArrowLeft' ? t.previousElementSibling : t.nextElementSibling) as HTMLElement | null;
      sib?.focus();
      sib?.click();
      e.preventDefault();
      return;
    }
    const step = e.key == 'ArrowDown' || e.key == 'ArrowRight' ? 1 : -1;
    // Skip the rest of the current segmented group when moving between rows.
    do i += step;
    while (inSeg && focusables[i] && focusables[i].parentElement == t.parentElement);
    if (focusables[i] && focusables[i].parentElement?.classList.contains('seg')) {
      const checked = focusables[i].parentElement!.querySelector<HTMLElement>('[aria-checked=true]');
      (checked ?? focusables[i]).focus();
    } else focusables[i]?.focus();
    e.preventDefault();
  }
}
