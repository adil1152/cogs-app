# MIS cost bulk amount/quantity contract

This additive contract changes **only** COST lines submitted through the MIS
bulk parent endpoints. Single-entry `POST/PATCH /api/mis/entries` behavior is
unchanged, including existing cost rate handling. Expense, salary, income, and
other/custom lines retain their existing calculation and permission rules.

## Create

`POST /api/mis/entries/bulk` continues to accept the existing
`MisBulkEntriesInput` body. A COST line submitted by the new bulk screen uses
`quantity` and `amount`:

```json
{
  "projectId": "project-id",
  "fromDate": "2026-09-01",
  "toDate": "2026-09-30",
  "action": "draft",
  "lines": [
    {
      "serviceId": "cost-service-id",
      "quantity": 500,
      "amount": 25000
    }
  ]
}
```

For a COST line with both values, the server treats `amount` and `quantity`
as authoritative and persists:

* `quantity`: the submitted quantity;
* `amount`: the submitted amount, normalized only to the existing six-decimal
  database precision; and
* `rate`: `amount / quantity`, rounded only to the existing six-decimal rate
  precision.

If `quantity` is zero, the server persists rate `0` and keeps the submitted
amount (including a non-zero amount). The request never divides by zero.
Examples: `(500, 25000) → rate 50`, `(500, 30000) → rate 60`,
`(600, 30000) → rate 50`. Repeating fractions keep the stored amount rather
than reconstructing it from the rounded rate.

Any incoming COST `rate` is ignored for this amount/quantity path, including
when supplied by an administrator. COST amount/quantity calculation does not
require `rate_override` permission or `rateReason`; those controls continue to
apply to rate-based non-COST lines. The legacy quantity/rate line shape remains
accepted for compatibility when no amount is supplied.

## Parent edit

`PATCH /api/mis/entries/parents/{id}` uses the same rules for replacement lines.
Include the existing child `id` to preserve its identity:

```json
{
  "fromDate": "2026-09-01",
  "toDate": "2026-09-30",
  "lines": [
    {
      "id": "existing-cost-child-id",
      "serviceId": "cost-service-id",
      "quantity": 600,
      "amount": 30000
    }
  ]
}
```

The response child exposes the stored `quantity`, derived `rate`, and stored
`amount`. Parent replacement remains atomic, keeps workflow/period guards,
audit history, and stable child IDs, and does not rewrite historical
standalone or unrelated records. Cost-derived calculation changes are not
rate overrides and do not create rate-override audits.