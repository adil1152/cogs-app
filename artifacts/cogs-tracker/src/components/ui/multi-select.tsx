import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
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

export interface MultiSelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allLabel?: string;
  className?: string;
  disabled?: boolean;
  /**
   * An empty selected list traditionally means "all".  These optional props
   * let scoped report filters distinguish that state from an explicit "none"
   * selection without changing the query shape sent to the API.
   */
  selectionMode?: "all" | "selected" | "none";
  onSelectionModeChange?: (mode: "all" | "selected" | "none") => void;
  "data-testid"?: string;
}

/**
 * Searchable multi-select combobox built on cmdk + Popover. Selection is shown
 * as a count summary in the trigger; selected rows have a leading check mark
 * inside the popover. Click an item to toggle.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  allLabel = "All",
  className,
  disabled,
  selectionMode = selected.length ? "selected" : "all",
  onSelectionModeChange,
  "data-testid": testId,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);

  function toggle(value: string) {
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value));
      if (selected.length === 1) onSelectionModeChange?.("none");
    } else {
      onChange([...selected, value]);
      onSelectionModeChange?.("selected");
    }
  }

  const triggerLabel =
    selectionMode === "none"
      ? "None (empty result)"
      : selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? "1 selected")
        : `${selected.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between font-normal",
            selected.length === 0 && "text-muted-foreground",
            className,
          )}
          data-testid={testId}
        >
          <span className="truncate text-left">
            {selected.length === 0 ? placeholder : triggerLabel}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {selected.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange([]);
                }}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
                aria-label="Clear selection"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[220px]"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {onSelectionModeChange && (
              <CommandGroup heading="Scope">
                <CommandItem
                  value="select all authorized scope"
                  onSelect={() => {
                    onChange([]);
                    onSelectionModeChange("all");
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", selectionMode === "all" ? "opacity-100" : "opacity-0")} />
                  <span>{allLabel}</span>
                </CommandItem>
                <CommandItem
                  value="select none empty result"
                  onSelect={() => {
                    onChange([]);
                    onSelectionModeChange("none");
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", selectionMode === "none" ? "opacity-100" : "opacity-0")} />
                  <span>None (empty result)</span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selectedSet.has(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.hint ?? ""}`}
                    onSelect={() => toggle(option.value)}
                    data-testid={`multi-option-${option.value}`}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="flex-1 truncate">{option.label}</span>
                    {option.hint && (
                      <span className="ml-2 text-xs text-muted-foreground truncate">
                        {option.hint}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
