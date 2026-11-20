import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  type MisAnalyticsPeriod,
} from "../hooks/useMisAnalyticsQuery";

export type MisPeriodSelection = "all" | "selected" | "none";

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthPeriod(offset: number, index: number): MisAnalyticsPeriod {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
  return {
    id: `period-${index}`,
    label: monthStart.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
    from: localDate(monthStart),
    to: localDate(monthEnd),
  };
}

/** Stable, valid defaults for turning period comparison on. */
export function defaultAnalyticsPeriods(): MisAnalyticsPeriod[] {
  return [monthPeriod(-2, 1), monthPeriod(-1, 2), monthPeriod(0, 3)];
}

function nextPeriodId(periods: MisAnalyticsPeriod[]) {
  let number = periods.length + 1;
  while (periods.some((period) => period.id === `period-${number}`)) number += 1;
  return `period-${number}`;
}

function periodLabel(period: MisAnalyticsPeriod, index: number) {
  return period.label.trim() || `Period ${index + 1}`;
}

export function MisAnalyticsPeriodCards({
  periods,
  onChange,
  disabled = false,
  minPeriods = 3,
  maxPeriods = 24,
}: {
  periods: MisAnalyticsPeriod[];
  onChange: (periods: MisAnalyticsPeriod[]) => void;
  disabled?: boolean;
  minPeriods?: number;
  maxPeriods?: number;
}) {
  const idPrefix = useId();

  function patchPeriod(index: number, patch: Partial<MisAnalyticsPeriod>) {
    onChange(periods.map((period, currentIndex) =>
      currentIndex === index ? { ...period, ...patch } : period,
    ));
  }

  function addPeriod() {
    if (periods.length >= maxPeriods) return;
    const index = periods.length;
    const previous = periods.at(-1);
    const from = previous?.to || localDate(new Date());
    onChange([
      ...periods,
      {
        id: nextPeriodId(periods),
        label: `Period ${index + 1}`,
        from,
        to: from,
      },
    ]);
  }

  function removePeriod(index: number) {
    if (periods.length <= minPeriods) return;
    onChange(periods.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <div className="space-y-3" aria-label="Comparison periods">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Comparison periods</p>
          <p className="text-xs text-muted-foreground">
            Add at least {minPeriods} periods. The server evaluates each complete date window independently.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addPeriod}
          disabled={disabled || periods.length >= maxPeriods}
        >
          <Plus className="mr-2 h-4 w-4" /> Add period
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {periods.map((period, index) => {
          const labelId = `${idPrefix}-label-${index}`;
          const fromId = `${idPrefix}-from-${index}`;
          const toId = `${idPrefix}-to-${index}`;
          return (
            <div key={period.id} className="rounded-lg border bg-muted/20 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{periodLabel(period, index)}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${periodLabel(period, index)}`}
                  onClick={() => removePeriod(index)}
                  disabled={disabled || periods.length <= minPeriods}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor={labelId}>Label</Label>
                <Input
                  id={labelId}
                  value={period.label}
                  placeholder={`Period ${index + 1}`}
                  onChange={(event) => patchPeriod(index, { label: event.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={fromId}>From</Label>
                  <Input
                    id={fromId}
                    type="date"
                    value={period.from}
                    onChange={(event) => patchPeriod(index, { from: event.target.value })}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={toId}>To</Label>
                  <Input
                    id={toId}
                    type="date"
                    value={period.to}
                    onChange={(event) => patchPeriod(index, { to: event.target.value })}
                    disabled={disabled}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {periods.length < minPeriods && (
        <p role="alert" className="text-sm text-amber-700">
          Add {minPeriods - periods.length} more period{minPeriods - periods.length === 1 ? "" : "s"} to compare.
        </p>
      )}
    </div>
  );
}

export function MisAnalyticsPeriodToggle({
  checked,
  onCheckedChange,
  disabled = false,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={`${id}-description`}
      />
      <div className="space-y-1">
        <Label htmlFor={id}>Enable period comparison</Label>
        <p id={`${id}-description`} className="text-xs text-muted-foreground">
          Off keeps the standard single-period request. On compares three or more named periods side by side.
        </p>
      </div>
    </div>
  );
}
