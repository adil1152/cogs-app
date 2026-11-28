import type { MisDashboardAdjustment } from "@workspace/api-client-react";

/** Aggregate only server-authorized charges; never combine currencies or expense kinds. */
export function summarizePercentageCharges(rows: MisDashboardAdjustment[]) {
  const groups = new Map<string, {
    currency: string;
    kind: "overhead" | "opExpense";
    total: number;
    percentage: number;
    services: Map<string, { name: string; amount: number; percentage: number }>;
  }>();
  for (const row of rows) {
    for (const kind of ["overhead", "opExpense"] as const) {
      const section = row[kind];
      if (!section) continue;
      const key = JSON.stringify([row.currency, kind]);
      const group = groups.get(key) ?? { currency: row.currency, kind, total: 0, percentage: 0, services: new Map() };
      group.total += section.total;
      for (const service of section.services) {
        const name = service.name.trim();
        const serviceKey = name.toLocaleLowerCase("en-US");
        const line = group.services.get(serviceKey) ?? { name, amount: 0, percentage: 0 };
        line.amount += service.amount;
        line.percentage += service.percentage;
        group.percentage += service.percentage;
        group.services.set(serviceKey, line);
      }
      groups.set(key, group);
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    total: Number(group.total.toFixed(6)),
    percentage: Number(group.percentage.toFixed(6)),
    services: [...group.services.values()]
      .map((service) => ({ ...service, amount: Number(service.amount.toFixed(6)), percentage: Number(service.percentage.toFixed(6)) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).sort((a, b) => a.currency.localeCompare(b.currency) || a.kind.localeCompare(b.kind));
}
