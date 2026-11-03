# FE-1 report: organisation, availability and the menu from data

**Date:** 2 November 2026 · **Folder:** `PRO\AccessServiceDesk\Frontend` · **Built against:** `docs/swagger.json`, saved again from `http://localhost:5048/swagger/v1/swagger.json` on 2 November 2026 (after Steps 1e, 2a and 2b)

## Result

| Check | Result |
|---|---|
| `npm run check` | **Passes**: lint, Prettier check, tests, `check:api` and build |
| Tests | **85 passed** in 15 files (63 at the end of FE-0) |
| `check:api` | 37 endpoints in 7 files, 38 access rules, compared with `docs/api/endpoint-inventory.md`: **0 mismatches, 0 warnings** |
| `check:api:live` | test.superadmin 12 PASS, test.hou 13 PASS, test.requester 14 PASS, **0 FAIL**. Every live GET response passes the app's own zod schema. |
| Section 7 manual checks | **All pass** against the running API. Steps 1–6: 21 checks, signed in through the Vite proxy with cookies and CSRF and listening on the SignalR hub. Step 7: a browser set to UTC−5. Screens checked in headless Edge, signed in through the real sign-in page. |

One `npm run check` run failed every test file with "Vitest failed to find the current suite". It ran while `npm run dev` was running in the same folder, and the two shared Vite's cache. With the dev server stopped, the check passes. **Stop `npm run dev` before running `npm run check`.**

## Section 0: contract refresh

- `docs/swagger.json` was saved again. Every endpoint now documents its responses, so the FE-0 warnings ("no response properties") are gone.
- **Inventory comparison.** `check:api` now compares with `docs/api/endpoint-inventory.md`. The inventory's "Who" column uses plain words ("anyone", "signed in (own only)", "Super Admin, Head of Unit", "unit head or deputy, HOD of its department, Super Admin"). `inventoryAccess` in `scripts/check-api.js` now reads these phrases, with a test.
- **Sign-in schemas.** `ApiResponse.errors` is now an object, `{}` on a failed sign-in. The FE-0 schema expected a list and would have rejected every sign-in answer. It is now a record. The shallow `check:api` does not compare value types, so this was found by reading the new schema and testing a live sign-in.
- **Errors.** One helper in `src/shared/lib/http/fieldErrors.js`, `applyFieldErrors(error, setError, fields)` (and `fieldError`). The API `message` goes in the toast or error box. A key in `errors` that matches a form field goes under that field. It is used on the email test form, the new department and unit dialogs, rename, and the leave form.
- **Welcome.** `/me` and the login `user` carry `firstName`/`lastName`. "Welcome, <firstName>" uses `firstName` and falls back to the first word of the full name.
- **Session query key** is now `['auth','me']`, as FE-1 uses it.
- **Development sign-in hint (not restored).** On 2 November, during the sign-in page work after FE-0, the user asked for the "Development test accounts" line to be **removed**. FE-1 section 0 asks for it with the new list. I kept the user's later instruction, so the line is not shown. If it should come back (development builds only, never a password), it is one line in `LoginPage.jsx`: test.requester, test.caseworker1–4, test.hou, test.hou2, test.hod, test.superadmin.

## What was built and changed

### Changes to FE-0 screens

1. **People and roles.**
   - "Give a role" offers only Super Admin.
   - Case Worker, Head of Unit and HOD chips have no remove button. They carry the tooltip "Follows the organisation. Change it in Administration > Units.", and a "Change them in Units" link to `/admin/units`.
   - Requester is unchanged.
   - The lists live in `src/shared/lib/roles.js`: `STRUCTURE_ROLES`, `ASSIGNABLE_ROLES` and `isStructureRole`.
2. **Sidebar built from `/api/org/me`** (key `['org','me']`). The hard-coded "Contribution Processing" list is gone.
   - **Everyone:** Home, My requests (coming soon), and My availability when the person is in a department.
   - **One section per department**, titled with the department's name from the data:
     - Work queue (coming soon) when the person is a member of a unit there;
     - "<unit> availability" for each unit the person heads or deputises;
     - "Department availability" when the person is the HOD.
   - **A Super Admin in no department:** one section per department from `/api/org/departments`.
   - **Reports:** HOU, HOD and Super Admin. **Administration:** People and roles, Units, Email.
   - Fix found in the live screenshots: "My availability" no longer stays highlighted on the unit pages.
3. **Live access changes.** A pushed notification with `relatedEntityType "User"` refetches `['auth','me']` and `['org','me']`, so roles and menu update without signing out. As a small extra, `"Absence"` refetches the availability views, so a head's unit page updates when a member records leave.
4. **Home** shows the person's place under the role chips, for example "Contribution Matching · Contribution Processing (Head of Unit)". People in no unit see nothing there.

### New screens

- **Administration → Units** (`/admin/units`, feature `admin-units`):
  - Department cards, with switched-off departments last, greyed, marked "Off".
  - Each card: code chip, HOD or "No HOD", and the actions Set HOD, Clear HOD, Rename and Switch off/on (with confirmation).
  - The units table: code, name, head, deputy, members, status, Manage. "Add unit" sits under it.
  - "Add department": the code is upper-cased as you type, with the hint "Used as the ticket reference prefix, for example CP. Cannot be changed later."
  - Every result shows the API message as a toast.
- **Unit page** (`/admin/units/:unitId`):
  - Breadcrumb Units › Department › Unit, built from the cached departments.
  - Head: Change (person picker) and Clear, with its hint. Deputy: Change (chosen from current members only) and Clear, with its hint.
  - Members table: name and login, staff no., category chip, Head/Deputy chip, account, joined (WAT).
  - Remove asks for confirmation. It is disabled on the head and deputy rows, with the tooltip "Change the head first" or "Change the deputy first".
  - Add member: the picker plus an optional staff no. (max 30).
  - Also: Rename and Switch off/on for the unit, using `PATCH /api/admin/units/{id}`. The spec lists that endpoint but places no button for it.
  - After every change: `['admin','departments']`, `['admin','units',id,'members']` and `['org','me']` are refetched.
- **`PersonPicker`** (`src/shared/ui/`): debounced 300 ms search over `GET /api/admin/users?search=&pageSize=10`, showing name, login name and department.
  - Shared code may not call feature APIs, so the search function and the footer come in as props.
  - The admin pages pass "Not listed? Add from directory", which opens FE-0's directory dialog and then selects the new person.
- **My availability** (`/availability`):
  - People outside the structure: only the one explanatory card.
  - Otherwise a status banner: "Available today" in green, or "On leave until Thu 5 Nov 2026" / "Out of office until …" in orange with "You will not be given new tickets while away."
  - Record leave form:
    - kind (Leave / Out of office);
    - start and end, where Start's `min` is today − 30 and End's `min` is Start;
    - note (max 200, "Do not include customer details").
  - Field errors from `errors.startDate` / `errors.endDate` show under the fields, and the message (including the 409 overlap) above the form.
  - Each period in the list shows: kind chip, "Mon 9 Nov – Fri 13 Nov 2026 (5 days)", note and "Recorded by …". The action is "Cancel" for a future period, or "End early" (confirmation "You will be available from today.") for a started one.
  - "Today" is always the API's `today`.
- **Team availability** (`/availability/units/:unitId`, `/availability/departments/:departmentId`):
  - "**3 of 4** available today", in orange below 2, with "Tickets may wait for an available case worker."
  - Rows: Head/Deputy/category chips; status Available (green), "On leave until 5 Nov" or "Out of office until …" (orange), or Blocked (grey); upcoming periods, the first two then "+N more".
  - "Record leave" opens a dialog with the same form (sending `userId`), plus that person's periods with Cancel / End early.
  - The department page stacks one unit card per unit.
- **Route guard** `RequireTeamAccess` uses the organisation data: the head or deputy of the unit, the HOD of its department, or a Super Admin. `org/me` lists only the HOD's own units, so the HOD's access to a unit is found through `/api/org/departments`. Everyone else gets the no-access page, and a 403 from the API shows its message.
- **`src/shared/lib/dates.js`:** `formatDay`, `formatShortDay`, `formatRange`, `formatShortRange`, `daysInclusive` and `addDays`. Office days stay `yyyy-MM-dd` strings and use UTC date arithmetic, never `new Date("yyyy-MM-dd")`. The test runs with `TZ=America/Los_Angeles` and first shows that the trap is real there.

## Section 7 manual checks: results

| # | Check | Result |
|---|---|---|
| 1 | Super Admin → Units | Contribution Processing, HOD test.hod; Contribution Matching head test.hou, 3 members; Refund head test.hou2, 3 members (screenshot checked) |
| 2 | People and roles → test.requester | "Give a role" offers only Super Admin |
| 3 | Add test.requester to Refund | 200. test.requester received "Your Access Desk access changed" live (`relatedEntityType` User). In the same session, `/me` showed CaseWorker and `org/me` showed Contribution Processing / Refund. Removed again; no departments afterwards |
| 4 | test.caseworker1 records leave today → tomorrow | Away, current period ends tomorrow ("On leave until …"). test.hou received "Availability changed in Contribution Matching" live |
| 5 | test.hou → Contribution Matching availability | test.caseworker1 away, "2 of 3 available today". End early → available (3 of 3); test.caseworker1 told ("Your availability was updated") |
| 6 | test.hod → Department availability | Both units. test.hou on Refund: the app guard sends them to no-access, and the API also answers 403 |
| 7 | Browser time zone UTC−5 (America/Bogota) | A 9–13 Nov leave still shows "Mon 9 Nov – Fri 13 Nov 2026 (5 days)"; recorded-at stays in WAT. The test leave was cancelled afterwards |

The test accounts' password was read from this computer's user secrets into memory for these runs and was never printed.

## Files

All under `Frontend/`. New:

- `src/shared/lib/dates.js` (+ test), `src/shared/lib/http/fieldErrors.js` (+ test), `src/shared/ui/PersonPicker.jsx`
- `src/features/org/`: `api/endpoints.js`, `hooks/useOrganisation.js`, `place.js` (+ test), `index.js`
- `src/features/admin-units/`:
  - `api/endpoints.js`, `hooks/useUnits.js`, `index.js`
  - `components/`: `DepartmentCard`, `OrgItemDialog`, `PickPersonDialog`, `RenameDialog`
  - `pages/`: `UnitsPage`, `UnitPage`, plus `UnitsPage.test.jsx`
- `src/features/availability/`:
  - `api/endpoints.js`, `hooks/useAvailability.js`, `absenceText.js`, `index.js`
  - `components/`: `AbsenceForm`, `AbsenceList`, `UnitAvailabilityCard`, `RequireTeamAccess`
  - `pages/`: `MyAvailabilityPage`, `TeamAvailabilityPages`, plus `AvailabilityPages.test.jsx`

Changed:

- `src/features/auth/api/endpoints.js` and `session.js` (errors record, `firstName`/`lastName`, key `['auth','me']`)
- `src/features/admin-people/` (`PersonPanel`, `AddFromDirectoryDialog` passes back the new person, `searchPeople`, `index.js`)
- `src/features/admin-email/pages/EmailPage.jsx` (field errors)
- `src/features/home/pages/HomePage.jsx`
- `src/features/notifications/hooks/useLiveNotifications.js`
- `src/layouts/navigation.js`, `Sidebar.jsx`
- `src/routes/AppRoutes.jsx`, `src/shared/lib/roles.js`, `src/shared/ui/index.js`, `src/test/render.jsx`
- Tests updated: `Sidebar`, `PeopleRolesPage`, `NotificationBell`, `LoginPage`, `check-api`
- `scripts/check-api.js` (plain-language inventory; `skipAlways` for routes the service checks by organisation), `scripts/api-access.js` (18 new routes)

## How to run

```
cd PRO\AccessServiceDesk\Frontend
npm install
npm run dev          # http://localhost:5174 (API on http://localhost:5048)
npm run check        # stop npm run dev first
```

## Questions for the backend

1. **Stale roles in the access token after a structure change.**
   - The web app now refetches `/me` and `org/me` when the "access changed" notification arrives, so the menu and pages update at once.
   - The access token still carries the old role claims until its next refresh. Policy-protected endpoints (`Unit_Management` for directory search, `Super_Admin_Only`) therefore follow the old roles for up to the token's lifetime. Availability is not affected, because it checks the database.
   - Should the API mark the person's tokens for refresh on a structure change? Or should the web app run its shared refresh when a `User` notification arrives? The second is easy to add on the frontend, but a forced refresh may be the cleaner contract.
   - The notification text still says "Sign out and back in if you do not see the change yet."
2. **404 before 403 on the availability views.** `GET /api/availability/units/{id}` and `/departments/{id}` answer 404 for an unknown id before checking access, so anyone signed in can tell which ids exist. Is that acceptable? If 403 came first for people who lead no unit, `check:api:live` could probe these routes; for now it skips them for every role.
3. **Nullable references in swagger.**
   - Swagger does not mark these as nullable: `DepartmentDto.hod`, `UnitDto.head`/`deputy`, `MyAvailabilityDto.current`, `MemberAvailabilityDto.current`. They are `$ref`s with no `nullable`.
   - They are null in practice, and the frontend schemas allow null.
   - Could Swashbuckle mark them, for example with `UseAllOfToExtendReferenceSchemas` and `SupportNonNullableReferenceTypes`?
4. **`ApiError.errors` / `ApiResponse.errors` are typed only as `object`.** Could swagger say `additionalProperties: { type: string }`, so the field-error shape is part of the contract?
5. **App name in notifications (rule 14).** Manual role changes (`AdminUserService`) say "Your Service Desk access changed"; structure changes (`OrgRoleSync`) say "Your **Access Desk** access changed". Should both say Access Desk?
6. **Docs.** `agent-onboarding.md` ("Secrets and sign-in") still lists the six original test accounts. test.caseworker3, test.caseworker4 and test.hou2 are missing.
