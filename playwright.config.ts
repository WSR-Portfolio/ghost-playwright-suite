import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  testDir: './tests',

  // Prevent accidental .only from blocking CI runs
  forbidOnly: !!process.env.CI,

  // Sequential execution — test target is a low-powered NAS
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,

  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.GHOST_URL,

    // actionTimeout is the single governing default for every operation routed
    // through Playwright — both UI actions (click/fill) and API requests made via
    // the `request` fixture (Admin API + Mailpit helpers). The test target is a
    // low-powered NAS that degrades under sustained sequential load: late in a full
    // run, individual API calls that normally answer in <1s can take 15–25s before
    // responding. 30s lets those slow-but-alive calls succeed instead of tripping a
    // timeout and cascading. See docs/decisions.md §7 for the full rationale.
    // This replaces scattered per-call timeout overrides — one source of truth so
    // every current and future request inherits the correct budget automatically.
    actionTimeout: 30_000,
    navigationTimeout: 30_000,

    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Per-test budget sits comfortably above actionTimeout so a single slow operation
  // (including one in beforeEach/beforeAll setup, which counts toward this budget)
  // does not exhaust the whole-test allowance. See docs/decisions.md §7.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  globalTeardown: './tests/global-teardown',

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
