/**
 * Global setup — runs once before any project (including the admin-auth and
 * member-auth setup projects of Decision 10) starts.
 *
 * Its sole job is to clear Ghost's `brute` table, which is where express-brute
 * stores rate-limit state for all three buckets — admin login (user_login),
 * member sign-in (member_login), and the per-IP global_reset. Clearing it gives
 * every run a clean rate-limit slate regardless of what previous runs left
 * behind, which is the root-cause fix for the cross-run lockout cascades that
 * previously forced CI cadence rules and the MU-001 self-skip (ADR §8/§9/§11).
 *
 * Credentials come from the DB_* env vars. The dedicated DB user has DELETE on
 * the brute table only (see ADR §11), so a leak of these creds cannot touch
 * content or members. If the creds are absent — e.g. a developer running from a
 * machine that cannot reach Ghost's MySQL, or a checkout without DB access — this
 * setup logs a warning and no-ops rather than failing the run; the tuned `spam`
 * config (freeRetries: 50) still keeps a single run comfortably under the limit.
 */

import { FullConfig } from '@playwright/test';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function globalSetup(_config: FullConfig): Promise<void> {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;

  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
    console.warn(
      '[globalSetup] DB credentials not set — skipping brute-table reset. ' +
        'Set DB_HOST, DB_NAME, DB_USER, DB_PASSWORD to enable (the tuned spam ' +
        'config still protects a single run).',
    );
    return;
  }

  let connection: mysql.Connection | undefined;
  try {
    connection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT ? parseInt(DB_PORT, 10) : 3306,
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASSWORD,
      // Fail fast rather than hanging the whole run if the DB is unreachable
      connectTimeout: 10_000,
    });

    const [result] = (await connection.execute('DELETE FROM brute')) as unknown as [
      { affectedRows: number },
    ];
    console.log(`[globalSetup] brute table cleared — ${result.affectedRows} row(s) deleted.`);
  } catch (err) {
    // A failed reset is recoverable (the tuned spam config still applies), so log
    // and continue rather than aborting the entire run.
    console.error('[globalSetup] Failed to clear brute table — continuing:', err);
  } finally {
    await connection?.end();
  }
}

export default globalSetup;
