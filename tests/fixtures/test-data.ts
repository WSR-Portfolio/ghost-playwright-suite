/**
 * Shared test data constants and generators.
 *
 * EMAIL ADDRESSING CONVENTION
 * ----------------------------
 * All test-generated email addresses use the dedicated subdomain
 * testuser.wsrportfolio.dev rather than a generic domain like example.com.
 * This makes test accounts immediately identifiable in Ghost's member list,
 * admin logs, and Mailpit — they cannot be confused with real user accounts
 * and can be bulk-deleted by filtering on the domain if a test run leaves
 * behind residual data.
 */

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export const TEST_EMAIL_DOMAIN = 'testuser.wsrportfolio.dev';

/**
 * Returns a deterministic-looking email address scoped to the test subdomain.
 *
 * Usage:
 *   generateTestEmail('signup')   → 'signup@testuser.wsrportfolio.dev'
 *   generateTestEmail('member-1') → 'member-1@testuser.wsrportfolio.dev'
 *
 * When a test needs a unique address per run (to avoid Mailpit collisions or
 * Ghost duplicate-member errors), append a timestamp or random suffix to the label:
 *   generateTestEmail(`member-${Date.now()}`)
 */
export function generateTestEmail(label: string): string {
  return `${label}@${TEST_EMAIL_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export const TEST_POST_TITLE = 'QA Test Post — Admin API';
export const TEST_POST_SLUG = 'qa-test-post-admin-api';
export const TEST_POST_TITLE_PUBLISHED = 'QA Test Post — Published';
export const TEST_POST_TITLE_UPDATED = 'QA Test Post — Updated Title';

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export const TEST_PAGE_TITLE = 'QA Test Page — Admin API';
export const TEST_PAGE_SLUG = 'qa-test-page-admin-api';

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const TEST_TAG_NAME = 'qa-test-tag';
export const TEST_TAG_DESCRIPTION = 'Created by Playwright test suite — safe to delete';

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export const TEST_MEMBER_NAME = 'QA Test Member';
export const TEST_MEMBER_EMAIL = generateTestEmail('member');

// Used when a test needs a fresh address that won't collide with a pre-existing
// member record — append Date.now() at call time rather than at module load time
// so each test invocation gets a distinct value.
export const TEST_MEMBER_EMAIL_UNIQUE = (): string =>
  generateTestEmail(`member-${Date.now()}`);
