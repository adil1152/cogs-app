import { useState } from "react";
import {
  getMisListProjectsQueryKey,
  useMisListProjects,
  type MisProject,
} from "@workspace/api-client-react";
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface MisReportProjectPickerProps {
  selected: string[];
  onChange: (ids: string[]) => void;
  isReportProject: (project: MisProject) => boolean;
  disabled?: boolean;
  selectionMode?: "all" | "selected" | "none";
  onSelectionModeChange?: (mode: "all" | "selected" | "none") => void;
}

/**
 * A project filter backed by the paginated MIS project endpoint.  It deliberately
 * searches the server rather than deriving choices from report rows.
 */
export function MisReportProjectPicker({
  selected,
  onChange,
  isReportProject,
  disabled,
  selectionMode = selected.length ? "selected" : "all",
  onSelectionModeChange,
}: MisReportProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const params = { search: search || undefined, page, pageSize: 20 };
  const { data, isLoading, error } = useMisListProjects(params, {
    query: { queryKey: getMisListProjectsQueryKey(params), enabled: open },
  });
  const projects = (data?.items ?? []).filter(isReportProject);
  const visibleSelected = projects.filter((project) => selected.includes(project.id));

  function changeSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function toggle(projectId: string) {
    if (selected.includes(projectId)) {
      onChange(selected.filter((id) => id !== projectId));
      if (selected.length === 1) onSelectionModeChange?.("none");
    } else {
      onChange([...selected, projectId]);
      onSelectionModeChange?.("selected");
    }
  }

  const triggerText = selectionMode === "none"
    ? "None (empty result)"
    : selected.length === 0
    ? "All permitted projects"
    : selected.length === 1
      ? (visibleSelected[0] ? `${visibleSelected[0].code} — ${visibleSelected[0].name}` : "1 project selected")
      : `${selected.length} projects selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-10 w-full justify-between font-normal", !selected.length && "text-muted-foreground")}
        >
          <span className="truncate">{triggerText}</span>
          <span className="ml-2 flex items-center gap-1">
            {selected.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Clear selected projects"
                className="rounded p-0.5 hover:bg-muted"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onChange([]);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,var(--radix-popover-trigger-width))] p-3">
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(event) => changeSearch(event.target.value)}
            className="pl-9"
            placeholder="Search permitted projects…"
          />
        </div>
        {onSelectionModeChange && (
          <div className="mb-2 grid grid-cols-2 gap-2 border-b pb-2">
            <Button
              type="button"
              variant={selectionMode === "all" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                onChange([]);
                onSelectionModeChange("all");
              }}
            >
              All permitted
            </Button>
            <Button
              type="button"
              variant={selectionMode === "none" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                onChange([]);
                onSelectionModeChange("none");
              }}
            >
              None
            </Button>
          </div>
        )}
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {isLoading && <p className="px-2 py-5 text-center text-sm text-muted-foreground">Loading projects…</p>}
          {error && <p className="px-2 py-5 text-center text-sm text-destructive">Projects could not be loaded.</p>}
          {!isLoading && !error && projects.length === 0 && (
            <p className="px-2 py-5 text-center text-sm text-muted-foreground">No report-enabled projects match.</p>
          )}
          {projects.map((project) => {
            const checked = selected.includes(project.id);
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => toggle(project.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
              >
                <Check className={cn("h-4 w-4 text-primary", checked ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                <span className="text-xs text-muted-foreground">{project.code}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
          <span>{data ? `${data.total} permitted project${data.total === 1 ? "" : "s"}` : ""}</span>
          <span className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Previous projects page" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span>Page {page}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Next projects page" disabled={!data || page * data.pageSize >= data.total} onClick={() => setPage((value) => value + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}