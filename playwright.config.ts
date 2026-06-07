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

    // Ghost admin panel is React — give it time to settle on slow connections
    actionTimeout: 15_000,
    navigationTimeout: 30_000,

    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  timeout: 30_000,
  expect: { timeout: 10_000 },

  globalTeardown: './tests/global-teardown',

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
