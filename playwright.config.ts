import { defineConfig, devices } from '@playwright/test';

// Smoke tests against the production build (run `npm run build` first).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  retries: process.env.CI ? 1 : 0,
  // On CI, failures show up as annotations on the run.
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: 'http://localhost:4173/', viewport: { width: 1280, height: 720 } },
  webServer: { command: 'npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 720 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 720 } } },
  ],
});
