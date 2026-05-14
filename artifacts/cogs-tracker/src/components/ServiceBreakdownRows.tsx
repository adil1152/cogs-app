import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ColorDot } from "@/components/ColorDot";
import { tintBgStyle } from "@/lib/serviceColor";
import { formatCurrency, formatNumber } from "@/lib/format";

interface SubRow {
  subItemId: string;
  name: string;
  color?: string | null;
  totalCost: number;
  totalMandayContribution: number;
  costPerManday: number;
}

interface Row {
  projectId: string;
  projectName: string;
  serviceId: string;
  serviceName: string;
  kind: string;
  color?: string | null;
  totalCost: number;
  totalMandayContribution: number;
  costPerManday: number;
  subBreakdown?: SubRow[];
}

interface Props {
  row: Row;
  onOpen: () => void;
  testId?: string;
}

export function ServiceBreakdownRows({ row, onOpen, testId }: Props) {
  const subs = row.subBreakdown ?? [];
  const hasSubs = subs.length > 0;
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        data-testid={testId}
      >
        <TableCell onClick={onOpen}>{row.projectName}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            {hasSubs ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 -ml-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((x) => !x);
                }}
                aria-label={
                  expanded ? "Collapse sub-services" : "Expand sub-services"
                }
                data-testid={
                  testId ? `${testId}-expand` : undefined
                }
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </Button>
            ) : (
              <span className="inline-block w-6" />
            )}
            <ColorDot color={row.color} name={row.serviceName} />
            <div onClick={onOpen} className="flex-1">
              <div className="font-medium">{row.serviceName}</div>
              <div className="text-xs text-muted-foreground capitalize">
                {row.kind}
                {hasSubs && (
                  <span className="ml-1.5">
                    · {subs.length} sub-
                    {subs.length === 1 ? "service" : "services"}
                  </span>
                )}
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell
          className="text-right tabular-nums"
          onClick={onOpen}
        >
          {formatCurrency(row.totalCost)}
        </TableCell>
        <TableCell
          className="text-right tabular-nums"
          onClick={onOpen}
        >
          {formatNumber(row.totalMandayContribution, 2)}
        </TableCell>
        <TableCell
          className="text-right tabular-nums"
          onClick={onOpen}
        >
          {row.totalMandayContribution > 0
            ? formatCurrency(row.costPerManday)
            : "—"}
        </TableCell>
      </TableRow>
      {expanded &&
        subs.map((sub) => (
          <TableRow
            key={`${row.serviceId}-${sub.subItemId}`}
            style={tintBgStyle(sub.color ?? row.color, 0.06, sub.name ?? row.serviceName)}
            data-testid={
              testId ? `${testId}-sub-${sub.subItemId}` : undefined
            }
          >
            <TableCell />
            <TableCell>
              <div className="flex items-center gap-2 pl-7 text-sm">
                <ColorDot
                  color={sub.color ?? row.color}
                  name={sub.name}
                  size={8}
                />
                <span>{sub.name}</span>
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums text-sm">
              {formatCurrency(sub.totalCost)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-sm">
              {formatNumber(sub.totalMandayContribution, 2)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-sm">
              {sub.totalMandayContribution > 0
                ? formatCurrency(sub.costPerManday)
                : "—"}
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}
