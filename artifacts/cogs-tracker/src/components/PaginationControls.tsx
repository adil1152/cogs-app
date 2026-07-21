import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const PAGE_SIZE = 25;

export function usePagination<T>(
  rows: T[],
  resetKey: unknown = "",
  pageSize: number = PAGE_SIZE,
) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

  // Any change to the filter context (search text, tab, …) restarts at page 1.
  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  // If the list shrinks below the current page, snap back.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );

  return { page, setPage, pageCount, pageRows, total: rows.length, pageSize };
}

export function PaginationControls({
  page,
  pageCount,
  setPage,
  total,
  pageSize = PAGE_SIZE,
  testidPrefix = "pagination",
}: {
  page: number;
  pageCount: number;
  setPage: (p: number) => void;
  total: number;
  pageSize?: number;
  testidPrefix?: string;
}) {
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <div className="text-xs text-muted-foreground" data-testid={`${testidPrefix}-info`}>
        Showing {from}–{to} of {total}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
          data-testid={`${testidPrefix}-prev`}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Previous
        </Button>
        <span className="px-2 text-xs text-muted-foreground tabular-nums">
          Page {page} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page >= pageCount}
          onClick={() => setPage(page + 1)}
          data-testid={`${testidPrefix}-next`}
        >
          Next <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
