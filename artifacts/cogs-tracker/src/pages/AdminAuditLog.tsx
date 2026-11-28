import { Fragment, useEffect, useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListSystemAuditLog,
  getListSystemAuditLogQueryKey,
  type ListSystemAuditLogParams,
  type ListSystemAuditLog200ItemsItem,
  ListSystemAuditLogModule,
  ListSystemAuditLogAction,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = ListSystemAuditLog200ItemsItem;
const ALL = "__all";

function humanize(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function isRedacted(v: unknown): boolean {
  return typeof v === "string" && /^\[?(redacted|hidden|\*{3,})\]?$/i.test(v.trim());
}

function formatValue(v: unknown): string {
  if (v === undefined) return "(not set)";
  if (v === null) return "(empty)";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v === "" ? "(blank)" : v;
  if (typeof v === "number") return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: "" };
  return {
    date: d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}

function relative(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

const ACTION_STYLE: Record<string, { label: string; cls: string }> = {
  INSERT: { label: "Created", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  UPDATE: { label: "Updated", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  DELETE: { label: "Deleted", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30" },
};
const MODULE_STYLE: Record<string, string> = {
  COGS: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  MIS: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
  System: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
};

export default function AdminAuditLog() {
  const { user } = useAuth();
  if (user?.role !== "admin") {
    return (
      <AppLayout>
        <PageHeader title="System audit log" />
        <div className="p-8">
          <Card className="max-w-lg">
            <CardContent className="p-6 flex gap-4">
              <ShieldAlert className="h-6 w-6 text-rose-500 shrink-0" />
              <div>
                <div className="font-semibold">Administrators only</div>
                <p className="text-sm text-muted-foreground mt-1">
                  The system audit log is restricted to whole-system administrators. Module-level
                  administrator rights do not grant access.
                </p>
                <Button asChild variant="outline" size="sm" className="mt-4">
                  <Link href="/">Back to dashboard</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }
  return <AuditLogView />;
}

function AuditLogView() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [module, setModule] = useState<string>(ALL);
  const [action, setAction] = useState<string>(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const params = useMemo<ListSystemAuditLogParams>(() => {
    const p: ListSystemAuditLogParams = { page };
    if (search) p.search = search;
    if (module !== ALL) p.module = module as ListSystemAuditLogParams["module"];
    if (action !== ALL) p.action = action as ListSystemAuditLogParams["action"];
    if (from) p.from = from;
    if (to) p.to = to;
    return p;
  }, [page, search, module, action, from, to]);

  const q = useListSystemAuditLog(params, {
    query: { queryKey: getListSystemAuditLogQueryKey(params), placeholderData: keepPreviousData },
  });
  const data = q.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize || 50;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, (page - 1) * pageSize + items.length);
  const dateInvalid = !!from && !!to && from > to;
  const hasFilters = !!search || module !== ALL || action !== ALL || !!from || !!to;

  const reset = () => {
    setSearchInput("");
    setSearch("");
    setModule(ALL);
    setAction(ALL);
    setFrom("");
    setTo("");
    setPage(1);
  };
  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const updatedAt = q.dataUpdatedAt;

  return (
    <AppLayout>
      <PageHeader
        title="System audit log"
        subtitle="Read-only change history across COGS, MIS and system administration."
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground hidden sm:inline" data-testid="text-freshness">
              {updatedAt ? `Updated ${relative(now - updatedAt)}` : "Not loaded yet"}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setNow(Date.now());
                void q.refetch();
              }}
              disabled={q.isFetching}
              data-testid="button-refresh"
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", q.isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      />
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-sky-500/25 bg-sky-500/5 px-4 py-3 text-sm">
          <Lock className="h-4 w-4 mt-0.5 text-sky-600 shrink-0" />
          <p className="text-muted-foreground">
            <span className="text-foreground font-medium">Records start from when change tracking was enabled.</span>{" "}
            Earlier activity is not shown. Passwords, tokens and other secrets are never displayed and appear as
            hidden values. Entries cannot be edited or deleted.
          </p>
        </div>

        <Card>
          <CardContent className="p-4 grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-[minmax(220px,2fr)_1fr_1fr_1fr_1fr_auto] items-end">
            <div className="space-y-1.5">
              <Label htmlFor="audit-search" className="text-xs">Search</Label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="audit-search"
                  className="pl-8"
                  placeholder="User, record, project or field"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  data-testid="input-search"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Module</Label>
              <Select value={module} onValueChange={(v) => { setModule(v); setPage(1); }}>
                <SelectTrigger data-testid="select-module"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All modules</SelectItem>
                  {Object.values(ListSystemAuditLogModule).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Action</Label>
              <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
                <SelectTrigger data-testid="select-action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All actions</SelectItem>
                  {Object.values(ListSystemAuditLogAction).map((a) => (
                    <SelectItem key={a} value={a}>{ACTION_STYLE[a]?.label ?? a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audit-from" className="text-xs">From</Label>
              <Input id="audit-from" type="date" value={from} max={to || undefined}
                onChange={(e) => { setFrom(e.target.value); setPage(1); }} data-testid="input-from" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audit-to" className="text-xs">To</Label>
              <Input id="audit-to" type="date" value={to} min={from || undefined}
                onChange={(e) => { setTo(e.target.value); setPage(1); }} data-testid="input-to" />
            </div>
            <Button variant="ghost" onClick={reset} disabled={!hasFilters} data-testid="button-reset">
              <X className="h-4 w-4 mr-1" /> Clear
            </Button>
          </CardContent>
        </Card>

        {dateInvalid && (
          <p className="text-sm text-rose-600">The start date is after the end date, so no records can match.</p>
        )}

        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between text-sm">
            <span className="text-muted-foreground" data-testid="text-range">
              {q.isLoading ? "Loading records" : `${rangeStart.toLocaleString()}-${rangeEnd.toLocaleString()} of ${total.toLocaleString()} changes`}
            </span>
            {q.isFetching && !q.isLoading && <span className="text-xs text-muted-foreground">Refreshing</span>}
          </div>

          {q.isLoading ? (
            <div className="divide-y">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-4 py-3 flex gap-4 items-center">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-14" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : q.isError ? (
            <div className="p-10 text-center">
              <AlertTriangle className="h-8 w-8 mx-auto text-rose-500" />
              <div className="font-semibold mt-3">Could not load the audit log</div>
              <p className="text-sm text-muted-foreground mt-1">
                {(q.error as { status?: number } | null)?.status === 403
                  ? "Your account does not have system administrator access."
                  : "The server did not respond as expected. Try again in a moment."}
              </p>
              <Button className="mt-4" variant="outline" onClick={() => void q.refetch()} data-testid="button-retry">
                <RefreshCw className="h-4 w-4 mr-2" /> Retry
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center">
              <div className="h-12 w-12 rounded-full bg-muted grid place-items-center mx-auto">
                <History className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="font-semibold mt-3">
                {hasFilters ? "No changes match these filters" : "No changes recorded yet"}
              </div>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                {hasFilters
                  ? "Widen the date range or clear filters to see more history."
                  : "Changes will appear here as users create, edit or remove records after tracking was enabled."}
              </p>
              {hasFilters && (
                <Button variant="outline" size="sm" className="mt-4" onClick={reset}>Clear filters</Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-8" />
                    <th className="text-left font-medium px-3 py-2">When</th>
                    <th className="text-left font-medium px-3 py-2">Module</th>
                    <th className="text-left font-medium px-3 py-2">Action</th>
                    <th className="text-left font-medium px-3 py-2">Record</th>
                    <th className="text-left font-medium px-3 py-2">Project</th>
                    <th className="text-left font-medium px-3 py-2">By</th>
                    <th className="text-left font-medium px-3 py-2">Fields</th>
                  </tr>
                </thead>
                <tbody className={cn("divide-y transition-opacity", q.isFetching && "opacity-60")}>
                  {items.map((it) => (
                    <AuditRow key={it.id} item={it} open={expanded.has(it.id)} onToggle={() => toggle(it.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!q.isLoading && !q.isError && total > 0 && (
            <div className="px-4 py-3 border-t flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">Page {page} of {pageCount}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1 || q.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))} data-testid="button-prev">
                  <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                </Button>
                <Button size="sm" variant="outline" disabled={page >= pageCount || q.isFetching}
                  onClick={() => setPage((p) => p + 1)} data-testid="button-next">
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}

function AuditRow({ item, open, onToggle }: { item: Item; open: boolean; onToggle: () => void }) {
  const when = formatWhen(item.occurredAt);
  const act = ACTION_STYLE[item.action] ?? { label: humanize(item.action), cls: "" };
  const fields = item.changedFields ?? [];
  return (
    <Fragment>
      <tr
        className={cn("cursor-pointer hover:bg-muted/30 transition-colors", open && "bg-muted/20")}
        onClick={onToggle}
        data-testid={`row-audit-${item.id}`}
      >
        <td className="pl-3">
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && "-rotate-90")} />
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          <div className="font-medium tabular-nums">{when.date}</div>
          <div className="text-xs text-muted-foreground tabular-nums">{when.time}</div>
        </td>
        <td className="px-3 py-2.5">
          <Badge variant="outline" className={MODULE_STYLE[item.module]}>{item.module}</Badge>
        </td>
        <td className="px-3 py-2.5">
          <Badge variant="outline" className={act.cls}>{act.label}</Badge>
        </td>
        <td className="px-3 py-2.5 max-w-[260px]">
          <div className="font-medium truncate">{item.entityName || (item.entityId ? `#${item.entityId}` : "Unnamed record")}</div>
          <div className="text-xs text-muted-foreground truncate">{humanize(item.entityType)}</div>
        </td>
        <td className="px-3 py-2.5 max-w-[180px] truncate">
          {item.projectName || <span className="text-muted-foreground">-</span>}
        </td>
        <td className="px-3 py-2.5 max-w-[160px] truncate">{item.actorName || "System"}</td>
        <td className="px-3 py-2.5 max-w-[240px]">
          {fields.length === 0 ? (
            <span className="text-muted-foreground text-xs">-</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {fields.slice(0, 3).map((f) => (
                <span key={f} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{humanize(f)}</span>
              ))}
              {fields.length > 3 && (
                <span className="text-[11px] text-muted-foreground">+{fields.length - 3} more</span>
              )}
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/10">
          <td />
          <td colSpan={7} className="px-3 pb-4 pt-1">
            <AuditDetail item={item} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function AuditDetail({ item }: { item: Item }) {
  const oldV = item.oldValues ?? null;
  const newV = item.newValues ?? null;
  const keys = useMemo(() => {
    if (item.changedFields?.length) return item.changedFields;
    return Array.from(new Set([...Object.keys(oldV ?? {}), ...Object.keys(newV ?? {})]));
  }, [item.changedFields, oldV, newV]);

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs">
        <Meta label="Record ID" value={item.entityId} />
        <Meta label="Project ID" value={item.projectId} />
        <Meta label="Request ID" value={item.requestId} />
        <Meta label="Path" value={item.path} />
      </dl>
      {keys.length === 0 ? (
        <p className="text-xs text-muted-foreground">No field-level values were captured for this change.</p>
      ) : (
        <div className="rounded-md border overflow-hidden bg-background/60">
          <div className="grid grid-cols-[minmax(120px,1fr)_2fr_2fr] text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
            <div className="px-3 py-1.5">Field</div>
            <div className="px-3 py-1.5">Before</div>
            <div className="px-3 py-1.5">After</div>
          </div>
          {keys.map((k) => {
            const hasOld = !!oldV && k in oldV;
            const hasNew = !!newV && k in newV;
            return (
              <div key={k} className="grid grid-cols-[minmax(120px,1fr)_2fr_2fr] border-t text-xs">
                <div className="px-3 py-2 font-medium">{humanize(k)}</div>
                <ValueCell present={hasOld} value={hasOld ? oldV![k] : undefined} tone="old" />
                <ValueCell present={hasNew} value={hasNew ? newV![k] : undefined} tone="new" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono truncate" title={value ?? undefined}>{value || "-"}</dd>
    </div>
  );
}

function ValueCell({ present, value, tone }: { present: boolean; value: unknown; tone: "old" | "new" }) {
  if (!present) return <div className="px-3 py-2 text-muted-foreground italic">-</div>;
  if (isRedacted(value)) {
    return (
      <div className="px-3 py-2">
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
          <Lock className="h-3 w-3" /> Hidden for security
        </span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "px-3 py-2 font-mono whitespace-pre-wrap break-all",
        tone === "old" ? "text-rose-700 dark:text-rose-300 bg-rose-500/5" : "text-emerald-700 dark:text-emerald-300 bg-emerald-500/5",
      )}
    >
      {formatValue(value)}
    </div>
  );
}
