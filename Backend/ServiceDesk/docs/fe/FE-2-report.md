# FE-2 report: categories and the skills matrix

**Date:** 3 November 2026 · **Folder:** `PRO\AccessServiceDesk\Frontend` · **Built against:** `docs/swagger.json`, saved again from `http://localhost:5048/swagger/v1/swagger.json` on 3 November 2026 (after Step 3)

## Result

| Check | Result |
|---|---|
| `npm run check` | **Passes** with `npm run dev` stopped: lint, Prettier check, tests, `check:api` and build |
| Tests | **110 passed** in 19 files (85 at the end of FE-1; 87 after the access-refresh change) |
| `check:api` | 44 endpoints in 9 files, 45 access rules, compared with `docs/api/endpoint-inventory.md`: **0 mismatches, 0 warnings**. Nullability is now compared too, nested objects included |
| `check:api:live` | test.superadmin 16 PASS, test.hou 17 PASS, test.requester 18 PASS, **0 FAIL**. The new GET routes answer 200 for Super Admin and 403 for the others. Every live answer passes the app's own zod schema |
| Section 6 manual checks | **All 5 pass** against the running API. Checks 2 and 5 were done in the real UI (headless Edge at 1280 × 800, signed in through the sign-in page, real key presses). Checks 1, 3 and 4 were done through the Vite proxy with cookies and CSRF, as the browser sends them |

## Section 0: contract refresh

- When I started, nothing was listening on port 5048: the API had been stopped. The Step 3 build was already in place, so I started it with `dotnet run --no-build --launch-profile http`. That built nothing and changed no backend files. It is still running.
- **`docs/swagger.json`** was saved again. It now has the 7 catalogue routes, nullable strings marked `nullable: true`, and nullable references written as `allOf: [{ $ref }]` with `nullable: true`.
- **`check:api` now compares nullability**, at every level of nesting:
  - It walks nested objects and array items, not just top-level names. The old shallow check had missed the `errors` change in FE-1.
  - A field that swagger marks nullable must accept `null` in the zod schema, or the check fails.
  - The FE-1 schemas already accepted `null` for `hod`, `head`, `deputy` and `current`, so they needed no change. The check now proves it, and tests parse real-shaped answers with those nulls.
- **One documented exception, `PRESENT_ON_SUCCESS`:** sign-in's `ApiResponse<T>.data` is `T?` because the same wrapper carries error answers. On a 200 it is always present, so the auth schemas keep `data` non-null.
- **`errors`:** every schema with an `errors` property is now `additionalProperties: { type: string }`; I checked them all and none differ. The sign-in `ApiResponse` schema now reads `errors` as `{ field: string }`.
- **Inventory routes with a query** (`/api/admin/categories?departmentId=`) are now compared by path only.
- **`FE-1-report.md`:** questions 1, 3, 5 and 6 are marked resolved, after checking each in the code: same notification title in `AdminUserService` and `OrgRoleSync`, nine test accounts in `agent-onboarding.md`, swagger nullables, and the 3 November refresh decision.

## What was built

### Administration → Categories (`/admin/categories`, Super Admin)

- **Menu:** "Categories" in Administration, between Units and Email.
- **Cover banner:** orange, "N categories have fewer than two case workers". It lists category · unit · count, with a link to each unit's skills matrix, and is hidden when `cover-warnings` is empty.
- **Department choice:** defaults to the first department. A select appears only when there is more than one.
- **Table grouped by unit**, with the unit name and a "Skills matrix" link as each group header:
  - columns: Order (up/down buttons), Name with the description in muted text, Timeline ("24 business hours"), Default priority (chip), Case workers ("Needs cover" chip), Status (Active / Off), Edit and Switch off/on;
  - active units with no categories still show, with "No categories yet";
  - a switched-off unit that still owns categories shows marked "Unit off".
- **Add category dialog:**
  - fields: Unit, Name (2–100), Description (optional, at most 300, hint "Shown to requesters when choosing"), Timeline in business hours (1–720, default 24), Default priority (default Medium);
  - a 409 or 400 message shows in the dialog, and `errors.unitId` and the other field errors show under their fields;
  - after saving, the toast reads "Category … created. Map at least two case workers to it." and has an "Open skills matrix" button.
- **Edit dialog:** the same fields plus Order, and it sends only what changed.
  - Choosing another unit shows "Case workers who are not in <unit> will stop handling this category." before saving, and the button becomes "Move and save".
  - The API's message (for example "2 case worker mappings were removed") is shown as a toast.
- **Switch off / on** asks first: "Requesters will no longer see it. Open tickets are not affected."
- **Reorder:** up/down swaps `sortOrder` with the neighbour in the same unit (two PATCHes).

### Skills matrix (`/admin/units/:unitId/skills`, Super Admin)

- **Reached from:** the Categories page (each unit group and the banner) and the Unit page ("Skills matrix" next to "Add member").
- **Header:** breadcrumb Units › Department › Unit › Skills, then the orange warnings banner from `warnings`.
- **Grid:**
  - rows are members, with Head of Unit and Blocked chips; columns are categories, active ones first;
  - cells are checkboxes, and column footers show the count, orange when an active category has fewer than two;
  - the header row, name column and footer stay in place while scrolling, and the grid scrolls sideways inside the card;
  - category names wrap up to three lines with a tooltip. At 1280 px, Contribution Matching's 15 columns are readable and the page itself never scrolls sideways.
- **Rules applied as the API applies them:**
  - a switched-off category cannot be newly ticked; an existing tick can be removed and put back;
  - a blocked person cannot be given new categories, because the API refuses that too.
  - Such cells stay focusable but do nothing (`aria-disabled`), so arrow keys never skip cells.
- **Row actions:** "All" (skips cells that cannot be ticked) and "None".
- **Saving:**
  - Ticks stay local. A sticky bar shows "N people changed" with Save changes and Discard, and footer counts update as you tick.
  - Save sends one `PUT …/skills/{userId}` per changed person with the full set, one after another, then refetches the matrix, the cover warnings, the category lists and the requester catalogue.
  - A message with "Fewer than two" shows as an orange toast; the others are green.
  - A failed PUT stops the run and shows its message. Rows not yet saved stay marked, and the failed one is marked "Not saved".
  - A tick made while a save is running is kept. Manual check 2 caught this bug: the first version dropped it. A test now covers it.
- **Leaving with unsaved ticks asks first.** In-app links and the back button use the router's `useBlocker`; reload or closing the tab uses `beforeunload`.
- **Keyboard:**
  - the grid is a single Tab stop;
  - arrow keys move between cells, and Home/End jump to the ends of the row;
  - Space toggles the cell, and the focused cell scrolls clear of the sticky header and name column.

### Small changes

- **Home (Super Admin):** a "Categories needing cover" card with the count and a link to `/admin/categories`, shown only when `cover-warnings` is not empty. Other roles never call that endpoint.
- **Unit page:**
  - a "Skills matrix" button;
  - a "Categories" column showing how many of the unit's categories each member handles, from the matrix endpoint;
  - the existing "Category" column is renamed "Staff category", so the two are not confused.
- Adding or removing a member, or changing the head or deputy, now also refreshes the catalogue views, because leaving a unit ends that person's mappings.
- **`catalogue` feature:** `GET /api/catalogue/categories` is declared, with `useCatalogue()` and `PRIORITY` / `PRIORITY_LABELS`, ready for the FE-3 ticket form.

### Changes to how the app is built

- **Data router:** the app now uses `createBrowserRouter`, with one splat route around the unchanged `<AppRoutes />`, because `useBlocker` needs a data router. The test helper uses `createMemoryRouter` in the same way. All earlier tests pass unchanged.
- **Toasts:** a `warning` tone (orange), an optional action button (`{ label, onClick }`), and a `data-tone` attribute that tests can read.
- **Department list:** the Categories page and the breadcrumb read departments and units from `GET /api/org/departments` (active departments with their active units), not `/api/admin/departments`. New categories can only go into active units. It also keeps `admin-catalogue` free of a dependency on `admin-units`, which now imports `admin-catalogue` for the matrix counts, so there is no import cycle.

## Manual checks (section 6)

| # | Check | Result |
|---|---|---|
| 1 | test.superadmin → Categories | 22 Contribution Processing categories (15 Contribution Matching, 7 Refund). Each has 3 case workers, 24 business hours and Medium; no cover banner |
| 2 | Add "Test Category" to Refund; tick it for test.caseworker2, then test.caseworker4, in the UI | "Needs cover" and the banner (Test Category · Refund · 0) appear. Saving test.caseworker2 gives an orange toast: "Test Case Worker Two now handles 8 categories in Refund. Fewer than two case workers handle: Test Category." Saving test.caseworker4 gives a green toast, and the banner is gone on the matrix and on Categories |
| 3 | Move Test Category to Contribution Matching, then switch it off | Toast: "Category Test Category updated. Moved to Contribution Matching. 2 case worker mappings were removed. …" It needs cover again (0, in the banner). After switching off, the banner is gone, and test.requester's `GET /api/catalogue/categories` lists 22 categories without Test Category |
| 4 | Units → Contribution Matching: add test.requester, map 2 categories, remove them | Those columns go 3 → 4 after mapping, then back to 3 after removal, and the person's row leaves the matrix. test.requester is out of the unit again |
| 5 | Matrix at 1280 px, keyboard only (Contribution Matching, 15 columns) | Columns scroll inside the card; page width stays 1280 px. Tab reaches the grid, arrows move, Space ticks, the "1 person changed" bar appears, the name column stays at the left after scrolling to the last column, leaving asks first, and Discard restores |

The test accounts' password was read from this computer's user secrets into memory for these runs and was never printed.

**Data left behind:** "Test Category" stays in Contribution Matching, switched off, with no mappings, as check 3 leaves it. The API has no way to delete a category. Re-running check 2 as written gets a 409 (name taken), so rename it first or use another name.

## Files

All under `Frontend/`. New:

- `src/features/admin-catalogue/`:
  - `api/endpoints.js`, `hooks/useCatalogueAdmin.js`, `skills.js` (matrix rules and counts), `index.js`
  - `components/`: `CategoryDialog`, `CoverBanner`, `PriorityChip`, `SkillsGrid`
  - `pages/`: `CategoriesPage`, `SkillsMatrixPage`, plus `CatalogueAdmin.test.jsx`
- `src/features/catalogue/`: `api/endpoints.js`, `hooks/useCatalogue.js`, `index.js`
- Tests: `src/features/home/pages/HomePage.test.jsx`, `src/features/admin-units/api/endpoints.test.js`, `src/features/availability/api/endpoints.test.js`

Changed:

- `scripts/check-api.js` (nullability, nested comparison, `PRESENT_ON_SUCCESS`, inventory routes with a query), `scripts/check-api.test.js`, and `scripts/api-access.js` (7 routes)
- `src/app/App.jsx` and `src/test/render.jsx` (data router)
- `src/routes/AppRoutes.jsx`, `src/layouts/navigation.js`
- `src/features/home/pages/HomePage.jsx`
- `src/features/admin-units/pages/UnitPage.jsx`, `hooks/useUnits.js`, `pages/UnitsPage.test.jsx`
- `src/features/auth/api/endpoints.js` (`errors` as `{ field: string }`)
- `src/shared/ui/toast/ToastProvider.jsx`, `toastContext.js`

## How to run

```
cd PRO\AccessServiceDesk\Frontend
npm install
npm run dev          # http://localhost:5174 (API on http://localhost:5048)
npm run check        # stop npm run dev first
```

## Questions for the backend

1. **`POST /api/admin/categories` returns the category, not a message.** FE-2 asks to toast the API message ("… Map at least two case workers to it."), so the frontend builds the same sentence itself. Fine as it is, or should the answer carry the message, as PATCH does?
2. **Deleting a category.** There is no delete, so test categories stay in the list for good, switched off. Is a delete for never-used categories planned, or a development reset? Section 6 check 2 cannot be re-run as written (409).
3. **"Sign out and back in if you do not see the change yet."** The access-change notifications still say this. The web app now refreshes the session itself when the notification arrives, so the sentence could go.
4. **FE-1 question 4 can be closed.** Every `errors` in swagger is now `additionalProperties: { type: string }`.
5. **FE-1 question 2 is still open** (404 before 403 on the availability views).
6. **"Your categories in … changed" notifications** (`relatedEntityType: "CategorySkills"`) reach the person's bell. The web app refreshes nothing for them yet, because no screen shows a person's own categories. FE-3's work queue may want to.
