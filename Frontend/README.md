# Access Desk web app

React + Vite (JavaScript) frontend for Access Desk, the Access Pensions internal service desk.

```
npm install
npm run dev        # http://localhost:5174, proxies /api and /hubs to http://localhost:5048
npm run check      # lint, format check, tests, check:api, build
npm run check:api:live   # compare with the running API (GET only, one role per run)
```

- Project rules: `../Backend/ServiceDesk/docs/agent-onboarding.md`
- API contract: `../Backend/ServiceDesk/docs/swagger.json` (read by `check:api`)
- API routes are declared only in `src/features/<feature>/api/endpoints.js`.
- Tokens live in HttpOnly cookies; the app never stores them. The CSRF token is kept in memory.
- The company logo is imported in one place: `src/shared/ui/brand/logo.js`.
