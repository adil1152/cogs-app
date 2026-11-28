# MIS parent transactions and management reports

This enhancement extends the existing MIS module. It does not replace COGS,
authentication, existing MIS records, or the financial calculation rules.

## Bulk transactions

New all-services submissions have one immutable `MIS-BULK-…` number and parent
record. All service lines remain linked to it. Bulk Entries provides searchable,
paginated history and opens the whole transaction, rather than an unrelated
line. Existing standalone entries remain unchanged: historical rows are not
combined merely because their dates, author, or project match.

Draft, submitted, returned, and rejected transactions can be edited with the
appropriate project permission. Approval locks the transaction. The separate
**Edit Approved MIS Entry** permission, plus a mandatory reason, is required
for approved edits. MIS administrators have that permission by default.

Parent actions synchronize child statuses atomically. Independent child
mutations are blocked. Edits retain original child identities and historical
service/rate snapshots, including unchanged services that were later disabled.
Changed rates still require rate permission and the existing reason/audit
controls. Parent and child history remain auditable.

## Period protection

Project Settings includes **Allow Multiple MIS Entries for Same Period**
(default No), with explicit non-overlapping, overlapping, and unlimited modes
and an optional maximum. Enabling multiple entries alone does not permit
overlap: non-overlapping remains the default.

Inclusive date-range checks detect exact, partial, contained, and enclosing
overlaps. Adjacent non-overlapping ranges remain valid. Relevant standalone
entries also participate in new parent conflict checks, while legacy
standalone service-level behavior is retained.

Project locks serialize period checks and writes. Mutations lock and re-read
records before enforcing current approval status. Conflict responses disclose
existing entry details and an Open Existing Entry link only to authorized
viewers.

Exact endpoints, fields, and workflow transitions are documented in
`mis-parent-contract.md`.

## Management reports

All MIS standard and advanced Excel/PDF exports use a shared presentation
layer. Existing authorization, report filters, currencies, calculations, and
CSV compatibility are preserved.

- QNC branding, project/number, period, generation date, and selected filters.
- Currency-separated executive summaries, financial KPIs, sections,
  subtotals, and detailed tables.
- Excel formatting, widths, frozen headers, autofilters, and native bar,
  doughnut, and applicable trend/comparison charts referencing workbook cells.
- PDF vector charts, wrapped rows, aligned totals, pagination, and page footers.
- Advanced analytics appendices retain current/previous/difference/percentage
  vectors, quantities, rates, mixed-unit indicators, and drill-down filters.
- Formula-injection protection and finite-number safeguards remain active.

## Navigation

The MIS sidebar has an accessible collapse/expand button. Desktop collapsed
navigation shows icons and tooltips, releases space for content, and retains
its state between pages. MIS access checks and the existing design remain.

## Migration and verification

The additive `004_mis_parents_and_period_policy` migration was applied to
development using the existing migration runner. Nothing was published or
migrated in production.

Verification includes workspace typechecking, the legacy integration harness,
the parent integration harness, analytics/export regressions, OOXML inspection,
PDF rendering, and a browser transaction lifecycle. Tests use isolated MIS
records and temporary sessions, not changes to real users or their credentials.

Useful commands:

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server exec tsx src/mis-tests/parent-integration.ts
pnpm --filter @workspace/api-server exec tsx src/mis-tests/integration.ts
pnpm --filter @workspace/api-server exec tsx src/mis-tests/export-regression.ts
```

Final checks: 85 parent acceptance assertions passed, including scoped creator
filtering, project-period policies, permissions, parent/child status consistency,
and historical-line edits. The browser verified bulk creation, submitted edit,
return/resubmit/approve, approved override reasons, read-only editor access,
history filters, sidebar toggling, and actual Excel/PDF downloads.

Project-policy permutations were covered by HTTP tests rather than a completed
browser walkthrough of every setting. The creator-picker correction was
confirmed with scoped API tests and typechecking. Temporary fixtures and
sessions were removed. Existing COGS nested-link console warnings and the
long project-picker label layout were observed but not changed in this scope.