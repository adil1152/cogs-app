export interface MealRowLike {
  weight: number | string;
  qty: number | string;
}

/**
 * Auto mandays for a food line: sum of qty x weight, where each weight is
 * the meal type's manday fraction (0.2 = 20%). Weights come from the
 * service's meal items (new entries) or the entry's saved snapshot (edits).
 */
export function computeMealRowsMandays(rows: MealRowLike[]): number {
  return rows.reduce((sum, r) => {
    const w = Number(r.weight);
    const q = Number(r.qty);
    if (Number.isNaN(w) || Number.isNaN(q)) return sum;
    return sum + w * q;
  }, 0);
}

/** UI shows whole percentages (20) but the API stores fractions (0.2). */
export function weightToPercent(weight: number | string): number {
  return Math.round(Number(weight) * 100 * 100) / 100;
}

export function percentToWeight(percent: number | string): number {
  return Math.round((Number(percent) / 100) * 1000) / 1000;
}

export function safeCostPerManday(totalCost: number, totalMandays: number): number | null {
  if (!totalMandays || totalMandays === 0) return null;
  return totalCost / totalMandays;
}
