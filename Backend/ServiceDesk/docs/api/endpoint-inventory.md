# Access Desk API: endpoint inventory

Source of truth for shapes: `docs/swagger.json` (saved from the running API). This list says **who** may call each endpoint and **why**.
Errors always use `{ message, errors: { field } }` (ApiError); the sign-in endpoints wrap their answers in `ApiResponse` (`{ statusCode, message, data, errors }`).
Changes (POST, PUT, PATCH, DELETE) from the web app carry `X-CSRF-Token`; Swagger and scripts that use a Bearer header do not need it.

| Method | Route | Who | Purpose |
|---|---|---|---|
| GET | `/api/health` | anyone | Liveness |
| POST | `/api/auth/login` | anyone | Sign in (AD or Development test account); sets the HttpOnly cookies and returns the CSRF token. 10 per minute per IP |
| POST | `/api/auth/refresh` | anyone with the refresh cookie | New tokens; the old refresh token stops working. 30 per minute per IP |
| GET | `/api/auth/me` | signed in | The person, their roles, unread count |
| GET | `/api/auth/csrf` | signed in | A fresh CSRF token (after a page reload) |
| POST | `/api/auth/logout` | anyone | Revokes the refresh token, clears the cookies |
| GET | `/api/notifications` | signed in | Own notifications, paged |
| GET | `/api/notifications/unread-count` | signed in | Own unread count |
| PATCH | `/api/notifications/{id}/read` | signed in (own only) | Mark one read (204) |
| PATCH | `/api/notifications/read-all` | signed in | Mark all own read |
| (hub) | `/hubs/notifications` | signed in | Live `ReceiveNotification`; `Ping` |
| GET | `/api/admin/users` | Super Admin | People with roles; search, role filter, paging |
| GET | `/api/admin/users/{userId}` | Super Admin | One person |
| GET | `/api/admin/roles` | Super Admin | The five roles |
| POST | `/api/admin/users/{userId}/roles` | Super Admin | Give a role (409 if held). Only Super Admin can be given here; Case Worker, Head of Unit and HOD follow the organisation (400) |
| DELETE | `/api/admin/users/{userId}/roles/{roleId}` | Super Admin | Take a role away (history kept; not Requester; not a structure role; not the last Super Admin) |
| PATCH | `/api/admin/users/{userId}/status` | Super Admin | Block / unblock (blocking ends sessions; not yourself; not the last Super Admin) |
| GET | `/api/admin/departments` | Super Admin | Departments with HOD and units (switched-off ones included) |
| POST | `/api/admin/departments` | Super Admin | New department (code 2-10 of A-Z, 0-9, -; code and name unique) |
| PATCH | `/api/admin/departments/{id}` | Super Admin | Rename / switch on or off (off only when all its units are off) |
| PUT | `/api/admin/departments/{id}/hod` | Super Admin | Set or clear the HOD (not a member of a unit in this department) |
| PUT | `/api/admin/departments/{id}/admin` | Super Admin | Set or clear the Department Admin (must head a unit of the department) |
| POST | `/api/admin/departments/{id}/units` | Super Admin | New unit in a department |
| PATCH | `/api/admin/units/{id}` | Super Admin | Rename / switch on or off (off only when it has no members) |
| PUT | `/api/admin/units/{id}/head` | Super Admin | Set or clear the head (added as a member; the old head stays as an employee) |
| PUT | `/api/admin/units/{id}/deputy` | Super Admin | Set or clear the deputy (must be a member, not the head) |
| GET | `/api/admin/units/{id}/members` | Super Admin | Current members |
| POST | `/api/admin/units/{id}/members` | Super Admin | Add a member (one unit per department; 409 if already in one) |
| DELETE | `/api/admin/units/{id}/members/{userId}` | Super Admin | Remove a member (history kept; not the head or deputy - change those first) |
| GET | `/api/org/me` | signed in | My departments and units, with what I lead (builds the menu) |
| GET | `/api/org/departments` | signed in | Active departments and units (names only) |
| GET | `/api/availability/me` | signed in | My availability today, my current and future leave |
| POST | `/api/availability/absences` | signed in (rules in the service) | Leave or out of office for myself (when in a unit or an HOD), or for a member of the unit I head or deputise, my department (HOD), or anyone (Super Admin). No overlaps (409); up to 30 days back; at most 366 days |
| DELETE | `/api/availability/absences/{id}` | same people as above | Cancels a future period; a started one ends yesterday instead |
| GET | `/api/availability/units/{unitId}` | unit head or deputy, HOD of its department, Super Admin | Members, who is available today, leave in the next 90 days |
| GET | `/api/availability/departments/{departmentId}` | HOD, Super Admin | The same for every active unit of the department |
| GET | `/api/catalogue/categories` | signed in | Active departments with the categories a requester can choose |
| GET | `/api/admin/categories?departmentId=` | Super Admin | Categories with owning unit, timeline, default priority, eligible case workers, `needsCover` |
| POST | `/api/admin/categories` | Super Admin | New category in a unit (name unique in the department; timeline 1-720 business hours) |
| PATCH | `/api/admin/categories/{id}` | Super Admin | Rename, describe, move to another unit of the department (mappings outside the new unit end), timeline, priority, order, on/off |
| GET | `/api/admin/categories/cover-warnings` | Super Admin | Active categories with fewer than two eligible case workers |
| GET | `/api/admin/units/{unitId}/skills` | Super Admin | Skills matrix: the unit's categories, its members and what each handles, warnings |
| PUT | `/api/admin/units/{unitId}/skills/{userId}` | Super Admin | Set exactly which of the unit's categories this member handles; message names categories still short of cover |
| GET | `/api/locations?forUserId=` | signed in (forUserId: Super Admin) | Active locations and the one to pre-select |
| GET | `/api/admin/locations` | Super Admin | All locations |
| POST | `/api/admin/locations` | Super Admin | Add a location |
| PATCH | `/api/admin/locations/{id}` | Super Admin | Rename, reorder, switch on/off (one must stay on) |
| GET, POST | `/api/admin/holidays?year=` | Super Admin | Company holidays, oldest first (server-settings ones flagged fromConfig); add one `{ date, name }` (409 if the date is already a holiday) |
| DELETE | `/api/admin/holidays/{id}` | Super Admin | Remove a holiday added here (404 if gone) |
| GET, PUT | `/api/admin/sla-policies` | Super Admin | Service levels: the four default targets (built-in when not saved) and the department and category overrides; save one `{ scope, departmentId?, categoryId?, priority, responseHours, resolutionHours }` |
| GET | `/api/priority-matrix` | signed in (the request form uses it) | The impact and urgency questions with their wording, and the priority of all 16 answer pairs (`isDefault`: not edited) |
| PUT | `/api/admin/priority-matrix` | Super Admin | Change cells `{ cells: [{ impact, urgency, priority }] }`; a cell sent at its default goes back to not edited; answers the whole matrix; affects tickets raised from now on |
| DELETE | `/api/admin/sla-policies/{id}` | Super Admin | Remove a saved level: the level above (or the built-in default) applies again |
| GET | `/api/canned-replies/placeholders` | signed in | The placeholders a saved reply may use, with what each becomes |
| GET | `/api/tickets/{id}/canned-replies` | department staff, Super Admin (others 404) | Saved replies for this ticket (its unit first, then shared), placeholders filled in |
| GET, POST | `/api/units/{unitId}/canned-replies` | Head of Unit, Department Admin, Super Admin | A unit's library of saved replies; add one `{ title, bodyHtml }` (409 title already used) |
| GET, POST | `/api/admin/canned-replies` | Super Admin | The shared library; add one |
| GET | `/api/units/{unitId}/categories` | Head of Unit, HOD, Department Admin, Super Admin | The unit's categories (read only here), with cover |
| GET | `/api/units/{unitId}/team` | Head of Unit, HOD, Department Admin, Super Admin | The unit's members |
| GET | `/api/units/{unitId}/skills` | Head of Unit, HOD, Department Admin, Super Admin | The unit's skills matrix and cover warnings |
| PUT | `/api/units/{unitId}/skills/{userId}` | Head of Unit, Department Admin, Super Admin | One member's whole set of categories (the HOD reads only) |
| PATCH, DELETE | `/api/canned-replies/{id}` | signed in (the library's keepers; others 403) | Change or remove a saved reply |
| GET | `/api/kb?search=&departmentId=&categoryId=&page=&pageSize=` | signed in | Published articles: `{ items: [{ id, title, summary, department, category, status, updatedAt, yes, no }], total, page, pageSize, departments: [{ id, name, count }] }`; departments counts matches per department ignoring the department filter. pageSize at most 50 |
| GET | `/api/kb/manage?...&status=draft|published` | signed in (empty for anyone who writes for no department) | Drafts and published articles of the departments I write for; same shape |
| GET | `/api/kb/options` | signed in | Departments I write for `[{ id, name, canPublish, categories }]`; empty: no "My department's articles" tab and no writing screens |
| GET | `/api/kb/suggest?categoryId=&text=` | signed in | Up to 3 published articles for the raise form `[{ id, title, summary, departmentName }]` |
| GET | `/api/kb/{id}` | signed in (a draft is 404 outside its department) | One article: bodyHtml (cleaned), author, dates, yes, no, myVote, canEdit, canPublish, canDelete |
| POST | `/api/kb` | signed in (writers of the department; others 403) | Create a draft `{ departmentId, categoryId, title, summary, bodyHtml }`: title 5 to 200 and unique in the department, summary 10 to 500, body 20+ characters of text; 400 errors.title / summary / bodyHtml / categoryId |
| PUT | `/api/kb/{id}` | signed in (staff change drafts, publishers any article; others 403) | Change an article (departmentId ignored; same rules) |
| POST | `/api/kb/{id}/publish`, `/unpublish` | signed in (a head of unit, the HOD, the Department Admin, Super Admin; others 403) | Publish, or back to draft; returns the article |
| DELETE | `/api/kb/{id}` | signed in (staff their own drafts, publishers any article; others 403) | Delete an article |
| POST | `/api/kb/{id}/vote` | signed in (published articles only) | "Was this helpful?" `{ helpful }`, one answer per person (again changes it); returns `{ yes, no, myVote }` |
| POST | `/api/tickets` | signed in (requesterUserId: Super Admin) | Raise a ticket; multipart: categoryId, locationId, impact, urgency (the priority comes from the priority matrix; priority? only when both are missing), subject, descriptionHtml, ccUserIds, files (0-6, 1 MB each) |
| POST | `/api/tickets/duplicate-check` | signed in | Open tickets in the same category from the last 7 days with the same RSA PIN |
| GET | `/api/tickets?view=mine\|copied\|assigned\|department` | signed in; department view: its staff or Super Admin | Paged lists, newest first; filters: unitId, status or open, search, waitingToStart, slaBreached, escalated, priority (1 Low to 4 Critical), ageBand (1 Under 1 day, 2 1 to 2 days, 3 3 to 5 days, 4 6 to 10 days, 5 Over 10 days: the unit chart's age bars; with open=true; anything else 400), pendingReason (1 waiting on the requester, 2 a third party), sort (created, assignedAt, assignedAt_desc, pendingsince: longest waiting first, due: soonest deadline first across every matching ticket, none due last; it uses a stored copy of the due time refreshed every 5 minutes, so a priority change or a resume can take up to 5 minutes to move a ticket). Each row carries pendingReason (1 requester, 2 third party) and pendingSince while Pending, null otherwise |
| GET | `/api/tickets/{id}`, `/api/tickets/by-reference/{ref}` | requester, raiser, people copied, department staff, Super Admin (others 404) | The ticket, its files and comments (internal notes for staff only) |
| POST | `/api/tickets/{id}/comments` | same as above; internal notes: department staff | Comment with 0-6 files |
| GET | `/api/tickets/{id}/attachments/{attachmentId}` | same as above (internal-note files: staff) | Download (always as a file) |
| GET | `/api/tickets/{id}/reassign-options` | department staff, Super Admin (requester or CC: 403) | Whether I can reassign it and to whom, with workloads |
| POST | `/api/tickets/{id}/reassign` | holder and unit head/deputy (same unit, mapped); HOD and Super Admin (any unit of the department) | Reassign with a reason (5-500); becomes Assigned |
| GET | `/api/pool?search=&unitId=&page=&pageSize=` | signed in | The unit pool, one page at a time (pageSize default 10, at most 100), oldest first: New, unassigned tickets in the units I work in (a member: the categories I handle; a head: the whole unit). `{ items: [{ id, reference, subject, unitId, unitName, categoryId, categoryName, priority, createdAt }], total, page, pageSize, units: [{ id, name, count }] }`; units counts the matches per unit, ignoring unitId |
| POST | `/api/tickets/{id}/pick` | signed in; unit members mapped to the category, or the head | Take a New ticket from the pool (400 unavailable, 409 already taken) |
| GET | `/api/tickets/{id}/assignments` | department staff, Super Admin | Assignment history with the workloads the engine compared |
| GET | `/api/people/search?query=` | signed in | Active staff by name or login name (name, login name, department only); for CC |
| GET | `/api/tickets/{id}/priority` | anyone who can see the ticket (others 404) | Can I change the priority (`canChange`, `reason` why not), the priority, and for staff the requester's `impact` and `urgency` |
| POST | `/api/tickets/{id}/priority` | signed in; head of the ticket's unit, HOD, Department Admin, Super Admin (others 403) | Change an open ticket's priority `{ priority, reason }` (reason 5-500, kept as an internal note); the service levels follow; 409 changed at the same moment |
| GET | `/api/tickets/{id}/actions` | anyone who can see the ticket | What I may do now, and the resolution codes |
| POST | `/api/tickets/{id}/acknowledge`, `/resume` | the assignee | Assigned/Reopened -> In progress; Pending -> In progress |
| POST | `/api/tickets/{id}/pending` | the assignee | `{ reason: 1 requester / 2 third party, note }` |
| POST | `/api/tickets/{id}/resolve` | the assignee | `{ code, note }`; 400 `errors.tasks` while a task is open, unless the code is Duplicate or Raised in error |
| POST | `/api/tickets/{id}/confirm`, `/reopen` | the requester (or who raised it) | Resolved -> Closed; Resolved -> Reopened `{ reason }` |
| POST | `/api/tickets/{id}/cancel` | requester (New/Assigned), Super Admin (any open) | `{ reason }` |
| POST | `/api/tickets/{id}/escalate` | the assignee | Ask the unit's head for help `{ reason }` (5 to 1000 characters, kept as an internal note) |
| GET | `/api/catalogue/suggestions` | signed in | Quick picks for the requester home: `recent` (what I raised in the last 90 days, up to 5, newest first) and `popular` (most raised in the last 30 days, up to 6); active categories only |
| GET | `/api/catalogue/templates` | signed in | Suggested subject and description for the raise form: categories requesters can choose that have one, placeholders filled in for me |
| GET, PUT | `/api/categories/{id}/template` | unit heads, Department Admin, Super Admin | A category's template to edit (placeholders not filled in); save `{ subject, descriptionHtml }`, both empty removes it (the head of its unit only; others 403) |
| GET | `/api/catalogue/mine` | signed in | The categories I handle, per unit |
| GET | `/api/directory/users/search` | Super Admin, Head of Unit | AD staff search (503 when AD is not set up) |
| POST | `/api/directory/users/ensure` | Super Admin | Add a person from AD before their first sign-in |
| GET | `/api/admin/email/status` | Super Admin | Email provider status (never a key) |
| POST | `/api/admin/email/test` | Super Admin | Send a test email |
| GET | `/api/tickets/sla-summary?departmentId=&unitId=` | staff of that department (a unit's staff: their own unit), Super Admin | Open tickets by SLA level: open, warning, overdue, farPast, unassigned |
| GET | `/api/reports/catalogue` | unit heads, HOD, Department Admin, Super Admin | Ready-made reports (R1 to R9) and the option lists |
| POST | `/api/reports/run` | same | Run a report definition in your own scope |
| POST | `/api/reports/export?format=xlsx\|csv` | same | Download a definition as Excel or CSV (up to 50,000 rows) |
| GET | `/api/reports/saved?scope=mine\|shared&search=&page=&pageSize=` | same | Saved reports, newest first, one page at a time (pageSize default 10, at most 100) `{ items, total, page, pageSize }`; scope mine or shared (anything else: both); search covers the name, description and owner |
| POST | `/api/reports/saved` | same | Save a report (private, unit, department or roles) |
| PUT, DELETE | `/api/reports/saved/{id}` | the owner | Change or delete a saved report (deleting also removes its schedules) |
| POST | `/api/reports/saved/{id}/run` | same people as above | Run a saved report in your own scope |
| POST | `/api/reports/saved/{id}/export?format=xlsx\|csv` | same | Download a saved report |
| GET, POST | `/api/reports/schedules` | same | My scheduled report emails; schedule a saved report (daily on working days, weekly, monthly, or custom weekdays; Lagos hour; emailed to me and up to 10 people I copy) |
| PUT, DELETE | `/api/reports/schedules/{id}` | the owner | Change, switch on or off, or delete a schedule. There is no "send now" |
| GET | `/api/reports/recipients/search?query=` | unit heads, HOD, Department Admin, Super Admin | People to copy on a scheduled report: up to 20 enabled staff with an email (400 empty or too long query; 503 directory not reachable) |
| GET, POST | `/api/views` | signed in | My saved list views (favourites first); save one `{ name, filterJson, isFavourite? }` (409 name already used, at most 30) |
| PATCH, DELETE | `/api/views/{id}` | signed in (my own; others 404) | Rename, change, star or delete a saved view |
| POST | `/api/tickets/bulk/pick`, `/acknowledge`, `/reassign`, `/resolve` | signed in (each ticket follows the single action's rules) | The same action on 1 to 50 tickets; always 200 with a result per ticket |
| GET, POST | `/api/tickets/{id}/links` | department staff, Super Admin (others 404) | Linked tickets (related, duplicate of, merged); link one `{ reference, relation }` (409 already linked) |
| DELETE | `/api/tickets/{id}/links/{linkId}` | department staff, Super Admin (others 404) | Remove a link (400 for a merge) |
| GET | `/api/tickets/{id}/tasks` | department staff, Super Admin (others 404) | Never for the requester (404). The checklist in the order added: `{ items: [{ id, title, assignee, dueDate, isDone, doneAt, doneBy (null while open), isOverdue, createdAt }], open, done, canEdit }`; canEdit false once Resolved, Closed or Cancelled |
| GET | `/api/tickets/{id}/tasks/owners` | department staff, Super Admin (others 404) | The owner picker: everyone active who works in the ticket's department `[{ userId, userName, fullName }]` |
| POST | `/api/tickets/{id}/tasks` | department staff, Super Admin (others 404) | Add `{ title, assigneeUserId?, dueDate? }`: title 3 to 200, at most 30 per ticket, owner works in the department (empty: the ticket's assignee), dueDate yyyy-MM-dd; 400 errors.title / dueDate / assigneeUserId, or a locked ticket |
| PUT | `/api/tickets/{id}/tasks/{taskId}` | department staff, Super Admin (others 404) | Change title, owner and due date (same rules as add) |
| PUT | `/api/tickets/{id}/tasks/{taskId}/done` | department staff, Super Admin (others 404) | `{ done }`: tick or untick |
| DELETE | `/api/tickets/{id}/tasks/{taskId}` | department staff, Super Admin (others 404) | Remove a task |
| POST | `/api/tickets/{id}/merge` | department staff, Super Admin (others 404) | Merge this ticket into the one to keep `{ targetReference, reason, copyRequester }`; it closes for good |
| POST | `/api/tickets/{id}/read` | anyone who can see the ticket (others 404) | Mark it read for me: clears its unread marker in my lists |
| GET | `/api/dashboard/summary` | signed in | Home counts: mine (open, waiting, warning, overdue, raised, to confirm, waiting on my reply) and, for those who oversee units, per-unit counts with a total |
| GET | `/api/performance/me?preset=&from=&to=` | signed in (own figures only) | My performance: figures (assigned, resolved, resolvedWithinSla, resolvedLate, reopened, firstResponseMet, noResponseInTime, openNow, overdueOpen, onHold, the shares withinSlaPercent, respondedInTimePercent, reopenedPercent, resolutionRatePercent, and the averages), the team averages (efficiency figures only), the series by day, week or month, open now by status, the targets (400 a bad range) |
| GET | `/api/performance/people/{userId}?preset=&from=&to=` | signed in; the person's head, HOD, Department Admin, Super Admin (others 404) | The same for one of my people |
| GET | `/api/performance/units/{unitId}?preset=&from=&to=` | signed in; the unit's head, HOD, Department Admin, Super Admin (others 403) | A unit's performance: figures and each member's figures (the same fields as /me), members, series, open by status, priority and age, top 8 categories, targets |
| GET | `/api/dashboard/unit/{unitId}` | unit heads, HOD, Department Admin, Super Admin | One unit's dashboard (its own head, its department's HOD or Department Admin, Super Admin; others 403): counts, pool by category, team and leave, categories and cover, escalations, tickets past their deadline (404 unknown unit) |
