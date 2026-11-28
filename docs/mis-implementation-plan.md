# MIS implementation plan

## Isolation

MIS is a separate module inside the existing application, under `/mis` and
`/api/mis`. It reuses sign-in and UI primitives but not COGS authorization,
transactions, project records, calculations, or workflows. Database additions
use the `mis_` prefix. Existing COGS code changes are limited to additive route
registration and a module entry link if needed for navigation.

## Delivery sequence

1. Define additive, typed MIS API contracts and generate the client.
2. Build independent MIS navigation and screens in parallel with MIS-only
   schema, migration, authorization, and server routes.
3. Provide configurable projects, tabs, services, and project assignments.
4. Implement period-based entries, rate authorization, status transitions,
   and transactional audit history.
5. Implement permission-scoped dashboards, financial reports, comparisons,
   drill-down, and Excel/PDF/CSV exports.
6. Run type checks, targeted authorization/calculation/workflow tests, and
   verify the existing COGS surfaces still load.

## Business defaults

- The spreadsheet is a business reference, not data to import. Its ten-day
  periods are examples; users enter real date ranges.
- The written requirement `amount = quantity × rate` takes precedence over
  spreadsheet expense percentages. Lump sums can use quantity one.
- Financial totals default to approved entries. Reporting must never silently
  combine amounts in different currencies.
- "Other" tabs have an explicit financial classification, including exclusion.
- No COGS role confers MIS access. Initial MIS administration is assigned only
  to the existing account explicitly identified by the project owner.
- Configuration is deactivated rather than deleting referenced history.
- Changes must not recalculate historical transaction rates or classifications.
- Reporting date semantics and duplicate-period rules must be documented.

## Safety

Use an explicit additive migration, not a broad schema synchronization that
could alter COGS tables. A rollback script must be MIS-only and must not run
automatically. Do not create, delete, or edit real COGS records during testing.
Do not deploy automatically.

The normal development apply command is
`NODE_ENV=development pnpm --filter @workspace/scripts run mis:migrate`.
Production application is intentionally blocked unless an operator explicitly
sets both `NODE_ENV=production` and `MIS_ALLOW_PRODUCTION_MIGRATION=true` for
that one command. The runner applies each ledgered MIS migration in one
transaction; it never performs a rollback. Manual rollback SQL removes only
the corresponding `mis_schema_migrations` row and retains the ledger itself.