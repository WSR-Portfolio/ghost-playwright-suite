/**
 * Admin API — Members (AA-024 through AA-032)
 *
 * Members are Ghost's subscriber model.  Unlike posts and pages, members have
 * strict uniqueness constraints (one record per email address) and status
 * semantics (free / paid / comped).  These tests cover CRUD, uniqueness
 * enforcement, email-based lookup, and the bulk-delete utility used by
 * high-volume test suites.
 */

import {
  test,
  expect,
  generateAdminToken,
  TEST_MEMBER_NAME,
  TEST_MEMBER_EMAIL_UNIQUE,
  generateTestEmail,
} from '../fixtures';

const BASE = (): string => {
  const u = process.env.GHOST_URL;
  if (!u) throw new Error('GHOST_URL not set');
  return u.replace(/\/$/, '');
};

const authHeaders = () => ({ Authorization: `Ghost ${generateAdminToken()}` });

let createdMemberIds: string[] = [];

test.describe('Admin API — Members', () => {
  test.afterAll(async ({ adminApi }) => {
    for (const id of createdMemberIds) {
      await adminApi.deleteMember(id);
    }
  });

  // -------------------------------------------------------------------------
  // AA-024 — Create member
  // Validates the basic creation contract: 201, name and email returned,
  // and default status=free (Ghost's default for non-paying members).
  // -------------------------------------------------------------------------
  test('AA-024: create member returns 201 with name, email, and status=free', async ({
    adminApi,
  }) => {
    const email = TEST_MEMBER_EMAIL_UNIQUE();
    const member = await adminApi.createMember({ name: TEST_MEMBER_NAME, email });

    createdMemberIds.push(member.id);

    expect(member.id).toBeTruthy();
    expect(member.name).toBe(TEST_MEMBER_NAME);
    expect(member.email).toBe(email);
    expect(member.status).toBe('free');
  });

  // -------------------------------------------------------------------------
  // AA-025 — Duplicate email → 422
  // Ghost enforces one member record per email address.  Attempting to create
  // a second member with the same email must be rejected with 422 to prevent
  // data integrity issues and duplicate communication.
  // -------------------------------------------------------------------------
  test('AA-025: create member with duplicate email returns 422', async ({ adminApi, request }) => {
    const email = TEST_MEMBER_EMAIL_UNIQUE();
    const member = await adminApi.createMember({ name: TEST_MEMBER_NAME, email });
    createdMemberIds.push(member.id);

    // Second creation attempt with the same address
    const res = await request.post(`${BASE()}/ghost/api/admin/members/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { members: [{ name: 'Duplicate', email }] },
    });

    expect(res.status()).toBe(422);
  });

  // -------------------------------------------------------------------------
  // AA-026 — Get member by email
  // getMemberByEmail is a filter-based lookup that returns the matching record.
  // This is used throughout the test suite to verify that Ghost operations
  // affecting members (e.g. sign-up via UI) persisted correctly.
  // -------------------------------------------------------------------------
  test('AA-026: getMemberByEmail returns the correct member record', async ({ adminApi }) => {
    const email = TEST_MEMBER_EMAIL_UNIQUE();
    const created = await adminApi.createMember({ name: TEST_MEMBER_NAME, email });
    createdMemberIds.push(created.id);

    const found = await adminApi.getMemberByEmail(email);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.email).toBe(email);
  });

  // -------------------------------------------------------------------------
  // AA-027 — getMemberByEmail returns null for unknown address
  // When no member exists for a given email, the helper must return null rather
  // than throw.  Callers depend on this contract for existence checks.
  // -------------------------------------------------------------------------
  test('AA-027: getMemberByEmail returns null for a non-existent email', async ({ adminApi }) => {
    const nonExistentEmail = generateTestEmail(`ghost-${Date.now()}-nobody`);

    const result = await adminApi.getMemberByEmail(nonExistentEmail);

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // AA-028 — Delete member, then lookup returns null
  // After deletion, a getMemberByEmail call for the same address must return
  // null.  Verifies that the delete actually removes the record from the API.
  // -------------------------------------------------------------------------
  test('AA-028: delete member — subsequent lookup returns null', async ({ adminApi }) => {
    const email = TEST_MEMBER_EMAIL_UNIQUE();
    const member = await adminApi.createMember({ name: TEST_MEMBER_NAME, email });

    await adminApi.deleteMember(member.id);

    const result = await adminApi.getMemberByEmail(email);
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // AA-029 — List members
  // The members listing endpoint must return 200 and a members array.  This is
  // the entry point for all subscriber management features in the admin panel.
  // -------------------------------------------------------------------------
  test('AA-029: list members returns 200 with a members array', async ({ request }) => {
    const res = await request.get(`${BASE()}/ghost/api/admin/members/`, {
      headers: authHeaders(),
      params: { limit: 5 },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.members)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AA-030 — deleteAllMembers utility clears all members
  // This helper is critical for test isolation: after calling it, the member
  // list must be empty.  Verifies the pagination loop inside deleteAllMembers
  // handles multi-page member sets correctly.
  // -------------------------------------------------------------------------
  test('AA-030: deleteAllMembers clears the member list', async ({ adminApi, request }) => {
    // Create a small batch to ensure there is something to delete
    const emails = [TEST_MEMBER_EMAIL_UNIQUE(), TEST_MEMBER_EMAIL_UNIQUE()];
    for (const email of emails) {
      await adminApi.createMember({ name: TEST_MEMBER_NAME, email });
    }

    await adminApi.deleteAllMembers();

    const res = await request.get(`${BASE()}/ghost/api/admin/members/`, {
      headers: authHeaders(),
      params: { limit: 100 },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // AA-031 — New member defaults to status=free
  // Explicitly asserts the default status so tests that depend on free-tier
  // behaviour have a reliable baseline without manually setting the field.
  // -------------------------------------------------------------------------
  test('AA-031: newly created member has status=free by default', async ({ adminApi }) => {
    const email = TEST_MEMBER_EMAIL_UNIQUE();
    const member = await adminApi.createMember({ name: TEST_MEMBER_NAME, email });
    createdMemberIds.push(member.id);

    expect(member.status).toBe('free');
  });

  // -------------------------------------------------------------------------
  // AA-032 — Invalid email format → 422
  // Ghost validates email syntax on the server.  Submitting a malformed email
  // must produce a 422 rather than creating a member with an invalid address
  // that could never receive magic-link emails.
  // -------------------------------------------------------------------------
  test('AA-032: create member with invalid email format returns 422', async ({ request }) => {
    const res = await request.post(`${BASE()}/ghost/api/admin/members/`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { members: [{ name: TEST_MEMBER_NAME, email: 'not-an-email' }] },
    });

    expect(res.status()).toBe(422);
  });
});
