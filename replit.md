# COGS Tracker

A web-based daily Cost-of-Goods-Sold (COGS) tracker for project managers running multi-site
service contracts (catering, cleaning, security, transport, etc.).

## What it does

- Tracks daily mandays + service costs per project.
- Food services use a meal-weighted manday formula:
  `breakfast × 0.2 + (lunch + dinner + midnight + meal box) × 0.4`
- Standard services use a flat daily cost.
- Cost-per-manday = total cost / total mandays (gracefully handles 0 mandays).
- Dashboard with today / week-to-date / month-to-date KPIs, a 30-day trend, and service +
  project breakdowns.
- Filtered, exportable cross-project reports and per-project summaries.
- Admin / User roles. Admins see everything; users see only projects they're explicitly granted
  access to.
- **Security field** (key feature): each project has a per-user access list. Admins decide who
  can view that project's summary report and who can edit its daily entries.

## Architecture

Monorepo (pnpm workspaces). Three artifacts:

- `artifacts/api-server` — Express API, OpenAPI-generated, Drizzle on Postgres.
- `artifacts/cogs-tracker` — React + Vite + Tailwind v4 + shadcn/ui (this is the user-facing app).
- `artifacts/mockup-sandbox` — design sandbox (workspace tooling; not used by the product).

Shared libs:

- `lib/api-spec` — OpenAPI source of truth (`openapi.yaml`).
- `lib/api-client-react` — Orval-generated React Query hooks + types.
- `lib/api-zod` — Orval-generated Zod schemas (used by the API server for validation).
- `lib/db` — Drizzle schema + push/migrate scripts.
- `lib/replit-auth-web` — `useAuth()` hook for the web frontend.

## Auth

- Replit OIDC via openid-client. Cookie-session, server-side session storage.
- The first user to log in is automatically promoted to `admin`. All others default to `user`.
- Admins can promote/demote users at `/admin/users`.

## Backend route map

- `GET /api/auth/user`, `/api/login`, `/api/logout`, `/api/callback`
- `GET /api/users` (admin), `PATCH /api/users/:id/role` (admin)
- `GET /api/projects`, `POST /api/projects` (admin)
- `GET /api/projects/:id`, `PATCH /api/projects/:id`, `DELETE /api/projects/:id` (admin)
- `GET /api/projects/:id/services`, `POST /api/projects/:id/services` (admin)
- `PATCH /api/services/:id`, `DELETE /api/services/:id` (admin)
- `GET /api/projects/:id/access` (admin), `POST /api/projects/:id/access` (admin)
- `PATCH /api/access/:id` (admin), `DELETE /api/access/:id` (admin)
- `GET /api/projects/:id/entries`, `POST /api/projects/:id/entries`
- `GET /api/entries/:id`, `PATCH /api/entries/:id`, `DELETE /api/entries/:id`
- `GET /api/dashboard`, `GET /api/recent-activity`
- `GET /api/projects/:id/summary` (requires `canViewSummary` for non-admins)
- `GET /api/reports/aggregate`, `GET /api/reports/trends`

## Visibility / authorization rules

- Admin: full access to every project, every entry, every report.
- Non-admin: visible projects = those with a `project_access` record where the user is the
  grantee (any of `canViewSummary` or `canEditEntries`).
  - Project summary report: needs `canViewSummary`.
  - Editing/creating daily entries: needs `canEditEntries`.

## Frontend route map

- `/` — Dashboard (KPIs, trend, breakdowns, recent activity)
- `/projects` — Projects list + create (admin)
- `/projects/:id` — Project detail (entries, services, security tab, settings tab)
- `/projects/:id/summary` — Per-project summary with date range + CSV export
- `/projects/:id/entries/new` — New daily entry
- `/projects/:id/entries/:entryId` — Edit / view daily entry
- `/reports` — Aggregate report with date range + project filter + CSV exports
- `/admin/users` — Admin role management

## Visual identity

Dark navy sidebar with amber/gold primary accents and teal/green secondary chart colors.
Light content area. The app feels like an operations cockpit: dense, tabular, confident.

## Working with this repo

- `pnpm --filter @workspace/api-spec run codegen` — regenerate hooks/zod after editing
  `lib/api-spec/openapi.yaml`. After codegen, also update the explicit type re-export list at
  `lib/api-zod/src/index.ts` if you added new schemas.
- `pnpm --filter @workspace/db run push` — push schema changes to the dev database.
- `pnpm run typecheck` — full repo typecheck.
- Workflows are managed by the platform; do not run `pnpm dev` from the repo root.
