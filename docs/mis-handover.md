# MIS module handover

## Delivered

MIS is available from **QNC MIS** in the existing application navigation.
It is a separate module, not a replacement for COGS. The owner-designated
existing account has been assigned global MIS Admin in development.
No other permanent MIS grants were created.

### Pages

| Route | Purpose |
| --- | --- |
| `/mis` | Filtered dashboard with separate currency groups |
| `/mis/projects` | Independent MIS project setup and search |
| `/mis/projects/:id` | Project settings, tab assignments, service configuration |
| `/mis/configuration` | Dynamic tabs/categories master |
| `/mis/entries` | Server-filtered, paginated transactions |
| `/mis/entries/new` | Dynamic period-based entry creation |
| `/mis/entries/:id` | Entry details, editing, actions, and history |
| `/mis/reports` | Nine report types, comparisons, drill-down, exports |
| `/mis/authorities` | MIS roles, project assignments, and extra permissions |

Create a category, create a project, enable the category for that project,
add its services/rates, then create and approve entries. No sample business
transactions or workbook records were imported.

## Files and integration points

- Frontend: `artifacts/cogs-tracker/src/modules/mis/`, with dedicated pages,
  components, permission helpers, and export hook.
- Backend: `artifacts/api-server/src/routes/mis/index.ts` and
  `artifacts/api-server/src/lib/mis/`.
- Models: `lib/db/src/schema/mis.ts`.
- Contracts: additive MIS paths/schemas in `lib/api-spec/openapi.yaml`;
  regenerated client and validators in the existing generated libraries.
- Operations: `scripts/src/mis-migrate.ts`,
  `scripts/src/mis-bootstrap-admin.ts`, and SQL under
  `artifacts/api-server/src/mis-ops/`.
- Tests: `artifacts/api-server/src/mis-tests/integration.ts` and
  `export-regression.ts`.

Existing COGS integration changes are limited to additive frontend/backend
route registration, a navigation link, and the schema barrel export. The API
build externalizes the new PDFKit package so its fonts and dependencies load
correctly. Existing workflow commands, COGS routes, permission rules, report
calculations, and database definitions were not replaced or altered.

## Database

New tables:

- `mis_projects`
- `mis_tabs`
- `mis_project_tabs`
- `mis_services`
- `mis_authorities`
- `mis_entries`
- `mis_audit_log`
- `mis_schema_migrations`

Migrations `001_mis_schema` and `002_mis_audit_append_only` were applied to
development. The latter enforces append-only audit records. Entry workflow
actions are recorded in the audit log rather than a redundant approvals table.
Entries retain historical names, classification, unit, currency, and rate;
deletion is a tombstone, not loss of audit history.

## Roles and security

MIS Admin, MIS Manager, Project Manager, Finance, Data Entry, and Viewer are
independent of COGS roles. Authorities can be global or project-scoped, with
explicit extra permissions. See `mis-api-contract.md` for the full matrix.

COGS administrators receive no automatic MIS privileges. Authorization is
checked server-side for lists, entries, history, configuration, reports, and
exports. Revoked permissions are loaded from the database on each request.
The final global MIS administrator cannot be removed.

Viewers can use basic income/cost/expense/salary/service-category reports.
Profit-bearing reports require financial permission. Export is a separate
permission. Operational reports intentionally do not display profit metrics.

## Entry workflow and calculations

- Draft → Submitted → Approved or Rejected.
- Authorized reset returns an entry to Draft.
- Cancellation and permitted deletion are audited.
- Only drafts can be edited; approval locks the record.
- Quantity × rate is computed server-side with fixed decimal arithmetic.
- Saved rates can be retained when defaults later change; overriding a rate
  requires explicit permission.
- Project, assigned tab, service status, effective dates, valid date ranges,
  duplicate-period rules, and nonnegative values are validated.
- Gross profit = income − cost.
- Net profit = income − cost − expenses − salaries.
- Margin = net profit ÷ income × 100, with safe zero-income handling.

## Reporting and exports

Income, Cost, Expense, Salary, MIS Summary, Project Profitability, Project
Comparison, Period Comparison, and Service/Category Comparison are available.
New categories and services are included dynamically according to their
financial classification and reporting flag.

Reports default to approved records and include only entries fully contained
within the selected date range. They do not prorate partially overlapping
periods. Currencies are always grouped separately; no exchange-rate conversion
is implied.

CSV, Excel, and multipage PDF exports include complete grouped data and
comparison values. Textual spreadsheet fields are protected against formula
injection. PDF uses an available TrueType font; an operator can provide a font
through `MIS_PDF_FONT_PATH` when a deployment needs broader script coverage.

## Verification results

- Full repository TypeScript check passed after the implementation.
- Backend integration harness passed 71 HTTP requests covering permissions,
  scoped access, workflow, audit, dates, rate snapshots, calculations,
  reporting flags, currency separation, and export responses.
- Browser journey created a custom Other category classified as Income,
  enabled it on a new project, added a service, and saved/submitted/approved
  a quantity 2.5 × rate 12.34 entry. History and locking worked; reports and
  dashboard returned 30.85 SAR; drill-down and CSV download succeeded.
- Browser findings in MIS (nested report anchors, transient date requests,
  stale selector errors, and dashboard filter reload state) were corrected
  and checked with targeted code/type checks. A second full browser pass was
  not run.
- Export regression checked 105 grouped records. Excel XML and CSV retained
  the last record; PDF text extraction verified the last record and four-page
  pagination. The built API was also checked for working PDF/XLSX/CSV responses.
- Existing COGS Dashboard, Projects, and Reports loaded during the browser
  check. Baseline comparison confirmed original table definitions and
  business-record counts unchanged. The shared user count increased by one
  during the session; no existing user role/profile/password was edited.
- All temporary MIS test projects, categories, services, entries, grants,
  and generated test sessions were removed.

The browser observed pre-existing COGS mobile clipping and nested-anchor
warnings. These were not changed because COGS UI changes were outside the
authorized scope. This is not a claim of exhaustive COGS regression coverage.

## Workbook assumptions and business confirmation

The workbook's ten-day periods and examples are references, not fixed rules.
Its expense percentages were not implemented as automatic allocation rules:
the written quantity × rate specification takes precedence. Lump sums can
use quantity one. Confirm separate requirements before adding percentage
allocations, proration, exchange-rate conversion, or importing workbook data.

Current defaults also assume fully contained reporting periods, the documented
six-role matrix, and explicit classification for Other categories. These are
documented operating rules rather than inferred accounting regulations.
Future COGS, Meal Count, and Odoo integrations were intentionally not built.

## Publishing readiness

The application has not been published and production data was not changed.
Before going live, an authorized operator must back up the production database,
apply only the ledgered MIS migrations, and explicitly bootstrap the designated
existing production account if MIS has no global administrator.

Commands are scoped to the database supplied to the process:

```sh
# Development only
NODE_ENV=development pnpm --filter @workspace/scripts run mis:migrate
NODE_ENV=development pnpm --filter @workspace/scripts run mis:bootstrap-admin <existing-account-email>

# Production: explicit operator approval and the production database connection
NODE_ENV=production MIS_ALLOW_PRODUCTION_MIGRATION=true pnpm --filter @workspace/scripts run mis:migrate
NODE_ENV=production MIS_ALLOW_PRODUCTION_BOOTSTRAP=true pnpm --filter @workspace/scripts run mis:bootstrap-admin <existing-account-email>
```

Do not use broad schema-push/force commands for this module. Rollback is manual:
apply the `002` down migration before `001`, only after backup and explicit
approval. Rolling back removes MIS data; it does not touch COGS tables.
Do not run the fixture-based integration harness against production.