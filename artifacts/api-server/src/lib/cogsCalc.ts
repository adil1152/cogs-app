/**
 * Food formula weights (per spec):
 * Breakfast = 0.2 manday
 * Lunch / Dinner / Midnight / MealBox = 0.4 manday each
 * Total food mandays = B*0.2 + L*0.4 + D*0.4 + M*0.4 + MB*0.4
 */
export const MEAL_WEIGHTS = {
  breakfast: 0.2,
  lunch: 0.4,
  dinner: 0.4,
  midnight: 0.4,
  mealBox: 0.4,
} as const;

export interface FoodQuantities {
  breakfastQty?: number | null;
  lunchQty?: number | null;
  dinnerQty?: number | null;
  midnightQty?: number | null;
  mealBoxQty?: number | null;
}

export function calcFoodMandays(q: FoodQuantities): number {
  return (
    (q.breakfastQty ?? 0) * MEAL_WEIGHTS.breakfast +
    (q.lunchQty ?? 0) * MEAL_WEIGHTS.lunch +
    (q.dinnerQty ?? 0) * MEAL_WEIGHTS.dinner +
    (q.midnightQty ?? 0) * MEAL_WEIGHTS.midnight +
    (q.mealBoxQty ?? 0) * MEAL_WEIGHTS.mealBox
  );
}

export function safeDivide(a: number, b: number): number {
  if (!b || b === 0) return 0;
  return a / b;
}
