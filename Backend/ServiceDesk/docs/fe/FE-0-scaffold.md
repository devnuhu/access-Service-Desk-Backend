# FE-0 — Access Desk web app scaffold (`PRO\AccessServiceDesk\Frontend`)

**For:** the VS Code agent. **Read first:** `docs/agent-onboarding.md` (rules 1–14) and `docs/build-plan.md`.

**Where things are** (all under `C:\Users\<you>\Desktop\PRO\`):

| What | Folder | Seen from the frontend folder |
|---|---|---|
| **This web app (you work here)** | `AccessServiceDesk\Frontend` | `.` |
| Backend solution (read-only) | `AccessServiceDesk\Backend\ServiceDesk\ServiceDeskAPI` | `..\Backend\ServiceDesk\ServiceDeskAPI` |
| Docs (this prompt, swagger.json, rules) | `AccessServiceDesk\Backend\ServiceDesk\docs` | `..\Backend\ServiceDesk\docs` |
| People Hub web app (tooling to copy) | `ELM\workforce-hub-web` | `..\..\ELM\workforce-hub-web` |

In this prompt, `docs/...` means `PRO\AccessServiceDesk\Backend\ServiceDesk\docs\...`. **The frontend folder starts empty.** Create the app there with Vite (React, JavaScript, no TypeScript): `npm create vite@latest . -- --template react`, then apply section 2 (People Hub tooling and versions) on top, replacing what the template made where they differ (for example its ESLint config, `App.css`, the demo counter). Remove the template's demo files. Open `PRO` in VS Code so all of them are visible.
**Backend:** read-only. Do not change anything under `AccessServiceDesk\Backend\`, except two files you may write: `docs/swagger.json` and `docs/fe/FE-0-report.md`. If the API seems wrong or is missing something, stop and write it down under "Questions for the backend" at the end of `docs/fe/FE-0-report.md`.
**Source of truth for routes and shapes:** `docs/swagger.json` (saved from the running API) and the controllers/DTOs in `ServiceDeskAPI\ServiceDeskAPI\Controllers` and `Application\DTOs`.
**Exit criteria:** `npm run check` passes (lint, format check, tests, `check:api`, build), and the manual checks at the end work against the running API.

---

## 1. What you are building

The first screens of **Access Desk**, Access Pensions' company-wide internal service desk. Every department will receive tickets through it over time; **Contribution Processing is the first module**, not the whole app.

**Platform vs module (important for every screen):** the sign-in page, header, shell, Home, notifications and Administration belong to the platform and never name a department. Department names appear only inside module areas (for example a "Contribution Processing" section in the menu once tickets exist) and in data (a person's department, a ticket's department). Never hard-code "Contribution Processing" outside such a module area.

FE-0 covers only what the backend already offers (Step 1):

1. Sign-in page
2. App shell: header, sidebar menu by role, notification bell with live updates, user menu with sign-out
3. Home page (welcome, the person's roles)
4. Super Admin → **People and roles** (list, search, filter, give/take away roles, block/unblock, add from directory)
5. Super Admin → **Email** (status and test email)
6. Not-found and no-access pages

Tickets, units, categories and reports come in later steps; show them in the menu only as disabled items labelled "Coming soon" where noted below.

## 2. Copy the People Hub tooling (code and settings names only)

People Hub's web app is at `..\..\ELM\workforce-hub-web` (from the frontend folder). Copy **tooling only**:

| Copy | Change |
|---|---|
| `package.json` scripts and the dependency **versions** | name `access-desk-web`. Keep only what FE-0 uses: react, react-dom, react-router-dom, @tanstack/react-query, axios, react-hook-form, zod, lucide-react, tailwindcss, @tailwindcss/vite, and all devDependencies. Add `@microsoft/signalr` (latest 8.x or 9.x that installs cleanly). Drop pdfjs-dist, recharts, react-is for now. |
| `eslint.config.js` | as is (the `/api/` literal rule and the feature-import rules stay) |
| `vite.config.js` | add `server.port: 5174` and `server.strictPort: true` (People Hub uses 5173; both must run side by side) |
| `jsconfig.json`, `.prettierrc.json` | as is |
| `scripts/check-api.js`, `scripts/check-api.test.js`, `scripts/api-access.js` | point them at `../Backend/ServiceDesk/docs/swagger.json` (the Service Desk docs folder) |
| `src/shared/lib/http/*` | adapt to section 4 (cookie names, CSRF, refresh) |
| `src/test/setup.js` | as is |

**Never copy** `.env`, `.env.development`, `.env.*.local` or any file with a key, token, password or URL of a People Hub server. Create `.env.example` and `.env.development` fresh:

```
# .env.development (local only; no secrets)
VITE_API_BASE_URL=
API_PROXY_TARGET=http://localhost:5048
```

With the proxy, the browser calls `/api` and `/hubs` on `localhost:5174` and Vite forwards them to the API's http profile (`http://localhost:5048`). Same origin, so the HttpOnly cookies just work.

Folder layout (same as People Hub): `src/app`, `src/layouts`, `src/routes`, `src/shared/{lib,hooks,ui}`, `src/features/<feature>/{api,components,hooks,pages}` with `src/features/<feature>/index.js` as each feature's public face, `src/test`.

Features for FE-0: `auth`, `notifications`, `admin-people`, `admin-email`, `home`.

## 3. Look and feel: Access Desk, corporate and modern

Its own look, not People Hub's. It must match the Access Desk emails:

- **Colours** (Tailwind 4 `@theme` tokens in `src/index.css`):
  - `--color-brand-navy: #003883` (header, primary buttons, links)
  - `--color-brand-orange: #ff8200` (accents: primary button bottom edge, "action required", focus ring)
  - `--color-brand-green: #8DC63F` (wordmark second word, success, positive states)
  - ink `#0B1F3A`, body `#3D4A5C`, muted `#6B7A90`, lines `#E3E8EF`, page `#F4F6FA`
- **Company logo + wordmark:** the Access Pensions logo comes first, then a thin divider, then "Access" in white + "Desk" in green with "Service Desk" small under it. Never a department name here.
  - Logo file: **do not copy any logo**. The user will drop the real logo into `src/assets/brand/` after the scaffold exists. Until then create a neutral placeholder `src/assets/brand/access-pensions-logo.svg` (grey rounded rectangle with the text "Access Pensions"). Import the logo in **one place only**, `src/shared/ui/brand/logo.js` (`export { default as logoUrl } from "@/assets/brand/access-pensions-logo.svg";`), and use a `<CompanyLogo />` component everywhere, so swapping in the real file is one file plus one line. Write this in the report under "How to add the real logo".
  - On navy, a full-colour logo sits on a small white rounded badge (`.logo-badge` in `login-reference.html`); a white version sits directly on the navy without the badge. `alt="Access Pensions"`.
  - App header: same arrangement, smaller (logo 28px high).
- **Font:** system stack (`"Segoe UI", Roboto, Helvetica, Arial, sans-serif`). No web fonts (corporate network).
- **Layout:** navy top bar (wordmark left; bell and user menu right), white sidebar with icons (lucide-react), content on the light page colour in white cards with 1px line borders, 6px radius, no heavy shadows.
- **Buttons:** primary = navy with a 3px orange bottom edge (as in the email); secondary = white with navy text and line border; danger = red outline.
- **Status chips:** small rounded uppercase labels (roles, active/blocked).
- **Accessibility:** visible focus ring (orange), labels on every input, contrast at least AA, keyboard-usable menus and dialogs, `aria-live` for toasts.
- **Responsive:** sidebar collapses to a menu button under 1024px.
- **Times:** stored in UTC, always shown in WAT (UTC+1): one helper `formatWat(utc)` in `src/shared/lib/time.js`, for example "Mon 2 Nov 2026, 15:42 WAT".

## 4. Talking to the API (security rules)

All calls go through one axios instance in `src/shared/lib/http/`. Routes are declared only in `src/features/<feature>/api/endpoints.js` (ESLint and `check:api` enforce this).

- `withCredentials: true`. Tokens live in **HttpOnly cookies** set by the API (`__Secure-sd-accessToken`, `__Secure-sd-refreshToken` over HTTP in development; `__Host-sd-*` over HTTPS). **Never** store tokens in localStorage, sessionStorage or JS memory, and never send an `Authorization` header from the web app. Ignore `accessToken`/`refreshToken` in the login response body.
- **CSRF:** every POST, PUT, PATCH and DELETE sends header `X-CSRF-Token`. Keep the token in memory only. Take it from the login/refresh response (`data.csrfToken`) or the `X-CSRF-Token` response header. After a page reload (token lost), call `GET /api/auth/csrf` once the session is confirmed by `GET /api/auth/me`. If a change is refused with **403** and the body message contains "Security check failed", fetch a new token with `GET /api/auth/csrf` and retry **once**.
- **Refresh:** on **401** from any call except login/refresh/logout, call `POST /api/auth/refresh` (no body; the cookie carries the token) through **one shared promise**: never two refreshes at once (the API ends every session if a used refresh token comes back after 30 seconds). Then retry the original request once. If refresh fails → clear the user from the query cache and go to `/login?next=<current path>`.
- **Errors:** the API answers `{ message }` (sometimes with `errors: { field }`). Show `message` to the user. 429 → "Too many attempts. Wait a minute and try again." 503 → show the API message.
- **Session start:** on app load call `GET /api/auth/me` (with the refresh-retry above). 200 → signed in; 401 after refresh → signed out.

## 5. The endpoints FE-0 uses

Check every one against `docs/swagger.json`.

| Feature | Method and route | Body / result |
|---|---|---|
| auth | `POST /api/auth/login` | `{ username, password }` → `{ statusCode, message, data: { csrfToken, accessTokenExpiresAt, user: { id, username, email, fullName, firstName, lastName, department, roles[], isActive, unreadNotificationCount } } }`. 401 `{ message }` |
| auth | `POST /api/auth/refresh` | same shape as login |
| auth | `GET /api/auth/me` | `{ data: { id, username, email, fullName, corporateEmail, department, jobTitle, roles[], unreadNotificationCount } }` |
| auth | `GET /api/auth/csrf` | `{ data: "<token>" }` |
| auth | `POST /api/auth/logout` | always 200; then clear state and go to `/login` |
| notifications | `GET /api/notifications?page=&pageSize=&unreadOnly=` | `{ items: [{ id, title, message, type, category, relatedEntityType, relatedEntityId, deepLinkUrl, isRead, readAt, createdAt, isActionRequired }], total, unread, page, pageSize }`. `type`: 0 Info, 1 Success, 2 Warning, 3 ActionRequired. `category`: 0 System, 1 Ticket, 2 Assignment, 3 Sla, 4 Escalation, 5 Report |
| notifications | `GET /api/notifications/unread-count` | `{ count }` |
| notifications | `PATCH /api/notifications/{id}/read` | 204 |
| notifications | `PATCH /api/notifications/read-all` | `{ marked }` |
| notifications | SignalR hub `/hubs/notifications` | server → client `ReceiveNotification(notification)` (same shape as a list item); client may invoke `Ping` → `"pong"` |
| admin-people | `GET /api/admin/users?page=&pageSize=&search=&role=` | `{ items: [{ id, userName, fullName, email, department, jobTitle, roles[], isActive, hasSignedIn, lastLoginAt, createdAt }], total, page, pageSize }` |
| admin-people | `GET /api/admin/users/{id}` | one item |
| admin-people | `GET /api/admin/roles` | `[{ id, name, description }]` |
| admin-people | `POST /api/admin/users/{id}/roles` | `{ roleId }` → `{ message }`; 409 already has it; 404 |
| admin-people | `DELETE /api/admin/users/{id}/roles/{roleId}` | `{ message }`; 400 for Requester or the last Super Admin; 404 |
| admin-people | `PATCH /api/admin/users/{id}/status` | `{ isActive }` → `{ message }`; 400 for yourself or the last Super Admin |
| admin-people | `GET /api/directory/users/search?query=` | `[{ distinguishedName, displayName, email, jobTitle, department, samAccountName }]`; 503 when AD is not set up yet |
| admin-people | `POST /api/directory/users/ensure` | `{ samAccountName }` → `{ userId, userName, fullName, email, department, created, roles[] }` |
| admin-email | `GET /api/admin/email/status` | `{ provider, infobip: { baseUrl, senderEmail, senderName, apiKeyConfigured }, smtp: {...}, notificationEmails, ready }` |
| admin-email | `POST /api/admin/email/test` | `{ to }` → `{ success, message }` (always 200 unless the address is invalid: 400) |

Role names: `Requester`, `CaseWorker`, `HeadOfUnit`, `HOD`, `SuperAdmin`. Show them as "Requester", "Case Worker", "Head of Unit", "Head of Department", "Super Admin". A person can hold several.

## 6. Screens

**Sign-in (`/login`): follow `docs/fe/login-reference.html` exactly** (screenshots: `login-desktop.png`, `login-mobile.png` in the same folder). It is the approved design. Rebuild it as React components with Tailwind classes and the theme tokens; keep the layout, spacing, colours and wording. Do not invent another layout.
- Two panels on desktop (1024px and wider): left **brand panel** (navy, soft gradient, the Access Pensions logo on its white badge, a thin divider, the "Access **Desk**" wordmark with "Service Desk" under it, the headline "Every request, to the right team, on time.", one line of text, three points with small icons, "Access ARM Pensions Plc · For staff use only", the decorative rings (inline SVG, `aria-hidden`), and the green / orange / white band along the bottom edge); right **form panel** (white).
- Under 1024px: the brand panel becomes a short navy top band with only the wordmark, the unit line and the band; the form follows.
- Form: "Staff sign-in" label, "Welcome back", "Sign in with your Access Pensions network account.", Username (person icon; hint "The name you use to sign in to your computer, for example amaka.obi"), Password (lock icon; Show/Hide button), **Sign in** button (navy, orange bottom edge, arrow icon; spinner and "Signing in…" while waiting; disabled while waiting), "Secured with your company network account", help line "Trouble signing in? Contact ICT support. Your password is the same as your computer password.", © line.
- Errors: the red box above the fields shows the API `message` (401), or "Too many attempts. Wait a minute and try again." (429), or "Access Desk cannot be reached right now. Try again shortly." (network/5xx). Focus moves to the box (`role="alert"`).
- Username field gets focus on load. `autocomplete="username"` / `"current-password"`. Enter submits. Both fields required (zod), with messages under the field.
- Development only (`import.meta.env.DEV`): the small grey line listing the test account names (never a password).
- On success: go to `next` (only if it is a local path starting with `/`, to prevent open redirects) or `/`.

**App shell.** Header: wordmark; bell (badge with unread count, 99+); user menu (full name, department, role chips, "Sign out"). Sidebar by role:
- Everyone: Home; My requests (disabled, "Coming soon"): a person's own tickets to any department
- Module section "Contribution Processing" (the first department module), shown to its staff (CaseWorker / HeadOfUnit / HOD) and SuperAdmin: Work queue (disabled, "Coming soon"). Build the menu from a small list of modules so later departments are added as data, not new layout code
- HeadOfUnit / HOD / SuperAdmin: Reports (disabled, "Coming soon")
- SuperAdmin: section "Administration" → People and roles; Email

Route guard component `RequireRole roles={[...]}`: not signed in → `/login?next=…`; signed in without the role → the no-access page. The server still decides access (rule 2); hiding is only for the user.

**Notification bell.** Dropdown with the 10 latest (title, message trimmed to 2 lines, time in WAT, unread dot, colour by type: orange for ActionRequired, navy Info, green Success, orange-light Warning). Click → mark read, then go to `deepLinkUrl` if present. "Mark all as read". Live: start a SignalR connection after sign-in (`withUrl('/hubs/notifications', { withCredentials: true })`, automatic reconnect); on `ReceiveNotification` add it to the top of the cached list, bump the count, and show a toast. Stop the connection on sign-out.

**Home (`/`).** "Welcome, <first name>", department, role chips, and one short card per role saying what they will be able to do (from BRD Section 4, one line each). No ticket data yet.

**People and roles (`/admin/people`, SuperAdmin).**
- Toolbar: search box (debounced 300 ms), role filter (All + five roles), "Add from directory" button.
- Table: Name (with login name under it), Department, Roles (chips), Status (Active / Blocked; "Not signed in yet" when `hasSignedIn` is false), Last sign-in (WAT). Paging (20 per page).
- Row click → side panel:
  - Roles: chips, each with a remove (×) button except **Requester** (no remove; tooltip "Every staff member is a Requester"). Remove asks for confirmation.
  - "Give a role": select of roles the person does not hold → Give.
  - Status: "Block access" / "Allow access" with confirmation ("Blocking signs them out everywhere").
  - Every result shows the API `message` as a toast; 400/404/409 messages shown as they come.
- "Add from directory": dialog with a search box → results list → "Add" → toast "Account created" (or "Already has an account") and open that person's panel. If search answers 503, show the API message in the dialog ("AD is not set up yet" is expected in development).

**Email (`/admin/email`, SuperAdmin).** Status card: provider, ready (green tick / orange warning), sender name and address, "API key set: yes/no" (never a key). "Send a test email" form (address) → show `{ success, message }`.

**No access** (`/no-access`) and **Not found** (`*`): simple card, link home.

## 7. Tests (vitest + Testing Library)

At least:
1. HTTP client: CSRF header on POST/PATCH/DELETE and not on GET; one 401 triggers exactly one refresh even with three requests in parallel; a 403 "Security check failed" refetches the token and retries once.
2. Sign-in page: shows the API message on 401; redirects to `next` on success.
3. Sidebar: a Requester sees no Administration; a SuperAdmin does.
4. RequireRole: signed-out → login; wrong role → no-access.
5. People page: renders role chips; no remove button on Requester; a 409 message appears as a toast.
6. Bell: a pushed notification increases the count and appears first.
7. `formatWat` turns `2026-11-02T14:42:00Z` into a 15:42 WAT text.

Mock the API with a small fake axios adapter or MSW; no real network in tests.

## 8. Before you start, and when you finish

Before: with the API running, fetch `http://localhost:5048/swagger/v1/swagger.json` (the http profile; no certificate trouble) and save it as `docs/swagger.json`. That saved copy is the contract: `npm run check` (`check:api`) reads it, so checks work offline and record what FE-0 was built against. Keep People Hub's `check:api:live` too, pointed at `http://localhost:5048/swagger/v1/swagger.json`, to compare against the running API. If the API is not running, ask the user to start it (from `Backend\ServiceDesk\ServiceDeskAPI\ServiceDeskAPI`: `dotnet run --launch-profile https`).

When finished, write `docs/fe/FE-0-report.md` (in `PRO\AccessServiceDesk\Backend\ServiceDesk\docs\fe`): what was built, files, how to run (`npm install`, `npm run dev`, open http://localhost:5174), test count, the `npm run check` result, and any questions for the backend.

Manual checks (API running, `npm run dev`):
1. Sign in as `test.caseworker1` → Home shows Case Worker and Requester; no Administration menu.
2. Sign in as `test.superadmin` → People and roles: give `test.requester` the Head of Unit role → toast; the bell of `test.requester` (other browser) shows the notification live.
3. Try removing Requester → not offered. Try blocking yourself → API message shown.
4. Email page shows Infobip ready; a test email arrives.
5. Leave the tab 16 minutes, click something → still works (silent refresh).
6. Sign out → back to sign-in; the back button does not show private pages.
