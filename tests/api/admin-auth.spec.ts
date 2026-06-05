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
  // AA-002 — Malformed token returns 401 with errors array
  // A token that is not a valid JWT must be rejected.  Asserts both the status
  // code and the presence of an errors array in the body — Ghost must return
  // a structured error response, not a 200 with empty data or a raw HTML page,
  // which would indicate the auth middleware is not running.
  //
  // Security implication: if this test fails, a malformed credential is being
  // accepted, meaning the auth check is bypassed or not enforced at all.
  // -------------------------------------------------------------------------
  test('AA-002: malformed token returns 401 with errors array', async ({ request }) => {
    const res = await request.get(`${BASE()}/ghost/api/admin/posts/`, {
      headers: { Authorization: 'Ghost this-is-not-a-valid-jwt' },
    });

    expect(res.status()).toBe(401);

    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // AA-003 — Missing Authorization header returns 401 with errors array
  // A completely unauthenticated request must be rejected.  Asserts both the
  // status code and the structured errors array — confirming the API does not
  // fall through to a default-allow state when no header is present at all.
  //
  // Security implication: if this test fails, the Admin API is open to the
  // public internet with no authentication required.
  // -------------------------------------------------------------------------
  test('AA-003: missing Authorization header returns 401 with errors array', async ({
    request,
  }) => {
    const res = await request.get(`${BASE()}/ghost/api/admin/posts/`);

    expect(res.status()).toBe(401);

    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });
});
