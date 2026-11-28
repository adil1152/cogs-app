# MIS bulk entry contract

`POST /api/mis/entries/bulk` creates the non-blank service lines for one
project and period in a single database transaction. The operation is
all-or-nothing: a validation, permission, effective-date, disabled-tab,
duplicate-period, or rate-lock failure rolls back every line.

```json
{
  "projectId": "project-id",
  "fromDate": "2026-09-01",
  "toDate": "2026-09-30",
  "lines": [
    {
      "serviceId": "service-id",
      "quantity": 500,
      "rate": 10,
      "remarks": "Optional note",
      "rateReason": "Required only when rate differs from the configured rate"
    }
  ],
  "action": "draft"
}
```

`action` is either `draft` or `submit`; submitted lines are returned with
`status: "submitted"`. A line whose `quantity` is omitted or `null` is a
blank client line and is skipped. `quantity: 0` is explicit and is saved.
Rates omitted from a line use the service's configured rate. Every service
must be active, assigned to an active entry-enabled tab for the project, and
eligible for the complete requested period. The server re-checks the
project's date range and duplicate-period lock for every line.

The caller needs `create_entries` for the project. A supplied rate that differs
from the service rate additionally requires `rate_override` and a non-blank
`rateReason`; otherwise the request is rejected. Override audits include the
configured/original rate, new rate, reason, actor, and timestamp. The response
is:

```json
{ "items": [/* MisEntry objects, in input line order */] }
```

Blank lines do not create records, and no partial response is returned after a
failure.