import {
  clearCsrfToken,
  getCsrfToken,
  request,
  setCsrfToken,
} from "@/shared/lib/http";
import { csrf, login, logout, me, refresh } from "./api/endpoints.js";

/** The signed-in person lives in the query cache under this key: a UserProfile, or null when signed out. */
export const SESSION_KEY = ["session"];

/**
 * Session start: GET /api/auth/me (the client refreshes once on 401). 200 -> signed in, and a CSRF
 * token is fetched if this page has none yet (after a reload). 401 after refresh -> null.
 */
export async function loadSession() {
  try {
    const { data } = await request(me);
    if (!getCsrfToken()) await fetchCsrfToken().catch(() => {});
    return data;
  } catch (error) {
    if (error?.kind === "unauthorized") return null;
    throw error;
  }
}

export const sessionQuery = {
  queryKey: SESSION_KEY,
  queryFn: loadSession,
  staleTime: Infinity,
  retry: false,
};

/** Gets a new CSRF token and keeps it in memory. */
export async function fetchCsrfToken() {
  const { data } = await request(csrf);
  setCsrfToken(data);
  return data;
}

/** Renews the cookies. Used by the HTTP client through one shared promise; true on success. */
export async function refreshSession() {
  try {
    const { data } = await request(refresh);
    setCsrfToken(data.csrfToken);
    return true;
  } catch {
    return false;
  }
}

/** Signs in, then loads the profile so the whole app reads one user shape. */
export async function signIn(queryClient, credentials) {
  const { data } = await request(login, { body: credentials });
  setCsrfToken(data.csrfToken);
  return queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
}

/** Forgets everything about the session in this tab. Route guards then send the person to sign in. */
export function endSession(queryClient) {
  clearCsrfToken();
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== SESSION_KEY[0],
  });
  queryClient.setQueryData(SESSION_KEY, null);
}

/** POST /api/auth/logout (always 200), then clears the session even if the call failed. */
export async function signOut(queryClient) {
  try {
    await request(logout);
  } finally {
    endSession(queryClient);
  }
}

/** First name for greetings. /me has no firstName, so it is the first word of the full name. */
export function firstNameOf(user) {
  const name = user?.fullName?.trim() || user?.username || "";
  return name.split(/\s+/)[0];
}

/** `next` only when it is a local path ("/x", not "//host" or "/\\host"), to prevent open redirects. */
export function safeNext(next) {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/login")) return "/";
  return next;
}
