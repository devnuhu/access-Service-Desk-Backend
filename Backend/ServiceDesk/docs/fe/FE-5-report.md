# FE-5 report: ticket workflow

**Date:** 4 November 2026 · **Folder:** `PRO\AccessServiceDesk\Frontend` · **Built against:** `docs/swagger.json`, saved again from `http://localhost:5048/swagger/v1/swagger.json` on 4 November 2026 (after Step 6)

## Result

| Check | Result |
|---|---|
| `npm run check` | **Passes** with `npm run dev` stopped: lint, Prettier check, tests, `check:api` and build |
| Tests | **172 passed** in 28 files (145 at the end of FE-4) |
| `check:api` | 68 endpoints in 12 files, 69 access rules, compared with `docs/api/endpoint-inventory.md`: **0 mismatches, 0 warnings** |
| `check:api:live` | test.requester 32 PASS, test.hou 28 PASS, test.hod 29 PASS, test.caseworker1 29 PASS, test.superadmin 30 PASS, **0 FAIL** |
| Section 7 manual checks | **All 8 pass** against the running API, in the real UI (headless Edge at 1280 × 900, signed in through the sign-in page). Check 3 needed a second run; see "Manual checks" |

## Section 0: contract refresh

- `docs/swagger.json` was saved again. It adds 9 routes (`actions`, seven workflow POSTs, `catalogue/mine`), the new ticket fields and `open` on `GET /api/tickets`.
- **Endpoint inventory:** `check:api` now reads three new things:
  - a row whose later route names only its last part (`` `/api/tickets/{id}/acknowledge`, `/resume` ``);
  - "the assignee" and "the requester (or who raised it)";
  - "anyone who can see the ticket", which is a signed-in person, not anonymous.

## What was built

### Ticket page

- **Actions** load with the ticket for everyone who can see it (`GET /actions`), and refetch after any action, comment or ticket notification. Only flags the API sets show a button; no rule is worked out in the browser.
- **Where the buttons go:**
  - Side panel, in an Actions card above the Assignment panel: Start work, Resume work, Resolve, Set pending. There is no card when no button applies.
  - Status callout at the top: Confirm it's resolved, It's not resolved, and Cancel ticket for the requester.
  - A Super Admin's Cancel on someone else's ticket goes in the side panel, with the title "Cancel this ticket for everyone?".
- **Dialogs:** Set pending, Resolve (codes from `resolutionCodes`), Close the ticket?, It's not resolved, Cancel. Start work and Resume have no dialog.
- **After an action:** the API's `message` as a toast, then the ticket, actions, options, history and lists refetch.
  - 400 with `errors`: each message under its field, several at once.
  - 400 without `errors`, and 403: the message in the dialog (for Start work and Resume, which have no dialog, a toast).
  - 409: "The ticket changed at the same moment. It has been reloaded." and everything refetches.
- **Field checks:** the browser checks only that required fields are filled. Length rules stay with the server, as section 3 asks ("don't work out the rules in the frontend"), and show through `errors`. The counters turn red over the limit.
- **Status callout:** one line per status, with the wording of section 4 and a different line for the requester or assignee where the spec has one. New shows "Waiting for an available case worker." The "Reply" link focuses the comment box.
- **Workflow comments:** a small chip from the bold label ("Resolved: Completed", "Waiting on you", "Reopened", "Cancelled"). Only those label shapes count, and only on public comments.
- **CC list:** "<name>, copied · handling it" for someone copied and assigned.
- **Small changes:**
  - The Assignment panel takes "Assigned … ago" from `assignedAt`.
  - The history now loads only when opened, so it has lost the count on its heading.
  - A cancelled ticket says "This ticket is cancelled." instead of "closed".
  - The fourth Auto reason in the Step 6 code, "reopened while the assignee is unavailable", has plain words too.

### Lists, Home, My availability

- **Open is one call with `open=true`** in the Work queue and on Home. My requests gained an Open choice; its default stays All statuses. The 100-per-status cap and its warning line are gone for Open.
- **Assigned to me** sends `departmentId`; the browser filter by department is gone.
- **Assignee column:** "Assigned <time ago>" with a WAT tooltip.
- **Sorting Assigned to me:** tickets not started come first, oldest `assignedAt` on top. This sorts the current page only, because the API has no sort (question 2).
- **Home, for members of a unit:** Assigned to me, Waiting to start, Pending. Each opens the Work queue filtered (`?tab=assigned&status=`).
- **Waiting to start** is a new status choice in the Work queue. It covers two statuses, so it is the one place left that makes one call per status and pages in the browser (question 1).
- **What I handle** on My availability, from `GET /api/catalogue/mine`. A `CategorySkills` notification refetches it, and so does a Super Admin's own matrix change.
- **CC picker:** the "not yourself" filter is removed for `/api/people/search`, and kept for the admin-users picker.

### `check:api:live`

- **Availability routes** are now tested with real ids (`orgScope`): the unit or department the person runs, otherwise the first in the list. Allowed roles get 200 and pass the schema; everyone else gets 403. In FE-4 these routes were skipped for every role.
- **New routes:** `GET /actions` and `GET /catalogue/mine` are probed with their schemas. `pending`, `resolve`, `reopen` and `cancel` are probed with an empty note or reason, which the API refuses with 400 before it looks at the ticket, so nothing is written. Acknowledge, resume and confirm are skipped as writes.

## Manual checks (section 7)

| # | Check | Result |
|---|---|---|
| 1 | Start work | **Pass.** CP-2026-000005 went to test.caseworker3. Start work moved it to In progress; the requester's bell shows "Ticket CP-2026-000005 in progress" |
| 2 | Pending on the requester | **Pass.** The requester sees "Reply below to continue." The Reply link focuses the box. Their reply moved it to In progress; the assignee's bell shows "… resumed" |
| 3 | Resolve | **Pass, on a second run** (below). The callout shows "Resolved just now: Information provided.", the note, Confirm it's resolved and It's not resolved |
| 4 | Reopen | **Pass.** "Reopened (1 time). Back with Test Case Worker Three." The assignee's bell shows "… reopened". Start work, then Resolve again |
| 5 | Confirm | **Pass.** Closed, the assignee's bell shows "… closed", no buttons left for either person, and "This ticket is closed." |
| 6 | Cancel | **Pass.** The requester cancelled CP-2026-000006 while Assigned. Once CP-2026-000007 was In progress the requester had no Cancel, and test.superadmin cancelled it ("Cancel this ticket for everyone?") |
| 7 | What I handle | **Pass.** test.caseworker1 sees Contribution Matching with 15 categories |
| 8 | One call for Open | **Pass.** The Work queue made one request: `view=department…&open=true&page=1&pageSize=20`, with no `status=` |

**Check 3:** in the full run the requester's page was blank when the script read it, and stayed blank past its 10-second wait. The dev server log and the next steps showed nothing wrong: check 4 opened the same Resolved ticket as the same person and worked. I re-ran the step on CP-2026-000004 with page errors captured: four loads, all correct, no errors. Each load took 3 to 6 seconds on the unbundled dev server, so a slow load is the likely cause, but I can't prove it and did not reproduce the blank page.

**Data left behind:** CP-2026-000005 (Closed, reopened once), CP-2026-000006 and CP-2026-000007 (Cancelled), and CP-2026-000004, which I resolved and closed for the re-run. The FE-3 and FE-4 leftovers are as they were.

**The API was left running**, as you started it. The dev server is stopped. zod is already 4.6.7, so no update was needed.

## Files

- **New:**
  - `src/features/tickets/components/`: `TicketActions.jsx`, `WorkflowDialogs.jsx`, `StatusCallout.jsx`, `Ago.jsx`.
  - `src/features/tickets/hooks/useRunAction.js`.
  - `src/features/tickets/pages/TicketWorkflow.test.jsx`.
  - `src/features/catalogue/components/WhatIHandle.jsx` (+ test).
- **Changed, tickets:** `api/endpoints.js`, `hooks/useTickets.js`, `ticketText.js`, `index.js`, components `AssignmentHistory`, `AssignmentPanel`, `CcField`, `Conversation`, `ReassignDialog`, `TicketTable`, pages `MyRequestsPage`, `NewTicketPage`, `TicketPage`, `WorkQueuePage`, and their tests.
- **Changed, other:**
  - `src/features/catalogue/` (`api/endpoints.js`, `hooks/useCatalogue.js`, `index.js`).
  - `src/features/admin-catalogue/hooks/useCatalogueAdmin.js`.
  - `src/features/availability/pages/MyAvailabilityPage.jsx`.
  - `src/features/home/pages/HomePage.jsx` (+ test).
  - `src/features/notifications/hooks/useLiveNotifications.js` and `components/NotificationBell.test.jsx`.
  - `src/shared/ui/RichTextEditor.test.jsx`.
  - `scripts/check-api.js`, `scripts/check-api.test.js`, `scripts/api-access.js`.
- **Backend docs:** `docs/swagger.json` and this report.
- **Tests:** two test files now preload the lazy editor, because a cold TipTap import outlasted the 4-second wait once the suite grew.

## Questions for the backend

1. **Waiting to start.** "Assigned or Reopened" still needs two calls and browser paging, capped at 100 per status. Could `status` take a repeated key, or could there be a `waiting=true` like `open=true`?
2. **Sorting Assigned to me.** The API sorts newest first, so "oldest unstarted on top" holds within a page only. Could `view=assigned` sort by `assignedAt`, or take a `sort`? It matters once someone has more than 20 open tickets.
3. **Workflow comments.** The chip comes from the comment's bold label, so a person who types a bold "Reopened" as their whole first line gets the chip too. A `kind` field on the comment would settle it. Also, "Waiting on you" reads oddly to staff, who see the same comment. Fine as it is?
4. **Default tab for heads.** FE-4 says heads, HODs and the Super Admin start on All open; FE-5 section 5 says Assigned to me is the default for unit members, and a head is a member. I kept FE-4's rule. Is that right?
5. **FE-3 and FE-4 notes on the Development reset:** still your call. Nothing here depends on it.
