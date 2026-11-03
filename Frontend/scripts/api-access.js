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
 *   skipAlways   with skip: not probed for any role (the service decides by organisation, and
 *                answers 404 for an unknown id before it checks access)
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
import { listAdminDepartments } from "../src/features/admin-units/api/endpoints.js";
import {
  getUnitSkills,
  listCategories,
  listCoverWarnings,
} from "../src/features/admin-catalogue/api/endpoints.js";
import { listCatalogue } from "../src/features/catalogue/api/endpoints.js";
import { listAdminLocations } from "../src/features/admin-locations/api/endpoints.js";
import {
  getTicket,
  getTicketByReference,
  listLocations,
  listTickets,
} from "../src/features/tickets/api/endpoints.js";
import { getMyAvailability } from "../src/features/availability/api/endpoints.js";
import {
  getMyOrganisation,
  listOrgDepartments,
} from "../src/features/org/api/endpoints.js";
import { me } from "../src/features/auth/api/endpoints.js";
import {
  getUnreadCount,
  listNotifications,
} from "../src/features/notifications/api/endpoints.js";

const SUPER = POLICIES.Super_Admin_Only;
const UNIT = POLICIES.Unit_Management;
// Availability views are [Authorize] only; the service checks the organisation (head or deputy of
// the unit, HOD of the department), so a role alone is not enough. These are the roles involved.
const TEAM_VIEW = ["HeadOfUnit", "HOD", "SuperAdmin"];
const DEPARTMENT_VIEW = ["HOD", "SuperAdmin"];
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

  // Organisation (Super_Admin_Only for changes; any signed-in person reads their own place)
  get("/api/admin/departments", SUPER, {
    probe: {},
    schema: listAdminDepartments.response,
  }),
  write("POST", "/api/admin/departments", SUPER),
  write("PATCH", "/api/admin/departments/{departmentId}", SUPER),
  write("PUT", "/api/admin/departments/{departmentId}/hod", SUPER),
  write("POST", "/api/admin/departments/{departmentId}/units", SUPER),
  write("PATCH", "/api/admin/units/{unitId}", SUPER),
  write("PUT", "/api/admin/units/{unitId}/head", SUPER),
  write("PUT", "/api/admin/units/{unitId}/deputy", SUPER),
  get("/api/admin/units/{unitId}/members", SUPER, {
    skip: "needs a unit id from GET /api/admin/departments (nested list)",
  }),
  write("POST", "/api/admin/units/{unitId}/members", SUPER),
  write("DELETE", "/api/admin/units/{unitId}/members/{userId}", SUPER),
  get("/api/org/me", SIGNED_IN, {
    probe: {},
    schema: getMyOrganisation.response,
  }),
  get("/api/org/departments", SIGNED_IN, {
    probe: {},
    schema: listOrgDepartments.response,
  }),

  // Availability
  get("/api/availability/me", SIGNED_IN, {
    probe: {},
    schema: getMyAvailability.response,
  }),
  write("POST", "/api/availability/absences", SIGNED_IN),
  write("DELETE", "/api/availability/absences/{absenceId}", SIGNED_IN),
  get("/api/availability/units/{unitId}", TEAM_VIEW, {
    skipAlways: true,
    skip: "allowed by the organisation (head or deputy of that unit), not by role alone",
  }),
  get("/api/availability/departments/{departmentId}", DEPARTMENT_VIEW, {
    skipAlways: true,
    skip: "allowed by the organisation (HOD of that department), not by role alone",
  }),

  // Catalogue: requesters read it; Super Admin manages categories and the skills matrix
  get("/api/catalogue/categories", SIGNED_IN, {
    probe: {},
    schema: listCatalogue.response,
  }),
  get("/api/admin/categories", SUPER, {
    probe: {},
    schema: listCategories.response,
  }),
  write("POST", "/api/admin/categories", SUPER),
  write("PATCH", "/api/admin/categories/{categoryId}", SUPER),
  get("/api/admin/categories/cover-warnings", SUPER, {
    probe: {},
    schema: listCoverWarnings.response,
  }),
  get("/api/admin/units/{unitId}/skills", SUPER, {
    ...from("/api/admin/categories", "unitId"),
    schema: getUnitSkills.response,
  }),
  write("PUT", "/api/admin/units/{unitId}/skills/{userId}", SUPER),

  // Locations: everyone reads the choices; Super Admin keeps the list
  get("/api/locations", SIGNED_IN, {
    probe: {},
    schema: listLocations.response,
  }),
  get("/api/admin/locations", SUPER, {
    probe: {},
    schema: listAdminLocations.response,
  }),
  write("POST", "/api/admin/locations", SUPER),
  write("PATCH", "/api/admin/locations/{locationId}", SUPER),

  // Tickets: any signed-in person raises and reads; the service decides per ticket (404 for others)
  write("POST", "/api/tickets", SIGNED_IN),
  write(
    "POST",
    "/api/tickets/duplicate-check",
    SIGNED_IN,
    "a POST (reads only, but the run is GET-only)",
  ),
  get("/api/tickets", SIGNED_IN, {
    probe: { view: "mine", page: 1, pageSize: 5 },
    schema: listTickets.response,
  }),
  get("/api/tickets/{ticketId}", SIGNED_IN, {
    ...from("/api/tickets", "id", { view: "mine", page: 1, pageSize: 1 }),
    schema: getTicket.response,
  }),
  get("/api/tickets/by-reference/{reference}", SIGNED_IN, {
    ...from("/api/tickets", "reference", {
      view: "mine",
      page: 1,
      pageSize: 1,
    }),
    schema: getTicketByReference.response,
  }),
  write("POST", "/api/tickets/{ticketId}/comments", SIGNED_IN),
  get("/api/tickets/{ticketId}/attachments/{attachmentId}", SIGNED_IN, {
    skipAlways: true,
    skip: "a file download; needs a ticket with a file (manual check 1 downloads one)",
  }),

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
