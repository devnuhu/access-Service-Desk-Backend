/**
 * Expected access per route, from the controllers in ServiceDeskAPI/Controllers and the policies in
 * Infrastructure/Identity/Policies.cs (SuperAdmin passes every policy).
 *
 * access: an array of role names, "signedIn" (any role) or "anonymous".
 * Live run (one role per run, GET only, never changes data):
 *   probe        GET it as is (query optional)
 *   idFrom       fill the path parameter from the first row of another GET (no row: SKIP)
 *   queryFrom    fill a required query parameter the same way ({ listPath, field, param })
 *   skip         never called live; the text says why and what data it needs
 *   badRequestProbe  a request (body, query and/or a concrete path) that must be refused with 400
 *                    before anything is written
 *   schema       a zod schema the live response must pass (field check)
 */
import { POLICIES } from "../src/features/auth/policies.js";
import {
  getUser,
  listRoles,
  listUsers,
} from "../src/features/admin-people/api/endpoints.js";
import { getEmailStatus } from "../src/features/admin-email/api/endpoints.js";
import { me } from "../src/features/auth/api/endpoints.js";
import {
  getUnreadCount,
  listNotifications,
} from "../src/features/notifications/api/endpoints.js";

const SUPER = POLICIES.Super_Admin_Only;
const UNIT = POLICIES.Unit_Management;
const SIGNED_IN = "signedIn";
const ANONYMOUS = "anonymous";

const WRITE =
  "write check: the script never creates, changes or deletes backend data";

const get = (path, access, live = { probe: {} }) => ({
  method: "GET",
  path,
  access,
  ...live,
});
const write = (method, path, access, skip = WRITE) => ({
  method,
  path,
  access,
  skip,
});
const from = (listPath, field = "id", listQuery = {}) => ({
  idFrom: { listPath, field, listQuery },
});

export const ACCESS_TABLE = [
  // Auth
  write("POST", "/api/Auth/login", ANONYMOUS, "used to sign in for the run"),
  write("POST", "/api/Auth/refresh", ANONYMOUS, "rotates the session token"),
  get("/api/Auth/me", SIGNED_IN, { probe: {}, schema: me.response }),
  // Issues a CSRF cookie; harmless, but the script has no use for it.
  get("/api/Auth/csrf", SIGNED_IN, { skip: "issues a CSRF cookie only" }),
  write(
    "POST",
    "/api/Auth/logout",
    ANONYMOUS,
    "called once at the end of the run",
  ),

  // People and roles (Super_Admin_Only)
  get("/api/admin/users", SUPER, {
    probe: { page: 1, pageSize: 5 },
    schema: listUsers.response,
  }),
  get("/api/admin/users/{userId}", SUPER, {
    ...from("/api/admin/users"),
    schema: getUser.response,
  }),
  get("/api/admin/roles", SUPER, { probe: {}, schema: listRoles.response }),
  write("POST", "/api/admin/users/{userId}/roles", SUPER),
  write("DELETE", "/api/admin/users/{userId}/roles/{roleId}", SUPER),
  write("PATCH", "/api/admin/users/{userId}/status", SUPER),

  // Directory: search for Heads of Unit and Super Admin; adding an account for Super Admin
  get("/api/directory/users/search", UNIT, {
    skip: "needs the directory (AD); answers 503 while AD is not set up",
  }),
  write("POST", "/api/directory/users/ensure", SUPER),

  // Email (Super_Admin_Only)
  get("/api/admin/email/status", SUPER, {
    probe: {},
    schema: getEmailStatus.response,
  }),
  write(
    "POST",
    "/api/admin/email/test",
    SUPER,
    "sends a real email; check it by hand on the Email page",
  ),

  // Notifications (the signed-in person's own)
  get("/api/notifications", SIGNED_IN, {
    probe: { page: 1, pageSize: 5 },
    schema: listNotifications.response,
  }),
  get("/api/notifications/unread-count", SIGNED_IN, {
    probe: {},
    schema: getUnreadCount.response,
  }),
  write("PATCH", "/api/notifications/{id}/read", SIGNED_IN),
  write("PATCH", "/api/notifications/read-all", SIGNED_IN),

  // Health
  get("/api/health", ANONYMOUS),
];

/** Routes the table says never to call. Declaring one in an endpoints.js file is a mismatch. */
export const DO_NOT_USE = [];

/** "HeadOfUnit, SuperAdmin" | "any signed-in user" | "anonymous" */
export function describeAccess(access) {
  if (access === SIGNED_IN) return "any signed-in user";
  if (access === ANONYMOUS) return "anonymous";
  return access.join(", ");
}

/** True when a user holding `roles` should be let through. */
export function isAllowed(access, roles) {
  if (access === SIGNED_IN || access === ANONYMOUS) return true;
  return roles.some((role) => access.includes(role));
}
