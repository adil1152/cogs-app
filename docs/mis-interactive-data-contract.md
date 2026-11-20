# MIS interactive data contract

This contract describes the additive backend fields used by the MIS bulk-entry
and service-ordering screens. It applies only to `/api/mis`; COGS records,
authentication records, and existing MIS history are not rewritten.

## Service configuration

`MisService` retains all existing fields and adds:

| Field | Type | Meaning |
| --- | --- | --- |
| `rateEnabled` | `boolean` | Whether a new entry for this service uses quantity × rate. Defaults to `true` for backward compatibility. |
| `calculatePercentAgainstIncome` | `boolean \| null` | Optional project-tab override. `null` means use the tab/type default. |
| `sequence` | `number` | Server-maintained persistent order. Clients must not ask an administrator to type a sequence number. |

`MisTab` (the type/category master) retains all existing fields and adds:

| Field | Type | Meaning |
| --- | --- | --- |
| `rateEnabled` | `boolean` | Default rate behavior for newly-created services in this type. Defaults to `true`. |
| `calculatePercentAgainstIncome` | `boolean` | Type default for percentage display/calculation. Defaults to `false`; the built-in Income type defaults to `true`, and Cost, Expense, and Salary default to `false` unless configured. |

The effective flags returned by
`GET /mis/projects/{projectId}/entry-services` are:

```ts
{
  rateEnabled: boolean;
  calculatePercentAgainstIncome: boolean;
  calculationMode: "quantity_rate" | "amount";
}
```

`calculatePercentAgainstIncome` is resolved as the nullable project-tab
override, then the tab/type default. `calculationMode` is a display and
validation snapshot: `amount` is forced for new Expense and Salary entries;
Income and Cost remain `quantity_rate`; custom types use their configured
`rateEnabled` value.

## Entry input and snapshots

Create, bulk, and parent-line inputs retain the existing identifiers, dates,
remarks, and rate override reason. The calculation fields are:

```ts
{
  quantity: number; // explicit zero is valid
  rate: number;     // quantity_rate mode only; omitted/ignored in amount mode
  amount?: number;  // required for amount mode, server-validated
}
```

The response `MisEntry` adds immutable calculation snapshots:

```ts
{
  calculationMode: "quantity_rate" | "amount";
  rateEnabled: boolean;
  calculatePercentAgainstIncome: boolean;
  amount: number; // server-owned, exact decimal calculation
}
```

Legacy rows are not migrated or recomputed. Every existing row receives the
effective `calculationMode: "quantity_rate"` compatibility interpretation,
preserving its stored quantity, rate, and amount. New Expense/Salary rows use
`amount` mode and store the entered actual amount. Editing a legacy
Salary/Expense row may intentionally transition it to amount mode; that
transition is written to the normal MIS audit trail. An edit that does not
change the mode retains the original snapshot.

## Calculation APIs

### `GET /api/mis/projects/{id}/entry-services`

Returns active, entry-enabled services in project/tab/service order. Each
service includes the effective flags above. The ordering is also used by bulk
entry and standard reports.

### `POST /api/mis/entries`

For `calculationMode: "quantity_rate"`:

```text
amount = round_half_up(quantity * rate, 6 decimal places)
```

For `calculationMode: "amount"`:

```text
amount = round_half_up(amount, 6 decimal places)
quantity = 1
rate = 1
```

An explicit zero amount is valid and remains a persisted row. The server
rejects negative, non-finite, exponent-form, or over-precision numeric input.

### `POST /api/mis/entries/bulk`

Uses the same per-line calculation rules as single-entry creation and persists
all non-blank lines atomically. A blank line is omitted; a quantity or amount
of zero is explicit and is retained. The response includes each line's
calculation snapshots and effective percentage flag.

### `PATCH /api/mis/entries/{id}` and
`PATCH /api/mis/entries/parents/{id}`

Re-validate the selected calculation mode against the current configuration,
while retaining the original row snapshot unless the caller intentionally
changes a Salary/Expense row from legacy `quantity_rate` to `amount`. Any
intentional mode transition is audited with old and new snapshots.

### `POST /api/mis/projects/{id}/services/reorder`

Requires the existing project `services` permission (or an equivalent global
configuration grant). The body is an atomic complete permutation:

```ts
{ serviceIds: string[] }
```

Every active or inactive service ID in the request must belong to the project,
appear exactly once, and no project service may be omitted. The server assigns
persistent contiguous sequence values in request order and returns services in
that order. Invalid IDs, duplicates, omissions, or unauthorized requests do
not partially update order.

## Percentage behavior

For a row or group whose effective `calculatePercentAgainstIncome` is `true`:

```text
percentage = amount / total income * 100
```

When total income is zero, percentage is `0` (never an error). A false flag
means the percentage is not calculated for that service/type. Income, Cost,
Expense, Salary, and custom type defaults remain configurable; a nullable
project-tab override takes precedence over the type default.

## Compatibility guarantees

- Existing COGS behavior and tables are unchanged.
- Authentication and authorization are evaluated by the existing MIS access
  layer for every endpoint.
- Historical entries preserve their stored amount, quantity, rate, names,
  classifications, and status.
- Migration `005_mis_calculation_and_service_order` is additive and is
  development-only through the existing migration runner.