export const MEAL_WEIGHTS = {
  breakfast: 0.2,
  lunch: 0.4,
  dinner: 0.4,
  midnight: 0.4,
  mealBox: 0.4,
} as const;

export interface MealCounts {
  breakfastQty?: number;
  lunchQty?: number;
  dinnerQty?: number;
  midnightQty?: number;
  mealBoxQty?: number;
}

export function computeMealMandays(meals: MealCounts): number {
  const b = meals.breakfastQty ?? 0;
  const l = meals.lunchQty ?? 0;
  const d = meals.dinnerQty ?? 0;
  const m = meals.midnightQty ?? 0;
  const mb = meals.mealBoxQty ?? 0;
  return (
    b * MEAL_WEIGHTS.breakfast +
    l * MEAL_WEIGHTS.lunch +
    d * MEAL_WEIGHTS.dinner +
    m * MEAL_WEIGHTS.midnight +
    mb * MEAL_WEIGHTS.mealBox
  );
}

export function safeCostPerManday(totalCost: number, totalMandays: number): number | null {
  if (!totalMandays || totalMandays === 0) return null;
  return totalCost / totalMandays;
}
