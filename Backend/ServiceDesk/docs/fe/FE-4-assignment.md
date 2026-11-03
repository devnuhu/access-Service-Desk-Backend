# FE-4: Assignment, reassignment and copying colleagues

**For:** the VS Code agent.

**Read first:**
- `docs/agent-onboarding.md`
- `docs/build-plan.md` (Step 5 and the 3 Nov decisions)
- `docs/fe/FE-0-scaffold.md`
- `docs/fe/FE-3-tickets.md`
- `docs/fe/FE-3-report.md`

**Where to work:** the same as before. Work in `AccessServiceDesk\Frontend`. The backend is read-only, except for `docs/swagger.json` and `docs/fe/FE-4-report.md`.

**Do not start or stop the API yourself.** Ask the user.

**Exit criteria:** `npm run check` passes with `npm run dev` stopped, and the manual checks in section 6 work against the running API.

---

## 0. Refresh the contract

With the API running, save `http://localhost:5048/swagger/v1/swagger.json` again as `docs/swagger.json` and run `npm run check`. Step 5 adds four endpoints (section 2). No existing endpoint changed shape.

One behaviour changed: **a new ticket now comes back Assigned**, not New. Update any test fixture or wording that assumed every new ticket waits.

## 1. What the backend now does (Step 5)

- **Assigning a new ticket.** A new ticket is assigned straight away to an eligible case worker. Eligible means all of these:
  - in the ticket's unit;
  - mapped to the category;
  - not on leave today;
  - with an active account.

  The person with the lowest weighted workload gets it. Workload counts their Assigned, In progress and Reopened tickets, weighted Critical 3, High 2, Medium 1, Low 1. On a tie, the person assigned least recently gets it.
- **Notifications on assignment.** The case worker gets "Ticket … assigned to you" (ActionRequired, category Assignment). The requester gets "Ticket … picked up".
- **Nobody eligible.** The ticket stays **New**, and the unit's head and deputy get "Ticket … is waiting". The API tries again every 5 minutes, and straight away when someone comes back from leave, is mapped to the category, or joins the unit.
- **Leave or blocking.** If the assignee goes on leave or is blocked:
  - tickets they haven't started move to someone else, and the assignee is told;
  - started tickets (In progress or Reopened) stay with them, and the head gets "… assignee unavailable".
- **Reassignment, always with a reason (5–500 characters).**
  - The person holding the ticket, and the unit's head or deputy, can pass it to an available member of the same unit who handles the category.
  - The HOD and a Super Admin can move it to an available member of any unit in the department. The ticket then moves to that unit.

  After reassignment the ticket is **Assigned** again, with a new acknowledgement window from Step 6.
- **Assignment history.** It records the method (1 Auto, 2 Reassigned), the reason, who moved it, the units it moved between, and, for Auto, every candidate's workload, with the chosen one marked.
- **People search for CC.** Anyone signed in can search people by name or login name. Results carry the name, login name and department only.

## 2. Endpoints

Check each one against `docs/swagger.json`. `person` = `{ userId, userName, fullName }`.

| Feature | Method and route | Body / result |
|---|---|---|
| tickets | `GET /api/tickets/{id}/reassign-options` | `{ canReassign, reason, candidates: [{ userId, userName, fullName, unitId, unitName, handlesCategory, workload, isCurrentAssignee }] }`. Department staff and Super Admin. A requester or a copied colleague gets 403; anyone else 404 |
| tickets | `POST /api/tickets/{id}/reassign` | `{ toUserId, reason }` → `{ message }`. 400 (`errors.reason`, `errors.toUserId`), 403, 404, 409 (changed at the same moment: reload and retry) |
| tickets | `GET /api/tickets/{id}/assignments` | `[{ id, at, method, reason, from: person \| null, to: person, by: person \| null, fromUnitName, toUnitName, scores: [{ userId, userName, fullName, workload, openTickets, lastAssignedAt, chosen }] }]`, oldest first. Staff only (403 / 404 as above) |
| people | `GET /api/people/search?query=` | `[{ userId, userName, fullName, department }]`, at most 20. 400 (`errors.query`) when the query is under 2 characters |

## 3. Screens

### 3.1 Copy colleagues (CC) for everyone

- Switch the FE-3 CC field on for **every** person raising a ticket, using `GET /api/people/search` through the search function the component already takes.
- Keep `/api/admin/users` only for the Super Admin's "Raise for someone else" picker.
- Search after 2 characters, debounced 300 ms. Show the name, login name and department. Allow at most 10 people. Don't let anyone pick themselves, or the requester when a Super Admin is raising for someone else.

### 3.2 Ticket page: Assignment panel (staff only, when `isStaffView`)

In the side panel "Actions" area left by FE-3:

- **Assignee block.**
  - Name and unit.
  - "Assigned … ago" (WAT tooltip with the exact time).
  - While the status is New, the block says "Waiting for an available case worker".
- **"Reassign" button.**
  - Shown when `reassign-options.canReassign` is true.
  - When false, show `reason` as muted text instead. Don't show a disabled button with no explanation.
- **Reassign dialog.**
  - A list of candidates, grouped by unit when there is more than one. Each row shows the name, a workload chip ("Workload 4"), a "Handles this category" chip or an orange "Not mapped" chip (possible only for HOD or Super Admin), and "Current" for the current assignee, which can't be selected.
  - A **Reason** field (required, 5–500 characters, with a counter).
  - When the chosen person is in another unit, warn: "This moves the ticket to <unit>."
  - On save, show the API message as a toast, then refetch the ticket, the options and the history.
  - On 409, show "The ticket changed at the same moment. It has been reloaded." and refetch.
- **"Assignment history" section,** collapsible and collapsed by default.
  - A timeline, oldest first: when (WAT), "Auto" or "Reassigned by <by>", from → to (with units when they differ), and the reason.
  - For Auto entries, a small expandable table of the candidates compared: name, open tickets, workload, last assigned (WAT), with the chosen one highlighted. This answers "why did X get this?"
  - Use plain words for the Auto reasons: `raised` → "When it was raised", `retry` → "When someone became available", `assignee unavailable` → "Because the assignee was unavailable".

Requesters and copied colleagues see only the assignee name (FE-3). No panel, and no calls to these endpoints, so they never get a 403.

### 3.3 Work queue and lists

- **Assignee column.** Show the name. For New tickets, show an orange "Waiting" chip.
- **"Assigned to me" tab or filter** for case workers, using `view=assigned`. Make it the default view of the Work queue for people who are members of a unit. Heads, HODs and the Super Admin default to "All open".
- **Home.** For case workers, add a card "Assigned to me" with the count of open tickets (`view=assigned`).

### 3.4 Live updates

When a notification arrives with `relatedEntityType === "Ticket"` and category Assignment (2), refetch:
- that ticket, if it is open;
- the Work queue and "Assigned to me" counts.

Use the same mechanism FE-3 uses for ticket notifications.

## 4. Backend answers to FE-3's questions

- **Multi-status filter for "Open":** coming in backend Step 6. Keep the five calls until then.
- Put any other FE-3 questions that are still open in the FE-4 report.

## 5. Tests (vitest + Testing Library, no real network)

At least:
1. The CC picker uses `/api/people/search` for a plain requester. It waits for 2 characters, can't pick yourself, and allows at most 10 people.
2. Assignment panel:
   - It is hidden for a non-staff viewer, with no request to `reassign-options`.
   - When `canReassign` is false, it shows the reason.
   - A candidate in another unit triggers the move warning.
   - A missing reason shows `errors.reason` under the field.
   - The current assignee can't be selected.
3. History renders Auto with its score table (chosen highlighted) and Reassigned with its reason, and maps the Auto reasons to plain words.
4. The Work queue defaults to "Assigned to me" for a unit member and to "All open" for a head. New tickets show "Waiting".
5. An Assignment notification for the open ticket refetches it.

## 6. Manual checks (API running, `npm run dev`)

1. **Raising.** As **test.requester**, raise a Contribution Matching ticket and copy **test.caseworker2** using the new search. The ticket page shows an assignee straight away, one of test.hou, test.caseworker1 or test.caseworker3. test.caseworker2 gets "You were copied".
2. **Holder reassigns.** As that assignee, in the Work queue → "Assigned to me", open it and reassign it to another Contribution Matching case worker with a reason. Toast. The history shows Auto (with the three candidates' workloads) and then Reassigned. The new assignee's bell shows "assigned to you".
3. **Not mapped.** As **test.hou2** (head of Refund), open the ticket. "Reassign" is not offered, and the reason text explains why.
4. **HOD moves units.** As **test.hod**, reassign it to **test.caseworker2** (Refund). The dialog warns about moving to Refund. After saving, the ticket shows unit Refund.
5. **Leave.** As **test.caseworker3**, record leave from today. Then raise a new Contribution Matching ticket as test.requester. It is never assigned to test.caseworker3.
6. **Requester view.** As **test.requester**, the ticket page shows only the assignee name. There is no Assignment panel and no 403 in the console.

## 7. Report

Write `docs/fe/FE-4-report.md` with:
- what was built;
- the files changed or added;
- the test count;
- the `npm run check` result;
- any questions for the backend.
