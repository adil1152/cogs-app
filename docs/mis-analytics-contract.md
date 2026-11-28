# MIS advanced analytics contract

This is the additive contract for the advanced MIS screen.  The owning route
is `GET /api/mis/analytics` (the API server is mounted below `/api`) and the
export route is `GET /api/mis/analytics/export`.  These endpoints read only
MIS tables; they never read COGS data and never mutate data.

## Authorization and scope

The caller must have `reports` and `financial` on **every project included in
the request**.  A project-scoped grant is evaluated per project, including
when a global MIS grant is present.  If `projectIds` is supplied and any ID is
unknown or is missing either permission, the request is rejected with `403`;
IDs are never silently intersected.  When `projectIds` is omitted, the server
uses the caller's projects for which both permissions are present.  If that
scope is empty, the request is rejected with `403`, except that a global
reports+financial administrator in a genuinely empty MIS installation receives
a successful empty envelope.

The same scope is applied before any aggregate query.  Reporting-disabled
tabs (`allow_reporting = false`) and entries whose project-tab assignment is
disabled are excluded from every aggregate.  Explicit `tabIds` and
`serviceIds` that do not belong to a permitted reporting project/tab are
rejected with `403`.  `serviceCodes` are resolved only within the permitted
scope, so the response never acts as a service-option oracle.  A service code
is case-insensitive and stable per project; grouping by service code lets the
same service compare across projects without exposing inaccessible services.

`reports` and `financial` are required even for operational rows.  Advanced
analytics intentionally does not return a redacted profit view: callers may
not mix full-profit and redacted projects.  Exports additionally require
`export` on every project in the already-computed reports+financial scope;
omitting `projectIds` never silently narrows that scope for an export.

## Query parameters

All parameters are query parameters.  Comma-separated and repeated values are
accepted for list parameters.  Unknown parameters are ignored for forwards
compatibility.

| Parameter | Type/default | Meaning |
| --- | --- | --- |
| `projectIds` | `string` | Comma-separated project IDs. |
| `projectCode` | `string` | Case-insensitive substring search on project code. |
| `tabIds` | `string` | Reporting tab IDs. |
| `serviceIds` | `string` | Project-local service IDs. |
| `serviceCodes` | `string` | Case-insensitive service codes; the same code can be compared across projects. |
| `types` | `string` | Comma-separated MIS types/categories; `type` and `entryType` are accepted aliases. |
| `from`, `to` | `YYYY-MM-DD` | Strict real calendar dates. An entry is included only when its complete period is within this range (`from_date >= from` and `to_date <= to`). There is no proration. |
| `status` | enum, `approved` | `draft`, `submitted`, `approved`, `rejected`, or `cancelled`. |
| `compareFrom`, `compareTo` | `YYYY-MM-DD` | A complete strict previous range; both are required together. Comparison uses the same non-date filters. |
| `groupBy` | ordered list | Ordered, comma-separated dimensions: `date`, `project`, `projectCode`, `type`, `service`, `month`, `year`. Duplicates and unknown dimensions are rejected. |
| `view` | `daily` \| `weekly` \| `monthly` \| `custom`, `monthly` | Bucket used for `trend`. `custom` requires `from` and `to` and returns one range bucket. |
| `mode` | enum, `analytics` | `analytics`, `project`, `service`, `type`, or `dynamic`. Without `groupBy`, `project`, `service`, and `type` select their named grouping; `analytics` is an ungrouped currency summary; `dynamic` requires `groupBy`. Explicit `groupBy` always wins. |
| `page` | positive integer, `1` | Grouped-row page. |
| `pageSize` | integer `1..500`, `50` | Grouped-row page size. |

`daily`, `weekly`, and `monthly` group date values by the entry
`from_date`; that attribution is explicit in the response as
`dateBasis: "period_start"`. A weekly/monthly bucket is clipped to the
requested range in its drill-down filters. Entries are never expanded into
daily amounts.

## JSON response

The response is an `AnalyticsEnvelope`:

```json
{
  "filters": {
    "projectIds": ["project-id"],
    "projectCode": null,
    "tabIds": [],
    "serviceIds": [],
    "serviceCodes": [],
    "types": [],
    "from": "2026-09-01",
    "to": "2026-09-30",
    "status": "approved",
    "groupBy": ["project", "type"],
    "view": "monthly",
    "mode": "dynamic",
    "page": 1,
    "pageSize": 50,
    "compareFrom": null,
    "compareTo": null
  },
  "dateBasis": "period_start",
  "totalsByCurrency": [{
    "currency": "USD",
    "current": { "totalIncome": 100, "totalCost": 40, "totalExpenses": 10,
      "totalSalaries": 20, "grossProfit": 60, "netProfit": 30,
      "profitMargin": 30, "totalAmount": 170, "quantity": 12,
      "weightedRate": 14.166667, "rateMin": 5, "rateMax": 20,
      "rateVaried": true, "units": ["day"], "unitVaried": false,
      "entryCount": 4, "contributionPercent": 100,
      "incomeContributionPercent": 100, "costContributionPercent": 100,
      "expensesContributionPercent": 100, "salariesContributionPercent": 100 },
    "previous": null,
    "difference": null,
    "percentageDifference": null
  }],
  "rows": [{
    "currency": "USD",
    "projectId": "project-id",
    "projectIds": ["project-id"],
    "projectName": "Project A",
    "projectCode": "QNC-001",
    "tabIds": ["tab-id"],
    "tabName": "Income",
    "type": "income",
    "serviceIds": ["service-id"],
    "serviceCode": "catering",
    "serviceName": "Catering",
    "periodStart": null,
    "periodEnd": null,
    "current": {},
    "previous": null,
    "difference": null,
    "percentageDifference": null,
    "drilldownFilters": {
      "projectIds": ["project-id"], "tabIds": ["tab-id"],
      "serviceIds": ["service-id"], "entryType": "income",
      "status": "approved", "currency": "USD",
      "from": "2026-09-01", "to": "2026-09-30",
      "startFrom": null, "startTo": null
    }
  }],
  "trend": [],
  "pagination": { "page": 1, "pageSize": 50, "total": 1, "pageCount": 1 }
}
```

`MetricSet` always contains the seven dashboard totals:
`totalIncome`, `totalCost`, `totalExpenses`, `totalSalaries`, `grossProfit`,
`netProfit`, and `profitMargin`.  It also contains `totalAmount`, `quantity`,
`weightedRate`, `rateMin`, `rateMax`, `rateVaried`, `units`, `unitVaried`, and
`entryCount`.  `weightedRate` is `totalAmount / quantity` and is `null` when
quantity is zero.  `rateMin`/`rateMax` are the observed entry-rate bounds.
`rateVaried` is true when observed rates differ; the API never labels a mixed
rate as a single fixed rate.  `unitVaried` and `units` make mixed units
explicit as well.

Contribution percentages on a row are that row's amount (or financial-class
amount) divided by the corresponding current currency total.  Zero
denominators return `0`, while comparison percentage differences return
`null` when the previous value is zero.  A comparison row always has
`current`, `previous`, `difference`, and `percentageDifference`; a group
present only in the comparison range is included with zero current metrics.
The same shape is used in `trend`.

Type grouping preserves the entry `type` enum for filtering, but also groups
by the configured tab ID. Distinct custom tabs whose entries all have type
`other` therefore remain separate; `tabName` is returned as their readable
label. Financial-class totals still use each entry's stored
`financial_class`.

Rows are produced by SQL `GROUP BY` aggregates, not by loading transactions.
`pagination.total` counts merged current/previous grouped rows, including
comparison-only groups.  `trend` is also database-aggregated and is bounded by
the selected date range.  Currency totals are never combined across
currencies.

Every row's `drilldownFilters` is safe to pass to `GET /mis/entries`: IDs,
type, status, and currency are only those represented by the row.  `from` and
`to` remain the complete report range (so a multi-day entry is not lost);
`startFrom` and `startTo` bound the entry's `from_date` period-start bucket.
Daily/monthly/weekly attribution is therefore not mistaken for full-period
containment.  Multi-project/service groups contain arrays because the existing
entry endpoint has single-project/tab/service filters; the frontend may fan
out those filters when opening Entries.  The core Entries endpoint accepts
`startFrom`/`startTo` as `from_date` bounds while retaining its `from`/`to`
full-period bounds.

When comparison is requested, a row present in both ranges has
`previousDrilldownFilters` using the complete comparison range and its own
period-start bucket.  A comparison-only row uses those previous filters as
its primary `drilldownFilters`, so a click never opens an empty current-range
query.

## Exports

`GET /api/mis/analytics/export` accepts exactly the analytics parameters plus
required `format=csv|xlsx|pdf`.  It uses the same normalized filters and
authorization.  Export has no pagination and includes every grouped row
(including comparison-only rows), every trend row, and currency totals; it
must never silently truncate at a transaction or row limit.  CSV is UTF-8
with spreadsheet-formula values escaped and includes the readable `tab_name`
column (populated for tab-grouped rows), XLSX is an Office Open XML workbook,
and PDF is generated with the server's maintained PDFKit dependency.

Errors use the shared `{ "error": "..." }` envelope.  Invalid dates, ranges,
enum values, grouping dimensions, pagination, and incomplete comparison
ranges return `400`; unauthorized project/tab/service IDs and missing
permissions return `403`.