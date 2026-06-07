/**
 * Admin API — Authentication (AA-001, AA-002, AA-003)
 *
 * These tests verify the authentication boundary on the Ghost Admin API.
 * AA-002 and AA-003 are security-critical: a regression here means the API
 * is publicly writable without credentials, which would allow anyone to create,
 * update, or delete all content on the Ghost instance.
 */

import { test, expect, generateAdminToken } from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

test.describe('Admin API — Authentication', () => {
  // -------------------------------------------------------------------------
  // AA-001 — Valid Admin API key returns 200
  // Confirms that a correctly signed Ghost JWT is accepted and that the
  // posts listing endpoint responds with 200.  This is the baseline: if this
  // test fails, all other Admin API tests are meaningless because the fixture
  // layer itself is broken.
  // -------------------------------------------------------------------------
  test('AA-001: valid Admin API key returns 200 on GET /ghost/api/admin/posts/', async ({
    request,
  }) => {
    const res = await request.get(`${BASE()}/ghost/api/admin/posts/`, {
      headers: { Authorization: `Ghost ${generateAdminToken()}` },
    });

    expect(res.status()).toBe(200);
  });

  // -------------------------------------------------------------------------
  // AA-002 — Malformed token returns 4xx with errors array
  // A token that is not a valid JWT must be rejected.  Ghost returns 400 (Bad
  // Request) when it cannot parse the token structure — a 400 is appropriate
  // here because the request itself is malformed, not just unauthorised.
  // Asserts both the status code and the presence of an errors array in the body.
  //
  // Security implication: if this test fails, a malformed credential is being
  // accepted, meaning the auth check is bypassed or not enforced at all.
  // -------------------------------------------------------------------------
  test('AA-002: malformed token returns 400 with errors array', async ({ request }) => {
    const res = await request.get(`${BASE()}/ghost/api/admin/posts/`, {
      headers: { Authorization: 'Ghost this-is-not-a-valid-jwt' },
    });

    // Ghost returns 400 for a syntactically invalid JWT (not 401 — the token
    // cannot even be parsed, so it is a bad request rather than unauthorised)
    expect(res.status()).toBe(400);

    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // AA-003 — Missing Authorization header returns 403 with errors array
  // A completely unauthenticated request must be rejected.  Ghost returns 403
  // (Forbidden) rather than 401 when no Authorization header is present — this
  // is the actual behaviour observed on this instance (running behind Cloudflare
  // Tunnel), where the auth middleware produces a 403 for absent credentials.
  // Asserts both the status code and the structured errors array.
  //
  // Security implication: if this test fails, the Admin API is accessible
  // without any credentials.
  // -------------------------------------------------------------------------
  test('AA-003: missing Authorization header returns 403 with errors array', async ({
    request,
  }) => {
    const res = await request.get(`${BASE()}/ghost/api/admin/posts/`);

    // Ghost returns 403 (not 401) when no Authorization header is present
    expect(res.status()).toBe(403);

    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });
});
