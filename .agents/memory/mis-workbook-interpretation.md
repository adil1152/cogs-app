---
name: MIS workbook interpretation
description: Business reasons for treating the uploaded MIS spreadsheet as reference rather than a model to copy.
---

Use the written dynamic, period-based MIS requirements over the workbook's
fixed ten-day sections and percentage-based expense examples. Do not import
the workbook's sample transactions automatically.

**Why:** The user supplied the workbook as a business reference, not an
accounting formula specification. Later written requirements explicitly
introduced direct Salary/Expense amounts and configurable percentage displays;
these supersede the initial quantity-times-rate request for those categories.

**How to apply:** Future percentage allocation, fixed reporting-period
templates, or historical spreadsheet imports need their own explicit business
requirements. Displaying an amount as a percentage of income is not permission
to derive or replace that amount using an income allocation formula. Preserve
historical quantity/rate snapshots unless the user intentionally converts an
entry to direct-amount mode.

For bulk Cost entries, treat entered Amount as authoritative and derive the
reference Rate from Amount / Quantity, not the other way around.

**Why:** The subsequent bulk-entry requirement explicitly makes both Cost
Amount and Quantity user inputs. Reconstructing Amount from a rounded Rate
would alter financial values, particularly at zero quantity.

**How to apply:** Preserve entered Cost amounts on bulk edits and in reports;
do not extend this rule to Income or standalone entry forms without a request.

Expense service defaults represent suggested direct amounts in new bulk entries,
not rates to multiply by quantity.

**Why:** The user explicitly permitted reusing the existing default-rate setting
as the Expense default amount rather than adding a separate field.

**How to apply:** Keep defaults editable at entry time; changing configuration
must not rewrite saved amounts or overwrite an in-progress amount.

Advanced date-wise analytics attribute a multi-day record to its period
start, without proration. Keep full report containment separate from the
start-date bucket used for drill-down.

**Why:** The enhancement requested daily/monthly views but supplied no
allocation rule or daily breakdown for period totals. Automatically splitting
amounts would invent accounting data and could change historic totals.

**How to apply:** Any future per-day allocation needs an explicit business
rule; chart and drill-down selections must count the same underlying entries.