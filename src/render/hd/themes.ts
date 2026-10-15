// Per-level soil themes. Each echoes the colours of the original CGA background
// tile for that level (the classic game cycles 8 dirt patterns).

export interface Theme {
  name: string;
  /** Main soil colour. */
  base: string;
  /** Darker and lighter strata bands. */
  dark: string;
  light: string;
  /** Occasional accent flecks (moss, iron, clay). */
  accent: string;
  /** Colour of the dug tunnel walls. */
  tunnel: string;
  /** Ambient light tint. */
  ambient: string;
  /** Sky gradient at the surface. */
  skyTop: string;
  skyHorizon: string;
}

export const THEMES: Theme[] = [
  {
    name: 'Ochre Clay',
    base: '#b25a2a',
    dark: '#7c3618',
    light: '#d98a43',
    accent: '#e7b25a',
    tunnel: '#2b150c',
    ambient: '#ffcf9e',
    skyTop: '#060814',
    skyHorizon: '#2c2340',
  },
  {
    name: 'Mossy Loam',
    base: '#7a4a2a',
    dark: '#4e2d18',
    light: '#a5683a',
    accent: '#6f9a3a',
    tunnel: '#1e130b',
    ambient: '#e8f0c8',
    skyTop: '#05080f',
    skyHorizon: '#1d3040',
  },
  {
    name: 'Sandstone',
    base: '#bf7a3a',
    dark: '#8c5226',
    light: '#e2aa62',
    accent: '#f3d08a',
    tunnel: '#2e1a0d',
    ambient: '#ffe2b8',
    skyTop: '#0a0710',
    skyHorizon: '#3a2236',
  },
  {
    name: 'Peat & Moss',
    base: '#5f3f24',
    dark: '#3a2414',
    light: '#87603a',
    accent: '#7fa13e',
    tunnel: '#160d07',
    ambient: '#dfeccb',
    skyTop: '#040810',
    skyHorizon: '#16303a',
  },
  {
    name: 'Iron Earth',
    base: '#9a4126',
    dark: '#5e2414',
    light: '#c46a3c',
    accent: '#7c9a3c',
    tunnel: '#22100a',
    ambient: '#ffd2b0',
    skyTop: '#0a0610',
    skyHorizon: '#3a1e2c',
  },
  {
    name: 'Rust & Lichen',
    base: '#86391f',
    dark: '#521f10',
    light: '#a8532e',
    accent: '#8db04a',
    tunnel: '#1f0e08',
    ambient: '#f0e0c0',
    skyTop: '#060710',
    skyHorizon: '#2a2440',
  },
  {
    name: 'Banded Strata',
    base: '#a5522a',
    dark: '#6a2e16',
    light: '#d0884a',
    accent: '#6fae4a',
    tunnel: '#25120a',
    ambient: '#ffe0c0',
    skyTop: '#070612',
    skyHorizon: '#33264a',
  },
  {
    name: 'Deep Amber',
    base: '#b4602a',
    dark: '#7a3a16',
    light: '#e39a48',
    accent: '#f6c86a',
    tunnel: '#2a160b',
    ambient: '#ffd8a8',
    skyTop: '#08060e',
    skyHorizon: '#3c2430',
  },
];

export function themeFor(plan: number): Theme {
  return THEMES[(Math.max(1, plan) - 1) % THEMES.length];
}
