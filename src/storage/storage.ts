// Persistent settings and high scores in localStorage. Every access is guarded:
// private browsing or blocked storage just means nothing persists.
import { sanitizeName } from '../name';

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s == null ? null : (JSON.parse(s) as T);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

// --- Settings ---------------------------------------------------------------

export type Quality = 'low' | 'medium' | 'high';

/** Rebindable actions. Each has a list of KeyboardEvent.code values. */
export type BindAction = 'left' | 'right' | 'up' | 'down' | 'fire' | 'pause';

export const DEFAULT_KEYS: Record<BindAction, string[]> = {
  left: ['ArrowLeft', 'KeyA', 'Numpad4'],
  right: ['ArrowRight', 'KeyD', 'Numpad6'],
  up: ['ArrowUp', 'KeyW', 'Numpad8'],
  down: ['ArrowDown', 'KeyS', 'Numpad2'],
  fire: ['Space', 'ControlLeft', 'ControlRight', 'F1', 'KeyZ', 'KeyJ'],
  pause: ['Escape', 'KeyP', 'Pause'],
};

/** How the remastered soundtrack plays the main tune: the 2027 band reading it
 *  straight, or the swing trio. The PC-speaker style always plays the 1983 tables. */
/** The readings of the main theme: two rendered dance tracks, an acid take and the jazz trio. */
export type MusicTheme = '2027' | 'novahead' | 'shegal' | 'nihilore' | 'jazz';

export interface Settings {
  graphics: 'hd' | 'classic';
  audio: 'hd' | 'classic';
  musicTheme: MusicTheme;
  crt: boolean;
  /** 'auto' picks a level from measured frame times. */
  quality: Quality | 'auto';
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  /** Ticks a buffered turn is remembered (0 = off, original behaviour). */
  turnBuffer: number;
  /** Game speed multiplier; 1 = original. */
  speed: number;
  reducedMotion: boolean;
  touchControls: 'auto' | 'on' | 'off';
  /** Stronger contrast between actors and earth; monsters turn violet so they never match the emeralds. */
  highContrast: boolean;
  /** Short text captions for sound cues. */
  captions: boolean;
  keys: Record<BindAction, string[]>;
}

export const DEFAULT_SETTINGS: Settings = {
  graphics: 'hd',
  audio: 'hd',
  musicTheme: '2027',
  crt: true,
  quality: 'auto',
  masterVolume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.8,
  muted: false,
  turnBuffer: 4,
  speed: 1,
  reducedMotion: false,
  touchControls: 'auto',
  highContrast: false,
  captions: false,
  keys: DEFAULT_KEYS,
};

const SETTINGS_KEY = 'digger2027.settings.v1';

export function loadSettings(): Settings {
  const s = read<Partial<Settings>>(SETTINGS_KEY) ?? {};
  const out = { ...DEFAULT_SETTINGS, ...s };
  out.keys = { ...DEFAULT_KEYS, ...(s.keys ?? {}) };
  for (const k of Object.keys(DEFAULT_KEYS) as BindAction[]) out.keys[k] = [...out.keys[k]];
  if (!s.reducedMotion && typeof matchMedia == 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
    out.reducedMotion = true;
  return out;
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}

// --- Progress -------------------------------------------------------------------

const PROGRESS_KEY = 'digger2027.progress.v1';

/** Highest level reached in any game, for the starting-level picker. */
export function maxLevelReached(): number {
  return Math.max(1, read<{ maxLevel: number }>(PROGRESS_KEY)?.maxLevel ?? 1);
}

export function recordLevel(level: number): void {
  if (level > maxLevelReached()) write(PROGRESS_KEY, { maxLevel: level });
}

// --- High scores --------------------------------------------------------------

export interface HighScore {
  name: string;
  score: number;
  date?: string;
}

const SCORES_KEY = 'digger2027.highscores.v1';
const LEGACY_KEY = 'ds';
const TABLE_SIZE = 10;

/** Older builds saved three-letter initials; they load as names. */
interface StoredScore {
  name?: string;
  initials?: string;
  score?: number;
  date?: string;
}

export class HighScores {
  private table: HighScore[];

  constructor() {
    const raw = read<StoredScore[]>(SCORES_KEY) ?? this.importLegacy();
    this.table = raw
      .filter((e) => e && typeof e.score == 'number')
      .map((e) => ({ name: sanitizeName(e.name ?? e.initials ?? '...') || '...', score: e.score as number, date: e.date }))
      .slice(0, TABLE_SIZE);
  }

  /** The old JS port stored ten space-separated scores under "ds". */
  private importLegacy(): StoredScore[] {
    try {
      const ds = localStorage.getItem(LEGACY_KEY);
      if (!ds) return [];
      const scores = ds
        .split(' ')
        .map((s) => parseInt(s, 10))
        .filter((n) => n > 0)
        .sort((a, b) => b - a);
      const table = scores.map((score) => ({ name: '...', score }));
      write(SCORES_KEY, table);
      return table;
    } catch {
      return [];
    }
  }

  list(): HighScore[] {
    return this.table.slice();
  }

  qualifies(score: number): boolean {
    if (score <= 0) return false;
    return this.table.length < TABLE_SIZE || score > this.table[this.table.length - 1].score;
  }

  add(entry: HighScore): number {
    let i = this.table.findIndex((e) => entry.score > e.score);
    if (i < 0) i = this.table.length;
    this.table.splice(i, 0, entry);
    this.table.length = Math.min(this.table.length, TABLE_SIZE);
    write(SCORES_KEY, this.table);
    return i;
  }

  reset(): void {
    this.table = [];
    write(SCORES_KEY, this.table);
  }
}
