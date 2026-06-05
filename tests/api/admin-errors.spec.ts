/**
 * Admin API — Error handling (AA-039)
 *
 * These tests verify that the Ghost Admin API returns well-formed error
 * responses for fundamentally malformed requests — not just validation errors
 * on valid JSON, but requests whose bodies cannot be parsed at all.
 *
 * A robust API must handle parse errors at the middleware layer and return a
 * structured response.  If Ghost returns 500, crashes, or returns 200 with
 * unexpected data on a bad parse, it indicates the error-handling middleware
 * is not in place for that code path.
 */

import { test, expect, generateAdminToken } from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

const authHeaders = () => ({ Authorization: `Ghost ${generateAdminToken()}` });

test.describe('Admin API — Error handling', () => {
  // -------------------------------------------------------------------------
  // AA-039 — Completely malformed JSON body → 400 Bad Request
  // Sends a raw string that is syntactically invalid JSON to an endpoint that
  // expects application/json.  Ghost's body-parser middleware must catch the
  // parse error and return 400 before any route handler runs.
  //
  // This matters because any other status code indicates the error was handled
  // (or not handled) in an unexpected place:
  //   • 200 / 201 — the body parser silently ignored the parse failure.
  //   • 422        — the route handler ran and treated unparsed input as a
  //                  validation error instead of a parse error.
  //   • 500        — Ghost threw an unhandled exception, exposing stack traces.
  // -------------------------------------------------------------------------
  test('AA-039: POST with completely malformed JSON body returns 400', async ({ request }) => {
    const res = await request.post(`${BASE()}/ghost/api/admin/posts/`, {
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      // A raw string is sent as-is when passed to `data`; the Content-Type header
      // tells Ghost to parse it as JSON, which must fail and produce a 400.
      data: '{ this : is {{ not ]] valid JSON at all }}}',
    });

    expect(res.status()).toBe(400);
  });
});
