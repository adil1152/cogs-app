---
name: MIS percentage expenses
description: Overhead and OP Expense are confidential project-income percentage charges, separate from actual expenses.
---

Overhead and OP Expense are separate project sections with percentage-based services and separately granted visibility. The dashboard adds percentages configured across all selected projects and applies them to combined selected-project income for the selected dates/statuses, separated by currency. Selected settings-only projects contribute percentages even without entries in the period.

**Why:** The user explicitly chose adding percentages from all selected projects rather than choosing one source project, and requested applying the resulting charges to dashboard net profit.

**How to apply:** Never expose restricted service percentages, calculated amounts, or an adjusted profit that can reveal a hidden section. Ordinary financial/report access alone is not permission to see either section. Dashboard net profit and margin include charges only when both permissions cover every selected project; otherwise clearly show pre-charge figures. Recorded breakdowns and ledger values stay unchanged. Do not create duplicate Expense entries. Settings are current calculation rules, not historical snapshots.

The dashboard should show overall Overhead and OP Expense service breakdowns across projects, not project-wise charge cards.

**Why:** The user explicitly requested replacing the project-wise dashboard breakdown with overall service totals.

**How to apply:** Combine matching service names within each expense type and currency, showing summed percentages and amounts calculated on the combined income base. Keep project/date/status filters and section permissions effective; never combine currencies.

MIS gross profit is Income − Cost − Expenses − Salaries, before Overhead and OP Expense.

**Why:** The user approved the dashboard formula and then explicitly confirmed applying it to the rest of the reports.

**How to apply:** Use this formula consistently in MIS reports, exports, and bulk summaries. Do not deduct expenses/salaries twice when deriving net profit. Dashboard net profit continues to deduct authorized OH/OP charges. Leave COGS unchanged.

The dashboard-style service breakdown belongs in a separate Overview Report, directly below Overall Overhead & OP Expense.

**Why:** The user explicitly requested a separate report showing selected-project Income, Cost, Expenses, and Salaries by service, rather than adding this section to the original dashboard.

**How to apply:** Preserve the original dashboard, share its filters and calculation rules, and keep the four service breakdowns below percentage charges in the separate report.

Dashboard and Overview exports must match the visible selected-project scope, not silently exclude projects lacking export permission.

**Why:** Dropping a selected project changes combined income, additive OH/OP percentages, and net profit, producing a misleading export.

**How to apply:** Require export access to every displayed project or ask the user to narrow selection. Preserve section-level confidentiality in both PDF and Excel.

Dashboard, Overview, and their PDFs order categories Income, Cost, Expense, Salaries. Their PDFs omit Recent entries, By entry period, the Entries KPI, and Entries columns.

**Why:** The user requested this presentation order and shorter PDFs.

**How to apply:** Sort by financial class so custom category names remain correctly grouped. Keep recent-entry and period sections on-screen and in Excel; only PDFs omit them.
