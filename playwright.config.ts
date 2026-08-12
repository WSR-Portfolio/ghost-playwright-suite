import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  testDir: './tests',

  // Prevent accidental .only from blocking CI runs
  forbidOnly: !!process.env.CI,

  // Parallel across spec files, but ordered within each file (fullyParallel: false).
  // The target moved off the low-powered NAS onto a dedicated i7/16GB host, so the
  // sequential accommodation of Decision 5 is no longer needed. Decision 10 covers the
  // move to workers: 4 and the setup-project dependencies below that guarantee the auth
  // specs create the shared sessions before the parallel `main` project runs. Within-file
  // order is kept (fullyParallel: false) for the AU-001->002->003 and MU-005->...->010 chains.
  fullyParallel: false,
  workers: 4,
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

  // globalSetup clears Ghost's rate-limit (brute) table before any project runs, so every
  // run starts from a clean slate (ADR §11). globalTeardown does the final member sweep.
  globalSetup: './tests/global-setup',
  globalTeardown: './tests/global-teardown',

  // Setup projects (Decision 10): the auth specs create the shared session files that the
  // rest of the suite restores via storageState. Modelling them as prerequisite projects
  // makes the "auth runs first" ordering explicit and enforced on cold checkouts (CI),
  // instead of relying on workers: 1 plus alphabetical file order. The auth specs remain
  // real test cases — this only constrains ordering. The `main` project then parallelises.
  projects: [
    {
      name: 'admin-auth',
      testMatch: /admin-ui[\\/]auth\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Depends on admin-auth purely to serialise the two sign-in flows, not because it
      // needs the admin session. Admin login (/ghost/api/admin/session) and member
      // magic-link (/members/api/send-magic-link/) both write to Ghost's shared `brute`
      // table via the same spam-prevention middleware. Run as sibling setup projects they
      // start concurrently, and because globalSetup empties `brute` immediately beforehand,
      // they race to insert into a freshly-empty table — InnoDB gap locking then produces
      // `ER_LOCK_DEADLOCK`, Ghost returns 500 from send-magic-link, and MU-004 fails with
      // Portal's generic "Failed to log in" and an empty Mailpit (observed 2026-08-12,
      // three attempts in a row). This is the same shared-bucket contention the rate-limit
      // project below already guards against; these two just went unnoticed.
      //
      // Trade-off: an admin-auth failure now also skips member-auth and its dependants.
      // That is the inverse of Decision 9's isolation (a *member* limiter trip must never
      // block the API/admin suite), which the `main` project still preserves.
      name: 'member-auth',
      testMatch: /member-ui[\\/]auth\.spec\.ts$/,
      dependencies: ['admin-auth'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // API + admin-UI specs: depend only on the admin session. A member sign-in
      // rate-limiter trip (Decision 9) is an expected, environmental condition, so it must
      // NOT block these ~80 tests — member-auth is deliberately not a dependency here.
      name: 'main',
      testMatch: /(api|admin-ui)[\\/].*\.spec\.ts$/,
      testIgnore: [/admin-ui[\\/]auth\.spec\.ts$/, /api[\\/]rate-limit\.spec\.ts$/],
      dependencies: ['admin-auth'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Member-UI specs (registration + content access): depend on the member session.
      // Isolated in their own project so a member-limiter trip affects only these tests,
      // not the API/admin-UI suite.
      name: 'member',
      testMatch: /member-ui[\\/].*\.spec\.ts$/,
      testIgnore: /member-ui[\\/]auth\.spec\.ts$/,
      dependencies: ['member-auth'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Rate-limit security test (RL-001) deliberately trips Ghost's per-IP brute limiter,
      // so it must run LAST and ALONE — depending on both test projects guarantees it never
      // executes concurrently with a sign-in test (which shares the global_reset bucket).
      // The spec resets the brute table before and after itself (ADR §11).
      name: 'rate-limit',
      testMatch: /api[\\/]rate-limit\.spec\.ts$/,
      dependencies: ['main', 'member'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
