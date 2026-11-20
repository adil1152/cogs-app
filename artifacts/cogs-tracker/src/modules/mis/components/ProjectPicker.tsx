import { useState } from "react";
import { useMisListProjects } from "@workspace/api-client-react";
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDebounce } from "@/hooks/use-debounce";

interface ProjectPickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  selectedLabel?: string | null;
}

export function ProjectPicker({ value, onChange, placeholder = "Select project...", disabled, selectedLabel }: ProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError } = useMisListProjects({
    search: debouncedSearch || undefined,
    page,
    pageSize: 20,
  });

  const selectedProject = data?.items?.find(p => p.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {selectedProject?.name ?? selectedLabel ?? <span className="text-muted-foreground">{placeholder}</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput 
            placeholder="Search projects..." 
            value={search}
            onValueChange={(next) => {
              setSearch(next);
              setPage(1);
            }}
          />
          <CommandList>
            <CommandEmpty>{isLoading ? <Loader2 className="h-4 w-4 animate-spin mx-auto my-2" /> : isError ? "Projects could not be loaded." : "No projects found."}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    !value ? "opacity-100" : "opacity-0"
                  )}
                />
                Global
              </CommandItem>
              {data?.items?.map((project) => (
                <CommandItem
                  key={project.id}
                  value={project.id}
                  onSelect={() => {
                    onChange(project.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === project.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col">
                    <span>{project.name}</span>
                    <span className="text-xs text-muted-foreground">{project.code}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {data && data.total > data.pageSize && (
            <div className="flex items-center justify-between border-t p-2 text-xs text-muted-foreground">
              <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>
                <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Previous
              </Button>
              <span>Page {data.page}</span>
              <Button type="button" variant="ghost" size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(current => current + 1)}>
                Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
