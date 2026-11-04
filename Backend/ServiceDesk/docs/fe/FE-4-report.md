# FE-4 report: assignment, reassignment and copying colleagues

**Date:** 3 November 2026 · **Folder:** `PRO\AccessServiceDesk\Frontend` · **Built against:** `docs/swagger.json`, saved again from `http://localhost:5048/swagger/v1/swagger.json` on 3 November 2026 (after Step 5)

## Result

| Check | Result |
|---|---|
| `npm run check` | **Passes** with `npm run dev` stopped: lint, Prettier check, tests, `check:api` and build |
| Tests | **145 passed** in 26 files (137 at the end of FE-3) |
| `check:api` | 59 endpoints in 12 files, 60 access rules, compared with `docs/api/endpoint-inventory.md`: **0 mismatches, 0 warnings** |
| `check:api:live` | test.requester 24 PASS, test.caseworker1 22 PASS, test.superadmin 22 PASS, **0 FAIL**. `GET /api/people/search` answers 200 for every role and matches the app's schema |
| Section 6 manual checks | **All 6 pass** against the running API, in the real UI (headless Edge at 1280 × 900, signed in through the sign-in page) |

## Section 0: contract refresh

- `docs/swagger.json` was saved again from the running API. It has the 4 Step 5 routes: `reassign-options`, `reassign`, `assignments` and `people/search`. No existing schema changed. The saved file matches the copy already committed in `5ddcbdd`, so git shows no difference.
- **Endpoint inventory.** The new "Who" wording is now read as "any signed-in person, the service checks the ticket":
  - "department staff, Super Admin (requester or CC: 403)";
  - "holder and unit head/deputy (…); HOD and Super Admin (…)".

  "Requester" alone still means the role. Tests cover both.
- **Live check.**
  - `GET reassign-options` and `GET assignments` are skipped for every role. The answer depends on the ticket's department, and a requester gets 403 on their own ticket by design.
  - `GET people/search` is probed with `query=test`.
- **"A new ticket now comes back Assigned".** No existing fixture assumed New for every ticket. The FE-3 work queue test expected "Unassigned" on a New ticket; it now expects the "Waiting" chip.

## What was built

### Copy colleagues (CC) for everyone

- The CC field is shown to **everyone** raising a ticket. It searches `GET /api/people/search` through the search function the component already took. The search goes through a new feature, `people` (`searchColleagues`), which maps `userId` to the picker's `id`.
- Search starts at 2 characters (before that the picker says "Type at least 2 letters."), debounced by 300 ms. Each result shows the name, login name and department.
- At most 10 people. You can't pick yourself, nor the requester when a Super Admin raises for someone else.
- The Super Admin's "Raise for someone else" picker still uses `/api/admin/users`.
- The shared `PersonPicker` gained `minLength` and `placeholder` options; existing uses are unchanged.

### Ticket page: Assignment panel (staff only, `isStaffView`)

- The panel sits in the side panel's Actions area. Requesters and copied colleagues never mount it, so the app never calls `reassign-options` or `assignments` for them. A test checks this, and manual check 6 confirmed there was no 403.
- **Assignee block:**
  - name and unit;
  - "Assigned 5 minutes ago", with the exact WAT time as a tooltip, taken from the last history entry (question 1);
  - while the status is New: "Waiting for an available case worker".
- **Reassign** shows when `canReassign` is true. Otherwise the API's `reason` shows as muted text.
- **Reassign dialog:**
  - Candidates are grouped by unit when there is more than one.
  - Each row has a "Workload N" chip, then "Handles this category" or an orange "Not mapped".
  - The current assignee shows "Current" and can't be chosen.
  - Reason is required, 5 to 500 characters, with a counter.
  - Choosing someone in another unit warns: "This moves the ticket to Refund."
  - Saving shows the API message as a toast, then refetches the ticket, the options, the history and the lists.
  - The server's `errors.reason` and `errors.toUserId` show under their fields.
  - A 409 shows "The ticket changed at the same moment. It has been reloaded." and refetches.
- **Assignment history** is collapsible and collapsed by default. It is a timeline, oldest first. Each entry shows:
  - the time (WAT);
  - "Auto" or "Reassigned by X";
  - from → to, with units when they differ;
  - the reason.

  Auto reasons are in plain words: "When it was raised", "When someone became available", "Because the assignee was unavailable". Each Auto entry has "Why X? (3 compared)", which opens a small table: name, open tickets, workload, last assigned (WAT). The chosen person is highlighted.
- The FE-3 "Actions" placeholder now shows to staff only and mentions what is still to come (acknowledge, pending, resolve).

### Work queue, lists and Home

- **Assignee column:** a New ticket shows an orange "Waiting" chip; otherwise the name.
- **Work queue tabs** for unit members: **Assigned to me** (`view=assigned`, open statuses) and **All open** (the FE-3 department view).
  - Plain case workers start on Assigned to me. Heads, deputies, HODs and the Super Admin start on All open. People who are not members of a unit (HOD, Super Admin) see no tabs.
  - `view=assigned` covers every department, so the tab keeps this department's tickets by `departmentCode` (question 2).
  - The unit filter is hidden on Assigned to me.
- **Home:** members of a unit get an **Assigned to me** card with the count of their open assigned tickets. It links to their Work queue.

### Live updates

FE-3 already refetches every query under `["tickets"]` when a notification with `relatedEntityType: "Ticket"` arrives. That includes Assignment ones (category 2). The new assignment queries live under the same prefix (`["tickets", "assignment", id]`). So an assignment push refetches the open ticket, its panel, the Work queue and the counts; only queries in use refetch. A test pushes an Assignment notification and checks that the open ticket and the queue refetch while unrelated queries don't.

## Manual checks (section 6)

| # | Check | Result |
|---|---|---|
| 1 | test.requester raises a Contribution Matching ticket, copying test.caseworker2 through the new search | **Pass.** CP-2026-000003 showed "Assigned to Test Head of Unit" straight away (workloads: test.hou 0, test.caseworker1 1, test.caseworker3 1). test.caseworker2's bell: "You were copied on CP-2026-000003" |
| 2 | The assignee reassigns from Work queue → Assigned to me | **Pass.** test.hou's queue opened on All open (they are a head). Assigned to me listed the ticket. Reassigned it to test.caseworker1 with a reason; toast "Ticket CP-2026-000003 is now with Test Case Worker One." The history shows Auto (3 candidates compared) then "Reassigned by Test Head of Unit". test.caseworker1's bell: "Ticket CP-2026-000003 assigned to you" |
| 3 | test.hou2 (head of Refund) opens it | **Pass.** No Reassign. The text reads "Only the person handling it, the head of Contribution Matching, the Head of Department or a Super Admin can reassign it." |
| 4 | test.hod moves it to test.caseworker2 (Refund) | **Pass.** test.caseworker2 was listed as Not mapped. The dialog warned "This moves the ticket to Refund." After saving, the ticket shows unit Refund, assignee test.caseworker2 |
| 5 | test.caseworker3 records leave from today; a new ticket is raised | **Pass.** Leave was recorded on My availability for 3 November. CP-2026-000004 went to test.caseworker1; its Auto entry compared only test.caseworker1 and test.hou |
| 6 | test.requester opens the ticket | **Pass.** Only "Assigned to Test Case Worker Two" in the header. No Assignment panel, and no 403 responses |

**How the checks ran:**

- The first try at check 1 stopped before submitting, because the dev server reloaded the page on its first load, so no ticket was raised. It passed on the second run.
- The first two tries at check 2 failed on my script's selectors: the menu had not loaded, and a chip is displayed in capitals. Neither try saved a reassignment. The third run passed.

**Side effect, as Step 5 intends:** test.caseworker3's leave moved CP-2026-000002, which they had not started, to test.hou ("Because the assignee was unavailable").

**Data left behind:**

- CP-2026-000003: in Refund with test.caseworker2, two reassignments, test.caseworker2 also copied.
- CP-2026-000004: with test.caseworker1.
- CP-2026-000002: now with test.hou.
- test.caseworker3's leave for 3 November only, which ends today.
- The notifications these created.

**The API was left running**, as you started it. Please stop it before the next backend step. The dev server is stopped.

## Files

- **New:**
  - `src/features/people/` (`api/endpoints.js`, `hooks/searchColleagues.js`, `index.js`).
  - `src/features/tickets/components/AssignmentPanel.jsx`, `ReassignDialog.jsx`, `AssignmentHistory.jsx`.
- **Changed, tickets:**
  - `api/endpoints.js` (`getReassignOptions`, `reassignTicket`, `listAssignments`, `ASSIGNMENT_METHOD`).
  - `hooks/useTickets.js` (assignment keys, `useReassignOptions`, `useAssignmentHistory`, `useReassign`, `refreshAfterReassign`).
  - `ticketText.js` (`sinceText`, `autoReasonText`, reason limits).
  - `components/CcField.jsx`, `components/TicketTable.jsx`.
  - `pages/NewTicketPage.jsx`, `pages/TicketPage.jsx`, `pages/WorkQueuePage.jsx`, and the three page tests.
- **Changed, other:**
  - `src/shared/ui/PersonPicker.jsx`.
  - `src/features/home/pages/HomePage.jsx` (+ test).
  - `src/features/notifications/hooks/useLiveNotifications.js` (comment) and `components/NotificationBell.test.jsx`.
  - `scripts/api-access.js`, `scripts/check-api.js`, `scripts/check-api.test.js`.
- **Backend docs:** `docs/swagger.json` and this report.
- **New tests (8):**
  - the CC search for a plain requester;
  - five Assignment panel tests (hidden for a requester, reason shown, reassign dialog, 409, history);
  - the Work queue for a case worker;
  - live refetch.

  Updated: the Work queue head test (All open, Waiting), the Home counts (Assigned to me), and the inventory wording.

## Backend answers to FE-3, and what is still open

- **Multi-status filter:** backend Step 6 will add it. The five calls stay until then.
- **Still open from FE-3:**
  - question 2: `[FromForm]` field names are PascalCase in swagger;
  - question 3: a 400 returns one field error at a time;
  - question 4: `POST /api/admin/locations` answers the location, `PATCH` answers `{ message }`;
  - question 5: should the raiser also be notified when a Super Admin raises a ticket for someone?

## Questions for the backend

1. **When was it assigned?** `TicketDetailDto` has no assignment time, so "Assigned … ago" comes from the last history entry. That works for staff only, and costs a second call. Could the ticket carry `assignedAt`?
2. **"Assigned to me" in one department.** `view=assigned` ignores `departmentId`, so the Work queue filters by `departmentCode` in the browser, after paging. Could `view=assigned` accept `departmentId`?
3. **People search returns the caller.** It already leaves out blocked accounts, but it includes the person searching, so the app removes them from the results. Should the search leave out the caller itself?
4. **Copied and assigned.** CP-2026-000003 ended with test.caseworker2 both copied and assigned. Should the person handling a ticket stay on its CC list, or drop off it?
