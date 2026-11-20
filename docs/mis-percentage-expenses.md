# MIS Overhead and OP Expense

Project settings has two separately authorized sections, Overhead and OP Expense.
Each service has a name, a percentage (0–100), and an active flag.
These are project-specific calculation rules, not bulk-entry services or ledger
transactions. Users can create, edit, deactivate, reactivate, and delete rules.
Deletion requires a confirmation in the UI and is audit logged.

## Permissions

- `overhead`: view Overhead services, percentages, and dashboard calculations.
- `op_expense`: view OP Expense services, percentages, and dashboard calculations.
- Writing additionally requires `services` or `project_config` in the same
  project/global scope.
- MIS administrators inherit both new permissions. Other existing roles do not;
  use Authorities or the project's Security tab to grant them explicitly.
- Existing dashboard access still requires Reports and Financial permission.
- APIs omit restricted dashboard sections entirely. Adjusted profit is returned
  only when both section permissions apply to that project. Financial access
  alone does not expose either section.

## Calculation and history

Each active service amount is combined selected-project income × percentage / 100, using exact
six-decimal arithmetic and rounding once at the final amount. Income uses the
selected dates and entry statuses and only reporting-enabled, non-deleted entries.
Period containment matches existing MIS dashboard rules; there is no proration.
The base is the full income of all selected projects, irrespective of category/service/search
filters. Percentages configured in every selected project are added, including
settings-only projects with no entries in the period. With no project filter,
all report/financial-permitted projects are included. Each currency is calculated
separately. Charges are independent and additive, never compounded.

The dashboard shows combined service percentages and amounts and each section's
total. Net profit and profit margin KPIs deduct both sections only when the user
has both section permissions for every selected project. Otherwise the KPIs
explicitly show pre-charge values; restricted sections and adjusted net profit
are omitted by the API. Entry/project/category/period breakdowns and ledger
amounts remain before these dashboard-only charges. No automatic Expense entry
is created.
Rules are current configuration: modifying/deleting/deactivating one changes
calculations for all subsequently viewed periods, including historical periods.
They are not frozen in approved bulk-entry snapshots.

Dashboard status defaults to `all`; explicit statuses still work. This does not
change the default status of other report endpoints or entry creation.

## Development schema and tests

Schema addition: `src/mis-ops/007_mis_percentage_services.up.sql` in the API artifact;
also declared in the shared Drizzle schema. Applied to development only.
No production database writes or publishing are performed by this change.

Focused regression command:

```sh
pnpm --filter @workspace/api-server exec tsx src/mis-tests/percentage-regression.ts
```
