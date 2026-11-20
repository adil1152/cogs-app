# MIS multi-period analytics contract

This document is the backend contract for the additive multi-period MIS
analytics enhancement. The owning endpoint is `GET /api/mis/analytics`; the
export endpoint is `GET /api/mis/analytics/export`. Both endpoints use the
same authorization, filters, period model, calculations, and scoped data.
The implementation is additive: existing single-period/current-versus-
previous requests and response fields remain unchanged.

## Compatibility and feature toggle

When `periodComparison` is absent or `false`, the endpoint behaves exactly as
the existing analytics endpoint. A request may use one `from`/`to` period,
or the existing optional `compareFrom`/`compareTo` current/previous pair.
The response has the existing `filters`, `dateBasis`, `totalsByCurrency`,
`rows`, `trend`, and `pagination` fields and does not require a `periods`
field.

When `periodComparison=true`, `periods` is required and is the source of the
period windows. The current/previous comparison pair is not used for this
mode. All other filters retain their existing meaning and are applied
independently to every selected period.

## Multi-period request

All parameters are query parameters. Repeated and comma-separated values are
accepted wherever the existing endpoint accepts list values. Unknown
parameters are ignored for forwards compatibility.

| Parameter | Type/default | Meaning |
| --- | --- | --- |
| `periodComparison` | boolean, `false` | Enables the additive multi-period response. Accepted values are `true`/`false` (case-insensitive), `1`/`0`, and `on`/`off`. |
| `periods` | JSON array | Required when `periodComparison=true`. Each item is `{ "id": string, "label": string, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }`. |
| `projectIds` | string | Comma-separated project IDs. |
| `projectCode` | string | Case-insensitive project-code search. |
| `tabIds` | string | Reporting tab/category IDs. |
| `serviceIds` | string | Project-local service IDs. |
| `serviceCodes` | string | Case-insensitive service codes. |
| `types` | string | Comma-separated MIS types/categories; `type` and `entryType` remain aliases. |
| `from`, `to` | `YYYY-MM-DD` | Existing single-period range. Required together when supplied. |
| `status` | string or list | Explicit status filter: one or more of `draft`, `submitted`, `approved`, `rejected`, `cancelled`, or `all`. |
| `compareFrom`, `compareTo` | `YYYY-MM-DD` | Existing current/previous comparison range. Required together and ignored only in multi-period mode. |
| `groupBy` | ordered list | Existing ordered dimensions: `date`, `project`, `projectCode`, `type`, `service`, `month`, `year`. |
| `view` | enum, `monthly` | Existing trend bucket: `daily`, `weekly`, `monthly`, or `custom`. |
| `mode` | enum, `analytics` | Existing grouping mode: `analytics`, `project`, `service`, `type`, or `dynamic`. |
| `page` | positive integer, `1` | Existing grouped-row page. |
| `pageSize` | integer `1..500`, `50` | Existing grouped-row page size. |

`periods` must be valid JSON, must be an array, and must contain at least
three items. Four or more periods are supported. To protect query cost, the
server accepts no more than 24 periods. Every period requires a non-empty
`id`, a non-empty `label`, and strict real calendar `from` and `to` dates.
IDs must be unique. `label` is optional; when omitted the server uses the
stable `id` as its label. `from` must not be later than `to`. Periods are
evaluated in the order supplied; the response preserves that order. Date
windows may be adjacent or overlap. They are independent report windows, not
a request to prorate or split entries.

Invalid JSON, fewer than three periods, more than 24 periods, duplicate or
empty IDs, missing labels/dates, invalid calendar dates, or reversed dates
returns `400` using the shared `{ "error": "..." }` envelope.

## Filters, status, and authorization

The complete existing project, service, category/type, date, grouping,
pagination, and status filters apply to each selected period. Explicit list
filters are never silently widened or narrowed. A project, tab, service, or
service-code outside the caller's authorized reporting scope returns `403`.
The same reports+financial permission is required for every included project,
and exports additionally require export permission for every included project.
Reporting-disabled tabs and disabled project-tab assignments are excluded
before aggregation.

Status filtering is backward compatible. An absent `status` retains the
existing default of `approved`. An explicit `status=all` includes all valid
statuses. A multi-status query can be sent as comma-separated or repeated
values, for example `status=approved,submitted` or
`status=approved&status=submitted`. Statuses are deduplicated, validated
against the five values, and applied as an OR filter. The normalized response
reports the selected `statuses`; a legacy single-status request also retains
the existing normalized `status` field. A frontend that wants all statuses
must send `status=all` explicitly; the backend does not change the legacy
absent-status behavior.

Currencies are always separate. No exchange-rate conversion or cross-currency
addition is performed. A currency can appear in a period only when that
period has scoped matching data; its totals, rows, and trend remain isolated
from every other currency.

## Multi-period response

The response is additive. In multi-period mode it contains all existing
top-level envelope fields, plus `periods`:

```json
{
  "filters": {
    "periodComparison": true,
    "periods": [
      { "id": "jan", "label": "Jan 2026", "from": "2026-01-01", "to": "2026-01-31" },
      { "id": "feb", "label": "Feb 2026", "from": "2026-02-01", "to": "2026-02-28" },
      { "id": "mar", "label": "Mar 2026", "from": "2026-03-01", "to": "2026-03-31" }
    ]
  },
  "dateBasis": "period_start",
  "totalsByCurrency": [],
  "rows": [],
  "trend": [],
  "pagination": { "page": 1, "pageSize": 50, "total": 0, "pageCount": 0 },
  "periods": [
    {
      "period": { "id": "jan", "label": "Jan 2026", "from": "2026-01-01", "to": "2026-01-31" },
      "totalsByCurrency": [],
      "rows": [],
      "trend": [],
      "pagination": { "page": 1, "pageSize": 50, "total": 0, "pageCount": 0 }
    }
  ]
}
```

Each item in `periods` contains the exact existing analytics envelope payload
for that period's `totalsByCurrency`, `rows`, `trend`, and `pagination`, plus
the selected period descriptor in `period`. It is **not** a nested analytics
envelope: period items do not contain `filters`, `dateBasis`, or another
`periods` array. This avoids recursive response growth while preserving the
existing row and metric serializers. The top-level legacy fields remain
present for additive clients; in multi-period mode they are empty, with the
period-scoped data in `periods`.

`totalsByCurrency` and every row's `current` metric use the existing
`AnalyticsMetricSet`: income, cost, expenses, salaries, gross profit, net
profit, safe zero-income profit margin, amount, quantity, rates, units, entry
count, and contribution percentages. Multi-period rows do not compare one
period against another implicitly. Each row is scoped to one period and
contains its period descriptor (or period ID) so identical groups from
different periods cannot be confused.

`trend` uses the existing date-bucket behavior. Daily, weekly, monthly, and
custom attribution is by `from_date` (`dateBasis: "period_start"`). An entry
is included only when its complete period is contained by that selected
period (`from_date >= from` and `to_date <= to`). Historical entries are
never prorated, expanded, or duplicated across buckets.

Pagination is applied independently to each period's grouped `rows`.
`pagination.total` counts that period's complete grouped result. `trend` is
returned as the selected period's complete bounded trend result, as in the
existing endpoint. Empty periods return zero rows and zero totals without
leaking data from another period or currency.

## Calculations and percentage configuration

Existing MIS financial calculations remain authoritative:

* Total Income = sum of entries with effective financial class `income`.
* Total Cost = sum of entries with effective financial class `cost`.
* Total Expenses = sum of entries with effective financial class `expense`.
* Total Salaries = sum of entries with effective financial class `salary`.
* Gross Profit = Total Income - Total Cost.
* Net Profit = Total Income - Total Cost - Total Expenses - Total Salaries.
* Profit Margin = Net Profit / Total Income × 100; zero income returns `0`.

The percentage-against-income result is exposed only where the effective
category configuration says `calculate % against total income = yes`.
The effective setting is resolved using the amount-core category precedence
and the persistent service/order configuration: a persisted project/category
override takes precedence over the category default, and the service's
persistent project order/configuration is retained for the effective service
classification. Historical entry snapshots are not rewritten when category
configuration changes. No period proration is used for percentages or any
other metric. A zero-income denominator yields `0` (never `NaN` or
`Infinity`) for an enabled percentage.

## Export

`GET /api/mis/analytics/export` accepts the same filters and period model plus
required `format=csv|xlsx|pdf`. It uses exactly the same resolved scope,
status selection, period containment, currency separation, calculations,
period ordering, and percentage configuration as the JSON endpoint. Export
does not silently truncate grouped rows and preserves every selected period,
including empty periods. CSV/XLSX/PDF serializers receive the scoped
period model rather than querying or re-authorizing data independently.
Spreadsheet text remains formula-injection safe.

## Errors

`400` is returned for malformed multi-period JSON, invalid booleans, fewer
than three or more than 24 periods, invalid dates/ranges, invalid statuses,
invalid groupings, invalid pagination, or incomplete legacy ranges.
`403` is returned for an unknown or unauthorized project, tab, service,
service code, or missing reports/financial/export permission. No unauthorized
scope is converted into an empty result.