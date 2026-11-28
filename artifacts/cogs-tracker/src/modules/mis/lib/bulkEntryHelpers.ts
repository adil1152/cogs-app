export type BulkCalculationMode = "quantity_rate" | "amount";

/**
 * Cost rows have a deliberately different source of truth from every other
 * quantity/rate row.  The configured tab type (rather than financialClass) is
 * used so a custom tab classified as cost keeps its configured behavior.
 */
export function isCostBulkRow(value: { tabType?: string; type?: string }): boolean {
  return (value.tabType ?? value.type ?? "").toLowerCase() === "cost";
}

export function parseFiniteNumber(value: string | number | null | undefined): number | null {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}

export function isBlankBulkValue(value: string | null | undefined): boolean {
  return !value?.trim();
}

export function calculatedCostRate(quantity: string | number | null | undefined, amount: string | number | null | undefined): number | null {
  const parsedQuantity = parseFiniteNumber(quantity);
  const parsedAmount = parseFiniteNumber(amount);
  if (parsedQuantity == null || parsedAmount == null || parsedQuantity <= 0) return null;
  const result = parsedAmount / parsedQuantity;
  return Number.isFinite(result) ? result : null;
}

export function roundedAmount(value: number): number {
  return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : 0;
}

export function quantityRateAmount(quantity: string | number | null | undefined, rate: string | number | null | undefined): number | null {
  const parsedQuantity = parseFiniteNumber(quantity);
  const parsedRate = parseFiniteNumber(rate);
  if (parsedQuantity == null || parsedRate == null) return null;
  const amount = parsedQuantity * parsedRate;
  return Number.isFinite(amount) ? roundedAmount(amount) : null;
}

export function directAmountValue(
  amount: string | number | null | undefined,
  explicitSave = false,
): number | null {
  const text = typeof amount === "number" ? String(amount) : amount ?? "";
  if (isBlankBulkValue(text)) {
    return explicitSave ? 0 : null;
  }
  return parseFiniteNumber(amount);
}

/**
 * Return the amount used by live previews.  Cost amount is intentionally read
 * directly and never reconstructed from a rounded rate.
 */
export function bulkRowAmount(
  row: { tabType?: string; type?: string },
  state: { quantity: string; rate: string; amount: string },
  explicitSave = false,
): number | null {
  if (isCostBulkRow(row)) return directAmountValue(state.amount, explicitSave);
  const mode = (row as { calculationMode?: BulkCalculationMode }).calculationMode;
  return mode === "amount"
    ? directAmountValue(state.amount, explicitSave)
    : quantityRateAmount(
      explicitSave && isBlankBulkValue(state.quantity) ? "0" : state.quantity,
      state.rate,
    );
}

export function incomePercentage(amount: number, income: number, enabled: boolean): number | null {
  if (!enabled || income <= 0 || !Number.isFinite(amount) || !Number.isFinite(income)) return null;
  return (amount / income) * 100;
}

export function percentageLabel(amount: number, income: number, enabled: boolean): string {
  if (!enabled) return "—";
  const percentage = incomePercentage(amount, income, enabled);
  return percentage == null ? "N/A" : `${percentage.toFixed(2)}%`;
}

export function bulkGroupRank(type: string | undefined): number {
  switch ((type ?? "").toLowerCase()) {
    case "income": return 0;
    case "cost": return 1;
    case "expense": return 2;
    case "salary": return 3;
    default: return 4;
  }
}

export function formatCalculatedRate(rate: number | null): string {
  return rate == null ? "N/A" : Number.isInteger(rate) ? String(rate) : String(Number(rate.toFixed(6)));
}