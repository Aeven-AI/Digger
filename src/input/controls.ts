// Keyboard, gamepad and touch input. Game keys go to the sim's Input latch;
// everything else becomes a UI action.
import type { Key } from '../sim/input';
import { DEFAULT_KEYS, type BindAction } from '../storage/storage';

export type UiAction = 'pause' | 'skip' |'toggleGraphics' | 'toggleSound' | 'nextTune' | 'mute' | 'fullscreen' | 'confirm' | 'back';

export interface ControlsTarget {
  press(k: Key): void;
  release(k: Key): void;
  action(a: UiAction): void;
  /** When true (a menu is open), game keys are not forwarded to the sim. */
  readonly menuOpen: boolean;
}

export class Controls {
  private held = new Set<Key>();
  private padPrev: boolean[] = [];
  private padDirs = new Set<Key>();
  private map = new Map<string, BindAction>();
  /** While set, the next key press is handed here instead (key rebinding). */
  private capture: ((code: string) => void) | null = null;

  constructor(private readonly t: ControlsTarget) {
    this.setKeys(DEFAULT_KEYS);
    addEventListener('keydown', (e) => this.keydown(e), { capture: true });
    addEventListener('keyup', (e) => this.keyup(e), { capture: true });
    addEventListener('blur', () => this.releaseAll());
  }

  setKeys(keys: Record<BindAction, string[]>): void {
    this.releaseAll();
    this.map.clear();
    for (const [action, codes] of Object.entries(keys) as [BindAction, string[]][]) for (const c of codes) this.map.set(c, action);
  }

  /** Hands the next key press to `cb` (Escape cancels with an empty code). */
  captureKey(cb: (code: string) => void): void {
    this.capture = cb;
  }

  private keydown(e: KeyboardEvent): void {
    if (this.capture) {
      e.preventDefault();
      e.stopPropagation();
      const cb = this.capture;
      this.capture = null;
      cb(e.code == 'Escape' ? '' : e.code);
      return;
    }
    // Typing into a text field (initials) is never a game or shortcut key.
    if (e.target instanceof HTMLInputElement && e.target.type != 'range') return;
    const bound = this.map.get(e.code);
    if (e.code == 'KeyN' && !bound) {
      e.preventDefault();
      if (!e.repeat) this.t.action('nextTune');
    }
    if (e.code == 'F3') {
      e.preventDefault();
      if (!e.repeat) this.t.action('nextTune');
    }
    if (e.code == 'F2' || e.code == 'F4') {
      e.preventDefault();
      if (!e.repeat) this.t.action(e.code == 'F2' ? 'toggleGraphics' : 'toggleSound');
      return;
    }
    if (e.code == 'Escape' || bound == 'pause') {
      if (!e.repeat) this.t.action(e.code == 'Escape' && this.t.menuOpen ? 'back' : 'pause');
      e.preventDefault();
      return;
    }
    if (this.t.menuOpen) return; // menus handle their own keys
    if (e.code == 'KeyM' && !bound) {
      if (!e.repeat) this.t.action('mute');
      return;
    }
    if (e.code == 'KeyF' && !bound) {
      if (!e.repeat) this.t.action('fullscreen');
      return;
    }
    const k = bound as Key | undefined;
    // Only Fire counts toward skipping a cut-scene, so steering never skips by accident.
    if (!e.repeat && k == 'fire') this.t.action('skip');
    if (k) {
      e.preventDefault();
      if (!this.held.has(k)) {
        this.held.add(k);
        this.t.press(k);
      }
    }
  }

  private keyup(e: KeyboardEvent): void {
    const k = this.map.get(e.code) as Key | undefined;
    if (k && k != ('pause' as Key) && this.held.has(k)) {
      this.held.delete(k);
      this.t.release(k);
      e.preventDefault();
    }
  }

  releaseAll(): void {
    for (const k of this.held) this.t.release(k);
    this.held.clear();
    for (const k of this.padDirs) this.t.release(k);
    this.padDirs.clear();
  }

  /** Call once per frame. */
  pollGamepads(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    if (!pad) return;
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    const want = new Set<Key>();
    // Pick the dominant axis so diagonals don't flicker between directions.
    if (b(14) || ax < -0.5) want.add('left');
    else if (b(15) || ax > 0.5) want.add('right');
    if (b(12) || ay < -0.5) want.add('up');
    else if (b(13) || ay > 0.5) want.add('down');
    if (b(0) || b(1) || b(2) || b(3) || b(7)) want.add('fire');
    const pressedNow = pad.buttons.map((x) => x.pressed);
    const edge = (i: number) => pressedNow[i] && !this.padPrev[i];
    if (edge(9)) this.t.action('pause');
    if (this.t.menuOpen) {
      if (edge(0)) this.t.action('confirm');
      if (edge(1)) this.t.action('back');
    } else {
      if ([0, 1, 2, 3, 7].some(edge)) this.t.action('skip');
      for (const k of want)
        if (!this.padDirs.has(k)) {
          this.padDirs.add(k);
          this.t.press(k);
        }
    }
    for (const k of [...this.padDirs])
      if (!want.has(k) || this.t.menuOpen) {
        this.padDirs.delete(k);
        this.t.release(k);
      }
    this.padPrev = pressedNow;
  }

  /**
   * Builds the on-screen controls for touch devices: a floating joystick on the left
   * (touch anywhere, then drag; the first touch only sets the centre) and a large
   * fire zone on the right.
   */
  mountTouch(root: HTMLElement): HTMLElement {
    const el = document.createElement('div');
    el.className = 'touch';
    el.innerHTML = `
      <div class="stick-zone" aria-label="Movement: touch and drag">
        <div class="stick-base"><div class="stick-knob"></div></div>
        <div class="stick-hint">drag to move</div>
      </div>
      <div class="fire-zone"><button class="fire" tabindex="-1" aria-label="Fire">FIRE</button></div>
      <button class="tpause" aria-label="Pause">❚❚</button>
      <div class="rotate-hint">Turn your phone sideways for a bigger view</div>`;
    root.appendChild(el);
    const zone = el.querySelector<HTMLElement>('.stick-zone')!;
    const base = el.querySelector<HTMLElement>('.stick-base')!;
    const knob = el.querySelector<HTMLElement>('.stick-knob')!;
    const fireZone = el.querySelector<HTMLElement>('.fire-zone')!;
    const fireBtn = el.querySelector<HTMLElement>('.fire')!;
    const RADIUS = 46;
    const DEAD = 14;
    let stickId = -1;
    let cx = 0;
    let cy = 0;
    let dir: Key | null = null;
    const setDir = (d: Key | null) => {
      if (d == dir) return;
      if (dir) this.t.release(dir);
      dir = d;
      if (d) this.t.press(d);
    };
    zone.addEventListener('pointerdown', (e) => {
      if (stickId >= 0) return;
      e.preventDefault();
      stickId = e.pointerId;
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        /* not a real pointer (tests) */
      }
      const r = zone.getBoundingClientRect();
      cx = e.clientX;
      cy = e.clientY;
      base.style.left = `${cx - r.left}px`;
      base.style.top = `${cy - r.top}px`;
      knob.style.transform = 'translate(-50%, -50%)';
      el.classList.add('stick-on');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId != stickId) return;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      const k = dist > RADIUS ? RADIUS / dist : 1;
      knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
      if (dist < DEAD) setDir(null);
      else if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 'right' : 'left');
      else setDir(dy > 0 ? 'down' : 'up');
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId != stickId) return;
      stickId = -1;
      setDir(null);
      knob.style.transform = 'translate(-50%, -50%)';
      el.classList.remove('stick-on');
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    const firing = new Set<number>();
    fireZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!firing.size) {
        this.t.action('skip');
        this.t.press('fire');
      }
      firing.add(e.pointerId);
      fireBtn.classList.add('down');
    });
    const endFire = (e: PointerEvent) => {
      if (!firing.delete(e.pointerId)) return;
      if (!firing.size) {
        this.t.release('fire');
        fireBtn.classList.remove('down');
      }
    };
    fireZone.addEventListener('pointerup', endFire);
    fireZone.addEventListener('pointercancel', endFire);
    fireZone.addEventListener('pointerleave', endFire);
    el.querySelector('.tpause')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.t.action('pause');
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }
}
