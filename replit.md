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
  can view that project's summary report, who can edit its daily entries, and who can reset an
  entry to draft.
- **Security groups**: reusable named permission templates (e.g. "Site Manager") live in
  `security_groups` and are managed at `/admin/security-groups`. Each `project_access` row
  has a nullable `security_group_id`; the user's effective permission is the **OR-merge** of
  the group's flags and the row's own "extra" flags. Group changes propagate live (no
  snapshot) and deletion is blocked while any access row references it (`409`). Backend
  authorization (`getProjectVisibility`, `listVisibleProjects`) does the OR-merge; the
  `/projects/:id/access` response surfaces both the row flags and `effectiveCan*` fields.
- **Sequential approval** with a **per-project, reorderable approval chain** (default
  `OP → SOP → COO → CC → Additional`). Admins reorder freely on the *Approvers* tab; the chain
  lives in `project_approval_chain` and is exposed as `project.approvalChain`. Each position
  can be assigned to one or more users; only assigned users (or admins) can approve at that
  position. The last position locks the entry.
- **Reset to draft**: admins, or users with the per-project `canResetApproval` permission, can
  unlock and clear all approvals on any entry. The action is fully audited.
- **Audit log**: every entry create / update / delete / approve / reject / reset is recorded in
  `entry_audit_log` and surfaced in the entry's *History* panel. Audit rows are never deleted —
  the FK to `daily_entries` is `ON DELETE SET NULL` so history outlives the entry.
- **Project sequence numbers**: every daily entry gets a per-project sequence like
  `ACME-0001`. The prefix is `projects.code` (admin-set on the Settings tab) or a slug of the
  project name when blank. Allocation is race-safe via `MAX(seq)+1` retried on the
  `(project_id, sequence_number)` unique-index conflict.

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
- `GET /api/security-groups` (admin), `POST /api/security-groups` (admin)
- `PATCH /api/security-groups/:id` (admin), `DELETE /api/security-groups/:id` (admin, blocks 409 if in use)
- `GET /api/projects/:id/entries`, `POST /api/projects/:id/entries`
- `GET /api/entries/:id`, `PATCH /api/entries/:id`, `DELETE /api/entries/:id`
- `POST /api/entries/:id/approve`, `POST /api/entries/:id/reject` (assigned approver or admin)
- `POST /api/entries/:id/reset` (admin or `canResetApproval`)
- `GET /api/entries/:id/audit`
- `GET /api/projects/:id/approvers`, `PUT /api/projects/:id/approvers` (admin)
- `GET /api/projects/:id/approval-chain`, `PUT /api/projects/:id/approval-chain` (admin, reorder only)
- `GET /api/services` — services across visible projects (Reports filter)
- `GET /api/dashboard`, `GET /api/recent-activity`
- `GET /api/projects/:id/summary` (requires `canViewSummary` for non-admins) — accepts
  `from`, `to`, and `serviceIds` CSV. When `serviceIds` is set, mandays are recomputed from
  the chosen services' cost rows (same semantics as `/reports/aggregate`).
- `GET /api/reports/aggregate`, `GET /api/reports/trends` — both accept `projectIds` and
  `serviceIds` CSV filters; service filter recomputes mandays from filtered cost rows.
  `aggregate.serviceBreakdown` is now keyed by `(projectId, serviceId)` and includes
  `projectName`, `serviceId`, and `costPerManday` so the UI can show a real per-(project ×
  service) table.
- `GET /api/reports/service-entries?from&to&projectIds&serviceIds` — drill-down endpoint
  used by the Reports/Project Summary "Services breakdown" table. Returns one row per
  (entry × service) with project name, service name, location, sequence code, cost,
  manday contribution and SAR/manday. Visibility = projects with `canViewSummary`.
- `GET /api/reports/projects/:id/entry-matrix?from&to` — returns the project's services
  and every entry in the date range with sparse `costs[]` keyed by serviceId, plus
  per-service totals. Powers the `/reports/entry-wise` pivot. Requires `canViewSummary`
  on the project (or admin).

## Visibility / authorization rules

- Admin: full access to every project, every entry, every report.
- Non-admin: visible projects = those with a `project_access` record where the user is the
  grantee (any of `canViewSummary` or `canEditEntries`).
  - Project summary report: needs `canViewSummary`.
  - Editing/creating daily entries: needs `canEditEntries`.

## Frontend route map

- `/` — Dashboard. Month-to-date only: 4 KPI cards (cost, mandays, SAR/manday, entries),
  a month-to-date trend line, plus service- and project-comparison bar charts.
- `/projects` — Projects list + create (admin)
- `/projects/:id` — Project detail (entries, services, security tab, settings tab)
- `/projects/:id/summary` — Per-project summary with date range + CSV export
- `/projects/:id/entries/new` — New daily entry
- `/projects/:id/entries/:entryId` — Edit / view daily entry
- `/reports` — Aggregate report with date range + project filter + CSV exports
- `/reports/entry-wise` — Single-project pivot: services laid out horizontally as
  (Cost / Mandays / Avg) column groups per entry. Per-service and per-metric column
  toggles, footer totals, per-row Entry total + grand total column, frozen
  `#`/Date/Location columns, click any cell to drill into that service's entries,
  and styled .xlsx export with frozen panes (project name, date range,
  generated-at header).
- `/reports/comparison` — Cross-project pivot: rows = projects, column groups =
  services collapsed by service NAME (Cost / Mandays / Avg per service), plus a
  Project total column and a Totals row across projects. Date range + project +
  service multi-select filters, metric toggles, frozen Project/Location columns,
  styled .xlsx export.
- `/admin/users` — Admin role management
- `/admin/security-groups` — Admin security-group templates (create / edit / delete)

## Visual identity

Light SAR/QNC theme: white sidebar with colored nav icons (sky/amber/emerald/violet), blue
primary accents, soft pastel content background. Sidebar collapses to a 64-px rail and is
**sticky** (`sticky top-0 h-screen`) so it stays visible while the main column scrolls; the
collapsed/expanded state persists in `localStorage` under `qnc-sidebar-collapsed`. Daily-entry
rows on the Project Summary and project rows on the Reports page are clickable and use
wouter's `useLocation` to navigate without a full page reload.

## Working with this repo

- `pnpm --filter @workspace/api-spec run codegen` — regenerate hooks/zod after editing
  `lib/api-spec/openapi.yaml`. After codegen, also update the explicit type re-export list at
  `lib/api-zod/src/index.ts` if you added new schemas.
- `pnpm --filter @workspace/db run push` — push schema changes to the dev database.
- `pnpm run typecheck` — full repo typecheck.
- Workflows are managed by the platform; do not run `pnpm dev` from the repo root.
