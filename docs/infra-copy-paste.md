# Infra Copy-Paste Artifacts — Rate Limit Cleanup

These are the exact commands and config for Steps 1 and 2. Copy-paste ready.

---

## Step 1A — `config.production.json` spam block

Add this as a top-level key in your existing `config.production.json`. Do not nest it inside another key.

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

## Step 1B — Validate JSON before restarting

```bash
python3 -m json.tool /path/to/config.production.json > /dev/null && echo "JSON valid" || echo "JSON INVALID — fix before restart"
```

## Step 1C — Restart and verify

```bash
docker compose restart ghost
docker compose logs ghost --tail=30
```

Look for Ghost reporting it started successfully on port 2368. Any `SyntaxError` or `ConfigError` means the JSON is malformed.

---

## Step 2A — Create least-privilege MySQL user

```bash
docker compose exec mysql mysql -u root -p
```

Then inside the MySQL shell (replace `strongpassword` and `ghost_db` with your actual values):

```sql
CREATE USER 'brute_reset_user'@'%' IDENTIFIED BY 'strongpassword';
GRANT DELETE ON ghost_db.brute TO 'brute_reset_user'@'%';
FLUSH PRIVILEGES;
SHOW GRANTS FOR 'brute_reset_user'@'%';
```

Expected output of SHOW GRANTS:
```
+-----------------------------------------------------------------------+
| Grants for brute_reset_user@%                                        |
+-----------------------------------------------------------------------+
| GRANT USAGE ON *.* TO `brute_reset_user`@`%`                        |
| GRANT DELETE ON `ghost_db`.`brute` TO `brute_reset_user`@`%`        |
+-----------------------------------------------------------------------+
```

## Step 2B — Confirm the brute table exists

Still inside the MySQL shell:

```sql
USE ghost_db;
SHOW TABLES LIKE 'brute';
SELECT COUNT(*) FROM brute;
```

If `SHOW TABLES` returns a row, you're good. If empty, the table doesn't exist yet (it gets created on first rate-limit event). The globalSetup handles this: `DELETE FROM brute` on an empty table returns `affectedRows: 0` without error.

## Step 2C — Check MySQL port reachability from the host

Exit the MySQL shell and run from the ghostbox host (not inside a container):

```bash
docker compose port mysql 3306
```

- Output `0.0.0.0:3306 -> 3306/tcp` or `127.0.0.1:3306 -> 3306/tcp` → `DB_HOST=localhost` will work ✅
- No output → port not published to host. Add to your `docker-compose.yml` under the mysql service and redeploy:

```yaml
services:
  mysql:
    ports:
      - "127.0.0.1:3306:3306"   # bind to loopback only — don't expose to LAN
```

```bash
docker compose up -d mysql
```

## Step 2D — Test the connection with the new user

From the ghostbox host (not inside a container):

```bash
mysql -h 127.0.0.1 -P 3306 -u brute_reset_user -p ghost_db -e "DELETE FROM brute;"
```

Enter the password when prompted. Expected output:
- If rows existed: no output, exit 0
- If table is empty: no output, exit 0
- Any `ERROR` → connectivity or permissions problem to fix before proceeding

## Step 2E — Add to .env

```bash
# Add these lines to your .env file on ghostbox
DB_HOST=localhost
DB_PORT=3306
DB_NAME=ghost_db
DB_USER=brute_reset_user
DB_PASSWORD=strongpassword
```

## Step 2F — GitHub Actions secrets to add

In your repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret name | Value |
|---|---|
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_NAME` | `ghost_db` |
| `DB_USER` | `brute_reset_user` |
| `DB_PASSWORD` | `strongpassword` |

These are added individually. The workflow YAML references them as `${{ secrets.DB_HOST }}` etc.
