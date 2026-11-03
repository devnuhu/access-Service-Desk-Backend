# FE-3 report: raising and following tickets

**Date:** 3 November 2026 · **Folder:** `PRO\AccessServiceDesk\Frontend` · **Built against:** `docs/swagger.json`, saved again from `http://localhost:5048/swagger/v1/swagger.json` on 3 November 2026 (after Step 4)

## Result

| Check | Result |
|---|---|
| `npm run check` | **Passes** with `npm run dev` stopped: lint, Prettier check, tests, `check:api` and build |
| Tests | **137 passed** in 26 files (110 at the end of FE-2) |
| `check:api` | 55 endpoints in 11 files, 56 access rules, compared with `docs/api/endpoint-inventory.md`: **0 mismatches, 0 warnings**. Multipart forms and the file download are now checked |
| `check:api:live` | test.requester 23 PASS, test.hou 20 PASS, test.superadmin 21 PASS, **0 FAIL**. Every live ticket and location answer passes the app's own zod schema |
| Section 7 manual checks | **All 7 pass** against the running API, in the real UI (headless Edge at 1280 × 900, signed in through the sign-in page). Notes on how checks 1 to 3 ran are under "Manual checks" |

## Section 0: contract refresh

- **`docs/swagger.json`** was saved again from the running API (you started it). It has 9 new routes: tickets, the duplicate check, comments, the download, and locations (public and admin).
- **Multipart forms.** `check:api` reads the fields from `requestBody.content["multipart/form-data"].schema`. For an endpoint declared with `bodyType: "multipart"`:
  - Each zod field must be the camelCase of a swagger field. Swagger writes `[FromForm]` fields in PascalCase (`CategoryId`), and ASP.NET binds form keys case-insensitively. A near miss gets a "did you mean".
  - A swagger array (`CcUserIds`, `Files`) must be a zod array, which the client sends as a repeated key. A single value must not be an array.
  - A `string`/`binary` field must be a file in zod (`z.instanceof(Blob)`). No form field may be a nested object.
  - Required form fields must be sent and required.
- **The file download.** A success answer that is not JSON and is `string`/`binary` (`application/octet-stream`) must be declared with `responseType: "blob"` and has no zod schema. The reverse is also caught: a JSON answer declared as a blob is a mismatch.
- **Endpoint inventory.** A row naming two routes (`/api/tickets/{id}`, `/api/tickets/by-reference/{ref}`) now gives one row each.
  - "Same as above…" takes the access of the row above.
  - A Who column that lists a record's people ("requester, raiser, people copied, department staff, Super Admin (others 404)") counts as any signed-in person; the service checks the rest. Everyone holds Requester.
- **The HTTP layer** gained the same two things, in `src/shared/lib/http/endpoint.js`:
  - A `multipart` body is parsed with zod, then sent as `FormData`: arrays repeat their key, Blobs go as files, booleans and numbers as text, and undefined is left out. No `Content-Type` is set, so the browser adds the boundary. The CSRF header is added as for any POST.
  - A `blob` endpoint resolves `{ blob, fileName }`, with the name taken from `Content-Disposition` (`filename*` first). When a download fails, the error message is read from the JSON inside the error blob.
- **FE-1 question 4 is marked resolved** in `FE-1-report.md`. Both `ApiError.errors` and `ApiResponse.errors` are `additionalProperties: { type: string }`.

## What was built

### Raise a ticket (`/tickets/new`), feature `tickets`

- A white card with two columns on wide screens and one on narrow screens.
  - **Department** is hidden while the catalogue has one department, which is the case today.
  - **Category** is a searchable combobox: type to filter, arrow keys, Enter, Escape. The category's description shows under it.
  - **Priority** follows the category's `defaultPriority` until the user picks one.
  - **Location** is pre-selected from `defaultLocationId`.
  - **Subject** shows a counter from 150 characters.
  - **Description** uses the rich-text editor.
  - **Attachments** use the file picker.
- **CC** (up to 10 people) and **Raise for someone else** are shown to Super Admins only (section 6, question 1).
  - Choosing a person reloads the locations with `forUserId`, so the default location is theirs.
  - The person chosen is removed from the CC list.
- **Checks in the browser:**
  - A category and a location must be chosen.
  - The subject must be 3 to 200 characters.
  - An editor with no text counts as empty: "Describe the request."
  - Above 200 000 characters of HTML, sending is blocked.
  - The first field with a problem is scrolled to and focused.
  - A 400 from the server puts `errors.<field>` under the matching field (`categoryId`, `locationId`, `priority`, `subject`, `descriptionHtml`, `files`, `ccUserIds`, `requesterUserId`) and keeps everything typed and chosen, files included.
- **Duplicate check:** when a category is chosen and the subject or description contains `PEN` and 12 digits, the form calls `duplicate-check` 800 ms after typing stops.
  - It calls once more on submit. If that finds a match the person has not seen yet, the first click stops and shows the orange box.
  - With matches shown, the button reads **Raise anyway** and raising is allowed.
  - Each match reads "Possible duplicate: CP-2026-000045 (In progress, raised 2 days ago)". It links to the ticket when `isYours` is true.
- **On success:** a toast ("Ticket CP-2026-000123 raised."), then the ticket page. The draft is cleared.
- **Draft:** category, priority, location, subject, description, CC and the chosen requester are kept in `sessionStorage` under `sd-ticket-draft:<userId>`. Files are not kept. Every storage call is wrapped in try/catch. **Cancel** asks first when the form has content, then clears the draft.

### Rich-text editor and viewer (`src/shared/ui`)

- **`RichTextEditor`**: TipTap **3.32.2**, the latest major, which installed cleanly. TipTap is MIT licensed. Toolbar groups:
  - Undo and Redo.
  - Paragraph or Heading 1–3 (a select).
  - Bold, Italic, Underline, Strikethrough, Code.
  - Text colour (navy, orange, green, red, black), Highlight (yellow, light green, light blue, light orange), Clear formatting.
  - Bulleted list, Numbered list, Indent, Outdent, Blockquote, Horizontal rule.
  - Align left, centre and right.
  - Link (a dialog that accepts http, https and mailto only) and Remove link.
  - Insert table (3 × 3 with a header row) and **Table options**: add or remove rows and columns, header row on/off, merge and split cells, delete table. Column resizing is on.
  - Full screen (Escape leaves).
- **Toolbar behaviour:**
  - Every control has an `aria-label` and a tooltip that shows TipTap's shortcut.
  - The toolbar has one Tab stop; arrow keys, Home and End move between the controls.
  - The compact version for the reply box has no heading select.
- **Images are blocked.** A pasted or dropped image file is refused with "Add pictures and screenshots as attachments." HTML that carries `<img>` pastes without the picture and shows the same hint.
- **Size and height:** a warning shows from 150 000 characters of HTML and an error above 200 000 ("Attach large tables as files."). The editor is at least 220px tall (140px in the reply box), grows to 600px, then scrolls.
- **TipTap packages used:**
  - `@tiptap/react` and `@tiptap/pm`.
  - `@tiptap/starter-kit`: paragraphs, headings 1–3, bold, italic, underline, strike, code, code block, link, bullet and ordered lists, list keymap, blockquote, horizontal rule, hard break, undo/redo, drop cursor, gap cursor, trailing node.
  - `@tiptap/extension-text-style` (`TextStyle`, `Color`), `@tiptap/extension-highlight` (multicolour), `@tiptap/extension-text-align` (headings and paragraphs).
  - `@tiptap/extension-table` (`TableKit`, resizable), `@tiptap/extensions` (`Placeholder`).
- **Loaded on first use:** the editor is a lazy chunk (474 kB), so the main bundle grew from 734 kB to 826 kB rather than to 1.3 MB. The 500 kB chunk warning was already printed before FE-3.
- **`RichTextView`** shows stored HTML through **DOMPurify 3.4.17**, using the server's allowlist (tags, attributes, http/https/mailto links). DOMPurify is dual licensed MPL-2.0 or Apache-2.0.
  - Links get `target="_blank"` and `rel="noopener noreferrer nofollow"`.
  - Wide tables scroll inside the box.
  - The editor and the viewer share one style (`.rich-text` in `index.css`): bordered cells, padding and a shaded header row.

### Attachments (`FilePicker`, `src/shared/ui`)

- A drop zone and **Choose files**, with an `accept` list of `.pdf .docx .xlsx .csv .jpg .jpeg .png`. Each file is checked in the browser, with one message per file:
  - "Big statement.pdf is larger than 1 MB."
  - "setup.exe: only PDF, DOCX, XLSX, CSV, JPG or PNG."
  - "You can attach at most 6 files."
- The list shows an icon, the name, the size in KB and a remove button. A hint reads "3 of 6 files · each at most 1 MB · …". The server's `errors.files` shows under the picker.

### Pages

- **My requests (`/tickets`):**
  - Tabs: Raised by me (`view=mine`) and Copied to me (`view=copied`).
  - Columns: Reference, Subject, Category, Status, Priority, Location, Raised (WAT), Updated.
  - A search box (reference or subject), a status filter and paging by 20. A row opens the ticket.
  - The empty state has **Raise a ticket**, which is also at the top of the page.
  - Status chips: New grey, Assigned navy, In progress light navy, Pending orange, Resolved green, Reopened orange, Closed grey, Cancelled grey and struck through.
- **Work queue (`/departments/:departmentId/tickets`):** `view=department`.
  - The unit filter defaults to the person's own unit.
  - The status filter defaults to **Open**.
  - Search covers reference, subject and description.
  - Extra columns: Unit, Requester, and Assignee ("Unassigned").
  - Anyone who is not staff of the department and not a Super Admin gets the no-access page.
  - **Open = one call per status:** five calls (New, Assigned, In progress, Pending, Reopened) of up to 100 tickets each, merged newest first and paged in the browser. I chose this over "show all and filter in the browser" because closed tickets would push open ones off a server page. When a status has more than 100 tickets, an orange line says so. Question 1 below would remove the workaround.
- **Ticket page (`/tickets/:reference` and `/tickets/id/:id`):**
  - The header has the reference, status and priority chips, and category · unit · department · location.
  - It says when the ticket was raised and by whom ("by X for Y" when someone raised it for another person), and shows the assignee or "Waiting for assignment".
  - The description and the ticket's own files.
  - A side panel shows the requester (with department), the people copied and the dates. An empty **Actions** card is left for Steps 5 and 6.
  - **Conversation:** oldest first. Internal notes are on light orange with an "Internal" chip.
  - **Reply box:** the editor (compact) and the file picker.
    - Staff (`canAddInternalNote`) choose Public reply or Internal note. Internal note is the default for staff; for everyone else the box is a public reply.
    - The toggle and the button turn orange for an internal note.
    - When `canComment` is false the box is replaced by "This ticket is closed."
  - **Files** download through the HTTP client as a blob (so the 401-refresh rule applies) and are saved under the server's file name. They are never opened inline.
  - A 404 shows "Ticket not found, or you do not have access to it."
- **Locations (`/admin/locations`, Super Admin):**
  - A table with Name, Order (up and down buttons swap the order), Status, Rename, and Switch off/on with confirmation.
  - The API's 400 shows as a toast: "At least one location must stay on: tickets need one."
- **Menu:**
  - **My requests** is now a link for everyone.
  - Each department section has **Work queue**. It shows for unit members and, new, for the department's **HOD**, because the API counts the HOD as department staff. FE-1 had no Work queue for an HOD; the sidebar test was updated to match.
  - A Super Admin in no department gets a Work queue per active department.
  - Administration has **Locations**.
- **Home:** a Requests section with **Raise a ticket** and two cards:
  - **My open requests**: the sum of the five open-status totals from `view=mine`.
  - **New in &lt;unit&gt;**, for unit members: `view=department`, their unit, status New.
- **Live updates:** a pushed notification with `relatedEntityType: "Ticket"` refetches every ticket query: the open ticket page, the lists and the Home counts. That covers "refetch this ticket" and also keeps the queue current.

### Smaller changes

- `PriorityChip` moved from `admin-catalogue` to `catalogue`, because tickets use it too.
- `isDepartmentStaff(org, departmentId)` added to `features/org`.
- New Button variant `internal` (orange).

## Manual checks (section 7)

| # | Check | Result |
|---|---|---|
| 1 | test.requester raises a ticket in Account Reconciliation | **Pass.** Location showed HQ (pre-selected). The description had a bold line, a two-item bullet list, a sentence with an RSA PIN-shaped number and a 3 × 3 table with a header row. Statement.pdf (20 KB) was attached; "Big statement.pdf is larger than 1 MB." and "You can attach at most 6 files." were refused in the browser. Submit landed on `/tickets/CP-2026-000001`, where the table shows with 1px borders and a shaded header. Downloading Statement.pdf saved it under that name |
| 2 | test.hou | **Pass.** The bell showed "New ticket in Contribution Matching: CP-2026-000001". The Work queue showed it as New, Unassigned. On the ticket the reply box defaulted to Internal note. An internal note with Ledger extract.pdf was added (orange, Internal chip), then a public reply |
| 3 | test.requester | **Pass.** The ticket shows the public reply only: no internal note, no Ledger extract.pdf, no toggle. Replied back |
| 4 | Paste `<img src=x onerror=alert(1)>` as text, and an image | **Pass.** As text it stays text. An image file from the clipboard, and `<img>` inside pasted HTML, were blocked with the hint. No alert ran |
| 5 | Second ticket with the same PIN | **Pass.** The duplicate box shows "Possible duplicate: CP-2026-000001 (New, raised today)", linked, with Raise anyway available. The second ticket was then discarded, not raised |
| 6 | test.superadmin: locations, raise for someone else | **Pass.** Abuja added, moved up (Abuja, HQ), moved back, switched off. Switching off HQ then showed the toast "At least one location must stay on: tickets need one." and HQ stayed on. CP-2026-000002 was raised for test.requester; its page says "by Test Super Admin for Test Requester", and test.requester sees it under Raised by me |
| 7 | test.requester opens `/tickets/CP-2026-999999` | **Pass.** Not-found card |

**How checks 1 to 3 ran:**

- **Check 1 ran twice.**
  - The first run raised CP-2026-000001 but showed a real bug: TipTap 3 re-applies its options on every render, which wiped the editor's `id` and ARIA attributes that had been set separately.
  - I fixed it by passing the attributes in the editor options, and added a regression test.
  - The second run passed every step up to submit. The submit was then stopped by the duplicate check (same PIN as 000001), which is the intended behaviour, so no second ticket was raised.
  - CP-2026-000001's stored HTML has the bold line, the list and the 3 × 3 table, so it served for checks 2 to 5.
- **Checks 2 and 3:** the comments were saved in one run. The script read the page before the refetch had finished, so I checked the pages again read-only, and through the API. Both pass.

**Data left behind:**

- **CP-2026-000001** (test.requester; an internal note with a file, a public reply and a reply back).
- **CP-2026-000002** (raised by test.superadmin for test.requester).
- Location **Abuja**, switched off, order 2.
- The notifications those created.

Tickets and locations cannot be deleted through the API. Re-running check 6 as written would get a 409 for "Abuja"; the script skips the add when Abuja exists.

**The API was left running**, as you started it. Please stop it before the next backend step.

## Files

- **New:**
  - `src/features/tickets/` (`api/endpoints.js`, `hooks/useTickets.js`, `ticketText.js`, 9 components, 4 pages with tests, `index.js`).
  - `src/features/admin-locations/` (endpoints, hooks, `LocationsPage` with test).
  - `src/features/catalogue/components/PriorityChip.jsx` (moved).
  - `src/shared/ui/RichTextEditor.jsx` (lazy wrapper), `RichTextEditorCore.jsx`, `RichTextView.jsx`, `FilePicker.jsx`, each with tests.
  - `src/shared/lib/richText.js` and `src/shared/lib/files.js`.
- **Changed:**
  - `scripts/check-api.js`, `scripts/check-api.test.js`, `scripts/api-access.js`.
  - `src/shared/lib/http/endpoint.js` (+ tests), `src/shared/ui/Button.jsx`, `src/shared/ui/index.js`, `src/index.css`.
  - `src/routes/AppRoutes.jsx`, `src/layouts/navigation.js` (+ sidebar test).
  - `src/features/home/pages/HomePage.jsx` (+ test), `src/features/notifications/hooks/useLiveNotifications.js`.
  - `src/features/org/place.js` and `index.js`, `src/features/catalogue/index.js`, `src/features/admin-catalogue/pages/CategoriesPage.jsx`.
  - `package.json` and `package-lock.json`.
- **Backend docs:** `docs/swagger.json`, `docs/fe/FE-1-report.md` (question 4), and this report.
- **Dependencies added (exact versions):** `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-text-style`, `@tiptap/extension-highlight`, `@tiptap/extension-text-align`, `@tiptap/extension-table` and `@tiptap/extensions`, all 3.32.2; `dompurify` 3.4.17.
  - `npm audit` still reports the same 7 moderate findings in the ESLint dev tool chain (`minimatch`). None of them come from the new packages.

## How to run

```
cd PRO\AccessServiceDesk\Frontend
npm install
npm run check              # with npm run dev stopped
npm run dev                # http://localhost:5174, API on http://localhost:5048
npm run check:api:live     # one role per run, GET only
```

## Section 6

1. **CC picker for everyone.**
   - **Built so far:** `CcField` takes a `search(text)` function and is shown to Super Admins now, using `/api/admin/users`.
   - **When `GET /api/people/search?query=` arrives, FE-4 needs from it:**
     - Each person as `{ id, userName, fullName, department }`, with `id` being the user id sent in `ccUserIds`. The shared `PersonPicker` already reads exactly these names, so the same names (or `userId`, which we would map) save a change.
     - Active accounts only.
     - A minimum query length (2 characters) and a cap of about 20 results.
     - A plain array (or `{ items }`).
   - **Also wanted:**
     - A 400 `errors.ccUserIds` naming the problem (more than 10 people, a blocked account, the requester themselves).
     - Confirmation that "Raise for someone else" stays Super Admin only and keeps using `/api/admin/users`.
2. **What in the contract slowed things down:** see questions 1 to 3 below. Nothing blocked the work.

## Questions for the backend

1. **Filtering by several statuses.** `GET /api/tickets` takes one `status`. The Work queue's default "Open" and the Home count therefore make five calls each, and the queue pages in the browser, with a cap of 100 per status. Could `status` accept a repeated key (`status=1&status=2…`) or `open=true`?
2. **Form field names in swagger.** `[FromForm]` fields come out in PascalCase (`CategoryId`, `CcUserIds`), while JSON bodies are camelCase. `check:api` now camelCases them, so this is cosmetic. Should swagger say camelCase so the contract matches what the app sends?
3. **One field error per 400.** The ticket and comment services return the first problem only (for example `subject`, then `descriptionHtml` on the next try). The form checks most fields in the browser first, so this rarely shows. Could the 400 list every field that is wrong, as the other admin endpoints do?
4. **Location answers.** `POST /api/admin/locations` answers the `LocationDto` but `PATCH` answers `{ message }`. The app handles both; is that intended?
5. **Notification for a ticket raised on someone's behalf.** CP-2026-000002 notified test.requester. Should the raiser (the Super Admin) also get the "received" notification, or is the toast enough?
