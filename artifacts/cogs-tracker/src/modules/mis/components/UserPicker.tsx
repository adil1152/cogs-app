import { useState } from "react";
import {
  getMisListEntryCreatorsQueryKey,
  getMisListUsersQueryKey,
  useMisListEntryCreators,
  useMisListUsers,
} from "@workspace/api-client-react";
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

interface UserPickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Used when the caller can preserve a selected manager but cannot list users. */
  selectedLabel?: string | null;
  canSearch?: boolean;
  /** Restrict options to creators visible in permitted MIS parent projects. */
  source?: "directory" | "entry-creators";
}

export function UserPicker({
  value,
  onChange,
  placeholder = "Select user...",
  disabled,
  selectedLabel,
  canSearch = true,
  source = "directory",
}: UserPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 300);

  const params = {
    search: debouncedSearch || undefined,
    page,
    pageSize: 20,
  };
  const directoryQuery = useMisListUsers(params, {
    query: {
      queryKey: getMisListUsersQueryKey(params),
      enabled: canSearch && source === "directory",
    },
  });
  const creatorQuery = useMisListEntryCreators(params, {
    query: {
      queryKey: getMisListEntryCreatorsQueryKey(params),
      enabled: canSearch && source === "entry-creators",
    },
  });
  const { data, isLoading, isError } = source === "entry-creators" ? creatorQuery : directoryQuery;

  const selectedUser = data?.items?.find(u => u.id === value);
  const displayedName = selectedUser?.displayName ?? selectedLabel;

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
          {displayedName ? displayedName : <span className="text-muted-foreground">{placeholder}</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        {canSearch ? <Command shouldFilter={false}>
          <CommandInput 
            placeholder="Search users..." 
            value={search}
            onValueChange={(next) => {
              setSearch(next);
              setPage(1);
            }}
          />
          <CommandList>
            <CommandEmpty>{isLoading ? <Loader2 className="h-4 w-4 animate-spin mx-auto my-2" /> : isError ? "Users could not be loaded." : "No users found."}</CommandEmpty>
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
                None
              </CommandItem>
              {data?.items?.map((user) => (
                <CommandItem
                  key={user.id}
                  value={user.id}
                  onSelect={() => {
                    onChange(user.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === user.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col">
                    <span>{user.displayName}</span>
                    {user.email && <span className="text-xs text-muted-foreground">{user.email}</span>}
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
        : <div className="p-3 text-sm text-muted-foreground">The current manager is preserved. You do not have permission to search users.</div>}
      </PopoverContent>
    </Popover>
  );
}
