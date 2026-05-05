import { format, parseISO } from "date-fns";

export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number | null | undefined, fractionDigits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatDate(iso: string, fmt = "MMM d, yyyy"): string {
  try {
    return format(parseISO(iso), fmt);
  } catch {
    return iso;
  }
}

export function formatDateShort(iso: string): string {
  return formatDate(iso, "MMM d");
}

export function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return format(d, "yyyy-MM-dd");
}
