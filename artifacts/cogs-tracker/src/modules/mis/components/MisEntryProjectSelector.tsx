import { useState } from "react";
import { Search } from "lucide-react";
import {
  getMisListProjectsQueryKey,
  useMisListProjects,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MisEntryProjectSelectorProps = {
  id: string;
  label: string;
  value: string;
  selectedName?: string | null;
  activeOnly?: boolean;
  disabled?: boolean;
  onChange: (project: { id: string; name: string }) => void;
};

/**
 * A paginated picker keeps project selection usable for organizations with
 * more projects than a single list response can hold.
 */
export function MisEntryProjectSelector({
  id,
  label,
  value,
  selectedName,
  activeOnly = false,
  disabled = false,
  onChange,
}: MisEntryProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const params = {
    search: search || undefined,
    status: activeOnly ? "active" as const : undefined,
    page,
    pageSize: 20,
  };
  const { data, isLoading } = useMisListProjects(params, {
    query: { queryKey: getMisListProjectsQueryKey(params), enabled: open },
  });
  const selected = data?.items.find((project) => project.id === value);
  const displayName = selected?.name || selectedName || (value ? "Selected project" : "Select a project");

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Button
        id={id}
        type="button"
        variant="outline"
        className="w-full justify-between font-normal"
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid={`button-${id}`}
      >
        <span className="truncate">{displayName}</span>
        <span className="ml-3 text-xs text-muted-foreground">Change</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Select project</DialogTitle>
            <DialogDescription>Search all projects you are permitted to use.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="pl-9"
              placeholder="Search projects by name"
              aria-label="Search projects"
              data-testid={`input-${id}-search`}
            />
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-1">
            {isLoading ? (
              <p className="p-3 text-sm text-muted-foreground">Loading projects…</p>
            ) : data?.items.length ? data.items.map((project) => (
              <Button
                key={project.id}
                type="button"
                variant={project.id === value ? "secondary" : "ghost"}
                className="h-auto w-full justify-start px-3 py-2 text-left"
                onClick={() => {
                  onChange({ id: project.id, name: project.name });
                  setOpen(false);
                }}
                data-testid={`button-project-${project.id}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{project.name}</span>
                  <span className="block text-xs text-muted-foreground">{project.code} · {project.currency}</span>
                </span>
              </Button>
            )) : (
              <p className="p-3 text-sm text-muted-foreground">No matching projects found.</p>
            )}
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{data ? `${data.total} project${data.total === 1 ? "" : "s"}` : ""}</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((current) => current - 1)} data-testid={`button-${id}-previous`}>
                Previous
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!data || page * data.pageSize >= data.total} onClick={() => setPage((current) => current + 1)} data-testid={`button-${id}-next`}>
                Next
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}