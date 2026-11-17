# FE-5: Ticket workflow (acknowledge, pending, resolve, confirm, reopen, cancel)

**For:** the VS Code agent.

**Read first:**
- `docs/agent-onboarding.md`
- `docs/build-plan.md` (Step 6 and the 4 Nov decisions)
- `docs/fe/FE-3-tickets.md`
- `docs/fe/FE-4-assignment.md`
- `docs/fe/FE-4-report.md`

**Where to work:** the same as before. Work in `AccessServiceDesk\Frontend`. The backend is read-only, except for `docs/swagger.json` and `docs/fe/FE-5-report.md`.

**Do not start or stop the API yourself.** Ask the user.

**Exit criteria:** `npm run check` passes with `npm run dev` stopped, and the manual checks in section 7 work against the running API.

---

## 0. Refresh the contract

With the API running (Step 6 applied), save `http://localhost:5048/swagger/v1/swagger.json` again as `docs/swagger.json` and run `npm run check`. Step 6 adds the workflow endpoints and `/api/catalogue/mine`, and adds fields to tickets (section 2).

## 1. What the backend now does (Step 6)

**Statuses:** New → Assigned → In progress ⇄ Pending → Resolved → Closed. Reopened and Cancelled branch off from there.

| Who | Action | Allowed while | Result |
|---|---|---|---|
| Assignee | **Acknowledge** | Assigned, Reopened | In progress. The requester is told "… in progress". |
| Assignee | **Set pending** (`reason` + `note`) | In progress | Pending. The note is posted as a **public comment**. |
| Assignee | **Resume** | Pending | In progress. |
| Assignee | **Resolve** (`code` + `note`) | In progress, Pending | Resolved. The note is posted as a public comment. The requester gets "… resolved" (ActionRequired), and copied colleagues are told too. |
| Requester (or whoever raised it) | **Confirm** | Resolved | Closed. The assignee is told. |
| Requester (or whoever raised it) | **Reopen** (`reason`) | Resolved | Reopened, back with the **same case worker**. If they're unavailable, the assignment engine passes it to the next available one. The reason is posted as a public comment. |
| Requester (or whoever raised it) | **Cancel** (`reason`) | New, Assigned | Cancelled. The reason is posted as a public comment. |
| Super Admin | **Cancel** (`reason`) | any open status, or Resolved | Cancelled. |

- **Requester's reply resumes the ticket:** when a ticket is **Pending on the requester** and the requester adds a public comment, it goes back to In progress automatically, and the assignee gets "… resumed".
- **Status history:** every change is stored with who made it and why. There's **no history endpoint yet**, so the timeline comes from comments, assignments and the ticket's dates.
- **Notifications never carry notes or reasons.** Those are only on the ticket, as public comments.
- **Auto-close** of Resolved tickets after 3 business days comes in Step 7. Don't show it yet.

**Errors:** the same `ApiError { message, errors }` as before.
- **400:** the right person but the wrong status, for example "Not possible while the ticket is Closed. …". Or a field to fix, with `errors.note`, `errors.reason` or `errors.code`. All field errors come back at once.
- **403:** not the right person.
- **404:** can't see the ticket.
- **409:** the ticket changed at the same moment. Reload it and retry.

## 2. Endpoints and fields

Check each against `docs/swagger.json`. Every POST returns `{ message }`, so show it as the toast.

| Method and route | Body / result |
|---|---|
| `GET /api/tickets/{id}/actions` | `{ canAcknowledge, canSetPending, canResume, canResolve, canConfirm, canReopen, canCancel, resolutionCodes: [{ code, label }] }` |
| `POST /api/tickets/{id}/acknowledge` | no body |
| `POST /api/tickets/{id}/pending` | `{ reason, note }`. `reason`: 1 Requester, 2 ThirdParty. `note`: 5–2000 characters |
| `POST /api/tickets/{id}/resume` | no body |
| `POST /api/tickets/{id}/resolve` | `{ code, note }`. `code`: 1 Completed, 2 InformationProvided, 3 ReferredElsewhere, 4 Duplicate, 5 NoActionRequired; take the labels from `resolutionCodes`. `note`: 10–4000 characters |
| `POST /api/tickets/{id}/confirm` | no body |
| `POST /api/tickets/{id}/reopen` | `{ reason }`, 5–2000 characters |
| `POST /api/tickets/{id}/cancel` | `{ reason }`, 3–500 characters |
| `GET /api/catalogue/mine` | `[{ unitId, unitName, departmentName, categories: [{ id, name, isActive }] }]`. The categories the signed-in person handles, read-only |

**New ticket fields:**
- **List items** gain `assignedAt` (nullable).
- **Ticket detail** gains `acknowledgedAt`, `pendingReason` (1 or 2, null when not Pending), `pendingSince`, `resolvedAt`, `resolutionCode`, `resolutionNote`, `closedAt`, `cancelledAt` and `reopenCount`.

**List changes:**
- `GET /api/tickets` takes **`open=true`**, meaning New, Assigned, In progress, Pending or Reopened. `open=false` means everything else.
- `departmentId` and `unitId` now narrow **every** view: mine, copied, assigned and department.

**People search:** `GET /api/people/search` no longer returns the person searching.

## 3. Ticket page: the action bar

1. **Loading the actions:** load `GET /api/tickets/{id}/actions` with the ticket, for **everyone** who can see it, and refetch it after any action, comment or ticket notification. Show **only** the buttons whose flag is true. Don't work out the rules in the frontend, and never show a disabled button with no explanation.
2. **Where the buttons go:**
   - the assignee's buttons in the side panel's "Actions" area, above Reassign;
   - the requester's buttons in a callout at the top of the page.

| Flag | Button | Dialog |
|---|---|---|
| `canAcknowledge` | **Start work** (primary) | No dialog. Just the toast. |
| `canSetPending` | **Set pending** | "Waiting on": radio for **The requester** ("their reply resumes it") or **A third party** ("for example an employer or another PFA"). Note field (required, 5–2000, with counter): "What are you waiting for? The requester sees this." |
| `canResume` | **Resume work** | No dialog. |
| `canResolve` | **Resolve** (primary) | Resolution code select (from `resolutionCodes`, required). Note field (required, 10–4000, with counter): "Tell the requester what was done. They see this and confirm it." |
| `canConfirm` | **Confirm it's resolved** (primary) | Small confirm: "Close the ticket?" |
| `canReopen` | **It's not resolved** | Reason field (required, 5–2000): "Say what is still wrong." |
| `canCancel` | **Cancel ticket** (danger) | Reason field (required, 3–500). The title is "Cancel this ticket?" for the requester, and "Cancel this ticket for everyone?" for a Super Admin cancelling someone else's ticket. |

3. **After an action:** show the API's `message` as a toast, then refetch the ticket, the actions and the lists.
   - **400 with `errors`:** show each message under its field.
   - **400 without `errors`, and 403:** show the message in the dialog.
   - **409:** "The ticket changed at the same moment. It has been reloaded." Then refetch.

## 4. Ticket page: what the status means

1. **Status callout:** under the heading, show a one-line callout for the current status:
   - **Assigned:** "Assigned to <name> <time ago>. Waiting for them to start." For the assignee: "Start work when you pick it up."
   - **In progress:** "<assignee> started on it <time ago>" (from `acknowledgedAt`).
   - **Pending, requester:** "Waiting on <the requester / you> since <time>." For the requester: "**Reply below to continue.** Your reply sends it back to the case worker." Put a "Reply" link that focuses the comment box.
   - **Pending, third party:** "Waiting on a third party since <time>."
   - **Resolved:** "Resolved <time ago>: <resolution label>." For the requester, the Confirm and Reopen buttons go here. Show `resolutionNote` as a quote.
   - **Closed:** "Closed <date>."
   - **Cancelled:** "Cancelled <date>."
   - **Reopened:** "Reopened (<reopenCount> time(s)). Back with <assignee>."
2. **Notes from workflow actions:** pending notes, resolutions, reopen reasons and cancel reasons arrive as ordinary **public comments**. The comment body starts with a bold label, such as "Waiting on you", "Resolved: Completed", "Reopened" or "Cancelled". Render them like other comments, plus a small status chip from that label. Don't parse anything else.
3. **"Copied · handling it":** someone who is both **copied** and the **assignee** stays on the CC list. In the CC list, show that person as "<name>, copied · handling it", so nobody thinks they were dropped.

## 5. Lists, Home and My availability

1. **One call for Open:** replace the five calls behind "Open" (from FE-3) with a single `open=true` call, in the Work queue, My tickets and Copied.
2. **"Assigned to me"** (`view=assigned`):
   - Make it the Work queue default for unit members.
   - It now takes `departmentId`. Pass the department picker's value when one is chosen, so someone in two departments can narrow it down.
3. **`assignedAt` in lists:**
   - Show "Assigned <time ago>" (with a WAT tooltip) in the assignee column.
   - Sort "Assigned to me" by `assignedAt` when the API order is the same, so the oldest unstarted ticket sits on top.
4. **Home cards for case workers:**
   - "Assigned to me": open tickets.
   - "Waiting to start": status Assigned or Reopened.
   - "Pending": status Pending.

   Each card links to its filtered list.
5. **My availability:** add a "What I handle" panel from `GET /api/catalogue/mine`.
   - Group by unit, showing the unit name with the department in muted text.
   - Categories that are switched off show as muted "(off)".
   - Read-only. Say "Ask your head of unit to change these."
6. **CC picker:** since `/api/people/search` no longer returns the caller, remove the frontend's own "not yourself" filter for that endpoint. Keep it for the Super Admin's admin-users picker.

## 6. Tests (vitest + Testing Library, no real network)

At least:
1. **Action bar:**
   - It shows only the buttons whose flags are true.
   - A requester with `canConfirm` and `canReopen` sees them in the Resolved callout.
   - A viewer with no flags sees no action bar.
2. **Pending dialog:**
   - The reason is required.
   - A short note shows `errors.note` from a mocked 400.
   - It sends `{ reason: 1 | 2, note }`.
3. **Resolve dialog:** codes come from `resolutionCodes`, and it sends `{ code, note }`. Two field errors from one 400 both show.
4. **Reopen and cancel** require a reason. The Super Admin wording on cancel works.
5. **409 on any action** shows the reload message and refetches.
6. **Status callout:**
   - Pending on the requester shows "Reply below to continue" to the requester only.
   - Resolved shows the resolution label and note.
7. **"Open" makes one call,** with `open=true`.
8. **"What I handle"** renders `catalogue/mine`, grouped by unit, with switched-off categories muted.
9. **The CC list** shows "copied · handling it" for a copied assignee.

## 7. Manual checks (API running, `npm run dev`)

1. **Start work.** As **test.requester**, raise a Contribution Matching ticket. As its assignee, open it and click **Start work**. The status becomes In progress, and the requester's bell shows "… in progress".
2. **Pending on the requester.** As the assignee, choose **Set pending → The requester**, with a note.
   - As test.requester, the page says "Reply below to continue".
   - Reply with a comment. The ticket goes back to In progress, and the assignee gets "… resumed".
3. **Resolve.** As the assignee, choose **Resolve** with "Information provided" and a note. As test.requester, the Resolved callout shows the code and note, plus Confirm and "It's not resolved".
4. **Reopen.** As test.requester, choose **It's not resolved** with a reason. The status becomes Reopened, it's back with the same case worker, and the assignee gets "… reopened". As the assignee, **Start work**, then Resolve again.
5. **Confirm.** As test.requester, confirm. The ticket is Closed, the assignee is told, and no buttons are left.
6. **Cancel.** Raise a second ticket. As test.requester, cancel it while it's Assigned, with a reason. Then, as a Super Admin, try cancelling a third ticket that's In progress. Both work.
7. **What I handle.** As **test.caseworker1**, My availability shows the Contribution Matching categories they handle.
8. **One call for Open.** In the Work queue, the "Open" filter makes **one** request with `open=true`, as seen in the browser's Network tab.

## 8. Also

- **`check:api:live`:** add the availability routes it doesn't cover yet, as suggested in your FE-4 report, plus the new workflow routes.
- **Questions:** list any backend questions in the report.

## 9. Report

Write `docs/fe/FE-5-report.md` with:
- what was built;
- the files changed or added;
- the test count;
- the `npm run check` and `check:api` results;
- any questions for the backend.
