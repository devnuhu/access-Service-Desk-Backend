/**
 * Expected access per route, from the controllers in ServiceDeskAPI/Controllers and the policies in
 * Infrastructure/Identity/Policies.cs (SuperAdmin passes every policy).
 *
 * access: an array of role names, "signedIn" (any role) or "anonymous".
 * Live run (one role per run, GET only, never changes data):
 *   probe        GET it as is (query optional)
 *   idFrom       fill the path parameter from the first row of another GET (no row: SKIP)
 *   orgScope     "unit" or "department": fill the path parameter with a real id, the one this person
 *                runs when there is one (a role that must be refused gets its 403 for a real id)
 *   queryFrom    fill a required query parameter the same way ({ listPath, field, param })
 *   queryOrgScope  fill a required query parameter with this person's department or unit id
 *                ({ scope: "department" | "unit", param }), like orgScope does for the path
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
import {
  listCatalogue,
  listCatalogueTemplates,
  listMyCategories,
} from "../src/features/catalogue/api/endpoints.js";
import { listAdminLocations } from "../src/features/admin-locations/api/endpoints.js";
import { listHolidays } from "../src/features/admin-holidays/api/endpoints.js";
import { getSlaPolicies } from "../src/features/admin-sla/api/endpoints.js";
import {
  listPlaceholders,
  listSharedReplies,
  listUnitReplies,
} from "../src/features/canned-replies/api/endpoints.js";
import {
  getUnitSkills as getMyUnitSkills,
  listUnitCategories,
  listUnitTeam,
} from "../src/features/my-unit/api/endpoints.js";
import { searchPeople } from "../src/features/people/api/endpoints.js";
import {
  getTicket,
  getSlaSummary,
  getTicketActions,
  getTicketByReference,
  listPool,
  listLocations,
  listSavedViews,
  listTickets,
} from "../src/features/tickets/api/endpoints.js";
import {
  getDepartmentAvailability,
  getMyAvailability,
  getUnitAvailability,
} from "../src/features/availability/api/endpoints.js";
import {
  getMyOrganisation,
  listOrgDepartments,
} from "../src/features/org/api/endpoints.js";
import { me } from "../src/features/auth/api/endpoints.js";
import {
  getDashboardSummary,
  getUnitDashboard,
} from "../src/features/home/api/endpoints.js";
import {
  getReportCatalogue,
  listReportSchedules,
  listSavedReports,
} from "../src/features/reports/api/endpoints.js";
import {
  getUnreadCount,
  listNotifications,
} from "../src/features/notifications/api/endpoints.js";

const SUPER = POLICIES.Super_Admin_Only;
const UNIT = POLICIES.Unit_Management;
// Availability views are [Authorize] only; the service checks the organisation (head of the unit,
// HOD of the department), so a role alone is not enough. These are the roles involved.
const TEAM_VIEW = ["HeadOfUnit", "HOD", "SuperAdmin"];
const DEPARTMENT_VIEW = ["HOD", "SuperAdmin"];
// Reports are [Authorize] only; the service allows unit heads, HODs, Department Admins and Super
// Admin (by the organisation) and answers 403 for anyone else.
// A unit's saved replies: its head, the Department Admin, Super Admin (the service checks which unit).
// A unit's own tools: read by its head, the HOD, the Department Admin and Super Admin.
const MY_UNIT = ["HeadOfUnit", "HOD", "DepartmentAdmin", "SuperAdmin"];
const UNIT_LIBRARY = ["HeadOfUnit", "DepartmentAdmin", "SuperAdmin"];
const REPORTS = ["HeadOfUnit", "HOD", "DepartmentAdmin", "SuperAdmin"];
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

const refused = (action, body, why) => ({
  ...write("POST", `/api/tickets/{ticketId}/${action}`, SIGNED_IN),
  badRequestProbe: {
    path: `/api/tickets/00000000-0000-0000-0000-000000000000/${action}`,
    body,
    why,
  },
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
  write("PUT", "/api/admin/departments/{departmentId}/admin", SUPER),
  write("POST", "/api/admin/departments/{departmentId}/units", SUPER),
  write("PATCH", "/api/admin/units/{unitId}", SUPER),
  write("PUT", "/api/admin/units/{unitId}/head", SUPER),
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
    orgScope: "unit",
    schema: getUnitAvailability.response,
  }),
  get("/api/availability/departments/{departmentId}", DEPARTMENT_VIEW, {
    orgScope: "department",
    schema: getDepartmentAvailability.response,
  }),

  // Catalogue: requesters read it; Super Admin manages categories and the skills matrix
  get("/api/catalogue/categories", SIGNED_IN, {
    probe: {},
    schema: listCatalogue.response,
  }),
  get("/api/catalogue/mine", SIGNED_IN, {
    probe: {},
    schema: listMyCategories.response,
  }),
  // Templates: the raise form's suggestions for everyone; a category's own template for the
  // Super Admin, the head of its unit and the Department Admin (the service decides; others 403)
  get("/api/catalogue/templates", SIGNED_IN, {
    probe: {},
    schema: listCatalogueTemplates.response,
  }),
  get("/api/categories/{categoryId}/template", UNIT_LIBRARY, {
    skipAlways: true,
    skip: "allowed for the head of the category's unit, its Department Admin and Super Admin; needs a category id",
  }),
  write("PUT", "/api/categories/{categoryId}/template", UNIT_LIBRARY),
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
  // Company holidays: the SLA clock skips them; server-settings rows (fromConfig) are read-only
  get("/api/admin/holidays", SUPER, {
    probe: { year: 2026 },
    schema: listHolidays.response,
  }),
  write("POST", "/api/admin/holidays", SUPER),
  write("DELETE", "/api/admin/holidays/{holidayId}", SUPER),
  // Service levels (first response and resolution targets by priority)
  get("/api/admin/sla-policies", SUPER, {
    probe: {},
    schema: getSlaPolicies.response,
  }),
  write("PUT", "/api/admin/sla-policies", SUPER),
  write("DELETE", "/api/admin/sla-policies/{id}", SUPER),

  // Saved replies: staff of a ticket read its replies (404 otherwise); a unit's head, the
  // Department Admin and Super Admin keep its library (403 otherwise); Super Admin the shared one
  get("/api/canned-replies/placeholders", SIGNED_IN, {
    probe: {},
    schema: listPlaceholders.response,
  }),
  get("/api/tickets/{ticketId}/canned-replies", SIGNED_IN, {
    skipAlways: true,
    skip: "allowed for the ticket's staff and Super Admin; anyone else gets 404 by design",
  }),
  get("/api/units/{unitId}/canned-replies", UNIT_LIBRARY, {
    orgScope: "unit",
    schema: listUnitReplies.response,
  }),
  write("POST", "/api/units/{unitId}/canned-replies", UNIT_LIBRARY),
  get("/api/admin/canned-replies", SUPER, {
    probe: {},
    schema: listSharedReplies.response,
  }),
  write("POST", "/api/admin/canned-replies", SUPER),
  // My unit: the unit's head, its department's HOD (read only) and Department Admin, Super Admin
  get("/api/units/{unitId}/categories", MY_UNIT, {
    orgScope: "unit",
    schema: listUnitCategories.response,
  }),
  get("/api/units/{unitId}/team", MY_UNIT, {
    orgScope: "unit",
    schema: listUnitTeam.response,
  }),
  get("/api/units/{unitId}/skills", MY_UNIT, {
    orgScope: "unit",
    schema: getMyUnitSkills.response,
  }),
  write("PUT", "/api/units/{unitId}/skills/{userId}", UNIT_LIBRARY),
  write("PATCH", "/api/canned-replies/{replyId}", SIGNED_IN),
  write("DELETE", "/api/canned-replies/{replyId}", SIGNED_IN),

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
  // [Authorize] only; the service allows staff of the department (members, HOD) and Super Admin.
  get(
    "/api/tickets/sla-summary",
    ["CaseWorker", "HeadOfUnit", "HOD", "DepartmentAdmin", "SuperAdmin"],
    {
      probe: {},
      queryOrgScope: { scope: "department", param: "departmentId" },
      schema: getSlaSummary.response,
    },
  ),
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

  // Assignment (Step 5): the service decides by the ticket's department, not by role
  get("/api/tickets/{ticketId}/reassign-options", SIGNED_IN, {
    skipAlways: true,
    skip: "allowed for the ticket's department staff and Super Admin; the requester of a ticket gets 403 by design",
  }),
  write("POST", "/api/tickets/{ticketId}/reassign", SIGNED_IN),
  // Unit pool: any signed-in person; the service lists only units they work in (empty otherwise)
  // and decides each pick (403 not in the unit or category, 400 unavailable, 409 taken).
  get("/api/pool", SIGNED_IN, { probe: {}, schema: listPool.response }),
  write("POST", "/api/tickets/{ticketId}/pick", SIGNED_IN),
  // Queue tools: my own saved views; bulk actions (each ticket follows the single action's rules,
  // always 200 with a result per ticket); marking a ticket read (anyone who can see it)
  get("/api/views", SIGNED_IN, { probe: {}, schema: listSavedViews.response }),
  write("POST", "/api/views", SIGNED_IN),
  write("PATCH", "/api/views/{viewId}", SIGNED_IN),
  write("DELETE", "/api/views/{viewId}", SIGNED_IN),
  write("POST", "/api/tickets/bulk/pick", SIGNED_IN),
  write("POST", "/api/tickets/bulk/acknowledge", SIGNED_IN),
  write("POST", "/api/tickets/bulk/reassign", SIGNED_IN),
  write("POST", "/api/tickets/bulk/resolve", SIGNED_IN),
  write("POST", "/api/tickets/{ticketId}/read", SIGNED_IN),
  // Linked tickets and merge: staff for the ticket (others 404 by design)
  get("/api/tickets/{ticketId}/links", SIGNED_IN, {
    skipAlways: true,
    skip: "allowed for the ticket's staff and Super Admin; anyone else gets 404 by design",
  }),
  write("POST", "/api/tickets/{ticketId}/links", SIGNED_IN),
  write("DELETE", "/api/tickets/{ticketId}/links/{linkId}", SIGNED_IN),
  write("POST", "/api/tickets/{ticketId}/merge", SIGNED_IN),
  get("/api/tickets/{ticketId}/assignments", SIGNED_IN, {
    skipAlways: true,
    skip: "allowed for the ticket's department staff and Super Admin; the requester of a ticket gets 403 by design",
  }),
  get("/api/people/search", SIGNED_IN, {
    probe: { query: "test" },
    schema: searchPeople.response,
  }),

  // Workflow (Step 6): the service decides by the ticket and the person. The routes with a body
  // check it before they look at the ticket, so a bad body is refused with 400 and writes nothing.
  get("/api/tickets/{ticketId}/actions", SIGNED_IN, {
    ...from("/api/tickets", "id", { view: "mine", page: 1, pageSize: 1 }),
    schema: getTicketActions.response,
  }),
  write("POST", "/api/tickets/{ticketId}/acknowledge", SIGNED_IN),
  refused("pending", { reason: 1, note: "" }, "an empty note"),
  write("POST", "/api/tickets/{ticketId}/resume", SIGNED_IN),
  refused("resolve", { code: 1, note: "" }, "an empty note"),
  write("POST", "/api/tickets/{ticketId}/confirm", SIGNED_IN),
  refused("reopen", { reason: "" }, "an empty reason"),
  refused("cancel", { reason: "" }, "an empty reason"),
  refused("escalate", { reason: "" }, "an empty reason"),

  // Reports (Step 9): the viewer's own scope; schedules are the viewer's own
  get("/api/reports/catalogue", REPORTS, {
    probe: {},
    schema: getReportCatalogue.response,
  }),
  write(
    "POST",
    "/api/reports/run",
    REPORTS,
    "a POST (reads only, but the run is GET-only)",
  ),
  write("POST", "/api/reports/export", REPORTS, "a POST file download"),
  get("/api/reports/saved", REPORTS, {
    probe: {},
    schema: listSavedReports.response,
  }),
  write("POST", "/api/reports/saved", REPORTS),
  write("PUT", "/api/reports/saved/{id}", REPORTS),
  write("DELETE", "/api/reports/saved/{id}", REPORTS),
  write(
    "POST",
    "/api/reports/saved/{id}/run",
    REPORTS,
    "a POST (reads only, but the run is GET-only)",
  ),
  write(
    "POST",
    "/api/reports/saved/{id}/export",
    REPORTS,
    "a POST file download, written to the audit log",
  ),
  get("/api/reports/schedules", REPORTS, {
    probe: {},
    schema: listReportSchedules.response,
  }),
  write("POST", "/api/reports/schedules", REPORTS),
  write("PUT", "/api/reports/schedules/{id}", REPORTS),
  write("DELETE", "/api/reports/schedules/{id}", REPORTS),
  get("/api/reports/recipients/search", REPORTS, {
    skip: "needs the directory (AD); answers 503 while AD is not set up",
  }),

  // Home counts (Step 9e): mine for everyone; the overview (or null) by what the person leads
  get("/api/dashboard/summary", SIGNED_IN, {
    probe: {},
    schema: getDashboardSummary.response,
  }),
  // One unit's dashboard: the unit's head, its department's HOD or Department Admin, Super Admin
  get("/api/dashboard/unit/{unitId}", REPORTS, {
    orgScope: "unit",
    schema: getUnitDashboard.response,
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
