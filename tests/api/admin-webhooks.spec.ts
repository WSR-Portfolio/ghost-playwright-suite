/**
 * Admin API — Webhooks (AA-035 through AA-037)
 *
 * WHAT WEBHOOKS ARE FOR
 * ---------------------
 * Webhooks are Ghost's primary integration surface.  When a Ghost event fires
 * (post published, member created, etc.) Ghost sends an HTTP POST to every
 * registered target URL for that event.  External services — Zapier, custom
 * pipelines, Slack bots, cache-invalidation endpoints — subscribe to Ghost
 * content changes via webhooks.  Testing CRUD on the webhook resource validates
 * a real integration pattern: if create or delete is broken, integrations that
 * depend on Ghost events will silently stop receiving them or accumulate
 * phantom endpoints that generate unnecessary traffic.
 *
 * CLEANUP STRATEGY
 * ----------------
 * Each test that creates a webhook stores its ID in `webhookId`.  afterEach
 * deletes it if the ID is set.  AA-037 (delete test) sets the ID and the test
 * body deletes it directly; afterEach will issue a redundant DELETE that Ghost
 * returns 404 for — handled gracefully with a .catch().
 */

import { test, expect, generateAdminToken } from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

const authHeaders = () => ({ Authorization: `Ghost ${generateAdminToken()}` });

const TARGET_URL = 'https://example.com/webhook-test';
const EVENT = 'post.published';

// Track the webhook created by each test for afterEach cleanup
let webhookId: string | null = null;

test.describe('Admin API — Webhooks', () => {
  test.beforeEach(() => {
    webhookId = null;
  });

  test.afterEach(async ({ request }) => {
    if (!webhookId) return;
    // Best-effort delete — 404 is expected when AA-037 already deleted the
    // webhook inside the test body.
    await request
      .delete(`${BASE()}/ghost/api/admin/webhooks/${webhookId}/`, {
        headers: authHeaders(),
      })
      .catch(() => undefined);
    webhookId = null;
  });

  // -------------------------------------------------------------------------
  // AA-035 — Create a webhook returns 201 with event and target_url
  // Validates the creation contract: 201, the event type is persisted exactly,
  // and the target URL round-trips without modification.  A target URL that
  // Ghost silently truncates or rewrites would send payloads to the wrong
  // endpoint, causing silent integration failures.
  // -------------------------------------------------------------------------
  test('AA-035: create a webhook returns 201 with correct event and target_url', async ({
    request,
  }) => {
    const res = await request.post(`${BASE()}/ghost/api/admin/webhooks/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: {
        webhooks: [{ event: EVENT, target_url: TARGET_URL }],
      },
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    const webhook = body.webhooks[0];

    expect(webhook.id).toBeTruthy();
    expect(webhook.event).toBe(EVENT);
    expect(webhook.target_url).toBe(TARGET_URL);

    webhookId = webhook.id;
  });

  // -------------------------------------------------------------------------
  // AA-036 — Create webhook without required target_url → 422
  // target_url is required: without it Ghost has no endpoint to POST events to.
  // The server must reject the request with a structured 422 rather than
  // creating a webhook record with a null or empty target.
  // -------------------------------------------------------------------------
  test('AA-036: create webhook without target_url returns 422', async ({ request }) => {
    const res = await request.post(`${BASE()}/ghost/api/admin/webhooks/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      // target_url deliberately omitted
      data: {
        webhooks: [{ event: EVENT }],
      },
    });

    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // AA-037 — Delete webhook returns 204
  // After deletion, a second DELETE for the same ID must return 404 to confirm
  // the record is gone and not merely marked inactive.  Uses two raw DELETEs
  // rather than the afterEach path because this test specifically asserts on
  // the status codes of both requests.
  // -------------------------------------------------------------------------
  test('AA-037: delete webhook returns 204; second delete returns 404', async ({ request }) => {
    // Create a webhook to delete
    const createRes = await request.post(`${BASE()}/ghost/api/admin/webhooks/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { webhooks: [{ event: EVENT, target_url: TARGET_URL }] },
    });
    expect(createRes.status()).toBe(201);
    const createBody = await createRes.json();
    webhookId = createBody.webhooks[0].id;

    // First delete — must return 204 No Content
    const deleteRes = await request.delete(`${BASE()}/ghost/api/admin/webhooks/${webhookId}/`, {
      headers: authHeaders(),
    });
    expect(deleteRes.status()).toBe(204);

    // Second delete for the same ID — must return 404 (not 204 or 500)
    const secondDeleteRes = await request.delete(
      `${BASE()}/ghost/api/admin/webhooks/${webhookId}/`,
      { headers: authHeaders() },
    );
    expect(secondDeleteRes.status()).toBe(404);

    // afterEach will attempt deletion again; the .catch() there swallows the 404
    webhookId = null;
  });
});
