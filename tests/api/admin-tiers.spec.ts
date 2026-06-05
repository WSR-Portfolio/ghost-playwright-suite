/**
 * Admin API — Tiers (AA-038)
 *
 * Tiers (formerly "products" in Ghost 4.x) are the membership subscription
 * levels that gate content visibility.  Ghost creates a built-in "Free" tier
 * on installation and optionally a "Premium" tier when Stripe is configured.
 * Tiers drive the 'visibility' field on posts (public / members / paid /
 * tiers) and are the foundation of Ghost's content monetisation model.
 *
 * These tests are read-only: tier creation and modification require Stripe
 * configuration and affect pricing/billing logic, which is out of scope for
 * an API integration test suite targeting a development instance.
 */

import { test, expect, generateAdminToken } from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

const authHeaders = () => ({ Authorization: `Ghost ${generateAdminToken()}` });

test.describe('Admin API — Tiers', () => {
  // -------------------------------------------------------------------------
  // AA-038 — List tiers returns at least the built-in Free tier
  // Ghost installs with a Free tier that is always present regardless of
  // Stripe configuration.  An empty tiers array would mean post visibility
  // filtering has no reference tier, which would break the members-only
  // content model across the entire site.
  // -------------------------------------------------------------------------
  test('AA-038: list tiers returns 200 with at least one tier including the Free tier', async ({
    request,
  }) => {
    const res = await request.get(`${BASE()}/ghost/api/admin/tiers/`, {
      headers: authHeaders(),
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tiers)).toBe(true);
    expect(body.tiers.length).toBeGreaterThanOrEqual(1);

    // The Free tier is always present — verify at least one tier has type='free'
    const freeTier = body.tiers.find(
      (t: { type: string }) => t.type === 'free',
    );
    expect(freeTier).toBeDefined();
  });
});
