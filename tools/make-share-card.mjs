// Renders public/share-card.png, the 1200x630 image link previews show
// (og:image / twitter:image). Social crawlers do not accept SVG, so the card is
// drawn as HTML around the favicon's digger and screenshotted with Playwright.
// Run with `npm run share-card` after changing the art.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../public/share-card.png', import.meta.url));

// Dirt speckles and the emeralds waiting ahead of the digger, on a fixed seed
// so re-running the script produces the same picture.
let seed = 2027;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
let speckles = '';
for (let i = 0; i < 260; i++) {
  const x = rnd() * 1200;
  const y = 330 + rnd() * 300;
  const r = 2 + rnd() * 7;
  speckles += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${rnd() < 0.5 ? '#6b4629' : '#472c19'}" opacity="${(0.35 + rnd() * 0.5).toFixed(2)}"/>`;
}
const emerald = (x, y, s) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-22 0l12-14h20l12 14-22 22z" fill="#2fd27a"/><path d="M-22 0h44l-22 22z" fill="#1c9a56"/><path d="M-10-14h20l-4 14h-12z" fill="#8ff5bd"/></g>`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; }
  body { width: 1200px; height: 630px; position: relative; overflow: hidden; background: #07060a;
    font-family: ui-sans-serif, system-ui, 'Segoe UI', Roboto, Arial, sans-serif; }
  svg { position: absolute; inset: 0; }
  .text { position: absolute; left: 80px; top: 62px; }
  .logo { margin: 0; font-size: 150px; font-weight: 800; line-height: 0.95; letter-spacing: 0.14em;
    background: linear-gradient(180deg, #fff3d6 0%, #f1b94a 55%, #c98a22 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    filter: drop-shadow(0 6px 26px rgba(241, 185, 74, 0.4)); }
  .year { font-size: 50px; font-weight: 800; letter-spacing: 0.9em; color: #b5a99a; margin: 14px 0 0 6px; }
</style></head><body>
<svg viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="0.3" cy="0.25" r="0.8">
      <stop offset="0" stop-color="#3a2014"/><stop offset="1" stop-color="#07060a"/>
    </radialGradient>
    <linearGradient id="dirt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5a3a22"/><stop offset="1" stop-color="#2c1a0f"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect y="330" width="1200" height="300" fill="url(#dirt)"/>
  ${speckles}
  <!-- the tunnel the digger has already dug, open behind it -->
  <path d="M0 372h640a104 104 0 0 1 0 208H0z" fill="#0d0907"/>
  ${emerald(860, 476, 2.1)}${emerald(990, 476, 2.1)}${emerald(1120, 476, 2.1)}
  <!-- the favicon's digger, scaled up -->
  <g transform="translate(425 301) scale(5.6)">
    <rect x="14" y="24" width="28" height="18" rx="5" fill="#d8402e"/>
    <rect x="20" y="18" width="14" height="10" rx="3" fill="#9fd8ff"/>
    <path d="M42 27l12 6-12 6z" fill="#e8c35a"/>
    <circle cx="20" cy="44" r="5" fill="#2a2a2e"/>
    <circle cx="36" cy="44" r="5" fill="#2a2a2e"/>
  </g>
</svg>
<div class="text"><h1 class="logo">DIGGER</h1><div class="year">2027</div></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out}`);
