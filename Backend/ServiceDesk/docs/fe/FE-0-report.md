# FE-0 report: Access Desk web app scaffold

**Date:** 2 November 2026 · **Folder:** `PRO\AccessServiceDesk\Frontend` · **Built against:** `docs/swagger.json`, saved from `http://localhost:5048/swagger/v1/swagger.json` on 2 November 2026

## Result

| Check | Result |
|---|---|
| `npm run check` | **Passes**: lint, Prettier check, tests, `check:api` and build |
| Tests | **63 passed** in 10 files |
| `check:api` | 19 endpoints in 4 files, 20 access rules: **0 mismatches, 8 warnings** (gaps in swagger, listed under "Questions for the backend") |
| Build | Passes. Vite warns that the JS bundle is larger than 500 kB (591 kB, 183 kB gzipped). Splitting by route can wait until more screens exist. |
| Live smoke test | Dev server on 5174. Through the proxy: `/api/health` 200, `/api/Auth/me` 401 without a session, wrong-password login returns the API message, and hub negotiate is 401 without a cookie. |

**Manual checks 1–6 have not been run yet.** They need test-account passwords, which are in user secrets and were not read. Run them as listed in FE-0 section 8.

## Before the manual checks: the sign-in reference is missing

`docs/fe/login-reference.html`, `login-desktop.png` and `login-mobile.png` **do not exist**. The `docs/fe` folder did not exist before this report, and no copy was found under `Desktop`, `Downloads` or `Documents`. I built the sign-in page from the written description in FE-0 section 6, which covers:

- the layout and breakpoints
- the wording given in the spec
- the states (errors, busy, dev-only line)
- the logo badge, divider, wordmark, rings and bottom band

The spec says only "one line of text" and "three points with small icons", so I wrote that wording myself. It is in `src/features/auth/components/LoginBrand.jsx`:

- Line: "Raise a request with any department and follow it from the moment it is logged until it is resolved."
- Points: "Goes straight to the team that handles it", "Response and resolution times you can follow", "Updates the moment anything changes".

**Action:** add the reference files to `docs/fe/`, then compare the page with them. Spacing and that wording may need small changes.

*Superseded:* the page was rebuilt to the final approved design. See "Sign-in page update" at the end.

## What was built

1. **Sign-in page** (`/login`):
   - Desktop: two panels. Phone (under 1024px): a navy top band, then the form.
   - Zod validation for both fields, focus on Username on load, Show/Hide password.
   - Busy state: spinner and "Signing in…".
   - Errors in a red box that takes focus: the API message on 401, a fixed text on 429, "cannot be reached" on network or 5xx errors.
   - Test-account names listed in development only.
   - `next` is followed only when it is a local path (`//host` and `/\host` are refused).
2. **App shell:**
   - Navy header: company logo and wordmark, notification bell, user menu (name, department, role chips, Sign out).
   - Sidebar built from data in `src/layouts/navigation.js`:
     - everyone: Home; My requests (coming soon)
     - CaseWorker, HeadOfUnit, HOD and SuperAdmin: a "Contribution Processing" section with Work queue (coming soon)
     - HeadOfUnit, HOD and SuperAdmin: Reports (coming soon)
     - SuperAdmin: Administration (People and roles, Email)
   - Under 1024px the sidebar becomes a drawer behind a menu button.
   - There is a skip link.
3. **Route guard** `RequireRole roles={[...]}`: signed out → `/login?next=…`; signed in without the role → `/no-access`.
4. **Notification bell:**
   - Shows the 10 latest notifications, with a colour per type, an unread dot, the message trimmed to 2 lines and the time in WAT.
   - Clicking one marks it read, then follows `deepLinkUrl` (local paths only).
   - "Mark all as read". The count shows 99+ above 99.
   - Live updates through SignalR at `/hubs/notifications` (cookie sign-in, automatic reconnect): a new notification goes to the top of the list, raises the count and shows a toast. The list is refetched after a reconnect.
   - The connection stops when the shell unmounts, which happens on sign-out.
5. **Home:** "Welcome, <first name>", department and job title, role chips, and one card per role held.
6. **People and roles** (`/admin/people`, SuperAdmin):
   - Search (300 ms debounce), role filter, 20 people per page.
   - Table: name with login name, department, role chips, Active/Blocked, "Not signed in yet", last sign-in in WAT.
   - Side panel:
     - Role chips with a remove button, except Requester, which has the tooltip "Every staff member is a Requester".
     - "Give a role" select.
     - Block access / Allow access, with a confirm step ("Blocking signs them out everywhere").
   - Every result is shown as a toast with the API message.
   - "Add from directory" dialog: search, then Add. It shows "Account created" or "Already has an account", then opens that person's panel. A 503 shows the API message inside the dialog.
7. **Email** (`/admin/email`, SuperAdmin): status card (provider, ready or not, sender, "API key set: Yes/No"; the key itself is never shown) and a test-email form that shows `{ success, message }`.
8. **No access** and **Not found** pages.

### Security rules (FE-0 section 4)

All of this is in `src/shared/lib/http/client.js`:

- `withCredentials: true`. No `Authorization` header is ever sent; the client removes one if code adds it.
- Tokens are never read or stored. `check:api` fails if the login or refresh schema names `accessToken`/`refreshToken`, or if the app sends `refreshToken` in a body.
- CSRF token in memory only (`csrf.js`). It comes from the login or refresh body, and from any `X-CSRF-Token` response header. After a reload it is fetched with `GET /api/Auth/csrf` once `/me` succeeds. It is sent on POST, PUT, PATCH and DELETE. A 403 "Security check failed" fetches a new token and retries once.
- A 401 triggers one refresh, shared by all requests that failed at the same time. A request that fails after a refresh has finished is retried without refreshing again, using a refresh counter. If refresh fails, the session is cleared from the query cache and the guard sends the person to `/login?next=…`.
- Refresh is sent with no body (the cookie carries the token). I checked this against the API: a refresh with no body and no cookie answers 400 "Refresh token is required.", not 415.

### Look

Tailwind 4 `@theme` tokens in `src/index.css`:

- Colours: navy `#003883`, orange `#ff8200`, green `#8DC63F`, ink, body, muted, line, page.
- Darker "-ink" shades of green and orange for text on white, so contrast meets AA.
- System font stack; orange focus ring everywhere.
- Primary button: navy with a 3px orange bottom edge. Secondary: white with navy text. Danger: red outline.
- Dialogs keep focus inside and close on Escape. The top dialog wins when a confirm sits over the side panel.
- Toasts sit in an `aria-live` region.
- `formatWat()` in `src/shared/lib/time.js` uses Africa/Lagos, so `2026-11-02T14:42:00Z` shows as "Mon 2 Nov 2026, 15:42 WAT".

## Tooling copied from People Hub (`ELM/workforce-hub-web`)

| What | How it was copied |
|---|---|
| `package.json` scripts and versions | Name `access-desk-web`. Only the dependencies FE-0 uses, plus `@microsoft/signalr` 9.0.19 (the latest 9.x). pdfjs-dist, recharts and react-is dropped. |
| `eslint.config.js`, `jsconfig.json`, `.prettierrc.json`, `.prettierignore`, `src/test/setup.js` | As is |
| `.gitignore` | People Hub's, without the staging-file lines |
| `vite.config.js` | `server.port: 5174`, `strictPort: true`, proxy `/api` and `/hubs` (WebSocket) to `API_PROXY_TARGET` |
| `scripts/check-api.js`, `check-api.test.js`, `api-access.js` | Point at `../Backend/ServiceDesk/docs/swagger.json`. Access table rebuilt from the Service Desk controllers and `Policies.cs`. ELM rules removed; Service Desk rules added (never read tokens, never send `refreshToken`). Environment variables renamed to `SD_*`. `check:api:live` defaults to `http://localhost:5048`. |
| `src/shared/lib/http/*` | Adapted for cookies, CSRF and the shared refresh. `apiError.js` adds 409 and 429. |

Nothing else was copied: no `.env` file, key, password, server address or logo. `.env.development` and `.env.example` were written new, with no secrets.

## Files

All under `Frontend/`:

- **Config:** `package.json`, `vite.config.js`, `eslint.config.js`, `jsconfig.json`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.env.development`, `.env.example`, `index.html`, `README.md`, `public/favicon.svg`
- **Scripts:** `scripts/check-api.js`, `scripts/check-api.test.js`, `scripts/api-access.js`
- **`src/app`:** `App.jsx`, `queryClient.js`, `setupHttp.js`. Also `src/main.jsx` and `src/index.css`.
- **`src/routes`:** `AppRoutes.jsx`, `StatusPages.jsx`
- **`src/layouts`:** `AppLayout.jsx`, `Sidebar.jsx` (+ test), `UserMenu.jsx`, `navigation.js`
- **`src/shared/lib`:** `env.js`, `time.js` (+ test), `roles.js`, `zodResolver.js`, `http/` (`client`, `apiError`, `endpoint`, `csrf`, `apiClient`, `index`, + tests)
- **`src/shared/hooks`:** `useDebouncedValue.js`, `useMediaQuery.js`
- **`src/shared/ui`:** `Button`, `Card`, `Chip`, `RoleChips`, `Spinner`, `Dialog`, `ConfirmDialog`, `MessageCard`, `toast/`, `brand/` (`logo.js`, `CompanyLogo`, `Wordmark`, `BrandLockup`)
- **`src/assets/brand`:** `access-pensions-logo.svg` (placeholder)
- **`src/features`:**
  - `auth`: `api/endpoints.js`, `policies.js`, `session.js`, hooks, `RequireRole` (+ test), `LoginBrand`, `LoginPage` (+ test)
  - `notifications`: endpoints, `hub.js`, hooks, `NotificationBell` (+ test)
  - `admin-people`: endpoints, hooks, `PersonPanel`, `AddFromDirectoryDialog`, `PeopleRolesPage` (+ test)
  - `admin-email`: endpoints, `EmailPage`
  - `home`: `HomePage`
- **`src/test`:** `setup.js`, `fakeApi.js` (fake axios adapter; no network), `render.jsx`

## How to run

```
cd PRO\AccessServiceDesk\Frontend
npm install
npm run dev          # open http://localhost:5174 (the API must be running on http://localhost:5048)
npm run check
```

## How to add the real logo

**Done (2 November 2026).** At the user's request, `src/assets/brand/access-pensions-logo.png` is now the real Access Pensions logo. It is a full-colour PNG (2046×769, 595 kB), taken from People Hub's `public/access_logo.png`. The placeholder SVG was removed. To replace it later (for example with a smaller or SVG version), follow the same steps:

1. Put the logo file in `Frontend/src/assets/brand/`, for example `access-pensions-logo.png`.
2. Change the one line in `Frontend/src/shared/ui/brand/logo.js`:
   `export { default as logoUrl } from "@/assets/brand/access-pensions-logo.png";`
3. Delete the placeholder `access-pensions-logo.svg`.

Every screen uses `<CompanyLogo />`, which reads `logoUrl` from that file. A full-colour logo sits on the white badge (the default). For a white version on navy, use `<CompanyLogo badge={false} />` in `src/shared/ui/brand/BrandLockup.jsx`.

## Notes and decisions

- **The BRD is missing too:** `docs/brd/` is empty, so I wrote the one-line role cards on Home from `agent-onboarding.md` and FE-0, with no department names. They are in `src/features/home/pages/HomePage.jsx`. Check them against BRD Section 4.
- `/api/Auth/me` has no `firstName`, so "Welcome, <first name>" uses the first word of `fullName`.
- `VITE_API_BASE_URL` left unset means same origin. People Hub's `env.js` throws instead, but no production env file exists, so the built app would fail at start-up.
- Swagger names the auth routes `/api/Auth/...` with a capital A. The endpoints use that exact spelling; the routes are not case-sensitive.

## Questions for the backend

1. **Responses with no schema in swagger.** `check:api` cannot compare 7 endpoints:
   - `GET /api/admin/email/status`
   - `POST /api/admin/email/test`
   - `POST /api/admin/users/{userId}/roles`
   - `DELETE /api/admin/users/{userId}/roles/{roleId}`
   - `PATCH /api/admin/users/{userId}/status`
   - `GET /api/notifications/unread-count`
   - `PATCH /api/notifications/read-all`

   They return anonymous objects or `IActionResult`. Could they get typed DTOs or `[ProducesResponseType]`? The frontend schemas follow the controller code for now.
2. **`PATCH /api/notifications/{id}/read`** returns **204** in code, but swagger says 200. Swagger also omits the 404, 409 and 400 answers on the admin routes.
3. **Error shape (rule 6).** Rule 6 says `{ message, errors: { field } }`. `ApiResponse.errors` (used by AuthController) is `string[]`, and the admin and directory controllers send `errors` as `{ field: "text" }` (a string, not an array). Which one is the contract? The frontend reads all of these shapes.
4. **`/api/Auth/me` has no `firstName`/`lastName`**, but the login and refresh `user` has them. Could `UserProfileDto` include them, so the greeting does not have to guess from `fullName`?
5. **Swagger documents a `RefreshTokenRequest` body on refresh and logout.** The web app sends no body (the cookie carries the token). Should the body stay, for scripts?
6. **`GET /api/health` has neither `[Authorize]` nor `[AllowAnonymous]`** (rule 9). Is anonymous intended? If so, `[AllowAnonymous]` would make that explicit.
7. **Platform naming (rule 14).** `GET /api/health` answers `"app": "Service Desk: Contribution Processing Module"`, which names a department at platform level. Should it be "Access Desk"?
8. **Endpoint inventory.** `check:api` can compare its access table with `docs/api/endpoint-inventory.md` (as People Hub does), but that file does not exist, so `check:api` prints a warning. Will the backend add it?
9. **Development cookies.** In Development the cookies use `SameSite=None; Secure` over plain HTTP. Through the Vite proxy (same origin) browsers accept this on `localhost`. Is `SameSite=None` still needed now that the app uses the proxy?

## Sign-in page update (2 November 2026)

The sign-in page was changed to the final approved design. Nothing else in the app changed. The form, the sign-in behaviour, the error messages and the API calls are unchanged.

**Built from:** the approved design screenshot and the written change list. `login-reference.html`, `login-desktop.png` and `login-mobile.png` are still not in `docs/fe/`. The illustration was not in `docs/fe/` either; it came from `Downloads\service-desk-illustration.svg`. Please put the reference files and the SVG in `docs/fe/` so the next check can use them.

**What changed:**

- **Brand panel:** light instead of navy, using the radial and linear gradient from the design.
  - Logo row: logo on a white badge with a `#D5E2F3` border, `#B9CCE6` divider, "Access" in navy and "Desk" in green on one line, "Service Desk" in `#4A6488`.
  - 32px navy headline, `#3D4A5C` paragraph.
  - Three points in white icon boxes with two-line labels.
  - `#5B7090` legal line.
  - Green / orange / navy band along the bottom.
- **Illustration:** `src/features/auth/components/ServiceDeskIllustration.jsx`, an inline SVG with `role="img"` and its aria-label. The decorative rings are gone.
- **Layout:** the brand panel is a flex column with no absolute positioning: logo row, then the illustration centred (max 440px; 360px between 1024 and 1279px), then headline, paragraph, points and legal line. The points sit in one row at 1280px and wider, and stack between 1024 and 1279px.
- **Desktop (1024px and wider):** the white form panel lies over the brand panel: `margin-left -32px`, 32px left corners, and the two-layer navy shadow.
- **Under 1024px:** the brand panel is a short band with only the logo row (22px wordmark, 44px bottom padding). The form panel slides up over it: `margin-top -20px`, 20px top corners, an upward shadow. On phones the form now starts at the top of its panel instead of being centred vertically.
- **Theme tokens** (`src/index.css`): `login-sky`, `login-sky-deep`, `login-badge-line`, `login-divider`, `login-unit`, `login-icon-line`, `login-legal`, `shadow-login-panel`, `shadow-login-panel-up`, and the `bg-login-brand` utility for the gradient.
- **Tests:** no existing test checked the old colours or rings. One test was added: the illustration is shown with its label, the new headline and points are present, and the rings are gone.

**Result:** `npm run check` passes with 64 tests and 0 `check:api` mismatches. Headless Edge screenshots at 1440px, 1100px and 520px match the design.

**Two choices to confirm:**

- The paragraph uses the screenshot's wording: "Raise a request to any department, follow it to resolution, and see who is working on it, all in one place."
- The plus and clock icons are orange and the check icon is navy, as in the screenshot.
