import { useState } from "react";
import { Check, Palette } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { MisAppearance, SaveResult } from "../hooks/useMisAppearance";

interface Props {
  appearance: MisAppearance;
  savedDefault: MisAppearance;
  isDirty: boolean;
  canSave: boolean;
  setAppearance: (a: MisAppearance) => void;
  saveAsDefault: () => SaveResult;
  isCollapsed?: boolean;
  compact?: boolean;
}

const OPTIONS: { value: MisAppearance; label: string; hint: string }[] = [
  { value: "classic", label: "Classic", hint: "Original MIS look" },
  { value: "glass", label: "Glass", hint: "Warm frosted panels" },
];

export function MisAppearancePicker({ appearance, savedDefault, isDirty, canSave, setAppearance, saveAsDefault, isCollapsed, compact }: Props) {
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const label = appearance === "glass" ? "Glass" : "Classic";

  return (
    <Popover onOpenChange={() => setStatus(null)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="button-mis-appearance"
          aria-label={`Appearance: ${label}`}
          title={`Appearance: ${label}`}
          className={cn(
            "flex items-center rounded-md text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground transition-colors h-10",
            compact ? "w-8 h-8 justify-center" : isCollapsed ? "md:justify-center md:px-0 px-3 gap-3 w-full" : "px-3 gap-3 w-full",
          )}
        >
          <Palette className="h-4 w-4 shrink-0" />
          {!compact && (
            <span className={cn("whitespace-nowrap", isCollapsed ? "md:hidden" : "block")}>
              Appearance <span className="text-sidebar-foreground/50">· {label}</span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-72 p-3 space-y-3" data-testid="panel-mis-appearance">
        <div>
          <div className="text-sm font-semibold">MIS appearance</div>
          <p className="text-xs text-muted-foreground">Choosing an option previews it for this session only.</p>
        </div>
        <div role="radiogroup" aria-label="MIS appearance" className="grid grid-cols-2 gap-2">
          {OPTIONS.map((o) => {
            const active = appearance === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`option-mis-appearance-${o.value}`}
                onClick={() => { setAppearance(o.value); setStatus(null); }}
                className={cn(
                  "relative rounded-md border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary ring-1 ring-primary" : "hover:bg-muted",
                )}
              >
                <span
                  aria-hidden
                  className={cn("block h-8 rounded mb-2 border", o.value === "glass" ? "mis-appearance-swatch-glass" : "bg-card")}
                />
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
                {active && <Check className="absolute top-1.5 right-1.5 h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
        <div className="space-y-1.5 border-t pt-3">
          <button
            type="button"
            data-testid="button-mis-appearance-save-default"
            disabled={!canSave || !isDirty}
            onClick={() => {
              const r = saveAsDefault();
              setStatus(r.ok ? { kind: "ok", text: `Saved: ${label} is now your default.` } : { kind: "error", text: r.error });
            }}
            className="w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
          >
            Save as default
          </button>
          <p className="text-[11px] text-muted-foreground" data-testid="text-mis-appearance-scope">
            Default is saved for this user on this browser. Current default:{" "}
            <span className="font-medium text-foreground" data-testid="text-mis-appearance-saved">{savedDefault === "glass" ? "Glass" : "Classic"}</span>
            {isDirty && " (previewing unsaved choice)"}
          </p>
          {status && (
            <p role={status.kind === "error" ? "alert" : "status"} data-testid={`status-mis-appearance-${status.kind}`}
              className={cn("text-xs font-medium", status.kind === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>
              {status.text}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
