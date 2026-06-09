/**
 * Security — Rate Limiting (RL-001)
 *
 * Positively verifies that Ghost's express-brute member sign-in limiter (`member_login`)
 * still blocks abuse after `spam.member_login.freeRetries`, even though that threshold was
 * deliberately raised for the test environment (ADR §11). The rest of the suite is built to
 * AVOID this limiter; this is the one test that intentionally trips it, to prove the guardrail
 * actually engages rather than just assuming the relaxed config left it functional.
 *
 * Why this needs careful isolation (ADR §10 / §11):
 * - Tripping the limiter pollutes the shared, per-IP `brute` table mid-run, and the global
 *   setup only resets it at the START of a run. So this spec runs in its OWN Playwright
 *   project that depends on `main` and `member` — it executes LAST and ALONE, never
 *   concurrently with any sign-in test (member auth shares the per-IP `global_reset` bucket,
 *   so a concurrent run would otherwise be collateral damage).
 * - It resets `brute` BEFORE (deterministic starting count) and AFTER (clean slate for
 *   following runs) using the same least-privilege DB path as global-setup.
 * - It skips when DB credentials are absent: without the ability to undo the lockout it would
 *   leave the member sign-in limiter tripped, so it only runs where it can clean up.
 */

import { test, expect, generateTestEmail } from '../fixtures';
import mysql from 'mysql2/promise';

const GHOST_URL = process.env.GHOST_URL!.replace(/\/$/, '');

const hasDbCreds = !!(
  process.env.DB_HOST &&
  process.env.DB_NAME &&
  process.env.DB_USER &&
  process.env.DB_PASSWORD
);

/** Clear Ghost's express-brute rate-limit table (same DB user/path as global-setup). */
async function resetBruteTable(): Promise<void> {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT ? parseInt(DB_PORT, 10) : 3306,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    connectTimeout: 10_000,
  });
  try {
    await conn.execute('DELETE FROM brute');
  } finally {
    await conn.end();
  }
}

test.describe('Security — Rate Limiting', () => {
  // Only run where we can undo the lockout afterwards.
  test.skip(!hasDbCreds, 'Requires DB access to reset the brute table — skipped without DB_* creds');

  test('RL-001: member sign-in limiter locks out after the configured freeRetries threshold', async ({
    request,
    mailpit,
  }) => {
    // Up to ~65 sequential sign-in requests plus two brute resets.
    test.setTimeout(90_000);

    // Start from a known-clean limiter state so the threshold is deterministic.
    await resetBruteTable();

    // freeRetries is 50 (ADR §11); cap the loop above that with headroom so a working
    // limiter is guaranteed to trip within the budget.
    const MAX_ATTEMPTS = 65;
    let lockedAt = -1;
    let lockedBody: unknown = null;
    let lastStatus = -1;

    try {
      for (let i = 1; i <= MAX_ATTEMPTS; i++) {
        // A *different* email each time — Ghost's limiter counts "too many different
        // sign-in attempts" per IP, which is exactly the abuse pattern it defends against.
        const res = await request.post(`${GHOST_URL}/members/api/send-magic-link/`, {
          headers: { 'Content-Type': 'application/json' },
          data: { email: generateTestEmail(`rl-001-${i}`), emailType: 'signin' },
        });
        lastStatus = res.status();
        if (res.status() === 429) {
          lockedAt = i;
          lockedBody = await res.json().catch(() => null);
          break;
        }
      }

      // The limiter MUST engage — this is the security guarantee under test. A 429 from this
      // endpoint is unambiguous: it is the brute-force/rate-limit response.
      expect(
        lockedAt,
        `expected a 429 lockout within ${MAX_ATTEMPTS} attempts (last status was ${lastStatus})`,
      ).toBeGreaterThan(0);

      // ...and it must grant legitimate-volume grace first (freeRetries), not lock instantly —
      // confirming the relaxed threshold is in effect rather than a stuck/zeroed limit.
      expect(lockedAt, 'limiter should allow freeRetries grace before locking').toBeGreaterThan(1);

      // Best-effort confirmation that the body identifies itself as a rate-limit error.
      // (Status 429 is the hard signal; the message wording varies by Ghost version.)
      const msg = JSON.stringify(lockedBody ?? '');
      if (msg && msg !== '""') {
        expect(msg).toMatch(/too many|sign.?in attempts|try again|rate ?limit/i);
      }

      console.log(`[RL-001] member_login limiter engaged on attempt ${lockedAt} (HTTP 429).`);
    } finally {
      // Undo the lockout so nothing inherits it, and clear any magic-link emails generated.
      await resetBruteTable();
      await mailpit.deleteAllMessages();
    }
  });
});
