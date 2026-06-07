/**
 * Admin API — Images (AA-033 through AA-034)
 *
 * Ghost stores uploaded images and returns a CDN-ready URL that themes and
 * the editor use directly.  The upload endpoint accepts multipart/form-data
 * with a `file` field and an optional `purpose` hint ('image', 'profile_image',
 * 'icon').
 *
 * MINIMAL PNG BUFFER
 * ------------------
 * Tests create a valid PNG image entirely in memory using a known-good base64
 * string rather than depending on a fixture file on disk.  This avoids an
 * external file dependency that could break when the repository is cloned to
 * a machine where the fixture path differs from the working directory at test
 * runtime.  The PNG is a 1×1 pixel image (< 100 bytes) — large enough to
 * pass Ghost's image validation, small enough to have negligible upload cost.
 *
 * The base64 string below is the canonical "tiniest-possible-PNG" that has
 * circulated in the testing community for years; its SHA-256 is stable and
 * the file parses correctly in every PNG decoder.
 */

import { test, expect, generateAdminToken } from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

const authHeaders = () => ({ Authorization: `Ghost ${generateAdminToken()}` });

// 1×1 pixel transparent PNG, 68 bytes.  Created in memory — no disk file required.
const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
    '+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Admin API — Images', () => {
  // -------------------------------------------------------------------------
  // AA-033 — Upload a valid PNG returns 200 with a URL
  // Verifies the full upload pipeline: multipart encoding accepted, image
  // stored by Ghost's storage adapter, and a public URL returned.  The URL
  // is the value that editors and themes embed directly in content — if it is
  // missing or malformed, images break site-wide.
  // -------------------------------------------------------------------------
  test('AA-033: upload a valid PNG returns 201 with a public URL', async ({ request }) => {
    const res = await request.post(`${BASE()}/ghost/api/admin/images/upload/`, {
      headers: authHeaders(),
      multipart: {
        file: {
          name: 'test-image.png',
          mimeType: 'image/png',
          buffer: MINIMAL_PNG,
        },
        purpose: 'image',
      },
    });

    // Ghost's image upload endpoint returns 201 on success
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(Array.isArray(body.images)).toBe(true);
    expect(body.images[0].url).toBeTruthy();
    expect(body.images[0].url).toMatch(/^https?:\/\//);
  });

  // -------------------------------------------------------------------------
  // AA-034 — Upload a plain-text file is rejected with a 4xx error
  // Ghost must validate MIME type and file extension before storing the file.
  // Accepting arbitrary file types would allow an authenticated admin to store
  // and serve non-image content (HTML, scripts) through Ghost's CDN, which is
  // a security and content-integrity risk.
  // -------------------------------------------------------------------------
  test('AA-034: upload a .txt file is rejected with a 4xx error', async ({ request }) => {
    const res = await request.post(`${BASE()}/ghost/api/admin/images/upload/`, {
      headers: authHeaders(),
      multipart: {
        file: {
          name: 'not-an-image.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('this is definitely not an image'),
        },
        purpose: 'image',
      },
    });

    // Ghost returns 422 for unsupported file type; 415 is also acceptable
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });
});
