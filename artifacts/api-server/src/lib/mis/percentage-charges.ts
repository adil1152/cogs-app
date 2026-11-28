import { and, eq, inArray } from "drizzle-orm";
import { db, misPercentageServicesTable, type MisPercentageServiceRow } from "@workspace/db";
import { can, type MisAccess } from "./access";

export type PercentageBase = {
  projectId: string; projectName: string; currency: string; income: string; baseProfit: number;
};

/** Use exact decimal arithmetic before returning the API number. */
export function percentageAmount(income: string, percentage: string): number {
  const scaled = (value: string) => {
    if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error("Expected a non-negative six-decimal amount");
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  };
  // Both inputs are six-decimal NUMERIC strings. Divide by 100 as well as
  // one scale factor, rounding once at the final six-decimal amount.
  const divisor = 100_000_000n;
  return Number((scaled(income) * scaled(percentage) + divisor / 2n) / divisor) / 1_000_000;
}

export function calculatePercentageAdjustments(access: MisAccess, bases: PercentageBase[], services: MisPercentageServiceRow[], projects = [...new Map(bases.map((base) => [base.projectId, { id: base.projectId, name: base.projectName }])).values()]) {
  const currencies = [...new Set(bases.map((base) => base.currency))];
  const combinedBases = currencies.flatMap((currency) => {
    const matching = bases.filter((base) => base.currency === currency);
    const income = matching.reduce((sum, base) => sum + Number(base.income), 0).toFixed(6);
    const baseProfit = Number(matching.reduce((sum, base) => sum + base.baseProfit, 0).toFixed(6));
    return projects.map((project) => ({ projectId: project.id, projectName: project.name, currency, income, baseProfit }));
  });
  return combinedBases.flatMap((base) => {
    const overheadAllowed = can(access, "overhead", base.projectId);
    const opAllowed = can(access, "op_expense", base.projectId);
    if (!overheadAllowed && !opAllowed) return [];
    const section = (kind: "overhead" | "op_expense") => {
      const lines = services.filter((service) => service.projectId === base.projectId && service.kind === kind && service.active)
        .map((service) => ({
          id: service.id, name: service.name, percentage: Number(service.percentage),
          amount: percentageAmount(base.income, service.percentage),
        }));
      return { total: Number(lines.reduce((total, line) => total + line.amount, 0).toFixed(6)), services: lines };
    };
    const overhead = overheadAllowed ? section("overhead") : undefined;
    const opExpense = opAllowed ? section("op_expense") : undefined;
    return [{
      ...base, income: Number(base.income),
      ...(overhead ? { overhead } : {}),
      ...(opExpense ? { opExpense } : {}),
    }];
  });
}

export async function dashboardPercentageAdjustments(access: MisAccess, bases: PercentageBase[], projects: { id: string; name: string }[]) {
  const permitted = projects.filter((project) => can(access, "overhead", project.id) || can(access, "op_expense", project.id));
  if (!permitted.length) return [];
  const projectIds = permitted.map((project) => project.id);
  const services = await db.select().from(misPercentageServicesTable)
    .where(and(inArray(misPercentageServicesTable.projectId, projectIds), eq(misPercentageServicesTable.active, true)))
    .orderBy(misPercentageServicesTable.createdAt, misPercentageServicesTable.id);
  return calculatePercentageAdjustments(access, bases, services, projects);
}

export function adjustedDashboardProfit(access: MisAccess, projectIds: string[], netProfit: number, rows: ReturnType<typeof calculatePercentageAdjustments>) {
  if (!projectIds.every((id) => can(access, "overhead", id) && can(access, "op_expense", id))) return undefined;
  return Number((netProfit - rows.reduce((sum, row) => sum + (row.overhead?.total ?? 0) + (row.opExpense?.total ?? 0), 0)).toFixed(6));
}
