type QuantityState = { quantity: string; quantityOverridden?: boolean };
export function isBlankCostRow(state: QuantityState & { amount: string }) {
  return state.amount.trim() === "" && (state.quantity.trim() === "" || !state.quantityOverridden);
}
type QuantityRow = { id: string; serviceId: string; tabType: string; quantitySourceServiceId?: string | null };

/** Apply defaults only to untouched Cost quantities; never alter amounts or saved rows. */
export function applyQuantityLinks<T extends QuantityState>(state: Record<string, T>, rows: QuantityRow[]): Record<string, T> {
  let next = state;
  for (const row of rows) {
    if (row.tabType !== "cost" || !row.quantitySourceServiceId) continue;
    const target = next[row.id];
    const sourceRow = rows.find((candidate) => candidate.serviceId === row.quantitySourceServiceId && candidate.tabType === "income");
    const source = sourceRow && next[sourceRow.id];
    if (!target || target.quantityOverridden || !source || target.quantity === source.quantity) continue;
    if (next === state) next = { ...state };
    next[row.id] = { ...target, quantity: source.quantity };
  }
  return next;
}
