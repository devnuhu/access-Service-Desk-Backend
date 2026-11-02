# Access Desk API: endpoint inventory

Source of truth for shapes: `docs/swagger.json` (saved from the running API). This list says **who** may call each endpoint and **why**.
Errors always use `{ message, errors: { field } }` (ApiError); the sign-in endpoints wrap their answers in `ApiResponse` (`{ statusCode, message, data, errors }`).
Changes (POST, PUT, PATCH, DELETE) from the web app carry `X-CSRF-Token`; Swagger and scripts that use a Bearer header do not need it.

| Method | Route | Who | Purpose |
|---|---|---|---|
| GET | `/api/health` | anyone | Liveness |
| POST | `/api/auth/login` | anyone | Sign in (AD or Development test account); sets the HttpOnly cookies and returns the CSRF token. 10 per minute per IP |
| POST | `/api/auth/refresh` | anyone with the refresh cookie | New tokens; the old refresh token stops working. 30 per minute per IP |
| GET | `/api/auth/me` | signed in | The person, their roles, unread count |
| GET | `/api/auth/csrf` | signed in | A fresh CSRF token (after a page reload) |
| POST | `/api/auth/logout` | anyone | Revokes the refresh token, clears the cookies |
| GET | `/api/notifications` | signed in | Own notifications, paged |
| GET | `/api/notifications/unread-count` | signed in | Own unread count |
| PATCH | `/api/notifications/{id}/read` | signed in (own only) | Mark one read (204) |
| PATCH | `/api/notifications/read-all` | signed in | Mark all own read |
| (hub) | `/hubs/notifications` | signed in | Live `ReceiveNotification`; `Ping` |
| GET | `/api/admin/users` | Super Admin | People with roles; search, role filter, paging |
| GET | `/api/admin/users/{userId}` | Super Admin | One person |
| GET | `/api/admin/roles` | Super Admin | The five roles |
| POST | `/api/admin/users/{userId}/roles` | Super Admin | Give a role (409 if held). Only Super Admin can be given here; Case Worker, Head of Unit and HOD follow the organisation (400) |
| DELETE | `/api/admin/users/{userId}/roles/{roleId}` | Super Admin | Take a role away (history kept; not Requester; not a structure role; not the last Super Admin) |
| PATCH | `/api/admin/users/{userId}/status` | Super Admin | Block / unblock (blocking ends sessions; not yourself; not the last Super Admin) |
| GET | `/api/admin/departments` | Super Admin | Departments with HOD and units (switched-off ones included) |
| POST | `/api/admin/departments` | Super Admin | New department (code 2-10 of A-Z, 0-9, -; code and name unique) |
| PATCH | `/api/admin/departments/{id}` | Super Admin | Rename / switch on or off (off only when all its units are off) |
| PUT | `/api/admin/departments/{id}/hod` | Super Admin | Set or clear the HOD (not a member of a unit in this department) |
| POST | `/api/admin/departments/{id}/units` | Super Admin | New unit in a department |
| PATCH | `/api/admin/units/{id}` | Super Admin | Rename / switch on or off (off only when it has no members) |
| PUT | `/api/admin/units/{id}/head` | Super Admin | Set or clear the head (added as a member; the old head stays as an employee) |
| PUT | `/api/admin/units/{id}/deputy` | Super Admin | Set or clear the deputy (must be a member, not the head) |
| GET | `/api/admin/units/{id}/members` | Super Admin | Current members |
| POST | `/api/admin/units/{id}/members` | Super Admin | Add a member (one unit per department; 409 if already in one) |
| DELETE | `/api/admin/units/{id}/members/{userId}` | Super Admin | Remove a member (history kept; not the head or deputy - change those first) |
| GET | `/api/org/me` | signed in | My departments and units, with what I lead (builds the menu) |
| GET | `/api/org/departments` | signed in | Active departments and units (names only) |
| GET | `/api/directory/users/search` | Super Admin, Head of Unit | AD staff search (503 when AD is not set up) |
| POST | `/api/directory/users/ensure` | Super Admin | Add a person from AD before their first sign-in |
| GET | `/api/admin/email/status` | Super Admin | Email provider status (never a key) |
| POST | `/api/admin/email/test` | Super Admin | Send a test email |
