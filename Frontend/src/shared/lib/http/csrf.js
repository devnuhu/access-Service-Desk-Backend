/**
 * The CSRF token, in memory only (never localStorage or sessionStorage). The API issues it on
 * sign-in, refresh and GET /api/auth/csrf, in the body and in the X-CSRF-Token response header.
 * A page reload loses it; the session start fetches a new one.
 */
let token = null;

export function getCsrfToken() {
  return token;
}

/** @param {string | null | undefined} value */
export function setCsrfToken(value) {
  token = value || null;
}

export function clearCsrfToken() {
  token = null;
}
