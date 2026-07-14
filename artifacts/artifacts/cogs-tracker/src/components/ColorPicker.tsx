import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PALETTE, normalizeHex, resolveServiceColor } from "@/lib/serviceColor";
import { cn } from "@/lib/utils";

interface Props {
  /** Current color (#rrggbb) or null when using auto-color. */
  value: string | null;
  onChange: (next: string | null) => void;
  /** Used to compute the "auto" preview color (falls back when value is null). */
  fallbackName?: string | null;
  size?: number;
  disabled?: boolean;
  className?: string;
}

export function ColorPicker({
  value,
  onChange,
  fallbackName,
  size = 22,
  disabled,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const preview = resolveServiceColor(value, fallbackName);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(value ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Pick service color"
          className={cn(
            "rounded-full border border-black/15 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50",
            className,
          )}
          style={{ width: size, height: size, backgroundColor: preview }}
        />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-3" align="start">
        <div className="grid grid-cols-6 gap-2">
          {PALETTE.map((hex) => {
            const selected = (value ?? "").toLowerCase() === hex;
            return (
              <button
                key={hex}
                type="button"
                aria-label={hex}
                onClick={() => {
                  onChange(hex);
                  setDraft(hex);
                  setOpen(false);
                }}
                className={cn(
                  "h-7 w-7 rounded-full border border-black/15 transition",
                  selected && "ring-2 ring-offset-2 ring-ring",
                )}
                style={{ backgroundColor: hex }}
              />
            );
          })}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            Custom hex (#rrggbb)
          </label>
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="#3366ff"
              className="h-8"
            />
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const norm = normalizeHex(draft);
                if (norm) {
                  onChange(norm);
                  setOpen(false);
                }
              }}
            >
              Set
            </Button>
          </div>
        </div>
        <div className="flex justify-between items-center pt-1">
          <span className="text-xs text-muted-foreground">
            {value ? "Custom" : "Auto"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(null);
              setDraft("");
              setOpen(false);
            }}
          >
            Reset to auto
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
