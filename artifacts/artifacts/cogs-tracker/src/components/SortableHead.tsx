import { useState, type ReactNode, type ThHTMLAttributes } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";
export type SortState<K extends string = string> = {
  key: K;
  dir: SortDir;
} | null;

/**
 * Column-sort state with a 3-step cycle per column:
 * first click sorts by the column (default direction), second click flips
 * the direction, third click clears sorting (back to the natural order).
 */
export function useSortState<K extends string = string>() {
  const [sort, setSort] = useState<SortState<K>>(null);

  function toggleSort(key: K, firstDir: SortDir = "desc") {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: firstDir };
      if (prev.dir === firstDir)
        return { key, dir: firstDir === "desc" ? "asc" : "desc" };
      return null;
    });
  }

  return { sort, toggleSort };
}

function isEmpty(v: unknown) {
  return v === null || v === undefined || v === "";
}

export function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const ea = isEmpty(a);
  const eb = isEmpty(b);
  if (ea && eb) return 0;
  if (ea) return 1; // empty values always sink to the bottom
  if (eb) return -1;
  let cmp: number;
  if (typeof a === "number" && typeof b === "number") {
    cmp = a - b;
  } else {
    cmp = String(a).localeCompare(String(b), undefined, {
      sensitivity: "base",
      numeric: true,
    });
  }
  return dir === "asc" ? cmp : -cmp;
}

export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: SortState<K>,
  getValue: (row: T, key: K) => unknown,
): T[] {
  if (!sort) return [...rows];
  return [...rows].sort((x, y) =>
    compareValues(getValue(x, sort.key), getValue(y, sort.key), sort.dir),
  );
}

type SortableHeadProps<K extends string> = {
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K, firstDir?: SortDir) => void;
  /** Direction applied on the first click. Numbers default to "desc". */
  firstDir?: SortDir;
  align?: "left" | "right" | "center";
  children: ReactNode;
} & Omit<ThHTMLAttributes<HTMLTableCellElement>, "onClick">;

export function SortableHead<K extends string>({
  sortKey,
  sort,
  onSort,
  firstDir = "desc",
  align = "left",
  children,
  className,
  ...props
}: SortableHeadProps<K>) {
  const active = sort?.key === sortKey ? sort.dir : null;
  const Icon = active === "desc" ? ArrowDown : active === "asc" ? ArrowUp : ArrowUpDown;
  return (
    <TableHead
      {...props}
      onClick={() => onSort(sortKey, firstDir)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSort(sortKey, firstDir);
        }
      }}
      tabIndex={0}
      role="columnheader"
      aria-sort={
        active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"
      }
      className={cn(
        "cursor-pointer select-none hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
      data-testid={`sort-${sortKey}`}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1",
          align === "right" && "w-full justify-end",
          align === "center" && "w-full justify-center",
        )}
      >
        {children}
        <Icon
          className={cn(
            "h-3 w-3 shrink-0",
            active ? "text-accent" : "text-muted-foreground/50",
          )}
        />
      </span>
    </TableHead>
  );
}
