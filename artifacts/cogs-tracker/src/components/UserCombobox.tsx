import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface UserComboboxItem {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export function userDisplayName(u: UserComboboxItem): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return name || (u.email ?? "");
}

export function UserCombobox({
  users,
  value,
  onSelect,
  placeholder = "Choose a user",
  testidPrefix = "user-pick",
  className,
}: {
  users: UserComboboxItem[];
  value: string;
  onSelect: (id: string) => void;
  placeholder?: string;
  testidPrefix?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = users.find((u) => u.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
          data-testid={`${testidPrefix}-trigger`}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? userDisplayName(selected) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search by name or email…"
            data-testid={`${testidPrefix}-search`}
          />
          <CommandList>
            <CommandEmpty>No user found.</CommandEmpty>
            <CommandGroup>
              {users.map((u) => (
                <CommandItem
                  key={u.id}
                  value={`${userDisplayName(u)} ${u.email ?? ""}`}
                  data-testid={`${testidPrefix}-${u.id}`}
                  onSelect={() => {
                    setOpen(false);
                    onSelect(u.id);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      value === u.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="truncate">{userDisplayName(u)}</div>
                    {u.email && (
                      <div className="text-xs text-muted-foreground truncate">
                        {u.email}
                      </div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
