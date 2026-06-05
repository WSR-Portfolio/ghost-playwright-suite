/**
 * Admin API — Newsletters (AA-031 through AA-032)
 *
 * Ghost's newsletter resource represents email newsletters that members can
 * subscribe to.  Ghost creates a default "Default Newsletter" on installation,
 * so the list endpoint always returns at least one record without any test
 * setup.  These tests exercise read operations only — newsletter creation and
 * modification carry a risk of disrupting email delivery configuration on a
 * shared instance and are out of scope for this read-only coverage pass.
 */

import { test, expect, generateAdminToken } from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

const authHeaders = () => ({ Authorization: `Ghost ${generateAdminToken()}` });

test.describe('Admin API — Newsletters', () => {
  // -------------------------------------------------------------------------
  // AA-031 — List newsletters returns at least the default newsletter
  // Ghost installs with one newsletter out of the box.  An empty newsletters
  // array would mean the email subscription system has no delivery target,
  // which would silently break all member email flows.
  // -------------------------------------------------------------------------
  test('AA-031: list newsletters returns 200 with at least one newsletter', async ({ request }) => {
    const res = await request.get(`${BASE()}/ghost/api/admin/newsletters/`, {
      headers: authHeaders(),
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.newsletters)).toBe(true);
    expect(body.newsletters.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // AA-032 — Get newsletter by ID returns the correct record
  // Fetches the first newsletter from the list endpoint, then retrieves it by
  // ID and verifies the name and slug fields match.  Validates that the
  // single-resource endpoint is consistent with the collection endpoint —
  // a mismatch would indicate a caching or routing bug.
  // -------------------------------------------------------------------------
  test('AA-032: get newsletter by ID returns the correct newsletter', async ({ request }) => {
    // Fetch the list to obtain a known-good newsletter ID
    const listRes = await request.get(`${BASE()}/ghost/api/admin/newsletters/`, {
      headers: authHeaders(),
    });
    expect(listRes.status()).toBe(200);
    const listBody = await listRes.json();
    const firstNewsletter = listBody.newsletters[0];

    // Fetch the same newsletter by ID and verify data consistency
    const byIdRes = await request.get(
      `${BASE()}/ghost/api/admin/newsletters/${firstNewsletter.id}/`,
      { headers: authHeaders() },
    );

    expect(byIdRes.status()).toBe(200);
    const byIdBody = await byIdRes.json();
    expect(byIdBody.newsletters[0].id).toBe(firstNewsletter.id);
    expect(byIdBody.newsletters[0].name).toBe(firstNewsletter.name);
    expect(byIdBody.newsletters[0].slug).toBe(firstNewsletter.slug);
  });
});
