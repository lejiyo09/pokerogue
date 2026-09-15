/**
 * Matches the school email shape the server independently re-checks
 * (`allowedSchoolEmail` in rogueserver's `api/account/firebase.go`):
 * <4-digit year><4-digit id>@hanilgo.cnehs.kr (e.g. 20260001@hanilgo.cnehs.kr).
 * Kept dependency-free (no Firebase SDK import) so registration can validate
 * the email before ever loading Firebase - see registration-form-ui-handler.ts.
 */
const ALLOWED_SCHOOL_EMAIL = /^2026\d{4}@hanilgo\.cnehs\.kr$/;

export function isAllowedSchoolEmail(email: string): boolean {
  return ALLOWED_SCHOOL_EMAIL.test(email);
}
