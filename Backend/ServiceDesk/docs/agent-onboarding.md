# Service Desk: Contribution Processing Module — agent onboarding

Read this first. It tells any agent (or developer) joining the project what the system is, how it is built, and the rules of work.

## What the system is

**Access Desk**, the company-wide internal service desk of Access Pensions. Any staff member raises a ticket to a department; each department's work is a **module**. **Contribution Processing is the first module** (BRD v1.3); other departments follow on the same platform, sign-in and roles. The system assigns it automatically, tracks a 20-minute acknowledgement SLA and a 24-hour resolution SLA in business hours, and escalates unresolved tickets to the Head of Unit and then the HOD.

The approved requirements are in `docs/brd/` (BRD v1.3, approved 28–30 October 2026). The BRD is the source of truth for business rules. Requirement IDs (FR-x.y, NFR-x, S1–S15, R1–R9) are used in code comments, tests and commit messages.

## Technology (same as People Hub / ELM)

| Layer | Choice |
|---|---|
| API | ASP.NET Core Web API, .NET 10, one project `ServiceDeskAPI` with folders `Controllers`, `Application/Interfaces`, `Application/DTOs`, `Domain/Entities`, `Domain/Enums`, `Infrastructure/Persistence`, `Infrastructure/Services`, `Infrastructure/Email`, `Infrastructure/Jobs` |
| Data | SQL Server with EF Core code-first migrations. Development database `ServiceDeskDB` on `.\SQLEXPRESS` (Windows sign-in). Automated tests use throwaway LocalDB databases |
| Sign-in | On-prem Active Directory over LDAPS, custom JWT and refresh token (no Entra ID). Copied from People Hub in Step 1 |
| Roles | Requester, CaseWorker, HeadOfUnit, HOD, SuperAdmin (BRD Section 4) |
| Background jobs | Hangfire on SQL Server: acknowledgement check every minute, SLA check every 5 minutes |
| Real-time | SignalR for live queues and in-app notifications |
| Email | Same email module as People Hub (Infobip or SMTP, branded layout) |
| Tests | xUnit, run against LocalDB |
| Frontend | React + Vite, JavaScript (no TypeScript), feature-based folders, same tooling and `npm run check` / `check:api` as People Hub |

## Folder layout

```
PRO\AccessServiceDesk\
  Backend\ServiceDesk\               run every script from here: .\Scripts\<script>.ps1
    ServiceDeskAPI\                  solution root
      ServiceDesk.sln(x)
      ServiceDeskAPI\                the API project
      tests\ServiceDeskAPI.Tests\    xUnit tests
    Scripts\                         step scripts (stepN-*.ps1) and helpers (set-secrets.ps1, ...)
    docs\
      agent-onboarding.md            this file
      build-plan.md                  steps and status
      swagger.json                   saved from the running API
      fe\                            frontend task prompts and design references
  Frontend\                          the React web app (JavaScript)
```

From the frontend folder: docs are `..\Backend\ServiceDesk\docs`, the API solution is `..\Backend\ServiceDesk\ServiceDeskAPI`, People Hub's web app is `..\..\ELM\workforce-hub-web`.

## How work is done

- **Backend changes come as step scripts** (`scripts\stepN-*.ps1`). Each one checks its anchors first, makes the change, builds, runs all tests, and reverts everything if anything fails. Run them from the solution root with the API stopped. Report the test count it prints.
- **The frontend is built by the VS Code agent** from a written task prompt per step. It treats the backend as read-only. The controllers and DTOs in code, and `docs/swagger.json`, are the source of truth for routes and shapes.
- After every backend step that changes routes: start the API once (it applies migrations), save `/swagger/v1/swagger.json` to `docs/swagger.json`, then run `npm run check` in the frontend and report the result.
- `docs/build-plan.md` is updated after every step.

## Rules

1. Business rules come from the BRD. If code and BRD disagree, stop and ask; do not guess.
2. The server decides access. Every endpoint has a policy; the frontend hides what a role cannot do, but never relies on hiding.
3. Customer data (RSA PIN, employer, amounts) never appears in email bodies or logs.
4. All times are stored in UTC and shown in WAT (UTC+1). SLA maths uses business hours (Mon–Fri 08:00–17:00 WAT, excluding the holiday calendar) through one service, `ISlaCalculator`.
5. Escalation and breach recording are idempotent: re-running a job never writes a second event or sends a second email.
6. Every error uses one shape, `ApiError`: `{ message, errors: { field: "what is wrong" } }` (errors may be empty), including the automatic "invalid request" answers. Sign-in endpoints wrap answers in `ApiResponse` (`{ statusCode, message, data, errors }`) for People Hub compatibility. Every action declares its responses with `[ProducesResponseType]`, so `swagger.json` has a schema for each; a test fails otherwise. New endpoints are added to `docs/api/endpoint-inventory.md`.
7. No secrets in source control. Keys live in user secrets or server environment variables.
8. The Service Desk never uses People Hub (ELM) secrets. It has its own JWT signing key, its own AD service account entry, its own email API key and its own database. Code and setting names may be copied from ELM; values may not.
9. Roles: a person can hold several at once. Read them with `RoleAssignments.GetActiveRoleNamesAsync`; grant with `RoleAssignments.EnsureRoleAsync`. Every endpoint uses `[Authorize]` or a policy from `Policies` (Super_Admin_Only, Unit_Management, Department_Oversight, Oversight, Case_Work).
10. Every business change stages its audit entry with `IAuditService.Stage(...)` and saves it in the same `SaveChangesAsync` as the change. `LogAsync` is only for events with nothing else to save (sign-in). Audit rows are never updated or deleted.
11. Notifications: stage with `IInAppNotificationService.Stage(...)` in the same save as the change; the push to the browser happens automatically after the save.
12. The web app sends the CSRF token (from the login/refresh response, the `X-CSRF-Token` response header, or `GET /api/auth/csrf`) in the `X-CSRF-Token` header on every POST, PUT, PATCH and DELETE.
13. Email: never call a provider directly; use `IEmailService`. Wording goes in `EmailTemplates` / `NotificationEmail`, the look comes from `EmailLayout`. A notification staged in a save is emailed automatically after the save. Never put customer data (RSA PIN, employer, amounts) in a notification or email; RSA PIN shapes are masked as a last resort, not as the plan.
14. Platform vs module: sign-in, shell, notifications, administration and email branding never name a department. Departments, units and their people are data (Step 2), never hard-coded, so the next department is added as data plus its own catalogue, not new code paths.
15. Structure roles: Case Worker, Head of Unit and HOD are never given by hand. They follow the organisation (`OrgRoleSync`): an active member of an active unit is a Case Worker; a unit head or deputy is a Head of Unit; a department's HOD is HOD. Change the structure (Administration > Units) and the roles follow in the same save. The People page gives only Super Admin; Requester is everyone's. A person is in at most one unit per department; a head is also a member of their unit; an HOD is never a member of a unit in their own department.
16. Office dates: anything by calendar day (leave now; SLA working days later) uses the Lagos office date from `IAvailabilityService.Today()` (UTC+1, no daylight saving), never `DateTime.Now` or the server's time zone. Store instants as UTC `DateTime`, whole days as `DateOnly` (`yyyy-MM-dd` in JSON).

## Secrets and sign-in (Development)

- `set-secrets.ps1` (run from `PRO\AccessServiceDesk\Backend\ServiceDesk`) makes a new JWT key and test-account password and asks for the Service Desk's own AD settings. They go to this computer's user secrets for ServiceDeskAPI.
- On a server: `SERVICEDESK_JWT_SECRET_KEY`, `SERVICEDESK_LDAP_USERNAME`, `SERVICEDESK_LDAP_PASSWORD`. People Hub's `JWT_SECRET_KEY` and `LDAP_SERVICE_*` are never read.
- Without AD settings, Development still starts: AD sign-in is off and the test accounts work (`test.requester`, `test.caseworker1`, `test.caseworker2`, `test.hou`, `test.hod`, `test.superadmin`). Production refuses to start.
- Tokens travel in HttpOnly cookies named `__Host-sd-accessToken` / `__Host-sd-refreshToken` (HTTPS) or `__Secure-sd-*` (HTTP in Development). The web app sends `credentials: 'include'` and refreshes through one shared promise (never two refreshes at once).
