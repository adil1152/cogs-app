# COGS Tracker

A web-based daily Cost-of-Goods-Sold (COGS) tracker for project managers running multi-site
service contracts (catering, cleaning, security, transport, etc.).

## What it does

- Tracks daily mandays + service costs per project.
- **Food services** have a fully editable per-service meal-type list (`food_meal_items`:
  name + weight fraction + sortOrder). Mandays = Σ(qty × weight). Defaults on create:
  Breakfast 0.2, Lunch/Dinner/Midnight/Meal box 0.4 (or admin-supplied `mealItems`).
  Admins can rename / re-weight / add / remove / reorder meal types **at any time** —
  create form and an expandable editor on the Services tab (`MealItemsEditor`), UI shows
  percent (20) ↔ stores fraction (0.2) via `weightToPercent`/`percentToWeight` in
  `cogs-formula.ts`. Entry rows snapshot name+weight per meal in `meal_cost_entries`
  (`meal_item_id` FK is `ON DELETE SET NULL`), so old entries keep their saved math;
  only new/edited entries pick up current items. On entry save the server resolves each
  `mealQuantities` row: prior snapshot by `mealItemId` → live service item → 400; rows
  with `mealItemId:null` (removed meals, matched by exact saved name) are valid only on
  edit. The entry form shows removed meals with an amber "(removed)" tag.
- Standard services use a flat daily cost.
- **Group services** ("Group services" kind) are admin-defined containers of
  named sub-services. Each sub-service captures its own cost + mandays per
  daily entry; the parent row's totals are the **sums** of its sub-rows. Sub-
  items live in `service_sub_items` and per-entry values in
  `sub_service_cost_entries`. Renames and reorders are always allowed; **add /
  remove of sub-items is locked once any cost entry references the parent
  service** (backend returns 409, UI disables the buttons via the new
  `ProjectService.hasEntries` flag computed in `serializeMany`). The entry
  detail surfaces sub-breakdowns inline on the entry edit page.
- Cost-per-manday = total cost / total mandays (gracefully handles 0 mandays).
- **Enable/disable project**: `projects.disabled` boolean, toggled by admins on the project
  Settings tab. Disabled projects are invisible to all non-admins — even with an explicit
  `project_access` grant — across the list, detail (404), dashboard, and reports (enforced in
  `projectAccess.ts`: `listVisibleProjects` filters them out, `getProjectVisibility` returns
  `project: null`). Admins see everything plus a "Disabled" badge on the list card and the
  detail header. Nothing is deleted; re-enabling restores visibility.
- Dashboard with today / week-to-date / month-to-date KPIs, a 30-day trend, and service +
  project breakdowns.
- Filtered, exportable cross-project reports and per-project summaries.
- Admin / User roles. Admins see everything; users see only projects they're explicitly granted
  access to.
- **Security field** (key feature): each project has a per-user access list. Admins decide who
  can view that project's summary report, who can edit its daily entries, and who can reset an
  entry to draft.
- **Global group membership**: users can be added as *members* of a security group
  (`security_group_members`; managed via the "All-project members" dialog on
  `/admin/security-groups`). Members get the group's flags on **every non-disabled
  project** — no per-project `project_access` rows needed. Enforced in
  `projectAccess.ts` (`getGlobalGroupFlags` OR-merged into both `listVisibleProjects`
  and `getProjectVisibility`; disabled projects stay hidden). Two seeded groups exist:
  "All Projects — Report Viewer" (canViewSummary) and "All Projects — Entry Editor"
  (canEditEntries), created idempotently on API-server startup (`seedGlobalGroups`).
  Group deletion is 409-blocked while it has members OR access rows.
- **Auto-assign groups**: security groups with `autoAssignNewProjects` behave differently —
  their membership does NOT grant global access. Instead, on every project create
  (`autoAssignGroupsToProject` in `projects.ts`) each member gets one `project_access` row:
  single group → linked to the group with row flags false (group edits propagate live via
  OR-merge); member of several auto-assign groups → `securityGroupId: null` with row flags
  set to the OR of all those groups' flags at creation time (deterministic, no permission
  loss). Existing projects are untouched; `getGlobalGroupFlags` excludes these groups. Toggle lives in the group create/edit dialog ("Auto-add members to every new
  project") with a badge on the group row.
- User pickers in the project Security tab ("Grant access") and the group members dialog
  are searchable comboboxes (`UserCombobox`: Popover + cmdk, search by name or email).
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
- **Entry date limits**: per-project `backdatedDays` / `futureDays` (nullable ints, admin-set
  on the Settings tab). They cap how far in the past/future a **non-admin** may date an entry
  (0 = that direction fully blocked, null = no limit). Enforced server-side on entry create
  and on date-change in PATCH (`entryDateWindowError` in `entries.ts`, "today" anchored to
  Asia/Riyadh); admins
  are exempt. The entry form mirrors the window via `min`/`max` on the date input plus a hint.
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

- Email + password (bcrypt). Cookie-session (`sid`), server-side session storage in `sessions`.
- Public `/register` page for self-signup. The first user to register is automatically promoted
  to `admin`; all others default to `user`. The check + insert happen in the same transaction.
- Legacy rows from the previous OIDC setup (no `password_hash`) cannot be claimed via
  `/register` — that would let anyone seize a coworker's account by knowing their email.
  Migration is an admin task: delete the row, or set a password via `PATCH /users/:id`.
- The bootstrap path is serialized with a transaction-scoped advisory lock so two concurrent
  first registrations can never both be promoted to admin.
- Role changes and admin-issued password resets immediately invalidate all of the target
  user's existing sessions, so a demoted admin can't keep elevated access until the cookie
  expires.
- `users.mobile` is a free-form, optional varchar — never required by the API.
- `/account` lets the signed-in user edit name + mobile and change their own password.
- Admins manage all users at `/admin/users`: create accounts (email + password + role +
  optional mobile), edit any user's profile, set a new password, and promote/demote roles.
- **User panel**: the sidebar user block is a dropdown (`UserMenuContent` in `AppLayout`)
  with name/email/role, "My account", and "Log out" (keeps `data-testid="button-logout"`).
  Password changes happen on `/account` itself.
- **Forgot password: DISABLED.** Self-service reset is turned off — the frontend pages
  (`/forgot-password`, `/reset-password`) and the login-page link were removed, and the
  backend `POST /api/auth/forgot-password` / `POST /api/auth/reset-password` routes return
  404 (gated by `PASSWORD_RESET_DISABLED` in `api-server/src/routes/auth.ts`; full flow
  code is kept behind the flag for easy re-enable). Password resets are an admin task via
  `/admin/users`. The "Change password" item was also removed from the sidebar user menu —
  users change their own password on `/account` ("My account").
- **Email settings** (admin, `/admin/settings`): single-row `smtp_settings` table with a
  `provider` column — `smtp` (host, port, secure, optional username/password, fromEmail,
  fromName) or `graph` (Microsoft 365 Graph API: graphTenantId, graphClientId,
  graphClientSecret, graphSenderEmail; requires a work/school tenant with the `Mail.Send`
  *application* permission + admin consent on the app registration). API:
  `GET/PUT /api/settings/smtp` (secrets never returned, only `hasPassword` /
  `hasGraphClientSecret`; empty/omitted secrets on PUT keep the saved ones; per-provider
  required-field validation) + `POST /api/settings/smtp/test` (sends a test email via the
  active provider). `isEmailConfigured` in `api-server/src/lib/mailer.ts` gates
  forgot-password's `emailConfigured` flag on the *active* provider being fully configured.
  SMTP sends via `nodemailer`; Graph sends via client-credentials token +
  `POST /users/{sender}/sendMail` (plain `fetch`, no extra dependency). Reset emails that
  fail to send are logged but still return success to avoid enumeration.

## Backend route map

- `GET /api/auth/user`
- `POST /api/auth/register` (public), `POST /api/auth/login` (public),
  `POST /api/auth/logout`
- `PATCH /api/auth/me` (self profile: name + mobile),
  `POST /api/auth/me/password` (self password change)
- `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` — disabled, return 404
- `GET/PUT /api/settings/smtp`, `POST /api/settings/smtp/test` (admin)
- `GET /api/users` (admin), `POST /api/users` (admin create with password),
  `PATCH /api/users/:id` (admin update profile / role / password),
  `PATCH /api/users/:id/role` (admin)
- `GET /api/projects`, `POST /api/projects` (admin)
- `GET /api/projects/:id`, `PATCH /api/projects/:id`, `DELETE /api/projects/:id` (admin)
- `GET /api/projects/:id/services`, `POST /api/projects/:id/services` (admin)
- `PATCH /api/services/:id`, `DELETE /api/services/:id` (admin)
- `GET /api/projects/:id/access` (admin), `POST /api/projects/:id/access` (admin)
- `PATCH /api/access/:id` (admin), `DELETE /api/access/:id` (admin)
- `GET /api/security-groups` (admin), `POST /api/security-groups` (admin)
- `PATCH /api/security-groups/:id` (admin), `DELETE /api/security-groups/:id` (admin, blocks 409 if in use)
- `GET/POST /api/security-groups/:id/members` (admin), `DELETE /api/security-group-members/:id` (admin) — global "all projects" membership
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
  grantee (any of `canViewSummary` or `canEditEntries`), plus ALL non-disabled projects if
  the user is a global member of any security group with at least one flag set.
  - Project summary report: needs `canViewSummary`.
  - Editing/creating daily entries: needs `canEditEntries`.

## Frontend route map

- `/` — Dashboard. 8 KPI cards (today's cost, week-to-date, MTD cost, mandays, SAR/manday,
  entries, plus "Highest cost project" and "Highest SAR/manday project" — both computed
  client-side from the visibility-scoped `projectBreakdown`, so each user only sees the top
  project among projects they can access), a month-to-date trend line, plus service- and
  project-comparison bar charts. KPI cards and sidebar nav links have subtle hover animations
  (lift/shadow on cards, slide + icon scale on nav). The "New entry" button (and the
  Entry-wise report's project selector) use the shared searchable `ProjectCombobox`
  (Popover + cmdk Command, `components/ProjectCombobox.tsx`) instead of plain dropdowns.
- `/projects` — Projects list + create (admin). Toolbar with admin-only Active / Disabled
  tabs (counts shown; non-admins never receive disabled projects so no tabs), client-side
  search (name / location / code), a grid ↔ list view toggle (table with Name / Code /
  Location / Contract columns; clickable rows), and pagination (25 per page via the shared
  `PaginationControls` / `usePagination` in `components/PaginationControls.tsx`; resets to
  page 1 on search/tab change). View choice persists in `localStorage`
  (`qnc-projects-view`).
- `/projects/:id` — Project detail (entries, services, security tab, settings tab)
- `/projects/:id/summary` — Per-project summary with date range + CSV export
- `/projects/:id/entries/new` — New daily entry
- `/projects/:id/entries/:entryId` — Edit / view daily entry
- All report tables (Reports, Entry-wise, Comparison, Project Summary) have sortable column
  headers via the shared `SortableHead` component (`useSortState` 3-click cycle:
  sort → flip → clear; numeric columns start descending, text/date ascending; empty values
  always sink to the bottom). Pivot pages sort by grouped per-service metric sub-columns
  using `svc|<key>|<metric>` sort keys.
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
- `/login`, `/register` — public auth pages (form-based; no OIDC redirect)
- `/account` — Profile + change password (mobile is the only profile field shown)
- `/admin/users` — Admin user management: add user, edit profile, set password, change
  role. Client-side search (name / email / mobile / role) + pagination (25 per page).
- `/admin/security-groups` — Admin security-group templates (create / edit / delete)
- `/admin/settings` — Admin SMTP email configuration + test-send

## Project navigation

Both `/projects/:id` and `/projects/:id/summary` show ←/→ chevrons next to the
project title (`ProjectSwitcher` + `useProjectSwitcher`). Order is by project
name, navigation wraps around at the ends, and global ←/→ keypresses are also
bound (ignored when typing in inputs/textarea/select/contenteditable or with
modifier keys held).

## Visual identity

Light SAR/QNC theme with a **frosted-glass** surface treatment: the sidebar, page headers
(`PageHeader`), and all shadcn `Card` panels use translucent backgrounds with backdrop blur
via the `glass` / `glass-sidebar` Tailwind utilities defined in `index.css` (`@utility`).
Overlays (dialogs, alert dialogs, sheets, dropdown menus, popovers, select menus) use the
`glass-overlay` utility — a more opaque popover-token surface (`--popover` at 0.82 alpha,
16-px blur) so text stays legible over blurred content; the `Command` root is transparent so
it inherits its parent overlay's glass.
The sidebar is **theme-aware** — light frosted in light mode, dark frosted navy in dark
mode — driven entirely by the `--sidebar*` tokens (light values are light, `.dark` values
are navy). The body background gradient includes faint brand-color radial tints so the blur
reads. Sharper blue primary accents and a refreshed chart palette. Fonts: 'Plus Jakarta
Sans' (sans) and 'Spline Sans Mono' (numbers/mono), loaded via `<link>` in `index.html` (do
not also `@import` in CSS). Login/Register use the sidebar tokens, so they also follow the
theme toggle. Sidebar collapses to a 64-px rail and is
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
