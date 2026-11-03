# FE-3 — Raising and following tickets

**For:** the VS Code agent. **Read first:** `docs/agent-onboarding.md`, `docs/build-plan.md` (Step 4 and the 3 Nov decisions), `docs/fe/FE-0-scaffold.md`, `docs/fe/FE-1-organisation.md`, `docs/fe/FE-2-catalogue.md` and `docs/fe/FE-2-report.md`.
**Where:** same as before. Work in `AccessServiceDesk\Frontend`; the backend is read-only except `docs/swagger.json` and `docs/fe/FE-3-report.md`.
**Exit criteria:** `npm run check` passes (with `npm run dev` stopped) and the manual checks in section 7 work against the running API. **Do not leave the API running when you finish**, and do not start it with `dotnet run` yourself: ask the user to start it (a running API blocks the next backend step).

---

## 0. Refresh the contract

With the API running, re-save `http://localhost:5048/swagger/v1/swagger.json` as `docs/swagger.json` and run `npm run check`. New in it:
- `multipart/form-data` request bodies (`POST /api/tickets`, `POST /api/tickets/{id}/comments`). Teach `check:api` to read form fields from `requestBody.content["multipart/form-data"].schema` (camelCase, files under `files`).
- One file download: `GET /api/tickets/{ticketId}/attachments/{attachmentId}` answers `application/octet-stream` (`string`, `binary`), not JSON. `check:api` must accept that.
- Mark FE-1 question 4 resolved (the `errors` type) in `FE-1-report.md`.

## 1. What the backend now offers (Step 4)

- **Tickets** with references like `CP-2026-000001`, created as **New** in the unit that owns the category. Automatic assignment comes in backend Step 5 and acknowledge / pending / resolve / cancel in Step 6, so in FE-3 there are **no status actions** yet; show the status and leave room for them.
- **Rich-text description and comments.** The server cleans the HTML (allowlist) before storing it.
- **Attachments:** optional, **0 to 6 files per ticket or comment, each at most 1 MB**, PDF, DOCX, XLSX, CSV, JPG or PNG. The server checks the real file type.
- **CC:** colleagues copied on a ticket can see it and are notified.
- **Super Admin can raise a ticket for someone else.**
- **Duplicate check:** open tickets in the same category from the last 7 days mentioning the same RSA PIN.
- **Public comments and internal notes** (internal notes and their files: the department's staff and Super Admin only).
- **Locations:** HQ at launch; Super Admin keeps the list; required on the form and pre-selected from the person's last ticket.
- **Who sees a ticket:** requester, whoever raised it, the people copied, the department's staff (unit members and HOD), Super Admin. Anyone else gets **404** (on purpose: references cannot be probed). Treat 404 on a ticket page as "Ticket not found, or you do not have access to it."
- Notifications link to `/tickets/<reference>`.

## 2. Endpoints

Check each against `docs/swagger.json`. Enums: `priority` 1 Low, 2 Medium, 3 High, 4 Critical; `status` 1 New, 2 Assigned, 3 In progress, 4 Pending, 5 Resolved, 6 Reopened, 7 Closed, 8 Cancelled.

| Feature | Method and route | Body / result |
|---|---|---|
| tickets | `GET /api/catalogue/categories` | departments with their categories (declared in FE-2) |
| tickets | `GET /api/locations?forUserId=` | `{ locations: [{ id, name, sortOrder, isActive }], defaultLocationId }` (`forUserId`: Super Admin raising for someone) |
| tickets | `POST /api/tickets` | **multipart**: `categoryId`, `locationId`, `priority` (optional), `subject` (3–200), `descriptionHtml`, `ccUserIds` (repeat the key), `requesterUserId` (Super Admin only), `files` (repeat) → `{ id, reference, message }`. 400 with `errors.<field>` (`categoryId`, `locationId`, `priority`, `subject`, `descriptionHtml`, `ccUserIds`, `files`, `requesterUserId`), 403 |
| tickets | `POST /api/tickets/duplicate-check` | JSON `{ categoryId, subject, descriptionHtml }` → `{ pinsFound: ["PEN********1234"], matches: [{ reference, status, createdAt, isYours }] }` |
| tickets | `GET /api/tickets?view=&departmentId=&unitId=&status=&search=&page=&pageSize=` | `view`: `mine` (default), `copied`, `assigned`, `department` (with `departmentId`; staff or Super Admin; optional `unitId`) → `{ items: [{ id, reference, subject, departmentCode, categoryName, unitName, locationName, priority, status, requester: person, assignee: person \| null, createdAt, updatedAt }], total, page, pageSize }`; `person` = `{ userId, userName, fullName }` |
| tickets | `GET /api/tickets/{id}` and `GET /api/tickets/by-reference/{reference}` | list fields plus `departmentId, departmentName, categoryId, unitId, locationId, requesterDepartment, raisedBy, descriptionHtml, cc: [person], attachments: [file], comments: [{ id, author, bodyHtml, isInternal, createdAt, attachments: [file] }], isStaffView, canComment, canAddInternalNote`; `file` = `{ id, commentId, fileName, contentType, sizeBytes, uploadedBy, uploadedAt }` |
| tickets | `POST /api/tickets/{id}/comments` | **multipart**: `bodyHtml`, `isInternal` (`true`/`false`), `files` → the new comment. 400 / 403 / 404 / 409 |
| tickets | `GET /api/tickets/{id}/attachments/{attachmentId}` | the file (binary) |
| admin-locations | `GET /api/admin/locations`, `POST /api/admin/locations` `{ name, sortOrder? }`, `PATCH /api/admin/locations/{id}` `{ name?, sortOrder?, isActive? }` | Super Admin; at least one location stays on (400) |
| people picker | `GET /api/admin/users?search=` | **Super Admin only.** For CC by everyone else see section 6, question 1 |

Multipart: build a `FormData`, let axios set the boundary (do not set `Content-Type` yourself), send the CSRF header as for any POST. Keep the route strings in `src/features/tickets/api/endpoints.js` as usual.

## 3. The ticket form (`/tickets/new`), feature `tickets`

Layout (white card, two columns on wide screens, one on narrow), in this order:

1. **Department** (select of departments from the catalogue; hidden when there is only one, which is today) → **Category** (searchable select of that department's categories; show the category's `description` under it when it has one).
2. **Priority** (Low / Medium / High / Critical; set to the category's `defaultPriority` when the category changes, unless the user already changed it).
3. **Location** (select; pre-selected from `defaultLocationId`; required).
4. **Subject** (required, 3–200, counter near the limit).
5. **Description**: the rich-text editor (section 3.1). Required.
6. **Attachments**: drop zone + "Choose files" (section 3.2).
7. **Copy colleagues (CC)**: optional, up to 10 people (section 6, question 1).
8. **Super Admin only:** "Raise for someone else" toggle → person picker (`/api/admin/users`); when chosen, reload locations with `forUserId` so the default is theirs.
9. **Submit** ("Raise ticket", primary) and "Cancel" (back, asks to confirm when the form has content).

**Duplicate check:** when the category is chosen and the subject or description contains something like `PEN` + 12 digits, call `duplicate-check` (debounced 800 ms, and once more on submit before sending). If `matches` is not empty, show an orange box above Submit: "Possible duplicate: CP-2026-000045 (In progress, raised 2 days ago)" for each match; references with `isYours` are links to the ticket. Submitting stays allowed ("Raise anyway").

**On success:** toast "Ticket CP-2026-000123 raised." and go to `/tickets/CP-2026-000123`. Clear the draft.
**On 400:** show `errors.<field>` under each field (FE-1 helper), scroll to the first, keep everything the user typed and the chosen files.
**Draft:** keep subject, description and choices (not files) in `sessionStorage` per user while typing, restore on return, clear on success or Cancel. Wrap storage in try/catch.

### 3.1 Rich-text editor (shared component `RichTextEditor` in `src/shared/ui/`)

Use **TipTap** (`@tiptap/react` and the extensions you need; latest major that installs cleanly; MIT). Toolbar, in groups, each button with a tooltip and `aria-label`, keyboard shortcuts where TipTap has them:
- Undo, Redo
- Paragraph / Heading 1–3 (select)
- Bold, Italic, Underline, Strikethrough, Code
- Text colour and Highlight (small palettes: brand navy, orange, green, red, black / yellow, light green, light blue, light orange), Clear formatting
- Bulleted list, Numbered list, Indent, Outdent, Blockquote, Horizontal rule
- Align left / centre / right
- Link (dialog: URL, http/https/mailto only), Unlink
- **Table:** insert (default 3×3 with header row), add/remove row above/below, add/remove column left/right, toggle header row, merge/split cells, delete table. Column resizing on.
- Full screen toggle.

Not in the toolbar: font family, font size, images. **Pasting or dropping an image** into the editor is blocked with a hint: "Add pictures and screenshots as attachments." Pasted content from Word or Excel keeps tables and basic formatting (TipTap does this) and is cleaned on the server anyway.
- Output `editor.getHTML()`; treat an editor with no text as empty (required check).
- Limit: warn at 150 000 characters of HTML, block submit above 200 000 ("Attach large tables as files.").
- Styling: tables with borders and padding, header row shaded, the same in the editor and when displayed. Min height 220px, grows to 600px then scrolls.

**Showing stored HTML** (descriptions and comments): component `RichTextView`. The server already cleaned it; also run it through **DOMPurify** in the browser (defence in depth) before `dangerouslySetInnerHTML`. Links open in a new tab with `rel="noopener noreferrer nofollow"`. Wide tables scroll horizontally inside the card.

### 3.2 Attachments (shared component `FilePicker`)

- 0 to 6 files; each at most 1 MB; `.pdf .docx .xlsx .csv .jpg .jpeg .png` (`accept` attribute too).
- Check in the browser before upload and say exactly what is wrong per file ("Statement.pdf is larger than 1 MB", "Only PDF, DOCX, XLSX, CSV, JPG or PNG", "You can attach at most 6 files"). The server checks again; show `errors.files` if it refuses.
- List chosen files with icon, name, size (KB), remove button. Show "3 of 6 files" and the 1 MB rule as a hint.

## 4. Pages

**Menu:** "My requests" (everyone; no longer "Coming soon") → `/tickets`. "Raise a ticket" as a primary button at the top of My requests and on Home. In each department section (from `org/me`), "Work queue" (no longer "Coming soon") → `/departments/:departmentId/tickets`. Super Admin: Administration → **Locations**.

**My requests (`/tickets`):** tabs "Raised by me" (`view=mine`) and "Copied to me" (`view=copied`). Table: Reference, Subject, Category, Status (chip; colours: New grey, Assigned navy, In progress navy-light, Pending orange, Resolved green, Reopened orange, Closed grey, Cancelled grey-strike), Priority, Location, Raised (WAT), Updated. Search box (reference or subject), status filter, paging (20). Row click → ticket page. Empty state with "Raise a ticket".

**Work queue (`/departments/:departmentId/tickets`)** (department staff and Super Admin): `view=department`. Filters: unit (from `org/me` / `org/departments`; default the person's own unit), status (default "Open" = New, Assigned, In progress, Pending, Reopened, done by calling once per status or by showing all and filtering client-side; choose the simpler and say which in the report), search (reference, subject, description). Columns as above plus Unit, Requester, Assignee ("Unassigned" while Step 5 is pending). Guard: no access page unless the person is staff of that department or Super Admin.

**Ticket page (`/tickets/:reference`, also `/tickets/id/:id`):** load by reference.
- Header: reference, subject, status chip, priority chip; under it: category · unit · department, location, raised (WAT) by requester (and "raised by X for Y" when `raisedBy` differs), assignee or "Waiting for assignment".
- Description (`RichTextView`) and the ticket's own files.
- Side panel: Requester (name, `requesterDepartment`), CC list, dates. Leave an empty "Actions" area for Step 5/6 (assign, acknowledge, resolve…).
- **Conversation:** comments oldest first. Internal notes (staff only) on a light orange background with an "Internal" chip. Each with author, time (WAT), body (`RichTextView`), files.
- **Reply box** (`RichTextEditor`, compact toolbar: no headings, tables still available) + `FilePicker`; for staff (`canAddInternalNote`) a toggle "Public reply / Internal note" (default **Internal note** for staff, **Public reply** for everyone else; the toggle and the submit button change colour for internal). Hidden when `canComment` is false ("This ticket is closed.").
- **Files:** clicking downloads via the HTTP client as a blob (so the 401-refresh and CSRF rules still apply), then saves with the real file name. Never open them inline.
- Live: when a notification for this ticket arrives (`relatedEntityType === "Ticket"` and `relatedEntityId` = this id), refetch the ticket.
- 404 → "Ticket not found, or you do not have access to it." card.

**Locations (`/admin/locations`, Super Admin):** table (Name, Order, Status), Add (name), Rename, up/down order, switch off/on with confirmation; the API's 400 "At least one location must stay on" shown as a toast.

**Home:** "Raise a ticket" button; for everyone a card "My open requests" (count from `view=mine`, open statuses); for department staff "New in my unit" (count from the work queue, status New).

## 5. Tests (vitest + Testing Library, no real network)

At least:
1. Form: the category sets the default priority (until the user picks one); location pre-selected from `defaultLocationId`; empty editor blocks submit with a message under Description.
2. FilePicker: refuses a 7th file, a file over 1 MB and a `.exe`, with the exact messages; removing a file frees a slot.
3. Submit sends `multipart/form-data` with `categoryId`, `locationId`, `subject`, `descriptionHtml`, repeated `ccUserIds` and `files`, plus the CSRF header; a 400 with `errors.files` shows under the picker and keeps the typed text.
4. Duplicate check: a description with `PEN123456789012` calls the check; matches show the orange box; submit still possible.
5. Editor: pasting an image is blocked with the hint; the table button inserts a 3×3 table with a header row.
6. `RichTextView` strips a `<script>` and an `onclick` even if the server sent one (DOMPurify).
7. Ticket page: requester sees no internal-note toggle; staff default to Internal note; an internal note renders with the Internal chip; a 404 shows the not-found card.
8. Download uses the HTTP client (blob) and the server's file name.
9. Work queue: a requester without department access gets the no-access page.

## 6. Questions to answer in the report (do not block on them)

1. **CC picker for everyone.** Today the only people search is `/api/admin/users` (Super Admin only). Build the CC field as a component that takes a search function; **show it to Super Admins now** (using `/api/admin/users`) and hide it for others. Backend Step 5 adds `GET /api/people/search?query=` for any signed-in person (name, login name, department only); FE-4 switches the field on for everyone. Say in the report if you need anything else from that endpoint.
2. Anything in the contract that blocked or slowed you.

## 7. Manual checks (API running, `npm run dev`)

1. As **test.requester**: Raise a ticket → Account Reconciliation; Location shows HQ; type a description with a bold line, a bullet list and a 3×3 table; attach one PDF under 1 MB; try a 2 MB file and a 7th file (refused in the browser). Submit → lands on the ticket page; reference `CP-2026-…`; the table shows with borders.
2. As **test.hou** (bell shows "New ticket in Contribution Matching") → Work queue shows it as New, Unassigned. Open it → add an **internal note** with a file; add a **public reply**.
3. As **test.requester**: the ticket shows the public reply only (no internal note, no internal file); reply back.
4. Paste `<img src=x onerror=alert(1)>` as text and an image from the clipboard into the editor: no alert, image blocked with the hint.
5. Raise a second ticket in Account Reconciliation mentioning the same `PEN…` number as a first one → the duplicate box shows the first reference.
6. As **test.superadmin**: Locations → add "Abuja", reorder, switch it off; try switching off HQ while Abuja is off → message. Raise a ticket for test.requester (Raise for someone else) → test.requester sees it under "Raised by me".
7. As a requester, open `/tickets/CP-2026-999999` → not-found card.

## 8. Report

`docs/fe/FE-3-report.md`: what was built, files, test count, `npm run check` result, the TipTap version and extensions used, answers to section 6, questions for the backend.
