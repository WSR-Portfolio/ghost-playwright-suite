# Ghost Playwright Suite — Rate Limit Cleanup Plan

**Status:** ✅ COMPLETE — All steps done. The admin-2FA empirical check (Step 5) passed: with the brute reset active, two cold admin logins minutes apart both succeeded, confirming the 2FA limiter lives in the `brute` table. `retries: 0` removed and the §8 cadence rule retired. CI green at 92 passed with `brute table cleared` confirmed in the log. **CI note:** `DB_HOST` secret is `ghost-stack-db-1` (the MySQL container name on the shared `ghost-stack_default` Docker network) — `127.0.0.1` does not work from inside the runner container.  
**Gating condition:** Infra changes (Steps 1–2) must be completed and verified before any code changes begin.  
**Estimated total effort:** ~3–4 hours across infra + code + docs

**Corrections incorporated (Claude Code review, confirmed by Sonnet):**
1. `retries: 0` lives in `test.describe.configure()` inside `tests/admin-ui/auth.spec.ts` (~line 54), **not** a `playwright.config.ts` project — Step 5 edits the spec file.
2. Step 2 uses a dedicated `brute_reset_user` user with `GRANT DELETE ON ghost_db.brute` only (least privilege); `DELETE FROM brute`, not `TRUNCATE` (which needs `DROP`).
3. Step 5 (admin-2FA limiter) is the **linchpin**: ADR §8's cadence-rule-obsolete language is held until that check passes; both outcomes documented.
4. Step 2 includes a `docker compose port mysql 3306` reachability check before wiring credentials.
5. `globalSetup` fires once before all projects (including the §10 setup projects) — no ordering conflict; documented in ADR §11.

---

## Background

The suite currently contains several accommodations that exist solely because Ghost's `express-brute` rate limiters fire unpredictably across CI runs. Now that we understand the limits (configurable, IP-based, stored in the `brute` MySQL table), we can address them at the source rather than coding around them.

**The two root fixes:**

1. **Tune Ghost's spam config** — raise `freeRetries` so a normal test run never comes close to tripping the limit
2. **Reset the `brute` table at the start of every run** — gives every run a clean rate-limit slate regardless of what previous runs left behind

**What stays:** Every accommodation that reflects realistic usage (session caching, cookie reuse, the magic-link + Mailpit flow itself) is kept. We're removing workarounds, not test coverage.

---

## Step 1 — Infra: Edit `config.production.json` on Ghostbox

**Owner:** You (ghostbox)  
**Effort:** ~15 minutes  
**Requires:** Ghost restart after the edit

### What to add

Open `config.production.json` on the ghostbox and add the `spam` block as a top-level sibling of the existing keys (alongside `database`, `mail`, etc.):

```json
"spam": {
  "user_login": {
    "freeRetries": 50,
    "minWait": 60000,
    "maxWait": 600000,
    "lifetime": 3600
  },
  "member_login": {
    "freeRetries": 50,
    "minWait": 60000,
    "maxWait": 600000,
    "lifetime": 3600
  },
  "global_reset": {
    "freeRetries": 50,
    "minWait": 60000,
    "maxWait": 600000,
    "lifetime": 3600
  }
}
```

**Rationale for these values:**
- `freeRetries: 50` — a full suite run uses well under 10 member email actions. 50 gives generous headroom across multiple back-to-back runs before any limit fires.
- `minWait: 60000` / `maxWait: 600000` — if the limit *does* fire (e.g. a loop bug that spams requests), lockout is measured in minutes, not hours/days.
- `lifetime: 3600` — attempt counter resets after 1 hour even without a restart, matching the existing default.

**Important:** Ghost rejects a malformed `config.production.json` at startup and will refuse to start. Validate your JSON before restarting:

```bash
python3 -m json.tool config.production.json > /dev/null && echo "valid"
```

### Restart Ghost

```bash
docker compose restart ghost
docker compose logs ghost --tail=20
```

### Verify the config loaded

Trigger a member signup from the Portal 2–3 times in quick succession and confirm Ghost does not block it. You don't need to hit 50 — just confirm the aggressive default (blocks after 2) is gone.

---

## Step 2 — Infra: Create Least-Privilege DB User + Confirm Connectivity

**Owner:** You (ghostbox)  
**Effort:** ~20 minutes

The suite's `globalSetup` will clear the `brute` table before each run using a dedicated MySQL user scoped to only what it needs.

### Create the least-privilege user

Connect to the Ghost MySQL container and create a user that can only `DELETE` from `brute`:

```bash
docker compose exec mysql mysql -u root -p
```

```sql
-- Replace 'strongpassword' with something real; store it in your password manager
CREATE USER 'brute_reset_user'@'%' IDENTIFIED BY 'strongpassword';
GRANT DELETE ON ghost_db.brute TO 'brute_reset_user'@'%';
FLUSH PRIVILEGES;

-- Verify
SHOW GRANTS FOR 'brute_reset_user'@'%';
```

> Use `'%'` as the host wildcard here since the runner connects from the ghostbox host, not from inside the Docker network. If you can pin the source IP, do so.

**Why not reuse the `ghost` DB user?** If these credentials ever leak, the blast radius is a single throwaway table. The `ghost` user can read and write all content and member data.

### Confirm the `brute` table exists

```sql
USE ghost_db;
SHOW TABLES LIKE 'brute';
SELECT * FROM brute LIMIT 5;
```

If the table is empty, no limits have fired yet — it still gets created on first use, and the globalSetup will work fine (it'll just delete 0 rows).

### Confirm runner → MySQL reachability

The self-hosted runner runs on the ghostbox host. MySQL may only listen inside the Docker network, in which case `localhost:3306` from the runner host won't resolve. Check:

```bash
docker compose port mysql 3306
```

- If it shows `0.0.0.0:3306 -> 3306/tcp` → `localhost` works from the runner host.
- If no output → the port isn't published. Add it to `docker-compose.yml` under the `mysql` service: `ports: ["127.0.0.1:3306:3306"]` and redeploy. Binding to `127.0.0.1` (not `0.0.0.0`) keeps MySQL off the external network.

### Credentials needed

| Variable | Value |
|---|---|
| `DB_HOST` | `localhost` or `127.0.0.1` |
| `DB_PORT` | `3306` |
| `DB_NAME` | `ghost_db` (your Ghost DB name) |
| `DB_USER` | `brute_reset_user` |
| `DB_PASSWORD` | the password you set above |

**Local:** Add to `.env` (already gitignored).  
**CI:** Add each as a GitHub Actions secret. Wire them into the workflow `env:` block alongside the existing secrets.

---

## Step 3 — Code: Add `globalSetup.ts` (pre-stageable)

**Owner:** Claude Code  
**Effort:** ~30 minutes including a verification run  
**Pre-stageable:** Yes — the script no-ops cleanly when DB creds are absent, so it can be committed before Step 2 is done without breaking anything.

Create `tests/global-setup.ts`:

```typescript
// tests/global-setup.ts
import { FullConfig } from '@playwright/test';
import mysql from 'mysql2/promise';

async function globalSetup(config: FullConfig) {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;

  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
    console.warn(
      '[globalSetup] DB credentials not set — skipping brute table reset. ' +
      'Set DB_HOST, DB_NAME, DB_USER, DB_PASSWORD in .env to enable.'
    );
    return;
  }

  let connection;
  try {
    connection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT ? parseInt(DB_PORT, 10) : 3306,
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASSWORD,
    });

    const [result] = await connection.execute('DELETE FROM brute') as any;
    console.log(`[globalSetup] brute table cleared — ${result.affectedRows} rows deleted.`);
  } catch (err) {
    // Log but do not throw — a failed reset is not worth aborting the run.
    console.error('[globalSetup] Failed to clear brute table:', err);
  } finally {
    await connection?.end();
  }
}

export default globalSetup;
```

**Install the dependency:**

```bash
npm install --save-dev mysql2
```

**Register in `playwright.config.ts`** (alongside the existing `globalTeardown`):

```typescript
globalSetup: './tests/global-setup',
globalTeardown: './tests/global-teardown',
```

**Wire DB secrets into the CI workflow** (`env:` block in `.github/workflows/playwright.yml`):

```yaml
env:
  # ... existing secrets ...
  DB_HOST: ${{ secrets.DB_HOST }}
  DB_PORT: ${{ secrets.DB_PORT }}
  DB_NAME: ${{ secrets.DB_NAME }}
  DB_USER: ${{ secrets.DB_USER }}
  DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
```

**Verify once Step 2 is done:** Run the suite locally and confirm `[globalSetup] brute table cleared` appears in the output before tests start.

---

## Step 4 — Code: Remove MU-001 Self-Skip Logic

**Owner:** Claude Code  
**Effort:** ~20 minutes  
**Gate:** Steps 1–3 complete and verified

In `tests/member-ui/registration.spec.ts`, remove the "Retry" button detection and `test.skip()` call from MU-001. What remains is only the submit + positive assertion. If the rate limit somehow fires after this change, it will be a real failure — which is correct, because the globalSetup should have prevented it.

---

## Step 5 — Code + Empirical Check: `retries: 0` in Auth Spec (ADR §8)

**Owner:** Claude Code + empirical verification  
**Effort:** ~10 minutes to change + one verification run  
**Gate:** Steps 1–3 complete

### Correction from original plan

`retries: 0` is **not** in `playwright.config.ts`'s project definition. It is set inside the spec file itself via `test.describe.configure({ retries: 0 })` in `tests/admin-ui/auth.spec.ts` (~line 54). That is the line to remove or relax, not a config-level project setting.

### The linchpin question

The brute table reset cleanly kills:
- The `member_login` limiter → MU-001 can stop skipping (Step 4)
- The `user_login` admin brute lockout → back-to-back bad-password attempts won't accumulate

What is **unknown until tested**: whether the admin 2FA device-verification code lockdown (the 30-minute one) is also stored in the `brute` table, or whether it uses a separate mechanism. This distinction drives the ADR §8 outcome.

### How to verify

After Steps 1–3 are in place:

1. Delete `.auth/admin.json` (force the full login path).
2. Run `npx playwright test tests/admin-ui/auth.spec.ts` to completion (it will request a 2FA code).
3. Immediately run it again without waiting.
4. **If AU-001 passes both times** → the brute reset clears the 2FA limiter → remove `test.describe.configure({ retries: 0 })` from auth.spec.ts, and the ADR §8 cadence rule can be retired.
5. **If the second run is blocked** on the 2FA code step → the limiter is separate → leave `retries: 0` in place, and the cadence rule survives as a documented fallback.

### ADR §8 holds pending this result

Do not edit the "30-minute cadence rule" section of ADR §8 until Step 5's verification run is complete. That result directly determines what the update says.

---

## Step 6 — Docs: Update ADRs

**Owner:** Claude Code (draft) → your review  
**Effort:** ~45–60 minutes  
**Gate:** Steps 3–5 complete

### ADR §8 — Admin 2FA Lockdown and CI Run Cadence

Revise based on Step 5's result:
- If 2FA limiter is in `brute`: mark the cadence rule obsolete, document the brute reset as the replacement mitigation.
- If 2FA limiter is separate: keep the cadence rule, but document it as a fallback now that the brute reset handles everything else.
- Either way: document the `spam` config change.

### ADR §9 — Member Sign-In Rate Limiter and Self-Skipping Registration Test

- Mark the self-skip behavior as removed.
- Document the two-part fix: `freeRetries: 50` + brute reset.
- Note the tradeoff: MU-001 now fails (not skips) if the limiter somehow fires — the correct behavior given the reset.

### ADR §11 — New: Rate Limit Configuration and Brute Table Reset

Create this entry. It should cover:
- The three `express-brute` buckets (`user_login`, `member_login`, `global_reset`) and their shared `brute` table
- The `spam` config added to `config.production.json` and reasoning for chosen values
- The `globalSetup.ts` brute reset and its graceful no-op when DB creds are absent
- The least-privilege `brute_reset_user` user and why the `ghost` user wasn't reused
- The globalSetup/setup-projects composition: globalSetup runs before all projects, including the `admin-auth` and `member-auth` setup projects, so auth logins happen on a clean rate-limit slate (no conflict with ADR §10)
- Explicit note: this configuration is for a test environment only — `freeRetries: 50` should never be used on a production Ghost instance

---

## Step 7 — Verification Run

After all changes:

1. Delete `.auth/admin.json` and `.auth/member.json` (simulate cold CI)
2. Run the full suite: `npx playwright test`
3. Expected result: **92 passed, 0 skipped, 0 failed**
4. Immediately run again without waiting — confirms the brute reset is working across consecutive runs
5. Trigger a GitHub Actions workflow run — confirms CI is green on a cold checkout with DB secrets wired in

---

## Staging Strategy (Option A vs B)

Claude Code offered two sequencing options:

**Option A — Pre-stage the inert plumbing now, finish cleanup after infra is ready**
- CC commits `globalSetup.ts`, `mysql2` dep, config registration, and workflow env block now
- Suite stays green (globalSetup no-ops without creds)
- You do Steps 1–2; CC runs Step 5's 2FA check and finishes Steps 4–6 in one pass

**Option B — You do Steps 1–2 first, CC does everything in one pass**
- Simpler commit history
- No code changes until infra is confirmed

Either works. Option A keeps parallel progress; Option B is cleaner. Your call.

---

## What Is NOT Changing

| Accommodation | Stays? | Why |
|---|---|---|
| Session cache (`.auth/admin.json`, 4-hour window) | ✅ Keep | Reflects real-world session reuse; genuine perf win |
| Member cookie reuse in content-access tests | ✅ Keep | A real member wouldn't re-auth per page |
| Magic-link + Mailpit flow | ✅ Keep | Hard architectural requirement; no password option for members |
| `fullyParallel: false` | ✅ Keep | MU-005–010 ordering is load-bearing |
| `workers: 4` | ✅ Keep | Proven correct in ADR §10 |
| Enlarged operation timeouts (ADR §7) | ✅ Keep | Now generous rather than necessary, cost-free on fast hardware |
| Global member teardown | ✅ Keep | Unconditional cleanup; unrelated to rate limits |

---

## Summary of Changes by File

| File | Change |
|---|---|
| `config.production.json` (ghostbox) | Add `spam` block with relaxed `freeRetries` |
| `.env` | Add `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| `package.json` | Add `mysql2` dev dependency |
| `tests/global-setup.ts` | **New file** — brute table reset |
| `playwright.config.ts` | Register `globalSetup`; add DB secrets to workflow env block |
| `tests/admin-ui/auth.spec.ts` | Remove `test.describe.configure({ retries: 0 })` (~line 54) **if Step 5 confirms it's safe** |
| `tests/member-ui/registration.spec.ts` | Remove MU-001 self-skip logic |
| `docs/decisions.md` | Revise ADR §8, §9; add ADR §11 |
| `.github/workflows/playwright.yml` | Add DB credential secrets to `env:` block |

---

## Sequencing Summary

```
Step 1 (you)   →  Edit config.production.json + restart Ghost
Step 2 (you)   →  Create brute_reset_user MySQL user + confirm port reachability + supply creds
Step 3 (CC)    →  Add globalSetup.ts + mysql2 + register in config + wire CI secrets [pre-stageable]
Step 4 (CC)    →  Remove MU-001 self-skip [gate: Steps 1–3]
Step 5 (CC)    →  Run 2FA empirical check → remove retries:0 from auth.spec.ts if safe [gate: Steps 1–3]
Step 6 (CC)    →  ADR updates: revise §8 and §9, add §11 [gate: Step 5 result known]
Step 7 (both)  →  Full suite + back-to-back run + CI push
```

Steps 1 and 2 are hard blockers for Steps 4–7. Step 3 is pre-stageable and can be committed now.
