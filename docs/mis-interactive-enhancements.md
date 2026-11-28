# Interactive MIS reporting and amount entry

## Reports and analytics

Comparison, Analytics, Report Builder, and applicable MIS Reports have an
**Enable Period Comparison** toggle. Enabled comparison accepts 3–24 labeled
date ranges; disabling it retains single-period behavior. Each period uses
the existing full-containment date rule, without proration.

Period results include side-by-side financial metrics, six metric charts,
grouped details, and pagination. Chart controls support bar/line views and
series visibility. Clicked project, service, category, and period dimensions
apply report filters or open scoped entries. Filter chips show the current
selection and support resetting it.

Project, category, service, and status filters default to all authorized
options. Explicit none is distinct from all. Returned status is included in
all-status reports, and drill-down preserves selected status subsets.
Project search matches both name and code.

Report type, search, currency, grouping, project/service/category filters,
periods, and permissions are carried into report requests and exports.
Currencies remain separate. Excel chart data is visible and contains only
selected aggregates; Excel and PDF share the same presentation data.

## Amounts and percentages

New Salary and Expense entries accept an actual amount rather than a rate or
quantity-times-rate calculation. Income and Cost retain their existing rate
rules. Custom types support configured calculation modes.

Historical entries retain saved calculation snapshots. Legacy Salary/Expense
edits show their saved amount without exposing rate fields. Conversion to
direct-amount mode is explicit and audited; unconverted lines retain their
original stored values.

Type configuration includes **Calculate % Against Total Income**, with a
nullable project override. Bulk rows and groups display income percentages
only where enabled, per currency. Zero income displays N/A rather than
dividing by zero. Percentages are analytical displays, not formulas that
replace entered amounts.

## Ordering

Manual service sequence inputs are removed. Project Settings supports
drag-and-drop and accessible move controls. Authorized reorder requests save
the complete order atomically, with rollback on failure and cache refresh.
Service ordering is reused in entry selectors, bulk entries, applicable
report groups, and exports.

## Safety and operations

The additive development migration `005` introduces calculation/configuration
snapshots. Existing amounts, workflows, permissions, and COGS business logic
are preserved. No production migration or publishing was performed.

Detailed contracts:

- `mis-interactive-data-contract.md`
- `mis-multiperiod-contract.md`

Verification includes workspace typechecking, an expanded 148-request HTTP
integration pass, focused multi-period/status/permission tests, export
regressions, and browser interaction checks. Tests use isolated fixture
projects and temporary sessions, never changes to real account credentials.