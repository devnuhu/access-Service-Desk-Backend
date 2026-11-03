# FE-1: Organisation, availability and the menu from data

**For:** the VS Code agent. **Read first:**
- `docs/agent-onboarding.md` (rules 1–16; 15 and 16 are new);
- `docs/build-plan.md` (Steps 2a and 2b);
- `docs/fe/FE-0-scaffold.md` (look and feel, HTTP rules and folder layout all still apply);
- `docs/fe/FE-0-report.md`.

**Where to work:** the same folders as FE-0. Work in `AccessServiceDesk\Frontend`. Treat the backend as read-only, except for the two files you write: `docs/swagger.json` and `docs/fe/FE-1-report.md`.

**Exit criteria:** `npm run check` passes, and the manual checks in section 7 work against the running API.

---

## 0. First: refresh the contract

The API has changed since FE-0: Step 1e, Step 2a and Step 2b. With the API running, save `http://localhost:5048/swagger/v1/swagger.json` again as `docs/swagger.json`, then run `npm run check`. Fix anything `check:api` reports before building new screens.

From Step 1e, also make sure the following are in place:
- **Errors.** Every error is `{ message, errors: { field: text } }`.
  - Show `message` in the toast or error box.
  - When `errors` has a key that matches a form field (camelCase, for example `startDate`), show that text under the field.
  - Use one helper for this in `src/shared/lib/http/`.
- **Welcome.** `/api/auth/me` and the login `user` now have `firstName` and `lastName`. "Welcome, <firstName>" uses `firstName`.
- **No list of test accounts on the sign-in page.** The user removed that line; keep it removed in every build.

## 1. What changed in the backend (why this step exists)

- **Departments and units are now data.**
  - Contribution Processing (code `CP`) has two units: Contribution Matching (`CM`) and Refund (`RF`).
  - Each unit has a Head of Unit, an optional deputy, and members (the case workers).
  - Each department has an HOD.
- **Case Worker, Head of Unit and HOD are structure roles.** They follow the organisation automatically:
  - a member of a unit is a Case Worker;
  - a head or deputy is a Head of Unit;
  - a department's HOD is HOD.

  The People page can no longer give or take them away. The API answers 400 if you try. Only **Super Admin** is given by hand, and Requester is everyone's.
- **Availability.**
  - Leave and out of office are recorded in whole days, Lagos time, with start and end included.
  - A person is available when their account is active and they are not away today.
- **The menu comes from data.** `GET /api/org/me` says which departments and units the signed-in person works in, heads, deputises or oversees. Build the module menu from it, never from a hard-coded department.

Development test organisation:

| Person | Place |
|---|---|
| test.hod | HOD of Contribution Processing |
| test.hou | Head of Contribution Matching |
| test.caseworker1, test.caseworker3 | Members of Contribution Matching |
| test.hou2 | Head of Refund |
| test.caseworker2, test.caseworker4 | Members of Refund |
| test.superadmin | Super Admin, not in any unit |
| test.requester | Requester only |

## 2. Endpoints FE-1 uses

Check every one against `docs/swagger.json`. Enums are numbers:
- `staffCategory`: 1 Employee, 2 Head of Unit.
- `kind`: 1 Leave, 2 Out of office.

Dates without a time are `"yyyy-MM-dd"` strings.

| Feature | Method and route | Body / result |
|---|---|---|
| org | `GET /api/org/me` | `{ departments: [{ id, code, name, isHod, units: [{ id, code, name, isHead, isDeputy, isMember }] }] }` |
| org | `GET /api/org/departments` | `[{ id, code, name, units: [{ id, code, name }] }]` (active only) |
| admin-units | `GET /api/admin/departments` | `[{ id, code, name, isActive, hod: person \| null, units: [{ id, departmentId, code, name, isActive, head, deputy, memberCount }] }]`; `person` = `{ userId, userName, fullName, email }` |
| admin-units | `POST /api/admin/departments` | `{ code, name }` → department; 400 / 409 |
| admin-units | `PATCH /api/admin/departments/{id}` | `{ name?, isActive? }` → `{ message }`; 400 "Switch off its units first." |
| admin-units | `PUT /api/admin/departments/{id}/hod` | `{ userId \| null }` → `{ message }` |
| admin-units | `POST /api/admin/departments/{id}/units` | `{ code, name }` → unit |
| admin-units | `PATCH /api/admin/units/{id}` | `{ name?, isActive? }` → `{ message }`; 400 "Remove its members (and its head) first." |
| admin-units | `PUT /api/admin/units/{id}/head` | `{ userId \| null }` → `{ message }` (the head is added as a member) |
| admin-units | `PUT /api/admin/units/{id}/deputy` | `{ userId \| null }` → `{ message }`; the deputy must already be a member |
| admin-units | `GET /api/admin/units/{id}/members` | `[{ userId, userName, fullName, email, staffNo, staffCategory, isHead, isDeputy, accountActive, joinedAt, lastAssignedAt }]` |
| admin-units | `POST /api/admin/units/{id}/members` | `{ userId, staffNo? }` → `{ message }`; 409 already in a unit of this department |
| admin-units | `DELETE /api/admin/units/{id}/members/{userId}` | `{ message }`; 400 for the head or deputy |
| admin-units | `GET /api/admin/users?search=&pageSize=10` | the person picker reuses the People list |
| availability | `GET /api/availability/me` | `{ today, inStructure, availableNow, current: absence \| null, absences: [absence] }`; `absence` = `{ id, userId, kind, startDate, endDate, note, recordedBy, recordedAt }` |
| availability | `POST /api/availability/absences` | `{ userId?, kind, startDate, endDate, note? }` → absence. 400 (field errors `startDate` / `endDate`), 403, 409 overlap |
| availability | `DELETE /api/availability/absences/{id}` | `{ message }`. Cancels a future period; a started one "ends early" (ends yesterday) |
| availability | `GET /api/availability/units/{unitId}` | `{ unitId, departmentId, code, name, today, memberCount, availableCount, members: [{ userId, userName, fullName, staffCategory, isHead, isDeputy, accountActive, availableNow, current, upcoming: [absence] }] }`; 403 / 404 |
| availability | `GET /api/availability/departments/{departmentId}` | `[unit availability]` (HOD, Super Admin) |

Who may record or cancel leave: the person, for themselves, when they are in a unit or are an HOD; the unit head or deputy, for that unit's members; the HOD, for their department; a Super Admin, for anyone. **The server decides** (rule 2). Show the buttons by the rules below and show the API's 403 message if it refuses.

## 3. Changes to FE-0 screens

1. **People and roles. "Give a role" offers only Super Admin.** Hide CaseWorker, HeadOfUnit and HOD from the select.
   - Their chips have **no remove button**. They have a tooltip instead: "Follows the organisation. Change it in Administration > Units." Also add a small link to `/admin/units`.
   - Requester stays as in FE-0.
   - Keep the role list in one place, `src/shared/lib/roles.js`, with `STRUCTURE_ROLES = ['CaseWorker', 'HeadOfUnit', 'HOD']`.
2. **Sidebar built from `/api/org/me`.** Fetch it with TanStack Query, under key `['org','me']`, after sign-in. Remove the hard-coded "Contribution Processing" module list.
   - **Everyone:**
     - Home.
     - My requests (Coming soon).
     - **My availability** (`/availability`), shown only when `departments` is not empty.
   - **One section per department** in `org/me`, titled with the department's `name` from data:
     - Work queue (Coming soon), when the person is a member of any unit there.
     - For each unit where `isHead` or `isDeputy`: "<unit name> availability" → `/availability/units/{unitId}`.
     - When `isHod`: "Department availability" → `/availability/departments/{departmentId}`.
   - **Super Admin who is not in a department:** one section per department from `GET /api/org/departments`, with "Department availability".
   - **Reports** (Coming soon): HeadOfUnit, HOD, SuperAdmin.
   - **Administration** (SuperAdmin): People and roles; **Units** (new, `/admin/units`); Email.
3. **Access changes arrive live.** When a `ReceiveNotification` arrives with `relatedEntityType === "User"`, invalidate `['auth','me']` and `['org','me']`, so roles and menu update without signing out.
4. **Home.** Add the person's place under the role chips: "Contribution Matching · Contribution Processing (Head of Unit)", built from `org/me`. Show nothing for people who are in no unit.

## 4. New screens

### 4.1 Administration → Units (`/admin/units`, SuperAdmin), feature `admin-units`

- **Page layout.** One card per department, active ones first. Switched-off departments are greyed, with an "Off" chip.
  - **Card header:** name, code chip, the HOD (name, or "No HOD" in muted text), and the actions "Set HOD", "Rename" and "Switch off/on".
  - **Card body:** a table of units with Code, Name, Head, Deputy, Members (count), Status, and a "Manage" link to `/admin/units/{unitId}`.
  - **Under the table:** an "Add unit" button opening a dialog with code and name.
- **Toolbar:** an "Add department" button opening a dialog.
  - The code field holds 2–10 capital letters, digits or dashes. Upper-case it as the user types.
  - Add the hint "Used as the ticket reference prefix, for example CP. Cannot be changed later."
- **Person picker** (shared component `PersonPicker` in `src/shared/ui/`): a search box (debounced 300 ms) over `GET /api/admin/users?search=&pageSize=10`.
  - Results show the name, login name and department.
  - Add a link "Not listed? Add from directory" that opens FE-0's directory dialog and then selects the new person.
  - Use the picker for Set HOD, Set head, Set deputy and Add member.
- **Unit page** (`/admin/units/:unitId`):
  - Breadcrumb Units › Department › Unit. Find the unit in the cached `GET /api/admin/departments`.
  - **Head:** the name with "Change" and "Clear" actions.
    - Add the hint "The head also works tickets in the unit. The previous head stays as a case worker."
  - **Deputy:** "Change" picks only from current members (use the members list, not the picker), plus "Clear".
    - Add the hint "Receives escalations when the head is on leave."
  - **Members table:** Name (with login name under it), Staff no., Category chip (Employee / Head of Unit), a "Head" or "Deputy" chip, Account (Active / Blocked), and Joined (WAT).
    - The "Remove" action asks for confirmation. On the head and deputy rows it is disabled, with a tooltip "Change the head/deputy first".
  - **"Add member":** the person picker plus an optional staff number (max 30).
  - **Messages:** show every API `message` as a toast, including the 400 and 409 rule messages (one unit per department, the HOD cannot be a member, and so on).
- **After every change:** invalidate `['admin','departments']`, `['admin','units',unitId,'members']` and `['org','me']`. The change may affect the admin's own menu.

### 4.2 My availability (`/availability`), feature `availability`

- **When `inStructure` is false:** show one card, "Leave is recorded here for people who work in a unit or head a department.", and nothing else.
- **Status banner:**
  - "Available today" in green, or
  - "On leave until Thu 5 Nov 2026" / "Out of office until …" in orange, with "You will not be given new tickets while away."
- **"Record leave" form:**
  - Kind (radio: Leave / Out of office).
  - Start and End dates (`<input type="date">`; `min` = today − 30 days; End `min` = Start).
  - Note (optional, max 200, hint "Do not include customer details").
  - **Record** button.
  - Field errors come from `errors.startDate` / `errors.endDate`. A 409 overlap shows its message above the form.
- **List of current and future periods,** each as a row: kind chip, "Mon 9 Nov – Fri 13 Nov 2026 (5 days)", note, "Recorded by …".
  - The action is "Cancel" for a future period. For a current one it is "End early", with the confirmation "You will be available from today."
- **Today:** use the `today` value the API returns, not the browser's clock.

### 4.3 Team availability (`/availability/units/:unitId`; `/availability/departments/:departmentId`)

- **Unit page:**
  - **Header:** unit name, and "**3 of 4** available today". Show it in orange when fewer than 2 are available, with "Tickets may wait for an available case worker."
  - **Table:** Name; chips for Head / Deputy / category; Status:
    - "Available" in green;
    - "On leave until 5 Nov" or "Out of office until …" in orange;
    - "Blocked" in grey.
  - **Upcoming:** compact date ranges, the first two, then "+N more".
  - **Actions per person:** "Record leave" opens the same form as 4.2 in a dialog, sending `userId`. Each period has "Cancel" / "End early".
- **Department page:** one unit card per unit, using the same component, stacked. It is the HOD's overview.
- **Access:** guard the routes with the org data. Allowed are head or deputy of that unit, HOD of that department, and SuperAdmin; everyone else gets the no-access page. If the API still answers 403, show its message.

### 4.4 Dates (shared)

`src/shared/lib/dates.js`:
- `formatDay("2026-11-03")` → "Tue 3 Nov 2026".
- `formatRange(start, end)` → "Mon 9 Nov – Fri 13 Nov 2026".
- `daysInclusive(start, end)`.
- `addDays(day, n)`.

Work on the `yyyy-MM-dd` strings directly, as calendar dates, by splitting them into numbers. **Never** pass them through `new Date("yyyy-MM-dd")`: that is read as UTC midnight, which shows the wrong day in some time zones. Instants such as `recordedAt` and `joinedAt` still use `formatWat`.

## 5. Tests (vitest + Testing Library, no real network)

At least:
1. `dates.js`:
   - `formatDay("2026-11-03")` is "Tue 3 Nov 2026" whatever the test machine's time zone (set `process.env.TZ` to `America/Los_Angeles` in this test);
   - `daysInclusive("2026-11-09","2026-11-13")` is 5;
   - `addDays` across a month end.
2. Sidebar from `org/me`:
   - test.hou's data shows "Contribution Processing" with "Contribution Matching availability";
   - a requester with no departments has no module section and no My availability;
   - a SuperAdmin with no departments gets sections from `/api/org/departments`.
3. People page: the Give-a-role select offers only Super Admin; a CaseWorker chip has no remove button.
4. Units page: renders departments, units, head and member counts; a 409 from Add member appears as a toast.
5. My availability:
   - "Out of office until …" when `current` has kind 2;
   - a field error from `errors.endDate` appears under End;
   - "End early" is shown for a started period and "Cancel" for a future one.
6. Unit availability: "1 of 2 available today" in orange; "Record leave" for a member posts `userId`.
7. A pushed notification with `relatedEntityType "User"` refetches `auth/me` and `org/me`.

## 6. Report

Write `docs/fe/FE-1-report.md`. Include:
- what was built and changed;
- the files;
- the test count;
- the `npm run check` result;
- questions for the backend.

## 7. Manual checks (API running, `npm run dev`)

1. Sign in as **test.superadmin** → Administration → Units.
   - You see Contribution Processing with HOD test.hod.
   - Contribution Matching has head test.hou and 3 members.
   - Refund has head test.hou2 and 3 members.
2. As the Super Admin, open People and roles → test.requester. "Give a role" offers only Super Admin.
3. As the Super Admin, add test.requester to Refund (Units → Refund → Add member).
   - In another browser, test.requester gets the access notification, and **without signing out** sees the Contribution Processing section and My availability.
   - Remove them again.
4. Sign in as **test.caseworker1** → My availability.
   - Record leave from today to tomorrow → the banner says "On leave until …".
   - test.hou's bell shows "Availability changed in Contribution Matching".
5. Sign in as **test.hou** → Contribution Matching availability.
   - It shows test.caseworker1 away, and "2 of 3 available today".
   - "End early" on that leave → test.caseworker1 shows as available.
   - test.caseworker1 is told.
6. Sign in as **test.hod** → Department availability shows both units. Opening `/availability/units/<Refund id>` as test.hou shows the no-access page.
7. Switch the browser's time zone (or the computer's) to UTC−5 → the dates shown are unchanged.
