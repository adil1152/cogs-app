import assert from "node:assert/strict";
import type { MisDashboardAdjustment } from "@workspace/api-client-react";
import { summarizePercentageCharges } from "./percentageSummary";

const section = (name: string, amount: number, percentage = 10) => ({
  total: amount, services: [{ id: name, name, amount, percentage }],
});
const base = { projectName: "Project", income: 100, baseProfit: 50 };
const rows: MisDashboardAdjustment[] = [
  { ...base, projectId: "a", currency: "SAR", overhead: section("Admin", 10), opExpense: section("Admin", 5) },
  { ...base, projectId: "b", currency: "SAR", overhead: section(" admin ", 20, 20) },
  { ...base, projectId: "c", currency: "USD", overhead: section("Admin", 3) },
  { ...base, projectId: "d", currency: "SAR" },
];
const result = summarizePercentageCharges(rows);
assert.equal(result.length, 3);
const overhead = result.find((group) => group.currency === "SAR" && group.kind === "overhead")!;
assert.equal(overhead.total, 30);
assert.deepEqual(overhead.services, [{ name: "Admin", amount: 30, percentage: 30 }]);
assert.equal(overhead.percentage, 30);
assert.equal(result.find((group) => group.kind === "opExpense")!.total, 5);
assert.equal(result.find((group) => group.currency === "USD")!.total, 3);
assert.deepEqual(summarizePercentageCharges([rows[3]]), []);
assert.deepEqual(summarizePercentageCharges([]), []);
assert.equal(summarizePercentageCharges([rows[1]])[0].total, 20);
assert.equal(summarizePercentageCharges([rows[1]]).length, 1);
assert.deepEqual(summarizePercentageCharges([
  { ...base, projectId: "a", currency: "SAR", overhead: { total: 0, services: [] } },
])[0].services, []);
console.log("Percentage summary regression checks passed");
