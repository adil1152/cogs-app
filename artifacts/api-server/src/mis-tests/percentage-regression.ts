import assert from "node:assert/strict";
import { pool, type MisPercentageServiceRow } from "@workspace/db";
import { adjustedDashboardProfit, calculatePercentageAdjustments, percentageAmount } from "../lib/mis/percentage-charges";
import type { MisAccess, MisPermission } from "../lib/mis/access";

const access = (global: MisPermission[] = [], project: MisPermission[] = []): MisAccess => ({
  userId: "test", globalAccess: global.length > 0, globalRoles: [], roles: ["custom"],
  globalPermissions: new Set(global), projectPermissions: new Map([["a", new Set(project)]]), projectIds: ["a"],
});
const bases = [
  { projectId: "a", projectName: "A", currency: "SAR", income: "1000.000000", baseProfit: 700 },
  { projectId: "a", projectName: "A", currency: "USD", income: "200.000000", baseProfit: 100 },
  { projectId: "b", projectName: "B", currency: "SAR", income: "9000.000000", baseProfit: 8000 },
];
const service = (kind: string, percentage: string, active = true): MisPercentageServiceRow => ({
  id: kind + percentage, projectId: "a", kind, name: kind, percentage, active,
  createdAt: new Date(), updatedAt: new Date(),
});
const services = [service("overhead", "10.000000"), service("op_expense", "5.000000"), service("overhead", "99.000000", false)];
assert.equal(percentageAmount("1000.000000", "10.000000"), 100);
assert.equal(percentageAmount("123.456789", "2.500000"), 3.08642);
assert.equal(percentageAmount("0.000000", "100.000000"), 0);
assert.equal(percentageAmount("100.000000", "0.000000"), 0);
assert.deepEqual(calculatePercentageAdjustments(access(["financial", "reports"]), bases, services), []);
const overhead = calculatePercentageAdjustments(access([], ["overhead"]), bases, services);
assert.equal(overhead.length, 2);
assert.equal(overhead[0].overhead?.total, 1000);
assert.equal("opExpense" in overhead[0], false);
assert.equal("adjustedProfit" in overhead[0], false);
const both = calculatePercentageAdjustments(access([], ["overhead", "op_expense"]), bases, services);
assert.equal("adjustedProfit" in both[0], false);
assert.equal(both[1].currency, "USD");
assert.equal(both[1].overhead?.total, 20);
assert.equal(both[0].overhead?.services.length, 1);
const opOnly = calculatePercentageAdjustments(access([], ["op_expense"]), bases, services);
assert.equal("overhead" in opOnly[0], false);
assert.equal(opOnly[0].opExpense?.total, 500);
assert.equal(calculatePercentageAdjustments(access(["overhead", "op_expense"]), bases, services).length, 4);
const empty = calculatePercentageAdjustments(access([], ["overhead", "op_expense"]), bases, []);
assert.equal(empty[0].overhead?.total, 0);
assert.equal(adjustedDashboardProfit(access([], ["overhead", "op_expense"]), ["a", "b"], 8700, both.filter((row) => row.currency === "SAR")), undefined);
const fullAccess = access(["overhead", "op_expense"]);
const extraService = { ...service("overhead", "2.000000"), projectId: "b", id: "b-oh" };
const full = calculatePercentageAdjustments(fullAccess, bases, [...services, extraService]);
const sar = full.filter((row) => row.currency === "SAR");
assert.equal(sar.reduce((sum, row) => sum + (row.overhead?.total ?? 0), 0), 1200);
assert.equal(adjustedDashboardProfit(fullAccess, ["a", "b"], 8700, sar), 7000);
// An explicitly selected settings-only project still contributes its percentages.
const projects = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
const settingsOnly = calculatePercentageAdjustments(fullAccess, [bases[0]], [extraService], projects);
assert.equal(settingsOnly.find((row) => row.projectId === "b")?.overhead?.total, 20);
assert.equal(adjustedDashboardProfit(fullAccess, ["a", "b"], 700, settingsOnly), 680);
// Deselecting B removes its percentage; rates are additive, not compounded.
assert.equal(calculatePercentageAdjustments(fullAccess, [bases[0]], [extraService])[0].overhead?.total, 0);
assert.equal(adjustedDashboardProfit(fullAccess, ["a"], 700, []), 700);
assert.deepEqual(calculatePercentageAdjustments(fullAccess, [], services, projects), []);
console.log("Percentage calculation, currency separation and permission regression checks passed");
await pool.end();
