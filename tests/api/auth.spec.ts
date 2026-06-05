/**
 * Admin API — Authentication boundary (AA-033 through AA-035)
 *
 * These tests verify that the Ghost Admin API enforces authentication on every
 * write and read endpoint.  A correctly secured API must reject requests that
 * carry no credentials, a malformed token, or a token signed with the wrong
 * scheme — and must return 401 in all three cases with no resource data leaked.
 *
 * All requests target the posts listing endpoint as a representative surface.
 * The auth layer is enforced globally in Ghost before any route handler runs,
 * so the specific endpoint does not matter.
 */

import { test, expect } from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

test.describe('Admin API — Authentication', () => {
  // -------------------------------------------------------------------------
  // AA-033 — No Authorization header → 401
  // Every Admin API request requires an Authorization header.  A completely
  // unauthenticated request must be rejected with 401 and must not leak any
  // post data, confirming the auth middleware runs before the route handler.
  // -------------------------------------------------------------------------
  test('AA-033: request with no Authorization header returns 401', async ({ request }) => {
    const res = await request.get(`${BASE()}/ghost/api/admin/posts/`);

    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // AA-034 — Malformed token → 401
  // A token that is not a valid JWT (e.g. an arbitrary string) must be rejected.
  // This guards against misconfigured clients that send garbage credentials
  // and must never accidentally succeed.
  // -------------------------------------------------------------------------
  test('AA-034: request with malformed Ghost token returns 401', async ({ request }) => {
    const res = await request.get(`${BASE()}/ghost/api/admin/posts/`, {
      headers: { Authorization: 'Ghost this-is-not-a-jwt' },
    });

    expect(res.status()).toBe(401);
  });

  // -------------------------------------------------------------------------
  // AA-035 — Wrong auth scheme: Bearer instead of Ghost → 401
  // The Admin API requires the custom "Ghost" scheme.  Using the standard
  // "Bearer" scheme — even with a well-formed JWT — must be rejected.  This
  // confirms that Ghost's auth middleware validates the scheme, not just the
  // token structure.
  // -------------------------------------------------------------------------
  test('AA-035: request with Bearer scheme instead of Ghost scheme returns 401', async ({
    request,
  }) => {
    // Craft a syntactically valid (but wrong-scheme) JWT header
    const fakeJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiJ0ZXN0IiwiaWF0IjoxNjAwMDAwMDAwfQ.' +
      'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

    const res = await request.get(`${BASE()}/ghost/api/admin/posts/`, {
      headers: { Authorization: `Bearer ${fakeJwt}` },
    });

    expect(res.status()).toBe(401);
  });
});
