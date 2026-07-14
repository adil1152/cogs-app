/**
 * Default meal types seeded when a food service is created without an
 * explicit meal list. Weights are manday fractions (0.2 = 20%).
 */
export const DEFAULT_MEAL_ITEMS: ReadonlyArray<{
  name: string;
  weight: number;
}> = [
  { name: "Breakfast", weight: 0.2 },
  { name: "Lunch", weight: 0.4 },
  { name: "Dinner", weight: 0.4 },
  { name: "Midnight", weight: 0.4 },
  { name: "Meal box", weight: 0.4 },
];

export interface MealRow {
  weight: number | string;
  qty: number | string;
}

/** Auto mandays for a food line: sum of qty x snapshot weight. */
export function calcMealRowsMandays(rows: MealRow[]): number {
  return rows.reduce((sum, r) => {
    const w = Number(r.weight);
    const q = Number(r.qty);
    if (Number.isNaN(w) || Number.isNaN(q)) return sum;
    return sum + w * q;
  }, 0);
}

export function safeDivide(a: number, b: number): number {
  if (!b || b === 0) return 0;
  return a / b;
}
