import assert from "node:assert/strict";
import { applyQuantityLinks, isBlankCostRow } from "./quantityLinks";

const rows = [
  { id: "i", serviceId: "income", tabType: "income" },
  { id: "c", serviceId: "cost", tabType: "cost", quantitySourceServiceId: "income" },
];
const initial = {
  i: { quantity: "10", amount: "100" },
  c: { quantity: "", amount: "", quantityOverridden: false },
};
const copied = applyQuantityLinks(initial, rows);
assert.equal(copied.c.quantity, "10");
assert.equal(copied.c.amount, "");
assert.equal(initial.c.quantity, "");
assert.equal(isBlankCostRow(copied.c), true);
assert.equal(isBlankCostRow({ ...copied.c, amount: "0" }), false);
assert.equal(applyQuantityLinks(copied, rows), copied);
assert.equal(applyQuantityLinks({ ...copied, i: { ...copied.i, quantity: "0" } }, rows).c.quantity, "0");
assert.equal(applyQuantityLinks({ ...copied, i: { ...copied.i, quantity: "" } }, rows).c.quantity, "");
assert.equal(applyQuantityLinks({ ...copied, c: { ...copied.c, quantity: "7", quantityOverridden: true } }, rows).c.quantity, "7");
assert.equal(applyQuantityLinks(copied, [rows[1]]), copied);
assert.equal(applyQuantityLinks(initial, [{ ...rows[1], quantitySourceServiceId: null }, rows[0]]), initial);
assert.equal(applyQuantityLinks(initial, [rows[1], rows[0]]).c.quantity, "10");
console.log("Quantity link regression checks passed");
