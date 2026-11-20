# MIS API contract

The MIS API is additive and lives below `/api/mis`. It is independent of COGS
roles and COGS records. All money is a JSON `number` at the API boundary and
must be stored/calculated with decimal database types. Existing COGS endpoints
and models are not part of this contract.

## Access and permissions

`GET /mis/me` is the initial authorization call. A false `hasAccess` means the
caller must not expose MIS actions. `permissions` are the user's effective
global permissions; `projectPermissions` and each returned project's
`effectivePermissions` are authoritative for project-specific UI gates.
`projectIds` is the permitted-project scope unless `globalAccess` is true.

Authorities are created, listed, updated, and revoked through
`/mis/authorities`; `projectId: null` means global scope. `extraPermissions`
only adds to a role. The first `mis_admin` is assigned explicitly by an
operator—COGS roles never create MIS membership or admin access.

| Role | Standard permissions |
| --- | --- |
| `mis_admin` | All permissions, including `authorities`. |
| `mis_manager` | `projects`, `configuration`, `tabs`, `services`, `entries`, `submit`, `approve`, `reports`, `export`, `financial`, `history`, `reset`, `rate_override`, `delete_approved`. |
| `project_manager` | Scoped `project_config`, `services`, `entries`, `submit`, `reports`, `export`, `financial`, `history`, `rate_override`; never authority or global-tab administration. |
| `finance` | `entries`, `submit`, `approve`, `reports`, `export`, `financial`, `history`, `rate_override`, `reset`. |
| `data_entry` | `entries`, `submit`, `history`; no rate override. |
| `viewer` | `reports`, `history`; no `financial` or `export` unless individually granted in `extraPermissions`. |

The available individual permission names are `authorities`, `projects`,
`configuration`, `project_config`, `tabs`, `services`, `entries`, `submit`,
`approve`, `reports`, `export`, `financial`, `history`, `reset`,
`rate_override`, and `delete_approved`.

Every list, dashboard, report, export, detail, and history response is
restricted to records in the caller's permitted project scope. Basic tab
reports require `reports`; financial totals require `financial`.

## Resource semantics

- **Users and authorities:** `GET /mis/users` is the MIS-admin picker.
  Authority list and user results are paginated envelopes:
  `{ items, total, page, pageSize }`.
- **Projects:** `GET/POST /mis/projects` lists/creates MIS projects; search and
  active/inactive status are server-filtered. `GET/PATCH /mis/projects/{id}`
  reads/replaces a project. Project request input is full writable state:
  name, code, nullable manager/dates, status, currency, and reporting settings.
- **Tabs and assignments:** `GET/POST /mis/tabs` and `PATCH /mis/tabs/{id}`
  manage the global dynamic master. A tab has a type and a financial class;
  `excluded` contributes no profit impact. `GET/PUT /mis/projects/{id}/tabs`
  reads/replaces that project's `{ tabId, enabled, sequence }` assignments.
- **Services:** `GET/POST /mis/projects/{id}/services` manages project-local
  services; `PATCH /mis/services/{id}` replaces service writable state.
  Services belong to a tab and include unit, default rate, sequence, active,
  and nullable effective dates.
- **Entries:** `GET/POST /mis/entries`, `GET/PATCH/DELETE /mis/entries/{id}`,
  workflow `POST /mis/entries/{id}/action`, and history
  `GET /mis/entries/{id}/history` implement period transactions. Entry input is
  project/tab/service, from/to dates, quantity, rate, and nullable remarks.
  The server validates dates and scope, computes `amount = quantity × rate`,
  snapshots names/classification/unit/currency, and enforces permission-gated
  rate overrides, approved deletion, duplicate-period controls, and workflow.
  Actions are `submit`, `approve`, `reject`, `reset`, and `cancel`.

PATCH endpoints accept the corresponding full writable input schema, not
operation-specific body shapes. Server-owned IDs, audit data, calculated
amounts, statuses, and snapshots are never accepted from the client.

## Filters, reports, and dashboard

Entry lists accept server-side `projectIds` (comma-separated), `tabId`,
`serviceId`, `from`, `to`, `status`, `entryType`, `search`, `page`, and
`pageSize`. Report/export use the same filters plus required `reportType`,
optional `compareFrom`/`compareTo`, and optional `currency`; report/dashboard
status defaults to `approved`. Export additionally requires `format` of
`xlsx`, `pdf`, or `csv` and returns an octet-stream.

Report types are `income`, `cost`, `expense`, `salary`, `summary`,
`project-profitability`, `project-comparison`, `period-comparison`, and
`service-tab-comparison`. `GET /mis/reports` returns currency groups, each
with current and optional comparison totals plus project/tab/service/period
group rows. A total contains income, cost, expenses, salaries, gross profit,
net profit, margin, and entry count. Currencies are never summed together.

The operational report types (`income`, `cost`, `expense`, `salary`, and
`service-tab-comparison`) require scoped `reports` permission. The
profit-bearing types (`summary`, `project-profitability`,
`project-comparison`, and `period-comparison`) additionally require scoped
`financial` permission. For an operational response the API retains the
numeric totals response shape but redacts `grossProfit`, `netProfit`, and
`profitMargin` as zero; clients must hide profit UI for operational report
types even when the caller separately has financial access. Reporting-disabled master tabs are excluded from every report and
dashboard aggregate. A dashboard request without both report and financial
scope returns an empty dashboard payload rather than a 403, so clients can
render their access CTA.

`GET /mis/dashboard` uses the reporting filters and returns separate currency
groups with totals plus `byProject`, `byTab`, and `byPeriod` rows, along with
fully typed recent entries the caller may access.

Errors use the shared `ErrorEnvelope`.