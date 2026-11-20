# Advanced MIS enhancements

## Scope and safety

This extends the existing MIS module. Existing COGS routes, tables, user
authentication, and business records were not replaced. Existing MIS records
remain intact. Migration `003_mis_security_service_fields` adds service codes
and currencies and permits explicitly configured custom authorities.
Existing services inherit their project's currency and receive stable codes;
existing entry snapshots are not rewritten.

No production migrations or publishing were performed.

## Navigation and access

- The COGS navigation shows **QNC MIS** only after a successful, user-keyed MIS
  access check confirms access. Pending/failed checks do not expose the link.
- Users with no MIS authority are redirected from direct `/mis` visits to
  COGS; all MIS APIs still enforce authorization independently.
- Access refreshes on navigation/window focus and periodically so removed
  grants do not remain visible indefinitely. User changes clear MIS caches.
- Existing role grants retain their privileges. The legacy `entries` extra
  permission expands to the new granular permissions.
- A custom role inherits no permissions. Empty grants confer no MIS access.

## New screens

| Route under `/mis` | Function |
| --- | --- |
| `/project-security` | Select a project and configure user permissions |
| `/projects/:id/security` | Direct project-scoped security configuration |
| `/authorities` | Global MIS access and existing authority management |
| `/service-rates` | Select a project and open service/rate configuration |
| `/entries/bulk` | **ENTER ALL SERVICES** for one project and period |
| `/analytics` | Seven financial KPIs and six filterable charts |
| `/comparison` | Project, service, and configured-category comparisons |
| `/report-builder` | Ordered, configurable report grouping |

The original dashboard, single-entry flow, approvals, history, and reports
remain available.

## Security and rates

Project assignments can independently allow viewing projects/entries,
creating, editing, deleting, approving, reporting, exporting, and rate
overrides. Global grants apply across projects; project grants do not confer
access to other projects. Rate editing is separate from entry editing.

Services support name, project-local code, category, unit, fixed/default rate,
currency, status, sequence, and effective dates. A rate override requires
permission and a reason. Audit records include the original/configured rate,
new rate, actor, time, and reason.

## All-services entry

The entry screen loads every active, assigned, entry-enabled service eligible
for the full selected period. Services are grouped by Income, Cost, Expense,
Salary, and Other, with dynamic configured category names.

- Default rates populate automatically; unauthorized users see locked rates.
- Amounts are calculated as quantity × rate and verified by the server.
- Untouched blank quantities create no records.
- Explicit zero quantities, or explicitly selected zero rows, are saved.
- Lump sums have an explicit quantity-one action, not automatic records.
- Draft or submit saves the entire batch atomically. One invalid service,
  unauthorized rate, duplicate, or invalid date prevents partial persistence.
- Failed saves preserve input. Unsaved changes are guarded before navigation
  or changing the project/period.

## Analytics and comparisons

New analytics require reports and financial permissions together on each
included project. Exports also require export permission for the entire
included scope; they never silently omit projects from the displayed report.

Filters include multiple projects, project code, multiple configured
categories/services, service codes shared across projects, dates, status,
daily/weekly/monthly/custom view, and comparison dates.

Each currency is separate. Financial results include income, cost, expenses,
salaries, gross profit, net profit, and margin. Comparisons expose current,
previous, difference, and percentage difference. Percentage difference is
undefined when the previous amount is zero rather than misleadingly zero.
Weighted service rates and mixed-rate/mixed-unit warnings prevent presenting
heterogeneous service data as one fixed rate.

The report builder supports ordered Date, Project, Project Number, Type,
Service, Month, and Year grouping. Type grouping keeps separately configured
categories separate, including multiple categories classified as Other.
Rows are paginated server-side. SQL performs aggregation rather than sending
all transactions to the browser.

### Date interpretation

Report inclusion continues to require full period containment. Daily, weekly,
monthly, and yearly buckets attribute each entry to its **period start**.
A multi-day entry is not prorated or duplicated across days.

Drill-down uses the original report date bounds plus explicit period-start
bucket bounds (`startFrom`/`startTo`) and the row's currency, status, project,
category, and service scope. This preserves entries spanning bucket ends.
Previous-period drill-down uses the comparison window.

## Exports and implementation

CSV, Excel, and multipage PDF downloads retain filters, permissions, currency
groups, comparison values, and configured category labels. Textual spreadsheet
values are protected against formula injection.

Primary implementation:

- `artifacts/api-server/src/routes/mis/index.ts`: granular CRUD, bulk services
  and entry endpoints, audit, entry drill-down filters.
- `artifacts/api-server/src/routes/mis/analytics.ts` and
  `src/lib/mis/analytics.ts`: advanced reporting and exports.
- `artifacts/cogs-tracker/src/modules/mis/`: screens, shared analytics
  filters/charts, access checks, and download/query helpers.
- `lib/api-spec/openapi.yaml`, `mis-analytics.yaml`, and generated libraries:
  API contracts and clients.
- `lib/db/src/schema/mis.ts`, `src/mis-ops/003_*`, and the existing migration
  runner: additive data changes.

See `mis-bulk-contract.md` and `mis-analytics-contract.md` for exact API details.

## Verification commands

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server exec tsx src/mis-tests/integration.ts
pnpm --filter @workspace/api-server exec tsx src/mis-tests/analytics-regression.ts
```

The HTTP harness checks granular and legacy access, atomic batch failures,
blank/zero lines, rate overrides/audit, project isolation, previous currency
totals, disabled project-category reporting, date-bucket drill-down,
currency filters, and exports. Its fixtures are explicitly cleaned up.
The analytics regression also covers distinct custom categories.

Browser fixtures are development-only. Their setup/cleanup utility uses
short-lived generated sessions and isolated MIS records, never account
password changes. Do not run fixture-based tests in production.

### Completed verification

- Workspace typechecking and the expanded HTTP integration checks passed.
- Live bounded analytics requests passed for 20 view/group combinations.
- Browser verification confirmed no-access navigation hiding and redirects,
  project isolation, locked rates, six-row atomic submission (blank skipped,
  zero retained), approval, six charts, comparisons, ordered grouping,
  matching entry drill-down, and an actual Excel download.
- The approved test period produced income 1,000, cost 200, expenses 80,
  salaries 100, gross profit 800, net profit 620, and margin 62%.
- CSV, Excel, and PDF exports returned successfully from the running API.
- An authorized rate override saved with its reason and original/new-rate
  audit. A subsequent remarks-only edit retained the saved rate.
- Temporary MIS fixture records, grants, generated sessions, and private
  session metadata were cleaned up. Real accounts were not modified.
- Report-builder URL persistence was typechecked; browser Back was not
  re-tested after that final non-critical improvement.