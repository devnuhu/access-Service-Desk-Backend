# Service Desk: Contribution Processing Module — build plan

Source: BRD v1.3 (approved), Section 14. Backend first, then the frontend against the published Swagger contract. Every step ends with all tests passing.

| Step | Deliverable | Exit criteria | Status |
|---|---|---|---|
| 0 | Solution scaffold (People Hub layout and package versions), tests, scripts, docs, git | Build OK; 1 smoke test passes | Done 2 Nov 2026 (API crashed on start, fixed in 0a) |
| 0a | Fix start-up crash: remove the template's Microsoft.AspNetCore.OpenApi (pulls Microsoft.OpenApi 2.x, breaks Swashbuckle 6.4); Swagger via Swashbuckle like ELM | API starts; /swagger and /api/health respond | Done 2 Nov 2026 (1 test, Microsoft.OpenApi 1.2.3) |
| 0b | Inventory of People Hub plumbing (`collect-elm-plumbing.ps1`) | `docs/elm-plumbing.txt` sent for review | Done 2 Nov 2026 (67 plumbing files, 18 test helpers) |
| 1a | Users, roles (several per person, 5 BRD roles seeded), AD sign-in (People Hub LdapAuthService), JWT, cookies, refresh rotation, logout revoke, policies, test accounts, `set-secrets.ps1` | Tests pass; test.caseworker1 signs in with Requester + CaseWorker; /api/auth/me works | Done 2 Nov 2026 (21 tests pass; secrets set, AD settings to be added later with `set-secrets.ps1 -LdapOnly`) |
| 1b | Audit log (append-only; sign-in, failed sign-in, sign-out audited), security headers, rate limits (login, refresh), CSRF for cookie sign-in, in-app notifications, SignalR live push | Tests pass; a saved notification reaches the recipient's browser live | Done 2 Nov 2026 (37 tests pass) |
| 1c | Email: Infobip / SMTP / Off (Off until set up), People Hub branded layout, email copy of every saved notification, RSA PIN guard, Super Admin email status and test | Tests pass; with real sender details, the Super Admin test email arrives | Done 2 Nov 2026 (48 tests pass). Provider Infobip; Service Desk key and sender via `set-secrets.ps1 -Email` |
| 1d | Super Admin user and role management (give / take away roles, block / unblock), AD staff search, add from directory before first sign-in, `make-first-super-admin.ps1` | Tests pass; a Contribution Processing user signs in with AD credentials (when the Service Desk AD settings are in) | Done 2 Nov 2026 (67 tests pass). Step 1 complete; AD settings and the first real Super Admin wait for ICT's service account |
| 2 | Units, heads, case workers, skills matrix, availability (BRD Section 5) | Contribution Matching and Refund set up with heads and mapped case workers | |
| 3 | Catalogue: 22 categories and configurable fields (Section 7) | 22 categories seeded | |
| 4 | Ticket raise, view, comment, attachments (M2, M4) | Any staff member raises and tracks a ticket | |
| 5 | Assignment engine and reassignment (M3) | Scenarios S9–S11 pass; every assignment logged with scores | |
| 6 | Workflow: acknowledge, pending, resolve, confirm, reopen, cancel (Section 8) | S12, S15 pass; requester confirms or reopens | |
| 7 | SLA engine, Hangfire jobs, acknowledgement SLA, escalation L1/L2 (M5, Section 9) | S1–S8, S13, S14 pass | |
| 8 | Notifications: email + SignalR, reminders, digests (M6) | Every event delivered once; no notification on an acknowledgement miss | |
| 9 | Dashboards, reports R1–R9, Excel export, audit (Section 13, M10) | R1–R9 match test data; export equals screen | |
| 10 | Security hardening, pen test, UAT, training, go-live | No High findings open; UAT sign-off; 2 weeks hypercare | |
| FE-0 | Access Desk web app in `PRO\AccessServiceDesk\Frontend` (People Hub tooling): sign-in, shell, role menus, live bell, People and roles, Email | `npm run check` passes; manual checks in `docs/fe/FE-0-scaffold.md` | Prompt ready (`docs/fe/FE-0-scaffold.md`), for the VS Code agent |

## Decisions log

| Date | Decision |
|---|---|
| 2 Nov 2026 | Solution at `PRO\ServiceDesk`, laid out like People Hub. Shared plumbing copied from ELM. Frontend in JavaScript like People Hub (the BRD's "TypeScript" to be corrected in the next change request). |
| 2 Nov 2026 | No ELM password, key or secret is used. The Service Desk gets its own JWT key, AD service account entry, email key and database. The inventory copies ELM setting names only. |
| 2 Nov 2026 | Step 1 split into 1a–1d. A person may hold several active roles (unique per user and role while active, not one per user as in People Hub). First sign-in gives Requester. No Employee record. |
| 2 Nov 2026 | Separation from People Hub at run time: own JWT issuer/audience (`ServiceDeskAPI` / `ServiceDeskWeb`), own cookie names (`__Host-sd-*`, `__Secure-sd-*`; browsers share cookies across ports, so the People Hub names would sign people out of the other app), own environment variables (`SERVICEDESK_JWT_SECRET_KEY`, `SERVICEDESK_LDAP_USERNAME`, `SERVICEDESK_LDAP_PASSWORD`), own user-secrets id. |
| 2 Nov 2026 | Hardening over People Hub: logout revokes the refresh token; a refresh token used twice (after 30 s) ends all of that person's sessions; the hard-coded fallback signing key in People Hub's GetPrincipalFromExpiredToken was not copied. Identity uses AddIdentityCore (no Identity cookie scheme). Frontend dev URL `http://localhost:5174` so it can run next to People Hub on 5173. |
| 2 Nov 2026 | Step 1b changes from People Hub: CSRF switched on (People Hub had the middleware but never used it) with one token per sign-in, checked only for cookie-signed changes; audit LogAsync writes through its own context and failures go to the log; AppDbContext refuses updates and deletes of audit rows; security headers in every environment; notifications pushed by a save interceptor (same pattern as People Hub's mail interceptor). |
| 2 Nov 2026 | Step 1c: the HR-specific email methods of People Hub were left out; IEmailService has send and send-with-attachments only. The Service Desk's own Infobip key comes from user secrets or `SERVICEDESK_INFOBIP_API_KEY` (never `INFOBIP_API_KEY`); SMTP has no built-in host. Default footer address `servicedesk@accesspensions.ng` (EmailSettings:Brand:SupportEmail) to be confirmed. |
| 2 Nov 2026 | Step 1d: roles are given and taken away one at a time (POST / DELETE), history kept. Requester cannot be removed (block the account instead); the last Super Admin cannot lose the role or be blocked; blocking ends the person's sessions. Staff search open to Super Admin and Heads of Unit. The first Super Admin on a server is set with `make-first-super-admin.ps1` (Windows sign-in to SQL Server, audited). |
| 2 Nov 2026 | Development database is `.\SQLEXPRESS` (ServiceDeskDB); tests stay on throwaway LocalDB databases. App name in the UI and emails: **Access Desk** (BRD title to change in the next change request). Own email design (navy header, two-tone wordmark, green/orange/navy band). Web app on port 5174 next to People Hub on 5173. |
| 2 Nov 2026 | **Access Desk is the company-wide service desk; Contribution Processing is its first module.** Sign-in, shell, notifications, admin and email branding are department-neutral ("Service Desk · Access Pensions"). Step 2 models departments and units as data so other departments join without new code. |
| 2 Nov 2026 | Frontend lives in `PRO\AccessServiceDesk\Frontend` (not under `PRO\ServiceDesk`). Its `check:api` reads `..\..\ServiceDesk\docs\swagger.json`. |
