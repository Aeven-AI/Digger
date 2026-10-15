# Digger 2027 — fan remake, with local changes

This repository is **[ubershmekel/digger-2027](https://github.com/ubershmekel/digger-2027)**
at the pinned commit below, plus the changes listed further down: a fan-made remake of
the 1983 Windmill Software game *Digger* by Rob Sleath. It is the source tree —
`npm install && npm run dev` runs it. `README.md` is upstream's, and describes the game.

| Path | What it is |
|---|---|
| `src/` | The simulation, the two renderers (1983 CGA and 3D), the audio backends and the UI. |
| `tests/` | Vitest unit tests; `tests/e2e/` holds the Playwright smoke tests. |
| `tools/` | Build helpers. `tools/music/` renders the club mix through a soundfont and folds the licensed songs into loops. |
| `public/` | Icons, the share card, the service worker, and the rendered tunes (`audio/`). |
| `README.md`, `LICENSE` | Upstream documentation and licence (GPL-2.0-or-later). |

A copy of this with a double-clickable `play.command`, the built site and this source
also sits in `~/Downloads/games/digger`.

## Provenance

- Upstream: <https://github.com/ubershmekel/digger-2027>
- Commit: `ed7c4ecd61524b888147658264c5b728a4585719` (2026-10-02), plus the local changes below.
- Licence: GPL-2.0-or-later. The modified source is included here, as that licence requires.
- Built with Node 22.22.0 / npm 10.9.4 on macOS (arm64): `npm ci && npm run build`

## Music

- **Changing tunes mid-game.** **F3** (or **N**, or the pause menu's **Next tune ▸**)
  steps through every tune the game can play, in this order: 2027 club → 2027 drum and
  bass → 2027 acid → Popcorn as the 1983 swing → the original 1983 PC-speaker tunes. A caption names what started playing. It starts on the 2027 theme
  and each press is remembered, so the next session begins with the one you left on.
- **The 1983 tune is in here.** The original PC-speaker tables are shipped as-is
  (`src/audio/tunes.ts`): *Popcorn* as the main theme, the William Tell galop in bonus
  mode, Chopin's funeral march on a death, plus the level jingle. **F4** switches the
  whole soundtrack between the 2027 band and that PC-speaker emulation, and
  **Settings → Audio → Sound style** does the same thing from the menu.
- **Four tunes.** Settings → Audio → *Main theme*, or the pause menu's **Next tune ▸**,
  picks between:
  - **2027 club** (default): the 1983 melody, note for note, played by a General MIDI
    soundfont — sampled kit, fingered bass, clavinet — over a four-on-the-floor beat with
    open hats on the off-beats, a two-bar breakdown and a riser into the second half. It is
    rendered **offline ahead of time** into `public/audio/digger-2027.opus` (46 s, loops
    seamlessly): `tools/music/render-real.ts` writes the cue from
    `src/audio/hd/compose.ts` to MIDI and plays it through FluidR3 Mono GM (MIT, by Frank
    Wen and Michael Cowgill) with `fluidsynth`, then `tools/music/mix.ts` balances the
    stems, ducks the melodic parts under each kick, adds a room and a delay throw, and
    limits and normalises the master. Re-render with `npm run music`.
  - **Three licensed songs**, wired in by `npm run songs`, which downloads each source,
    folds its tail over its head for a seamless three-minute loop, matches its loudness to
    the club mix and encodes it to Opus: *Fractured Light* by nova head (CC0 1.0),
    *Pixel gangster Mario is drinking in Miami* by Vlad Shegal (CC BY 3.0) and *The Water
    and the Well* by Nihilore (CC BY 4.0). The two CC BY tracks keep their credit wherever
    the game is distributed; see README.md.
  - **1983 swing**: upstream's jazz-trio arrangement of the same melody, unchanged
    (`mainTheme()`).

  Switching between them lands on a beat, and `tests/theme.test.ts` holds the 2027
  reading to the original melody note for note.

## Local changes in this copy

1. **Gentler opening rooms.** Monsters step on a slowed cadence in the early rooms
   (`monsterPace()` in `src/sim/main.ts`: 4 ticks in room 1, 3 in rooms 2–3, 2 in rooms
   4–6, the original single tick from room 7 on), and Nobbins stay green for the first
   two rooms instead of turning into tunnel-digging Hobbins straight away.
2. **The Warden**, an end boss in every fifth room — rooms 5, 10, 15 and so on, and
   nowhere else (checked across the first twelve rooms). It replaces the bonus cherry
   for that room, takes 3 hits plus one more per ten rooms, freezes for about a second
   after each hit, and telegraphs a charge (a brief burst of full-speed pursuit) before
   closing in. A gold bag dropped on it kills it outright. The room is only over when it
   is down. It is a giant crowned Nobbin — the same silhouette as the ordinary monster,
   violet with gold spikes and lit eyes — so it still looks like this game. Sim in
   `src/sim/monster.ts`, model in `src/render/hd/models.ts`, hit-point bar in `src/ui/ui.ts`.
   Beatable by design: slower than the monsters around it, and it never digs.
3. **Full names in the high-score table** instead of three initials: up to 12 characters,
   letters, digits, spaces and `.'-`, with accents and curly quotes folded to ASCII
   (`src/name.ts`). Both the HTML entry screen and the classic 1983 screen show the name.
   Existing three-letter entries from earlier versions still load.
4. **A straight, cheaper 3D view.** The camera no longer tilts at all (7° → 0°) and its
   field of view is 24° narrower, so the playfield is a flat side-on diorama rather than
   a wide-angle shot; idle camera drift is a fraction of what it was. Render scale is
   capped at 1.5× device pixels (was 2×), and the shadow map and bloom are back to their
   original sizes — that is most of the frame-time saving.
5. **Fixed two things found while looking at the result**: the Warden's hit-point bar no
   longer shows outside boss rooms (`display: flex` was beating the `hidden` attribute),
   and `PCFSoftShadowMap` — removed in the bundled Three release — is now requested as
   `PCFShadowMap`, which also silences the console warning.

## Checks run against this build

- `npm test` — 12 passed. `tests/warden.test.ts` covers the room-1-to-room-7 pace, the
  Warden's spawn, hit points, stun, the room-completion gate, the bag kill, and name
  sanitising; `tests/theme.test.ts` holds both readings of the main theme to the 1983
  melody, note for note. Upstream's `tests/parity.test.ts` self-skips: it compares
  against a reference port that upstream expects in a gitignored `old/` directory.
- `npx tsc --noEmit` — clean. `npm run lint` — clean. `npm run build` — clean.
- Driven over the Chrome DevTools Protocol: room 5 spawns the Warden (3 hit points, bar
  shown, one hit takes it to 2), the name screen accepts and caps a full name, no
  uncaught errors, and 120 consecutive frames measured 8.3 ms median / 9 ms worst with
  the Warden on screen.
- The music was checked the same way, in the browser that plays it: the page fetches
  `audio/digger-2027.opus`, Chrome decodes it to 45.714 s of stereo at 48 kHz, and the
  running game hands that exact buffer to a looping buffer source (recorded by hooking
  `createBufferSource` in the page). The decoded file peaks at −0.7 dBFS, and the step
  across the loop point is smaller than the typical step inside the loop, so the repeat
  has no seam.

## Why it wants a local server

The build uses ES modules and a service worker, so opening `dist/index.html` directly
from the filesystem (a `file://` URL) is blocked by the browser. `npm run preview` (or
any static server) serves it over `http://localhost` instead; the game then keeps
working offline after the first load. The copy in `~/Downloads/games/digger` does the
same thing from `play.command`.

## Playing

The remake defaults to 3D graphics with jazz arrangements. Press **F2** for the original
1983 CGA graphics and **F4** for the original PC-speaker sound, or use the **2027 ⇄ 1983**
switch on the title screen. Full controls are in `README.md` and under Settings → Controls.
