# Digger 2027

**▶ Play it: <https://aeven-ai.github.io/Digger/>** — this build, with the 2027 tune and full-name high scores.

Forked from [ubershmekel/digger-2027](https://github.com/ubershmekel/digger-2027) at `ed7c4ec`, GPL-2.0-or-later. Everything below is this build: it is not on upstream's own page, which is an older pre-fork build.

A fan-made, modern version of the original 1983 **[Digger](https://en.wikipedia.org/wiki/Digger_(video_game))** (Windmill Software, designed by Rob Sleath), a Mr. Do! / Dig Dug-style maze game.

It's the same game: the same eight levels, the same rules, monster AI, timing and tunes, verified tick-for-tick against the original logic. What's new is the presentation and the comfort: real-time 3D graphics, jazz arrangements of the original music, and modern quality-of-life features. Press **F2** at any time to switch to the original CGA graphics, and **F4** for the original PC-speaker sound.

> License: **GPL-2.0-or-later** (see [LICENSE](LICENSE)). The upstream Digger Remastered code is GPLv2.
>
> Inspiration and behaviour reference: the browser port at <https://www.futrega.org/digger/>.

## Controls

| Action | Keys |
|---|---|
| Move | Arrow keys or WASD |
| Fire | Space, Ctrl, F1, Z or J |
| Pause | Esc or P |
| Classic graphics on/off | F2 |
| Classic sound on/off | F4 |
| Mute | M |
| Fullscreen | F |
| Skip a cut-scene | Fire twice (a prompt appears) |

Movement, Fire and Pause keys can be rebound in **Settings → Controls**, which also lists every hotkey.

Gamepads work (D-pad or stick, A to fire, Start to pause). On touch devices, touch anywhere on the left and drag to steer with a floating joystick, and tap anywhere on the right to fire. The touch controls hide whenever a menu is open.

## Development

```bash
npm install
```
```bash
npm run dev
```

- `npm test` runs the unit and parity tests.
- `npm run lint` runs [oxlint](https://oxc.rs/). TypeScript 7's native compiler has no JS API, so typescript-eslint can't run.
- `npm run build` makes a static build in `dist/`.
- `npm run e2e` runs Playwright smoke tests against the build in Chromium, Firefox and WebKit.
- `npm run music` re-renders all three 2027 tracks into `public/audio/` (needs `ffmpeg` with `libopus`; it takes a few seconds).

Every push to `main` runs all of these in CI and then deploys to GitHub Pages (`.github/workflows/deploy.yml`). The built site works offline after the first visit, via a service worker.

Dev helpers: `?autoplay` (or `?autoplay=3` for level 3) jumps straight into a game, and `window.app` is exposed in dev builds.

---

## 1. Goals

| Goal | What it means in practice |
|---|---|
| **Plays like the original** | Same 8 levels, scoring, monster AI, bag physics, bonus mode, fire recharge, extra lives, 1P/2P alternating. Same logic tick rate. Veterans should not have to relearn anything. |
| **Sucks less** | Smooth rendering at any refresh rate, responsive layout, proper pause, turn buffering, gamepad and touch support. |
| **3D, cinematic, recognisable** | Real 3D models and lighting in a side-on diorama. Every entity keeps its silhouette, palette cues and animation beats from the CGA sprites. |
| **Beautiful music, same notes** | Jazz arrangements of the *same* melodies: the main theme, the bonus-mode theme, the death dirge and the level jingle. Sound effects keep their original pitch contours, with richer timbre. |
| **Never make the player wait** | Every cut-scene and transition is skippable. Skipping fast-forwards the game logic, so nothing desyncs. |
| **Quality of life** | Separate master, music and effects volume, mute, pause, gamepad, touch controls, high scores saved in the browser. |
| **Classic mode** | Hotkeys and menu toggles switch the graphics (F2) and the sound (F4) back to the original CGA look and PC-speaker sound, live, mid-game, and back again. The year button in the top corner (2027 ⇄ 1983) switches both at once. |

### Non-goals (for v1)
- New levels, new enemies or rule changes. (A level editor or "remix" mode could come after 1.0.)
- Online leaderboards or accounts.
- Native or mobile app stores. It's a web game; a PWA install is enough.

---

## 2. How it stays faithful

The game logic is a TypeScript port of the browser port at [futrega.org/digger](https://www.futrega.org/digger/), which itself comes from Andrew Jenner's C *Digger Remastered*. The port keeps the original module structure (`main`, `digger`, `monster`, `bags`, `drawing`, `sprite`, `scores`, `sound`) and constants unchanged.

- **The original screen is part of the game state.** Digger's fireball detects dirt by reading screen pixels, so the sim keeps an exact virtual 320×200 CGA framebuffer. That makes the logic bit-exact, and classic mode simply displays that buffer.
- **The flow is a generator.** The original's async loops became a generator that yields "wait N ms". That keeps the sim deterministic and lets any cut-scene be fast-forwarded.
- **Parity test.** `tests/parity.test.ts` runs the original JS side by side with the port, on the same seed and scripted input, and compares the framebuffer and state after every tick. It runs locally when the reference sources are present in a gitignored `old/` folder, and is skipped otherwise.
- **One fix:** the reference JS port skipped a level when the last emerald was collected (it advanced the level twice). The port follows the C original instead.

### Rules checklist (must match exactly)
- Dig horizontal and vertical tunnels; each level starts with some tunnels pre-dug.
- Monsters spawn at the top-right as **Nobbins**. They sometimes turn into **Hobbins** (more often on higher levels). Hobbins dig, and they destroy emeralds and gold bags in their path.
- When a monster dies, another spawns, up to a per-level maximum. Once they've all spawned, a **cherry** appears top-right. Eating it starts **bonus mode** (≈15 s, shorter on higher levels): monsters flee and the Digger can eat them.
- Undermined bags wobble, then fall. A bag **breaks into gold only if it falls more than one row**. Bags can be pushed left and right. Falling bags squash monsters *and* the Digger.
- The weapon fires in a straight line, then recharges. Recharge takes **longer on higher levels**.
- A level ends when **all emeralds are collected or all monsters are killed**.
- Scoring: emerald 25, 8-in-a-row bonus 250, monster kill (shot or squashed) 250, gold 500, entering bonus mode 1000, bonus eats 200 / 400 / 800… (doubling), extra life every 20,000.

---

## 3. Architecture

```
               ┌────────────────────────────────────────────┐
  Input ──────▶│  SIM (pure TS, deterministic, no DOM)      │
 (kbd/pad/touch)│  76 ms tick, seeded RNG, virtual CGA screen│
               └──────────┬───────────────────┬─────────────┘
                          │ state + events    │ sound commands
               ┌──────────▼─────────┐  ┌──────▼───────────────┐
               │ RENDERER (swappable)│  │ AUDIO (swappable)    │
               │  • HD: Three.js     │  │  • HD: jazz + synth  │
               │  • Classic: CGA 2D  │  │    effects           │
               │  interpolates ticks │  │  • Classic: PC       │
               └────────────────────┘  │    speaker worklet   │
                                        └──────────────────────┘
               UI layer (HTML/CSS overlay): menus, HUD, settings
```

1. **The sim never touches rendering.** It exposes its state (sprite table, dug mask, emeralds, scores) and emits *events* (`emerald`, `bagLand`, `gold`, `monsterKilled`, `explode`, `diggerHit`, `levelStart`…) plus the original's sound commands.
2. **Fixed-timestep sim, interpolated rendering.** The sim runs at the original rate (1000/13 ms per tick). The 3D renderer draws at display refresh and interpolates between ticks.
3. **Renderers and audio backends are hot-swappable** on the same live sim.

### Layout
```
src/
  sim/          # the ported game logic, levels and extracted CGA data
  app/          # frame driver (fixed-rate stepping, pause, skip) and app wiring
  render/
    classic/    # shows the virtual CGA framebuffer
    hd/         # Three.js scene, terrain, procedural models, textures, effects
  audio/
    classic/    # AudioWorklet port of the original PC-speaker engine
    hd/         # synthesized instruments, arrangements, jazz backend
  input/        # keyboard, gamepad, touch
  ui/           # menus, settings, HUD, high scores, initials
  storage/      # localStorage for settings and high scores
tools/          # extract-data.mjs: CGA sprites and font → TypeScript data
tests/          # parity test against the reference port
```

---

## 4. Visuals (HD mode)

- **Camera:** a side-on diorama with a slight downward tilt. The whole playfield is always on screen, as in the original. A gentle drift, shakes on impacts and an ease-in on death are all disabled by "Reduced motion".
- **Earth:** a cross-section slab whose front face is a heightfield carved live from the sim's per-pixel dug mask, with crumbly edges. Each level has its own soil theme, derived from the colours of the original's eight dirt patterns. A grassy surface and night sky sit above.
- **Lighting:** a key light with soft shadows, the Digger's headlamp, fireballs and explosions as real lights, plus bloom.
- **Characters**, built procedurally in code (`src/render/hd/models.ts`) and modelled on the CGA sprites:
  - **Digger:** a red machine with yellow wheels and a green drill that pumps in and out like the sprite's scoop. Its yellow hoop stands tall when the weapon is ready and sinks while recharging.
  - **Nobbin:** a green body with two big yellow eyes on top and red legs planted wide.
  - **Hobbin:** side-on and spiky, with one yellow eye and snapping red jaws, facing the way it travels. Nobbins pop into Hobbins with a puff of smoke.
  - **Gold bag:** a leather sack with a `$` that wobbles, falls and bursts into a heap of coins.
  - Also faceted **emeralds**, the **cherry**, the **fireball**, and the **gravestone**.
- **Effects:** particles, tossed coins, score popups and title cards.
- **Title screen:** the original cast introduction, restaged in a cave, beside the menu and a high-score table.

## 5. Audio (HD mode)

Composed as code, and synthesized: no samples ship with the game.

| Cue | Original table | Arrangement |
|---|---|---|
| Main theme (*Popcorn*) | `backgjingle` | Medium swing in D minor: vibes lead, then a Rhodes chorus. Walking bass, brushes then sticks. Two choruses, looped. |
| Bonus (*William Tell*) | `bonusjingle` | Up-tempo hard bop: muted trumpet lead with band hits on the long notes. |
| Death (Chopin's *Funeral March*) | `dirge` | Piano in octaves over strings. |
| Level complete | `newlevjingle` | Vibes arpeggios over lush Rhodes chords and a cymbal swell. |

- **Instruments:** FM electric piano, vibraphone, upright bass, muted trumpet, strings, piano, and a drum kit (ride, hi-hat, brushes, snare, kick). All are synthesized with Web Audio (`src/audio/hd/instruments.ts`).
### The 2027 tracks

The 2027 tune is not synthesized in the browser. `npm run music` renders the club reading
of the 1983 melody offline into `public/audio/`, note for note, and `npm run songs` adds
three licensed songs beside it:

| Track | What it is |
|---|---|
| `digger-2027.opus` | Club mix at 126 bpm: four on the floor, open hats on the off-beats, the tune on a saw lead with the riff an octave below, a breakdown and a riser. |
| `digger-novahead.opus` | *Fractured Light* — nova head. A three-minute loop. |
| `digger-shegal.opus` | *Pixel gangster Mario is drinking in Miami* — Vlad Shegal. A three-minute loop. |
| `digger-nihilore.opus` | *The Water and the Well* — Nihilore. A three-minute loop. |

`tools/music/` does the work offline, where there is no realtime budget:

- **`render-real.ts`** turns the cue from `src/audio/hd/compose.ts` into MIDI and plays it
  through **FluidR3 Mono GM**, an MIT-licensed General MIDI soundfont (Frank Wen, Michael
  Cowgill), so the club mix is played by a sampled drum kit, a fingered bass and a clavinet
  rather than oscillators. `fluidsynth` renders one stem per group.
- **`mix.ts`** balances the four stems, ducks the melodic ones under each kick, adds a room
  and a three-sixteenth delay throw, and masters the result to a limited, normalised loop.
- **`songs.ts`** downloads each licensed song, folds its tail back over its head so the
  loop has no seam, matches its loudness to the club mix and encodes it.

The game plays those files, and falls back to synthesizing the club cue in the browser if a
file will not decode, so browsers without Opus still get music.

**Song credits, and what each licence asks for.** *Fractured Light* by nova head is CC0 1.0
— a public domain dedication, no conditions. *Pixel gangster Mario is drinking in Miami* by
Vlad Shegal and *The Water and the Well* by Nihilore are CC BY (3.0 and 4.0): keep the
credit wherever the game is distributed, which is what this section and
`tools/music/songs.ts` are for. Sources: the `nova-head-fractured-light`, `fsr017` and
`nihilore-broken-parts` items on the Internet Archive.

- **Rendering:** each cue is bounced when the game starts. Every distinct sound (instrument, pitch, rounded length and velocity) is synthesized once in an `OfflineAudioContext`. The notes are then mixed in plain JS, and reverb and mastering run in a single pass. That's about a tenth as many synthesized voices as notes. Looping cues get their reverb tail folded back onto the start, so the loop is seamless. The first jazz game waits for the main theme behind a progress bar, or you can skip ahead and let the music join later.
- **Effects** are synthesized live and follow the original's pitch contours. Emerald pickups climb the original C-major scale on vibes. A falling bag gets a dropping whistle and a wobbling bag creaks. Gold goes "cha-ching". Eating monsters gulps higher with each bite. Death is a sad muted trombone.

> **Decision:** the main theme is *Popcorn* (Gershon Kingsley, 1969), in a jazz arrangement, as in every Digger version. The bonus theme (Rossini) and the dirge (Chopin) are public domain. *Popcorn* is still under copyright, and an arrangement doesn't change that. That's fine for a free fan project, but it would need revisiting before any commercial release. The three licensed songs are CC0 and CC BY, so they ship as they are, with the credits above.

## 6. Classic mode

- **Graphics (F2):** the sim's own CGA framebuffer, scaled with nearest-neighbour filtering, with an optional CRT overlay.
- **Sound (F4):** the original PC-speaker engine, ported to an AudioWorklet. Music and effects are on separate channels, so the volume sliders still work.

## 7. Quality-of-life features

- [x] Master, music and effects volume, plus mute (M). All settings persist and apply live.
- [x] Audio unlocks on the first interaction, via a "press any key" start screen.
- [x] Rebindable movement, Fire and Pause keys, plus a full hotkey list in Settings.
- [x] Gamepad support.
- [x] Touch controls: a floating joystick (touch, then drag) and a large fire zone, shown only during play.
- [x] Turn buffering *(experimental)*: a turn pressed just before a junction is remembered and taken when legal. Off / Short / Normal / Long; Off plays exactly like 1983.
- [x] Auto-pause when the tab or window loses focus.
- [x] Game speed: Slow / Original / Fast.
- [x] 1P / 2P alternating, as in the original.
- [x] Starting-level select, for any level you've reached.
- [x] Every cut-scene is skippable: Fire twice. A skipping press never becomes a shot, and Fire is ignored for a moment as each life starts.
- [x] In 3D, the screen fades to black after a death and fades back in on revive.
- [x] High scores (top 10 with initials) kept in `localStorage`, surviving restarts. Old `ds` scores from the reference port are imported. Reset is in Settings.
- [x] Graphics quality: Auto (steps down when frames are slow, and switches to classic if even Low is unplayable), Low, Medium, High.
- [x] Fullscreen (F or Settings).
- [x] Accessibility: reduced motion; high contrast (darker earth, brighter actors, violet monsters so they never blend with emeralds); captions for sound cues.
- [x] Offline play after the first visit.

---

## 8. Roadmap

### Phase 0: Foundations
- [x] Vite + TS + Three.js project skeleton, Vitest, CI.
- [x] GitHub Pages deploy via GitHub Actions.
- [x] `tools/extract-data.mjs`: CGA sprites and font extracted into TypeScript data.
- [x] Measure the reference timing (76 ms ticks).
- [x] Lint (oxlint) and Playwright smoke tests.

### Phase 1: Faithful sim + classic renderer
- [x] Port the sim module by module, typed, with no globals or DOM.
- [x] Fireball collision: kept the original pixel reads, on a virtual framebuffer, for exact behaviour.
- [x] Classic renderer and classic audio running on the new sim.
- [x] Scene state machine with skip/fast-forward for every cut-scene.
- [x] Tick-for-tick parity test against the reference port.

### Phase 2: HD renderer
- [x] Diorama camera, earth slab, live tunnel carving.
- [x] 3D models for all entities, interpolation, events driving effects.
- [x] Live HD ⇄ Classic toggle.

### Phase 3: Audio
- [x] Mixer buses (master/music/effects), settings UI, persistence.
- [x] Synthesized instruments, the 4 arranged cues, offline-rendered seamless loops. Rendering is segmented, so the main theme is ready in seconds.
- [x] Effects set, plus the classic/jazz toggle (F4).
- [x] Beat-synced transitions between the main and bonus themes; loudness normalization.

### Phase 4: Art & polish
- [x] Procedural models and animations: Digger, Nobbin, Hobbin (plus the morph), bag, gold, emerald, cherry, fireball, gravestone.
- [x] Level soil themes, lighting, post-processing, particles.
- [x] Title / cast sequence with entrances and exits, high scores, level title cards, game over and high-score entry.
- [x] Entrance animations for every actor in 3D.
- [x] Quality presets with automatic detection.

### Phase 5: QoL & ship
- [x] Gamepad, touch, rebinding, accessibility options, PWA manifest, offline cache.
- [x] Automated smoke tests in Chromium, Firefox and WebKit (desktop engines). Real iOS and Android devices haven't been tested yet.
- [x] v1.0 release.

### Later / maybe
Replays and sharing, a daily-seed challenge, a level editor, "remix" levels, simultaneous 2P co-op (Digger Remastered added a simultaneous 2-player mode).

---

## 9. Decisions

| Topic | Decision |
|---|---|
| Name | **Digger 2027**. *Digger HD* (Creat Studios, PS3, 2009) and *Digger Remastered* (Andrew Jenner) are both taken. |
| License | **GPL-2.0-or-later**, to match the GPLv2 upstream. |
| Main theme | **Popcorn**, jazz-arranged (see §5). |
| Art | Made by Claude, procedurally and as code. |
| Music & SFX | Composed and synthesized by Claude, as code. |
| Turn buffering | Experimental. On by default ("Normal"), tunable, and the final default is decided after playtesting. |
| High scores | Persistent `localStorage`, surviving browser restarts. |
| Cut-scenes | All skippable, via fast-forward in the sim. |

---

## 10. Credits

- Original *Digger* © 1983 Windmill Software. Designed by Rob Sleath; released under the GNU GPL in 1998.
- *Digger Remastered* by Andrew Jenner ([digger.org](http://www.digger.org/)).
- The browser port at [futrega.org/digger](https://www.futrega.org/digger/), the inspiration and behaviour reference for this project.
- Digger 2027 is a fan-made, modern version of the original game, licensed under the GNU GPL v2 or later.
