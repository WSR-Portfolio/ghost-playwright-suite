/**
 * Single import point for all custom fixtures.
 *
 * Spec files should import { test, expect } from '../fixtures' (or the
 * appropriate relative path) instead of from @playwright/test directly.
 * This ensures every test has access to adminApi and mailpit fixtures.
 */

export { test, expect } from './mailpit.fixture';
export { generateAdminToken } from './admin-api.fixture';
export {
  generateTestEmail,
  TEST_EMAIL_DOMAIN,
  TEST_POST_TITLE,
  TEST_POST_SLUG,
  TEST_POST_TITLE_PUBLISHED,
  TEST_POST_TITLE_UPDATED,
  TEST_PAGE_TITLE,
  TEST_PAGE_SLUG,
  TEST_TAG_NAME,
  TEST_TAG_DESCRIPTION,
  TEST_MEMBER_NAME,
  TEST_MEMBER_EMAIL,
  TEST_MEMBER_EMAIL_UNIQUE,
} from './test-data';
export type { GhostPost, GhostPage, GhostTag, GhostMember, AdminApiHelper } from './admin-api.fixture';
export type { MailpitHelper, MailpitMessage } from './mailpit.fixture';
