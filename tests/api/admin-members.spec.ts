/**
 * Admin API — Members (AA-025 through AA-030)
 *
 * Cleanup strategy: afterAll calls deleteAllMembers() rather than per-test
 * teardown.  This is intentional — the target is a controlled environment with
 * no real users (CLAUDE.md), so wiping all members after the suite is safe and
 * simpler than tracking individual IDs across tests that may fail mid-create.
 *
 * All email addresses are generated via generateTestEmail() so they are scoped
 * to the testuser.wsrportfolio.dev subdomain and immediately identifiable in
 * Ghost's member list if a run is interrupted before afterAll fires.
 *
 * Tests that expect non-201 status codes (AA-026, AA-027) use the raw
 * Playwright `request` fixture because AdminApiHelper.createMember asserts
 * 201 internally and would throw before the test can inspect the status.
 */

import { test, expect, generateAdminToken, generateTestEmail, TEST_MEMBER_NAME } from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

const authHeaders = () => ({ Authorization: `Ghost ${generateAdminToken()}` });

test.describe('Admin API — Members', () => {
  test.afterAll(async ({ adminApi }) => {
    // Nuclear teardown: removes every member created during this suite run.
    // Safe because GHOST_URL targets a dedicated test environment.
    await adminApi.deleteAllMembers();
  });

  // -------------------------------------------------------------------------
  // AA-025 — Create a member
  // Validates the creation contract: 201, required fields returned (id, name,
  // email), and Ghost's default status of 'free' for non-paying members.
  // -------------------------------------------------------------------------
  test('AA-025: create a member returns 201 with id, name, email, and status=free', async ({
    adminApi,
  }) => {
    const email = generateTestEmail(`aa-025-${Date.now()}`);
    const member = await adminApi.createMember({ name: TEST_MEMBER_NAME, email });

    expect(member.id).toBeTruthy();
    expect(member.name).toBe(TEST_MEMBER_NAME);
    expect(member.email).toBe(email);
    expect(member.status).toBe('free');
  });

  // -------------------------------------------------------------------------
  // AA-026 — Invalid email format → 422
  // Ghost validates email syntax server-side.  An address that fails the
  // validation must be rejected with 422 (not 400 or 500) so that no member
  // record is created for an address that can never receive magic-link emails.
  // -------------------------------------------------------------------------
  test('AA-026: create member with invalid email format returns 422', async ({ request }) => {
    const res = await request.post(`${BASE()}/ghost/api/admin/members/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { members: [{ name: TEST_MEMBER_NAME, email: 'not-an-email-address' }] },
    });

    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // AA-027 — Duplicate email → 422 with error referencing the duplicate
  // Ghost enforces one member record per email address.  A second create with
  // the same email must return 422 and include a structured error whose message
  // explains the conflict.  An empty or missing message would mean the API is
  // failing silently — callers could not surface a useful error to the user.
  // -------------------------------------------------------------------------
  test('AA-027: duplicate email returns 422 with a descriptive error message', async ({
    adminApi,
    request,
  }) => {
    const email = generateTestEmail(`aa-027-${Date.now()}`);

    // First create — must succeed so the duplicate exists to trigger the conflict
    await adminApi.createMember({ name: TEST_MEMBER_NAME, email });

    // Second create with the same address — must be rejected
    const res = await request.post(`${BASE()}/ghost/api/admin/members/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { members: [{ name: 'Duplicate Member', email }] },
    });

    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
    // The error message must be non-empty and indicate the conflict — a silent
    // or null message would not help callers surface the issue to the operator.
    expect(body.errors[0].message).toBeTruthy();
    expect(body.errors[0].message.toLowerCase()).toMatch(/exist|duplicate|already/);
  });

  // -------------------------------------------------------------------------
  // AA-028 — Delete member; subsequent GET returns 404
  // After deletion the member must not be accessible via the Admin API.
  // Uses a raw GET because there is no getMember(id) helper.
  // afterAll will call deleteAllMembers() — this member is already gone by
  // then, but deleteAllMembers iterates only existing records, so no error.
  // -------------------------------------------------------------------------
  test('AA-028: deleted member returns 404 on subsequent GET', async ({ adminApi, request }) => {
    const email = generateTestEmail(`aa-028-${Date.now()}`);
    const member = await adminApi.createMember({ name: TEST_MEMBER_NAME, email });

    await adminApi.deleteMember(member.id);

    const res = await request.get(`${BASE()}/ghost/api/admin/members/${member.id}/`, {
      headers: authHeaders(),
    });

    expect(res.status()).toBe(404);
  });

  // -------------------------------------------------------------------------
  // AA-029 — Get member by ID
  // A raw GET to /ghost/api/admin/members/{id}/ must return 200 and the
  // correct member data.  There is no AdminApiHelper.getMember() method, so
  // this test also validates the single-resource endpoint shape that other
  // code (e.g. admin-ui tests) may rely on.
  // -------------------------------------------------------------------------
  test('AA-029: get member by ID returns 200 with correct email and name', async ({
    adminApi,
    request,
  }) => {
    const email = generateTestEmail(`aa-029-${Date.now()}`);
    const created = await adminApi.createMember({ name: TEST_MEMBER_NAME, email });

    const res = await request.get(`${BASE()}/ghost/api/admin/members/${created.id}/`, {
      headers: authHeaders(),
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.members[0].email).toBe(email);
    expect(body.members[0].name).toBe(TEST_MEMBER_NAME);
  });

  // -------------------------------------------------------------------------
  // AA-030 — Search members by email using the filter parameter
  // The Admin API supports NQL filters via ?filter=.  This test verifies that
  // filtering by email:'{address}' returns exactly one member record matching
  // that address.  The filter is used throughout the test suite (and in real
  // admin tooling) to look up a member by email without knowing their ID; an
  // incorrect filter result — zero records, multiple records, or a wrong record
  // — would silently break any feature that relies on this lookup.
  // -------------------------------------------------------------------------
  test('AA-030: filter by email returns exactly one member with the correct email', async ({
    adminApi,
    request,
  }) => {
    const email = generateTestEmail(`aa-030-${Date.now()}`);
    await adminApi.createMember({ name: TEST_MEMBER_NAME, email });

    // Ghost NQL filter syntax requires single quotes around the value
    const res = await request.get(`${BASE()}/ghost/api/admin/members/`, {
      headers: authHeaders(),
      params: { filter: `email:'${email}'` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(1);
    expect(body.members[0].email).toBe(email);
  });
});
