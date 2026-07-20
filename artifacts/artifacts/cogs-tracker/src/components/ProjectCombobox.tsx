import { useState, type ReactNode } from "react";
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
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProjectComboboxItem {
  id: string;
  name: string;
  location?: string | null;
}

interface ProjectComboboxProps {
  projects: ProjectComboboxItem[];
  onSelect: (id: string) => void;
  trigger: ReactNode;
  value?: string;
  align?: "start" | "end";
  testidPrefix?: string;
}

export function ProjectCombobox({
  projects,
  onSelect,
  trigger,
  value,
  align = "start",
  testidPrefix = "project-pick",
}: ProjectComboboxProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-80 p-0" align={align}>
        <Command>
          <CommandInput
            placeholder="Search projects…"
            data-testid={`${testidPrefix}-search`}
          />
          <CommandList>
            <CommandEmpty>No project found.</CommandEmpty>
            <CommandGroup>
              {projects.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.name} ${p.location ?? ""}`}
                  data-testid={`${testidPrefix}-${p.id}`}
                  onSelect={() => {
                    setOpen(false);
                    onSelect(p.id);
                  }}
                >
                  {value !== undefined && (
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        value === p.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                  )}
                  <span className="truncate">{p.name}</span>
                  {p.location ? (
                    <span className="ml-auto pl-4 text-xs text-muted-foreground truncate">
                      {p.location}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
