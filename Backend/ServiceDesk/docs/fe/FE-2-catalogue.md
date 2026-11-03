# FE-2 — Categories and the skills matrix

**For:** the VS Code agent. **Read first:** `docs/agent-onboarding.md`, `docs/build-plan.md` (Step 3 and the 3 Nov decisions), `docs/fe/FE-0-scaffold.md` (look, HTTP rules, layout), `docs/fe/FE-1-organisation.md` and `docs/fe/FE-1-report.md`.
**Where:** same as before. Work in `AccessServiceDesk\Frontend`; the backend is read-only except `docs/swagger.json` and `docs/fe/FE-2-report.md`.
**Exit criteria:** `npm run check` passes (run it with `npm run dev` stopped) and the manual checks in section 6 work against the running API.

---

## 0. Refresh the contract

With the API running, re-save `http://localhost:5048/swagger/v1/swagger.json` as `docs/swagger.json` and run `npm run check`.

Two contract changes from Step 3 (answers to FE-1 backend questions 3 and 5):
- **Nullable fields are now marked.** Nullable strings carry `nullable: true`, and properties that point to another schema and can be null (for example `hod`, `head`, `deputy`, `current`) are now written as `allOf: [{ $ref }]` with `nullable: true`. If `check:api` reads property schemas, teach it to follow `allOf`. Update FE schemas so these fields accept `null`.
- **`errors`** is `{ field: message }` (`additionalProperties: string`) everywhere. If you still see something else, name the schema in the report.
- Role changes from the People page now send "Your Access Desk access changed" (both kinds of change have the same title now). Mark FE-1 backend questions 1, 3, 5 and 6 as resolved in `FE-1-report.md`.

## 1. What the backend now offers (Step 3)

- **Categories** belong to a unit (and so to its department). Contribution Processing has 22: 15 owned by Contribution Matching, 7 by Refund; each 24 business hours, default priority Medium. A Super Admin adds, renames, re-describes, reorders, moves (to another unit of the same department), and switches them on or off. **Categories have no extra form fields** (user decision): the requester picks a category and describes the request in the ticket body.
- **Skills matrix:** which members of a unit handle which of that unit's categories. Only members of the owning unit can be mapped. An active category with fewer than two eligible case workers gets a warning (`needsCover`); nothing is blocked. Leaving the unit, or the category moving to another unit, ends the mapping.
- Development: test.hou, test.caseworker1 and test.caseworker3 handle every Contribution Matching category; test.hou2, test.caseworker2 and test.caseworker4 every Refund category (so each category starts with 3).

## 2. Endpoints

Check each against `docs/swagger.json`. `defaultPriority`: 1 Low, 2 Medium, 3 High, 4 Critical.

| Feature | Method and route | Body / result |
|---|---|---|
| catalogue | `GET /api/catalogue/categories` | `[{ departmentId, code, name, categories: [{ id, name, description, defaultPriority }] }]` (any signed-in person; used by the ticket form in FE-3) |
| admin-catalogue | `GET /api/admin/categories?departmentId=` | `[{ id, departmentId, departmentName, unitId, unitName, name, description, timelineHours, defaultPriority, sortOrder, isActive, eligibleCount, needsCover }]` |
| admin-catalogue | `POST /api/admin/categories` | `{ unitId, name, description?, timelineHours, defaultPriority }` → category; 400 (`errors.unitId` when no unit), 409 name taken in the department |
| admin-catalogue | `PATCH /api/admin/categories/{id}` | any of `{ name, description, unitId, timelineHours, defaultPriority, sortOrder, isActive }` → `{ message }` (the message says what else happened, e.g. "Moved to Refund. 3 case worker mappings were removed.") |
| admin-catalogue | `GET /api/admin/categories/cover-warnings` | `[{ categoryId, categoryName, unitId, unitName, eligibleCount }]` |
| admin-catalogue | `GET /api/admin/units/{unitId}/skills` | `{ unitId, unitName, categories: [{ id, name, isActive, eligibleCount }], members: [{ userId, userName, fullName, staffCategory, accountActive, categoryIds: [] }], warnings: [cover] }` |
| admin-catalogue | `PUT /api/admin/units/{unitId}/skills/{userId}` | `{ categoryIds: [] }` (the full set for that person in that unit; `[]` clears) → `{ message }`, which ends with "Fewer than two case workers handle: …" when cover is short |

All Super Admin only, except `GET /api/catalogue/categories`.

## 3. Screens

### 3.1 Administration → Categories (`/admin/categories`, SuperAdmin), feature `admin-catalogue`

- Add "Categories" to the Administration menu (between Units and Email).
- **Cover banner** at the top when `cover-warnings` is not empty: orange, "N categories have fewer than two case workers" with the list (category · unit · count) and a link to each unit's matrix. Hidden when empty.
- Department filter (tabs or select from `GET /api/admin/departments`; one department today, so default to the first).
- Table grouped by unit (unit name as a group header with a "Skills matrix" link): Order, Name (with description under it in muted text), Timeline ("24 business hours"), Default priority (chip), Case workers (`eligibleCount`; orange chip "Needs cover" when `needsCover`), Status (Active / Off), actions.
- **Add category** dialog: Unit (select of the department's active units), Name, Description (optional, 300 max, hint "Shown to requesters when choosing"), Timeline in business hours (number, default 24, 1–720), Default priority (select). After saving, toast the API message ("… Map at least two case workers to it.") and offer "Open skills matrix".
- **Edit** dialog: same fields plus Order. Changing the unit shows a warning before saving: "Case workers who are not in <new unit> will stop handling this category." Show the API message as a toast (it reports how many mappings were removed).
- **Switch off / on** with confirmation ("Requesters will no longer see it. Open tickets are not affected.").
- Reorder: simple up/down buttons that PATCH `sortOrder` (no drag-and-drop needed).

### 3.2 Skills matrix (`/admin/units/:unitId/skills`, SuperAdmin)

- Reached from the Categories page (per unit) and from the Unit page of FE-1 (add a "Skills matrix" button next to "Add member").
- Header: unit name, breadcrumb Units › Department › Unit › Skills; warnings banner (from `warnings`) in orange.
- **Grid:** rows = members (name, login name, Head of Unit chip when `staffCategory` is 2, "Blocked" chip when `accountActive` is false); columns = the unit's categories (active first; switched-off ones greyed and not tickable unless already ticked). Cells are checkboxes. Column footers show `eligibleCount`, orange when under 2. Sticky first column and header row; horizontal scroll inside the card for 15 columns; category names shown rotated or truncated with a tooltip (keep it readable; test at 1280px).
- Row actions: "All" and "None" for a person.
- **Saving:** edits are local until the user clicks **Save changes** (sticky bar showing "N people changed" with Save and Discard). Save sends one `PUT …/skills/{userId}` per changed person, one after another, then refetches the matrix and `cover-warnings`. Show each API message; if a message contains "Fewer than two", show it as an orange toast. If one PUT fails, stop, show its message, keep the unsaved rows marked.
- Leaving the page with unsaved changes asks for confirmation.
- Keyboard: arrow keys move between cells, Space toggles.

### 3.3 Small changes

- **Home** (Super Admin): if `cover-warnings` is not empty, a card "Categories needing cover" with the count and a link to `/admin/categories`.
- **Unit page** (FE-1): "Skills matrix" button; the members table gains a "Categories" column with the count of categories each member handles (from the matrix endpoint).

## 4. Out of scope (FE-3, with backend Step 4)

The ticket form, ticket lists and work queue. Decisions already taken for that form, so nothing you build here contradicts them: the requester picks Department → Category → Priority (default from the category) → Location, then Subject and a **rich-text description** (TipTap with tables), optional attachments (**at most 6 files, each at most 1 MB**; PDF, DOCX, XLSX, CSV, JPG, PNG), and CC.

## 5. Tests (vitest + Testing Library, no real network)

At least:
1. Categories page: groups by unit; "Needs cover" chip when `needsCover`; the cover banner lists warnings and hides when empty.
2. Add category: posts `{ unitId, name, timelineHours, defaultPriority }`; a 409 shows the message; `errors.unitId` appears under Unit.
3. Edit with a new unit shows the move warning before saving.
4. Matrix: ticking a cell marks the row changed and updates the footer count locally; Save sends one PUT per changed person with the full `categoryIds` set; a "Fewer than two" message shows as an orange toast; Discard restores.
5. Matrix: a switched-off category cannot be newly ticked.
6. Schemas accept `null` for `hod`, `head`, `deputy` and `current`.

## 6. Manual checks (API running, `npm run dev`)

1. As **test.superadmin** → Categories: 22 Contribution Processing categories (15 under Contribution Matching, 7 under Refund), each "3" case workers, no cover banner.
2. Add "Test Category" to Refund → "Needs cover" and the banner appear. Open the Refund skills matrix, tick it for test.caseworker2 → Save → orange "Fewer than two…" toast; tick it for test.caseworker4 → Save → banner gone.
3. Move "Test Category" to Contribution Matching → the toast reports 2 mappings removed; it needs cover again. Switch it off → banner gone, and as **test.requester** `GET /api/catalogue/categories` (or a quick check in the browser dev tools) no longer lists it.
4. In Units → Contribution Matching, remove a member who handles categories (add a person first if you prefer) → their column count drops in the matrix.
5. The matrix is usable at 1280px wide and with the keyboard only.

## 7. Report

`docs/fe/FE-2-report.md`: what was built, files, test count, `npm run check` result, questions for the backend.
