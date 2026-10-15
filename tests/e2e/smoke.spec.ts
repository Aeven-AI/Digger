// Smoke tests against the production build in each browser engine.
import { expect, test, type Page } from '@playwright/test';

/** Collects uncaught errors and console errors, ignoring headless GPU/audio noise. */
function watchErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() == 'error') errors.push(m.text());
  });
  return () => errors.filter((e) => !/WebGL|GPU|Audio|AudioContext|autoplay|3D renderer/i.test(e));
}

async function start(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page).toHaveTitle('Digger 2027');
  await page.getByRole('button', { name: 'Press any key to begin' }).click();
  await page.getByRole('button', { name: '1 Player' }).click();
}

test('plays, pauses, opens settings and quits (classic mode)', async ({ page }) => {
  // Classic mode keeps this flow fast and deterministic on every engine, GPU or not.
  await page.addInitScript(() =>
    localStorage.setItem('digger2027.settings.v1', JSON.stringify({ graphics: 'classic', audio: 'classic' })),
  );
  const errors = watchErrors(page);
  await start(page);
  await expect(page.locator('canvas.classic-canvas')).toBeVisible();

  // Skip the level intro, then move and fire.
  await expect(page.getByText('Fire twice to skip')).toBeVisible();
  await page.waitForTimeout(500); // presses in the first moment of a cut-scene don't count
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('Space');
  await page.keyboard.press('F4');
  await page.keyboard.press('F4');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('All hotkeys')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Quit to Title' }).click();
  await expect(page.getByRole('button', { name: '1 Player' })).toBeVisible({ timeout: 10_000 });
  expect(errors()).toEqual([]);
});

test('the remastered 3D mode boots, or falls back to classic cleanly', async ({ page }) => {
  const errors = watchErrors(page);
  await start(page);
  // Either the 3D canvas is up, or (no WebGL / too slow) the game switched to classic and said so.
  await expect(page.locator('canvas.hd-canvas, canvas.classic-canvas').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  expect(errors()).toEqual([]);
});
