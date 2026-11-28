import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  getMisListEntriesQueryKey,
  getMisGetProjectQueryKey,
  getMisListProjectServicesQueryKey,
  getMisListTabsQueryKey,
  MisEntryStatus,
  MisTabType,
  useMisGetCurrentAccess,
  useMisGetProject,
  useMisListEntries,
  useMisListProjectServices,
  useMisListTabs,
} from "@workspace/api-client-react";
import { FileText, Plus, Search } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MisEntryProjectSelector } from "../components/MisEntryProjectSelector";
import { MisEntryStatusBadge } from "../components/MisEntryStatusBadge";

const pageSize = 20;

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function readableDate(value: string) {
  return format(new Date(`${value}T00:00:00`), "MMM d, yyyy");
}

export default function Entries() {
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const [search, setSearch] = useState(() => initial.get("search") || "");
  const [projectIds, setProjectIds] = useState(() => initial.get("projectIds") || "");
  const [projectName, setProjectName] = useState<string | null>(null);
  const [tabId, setTabId] = useState(() => initial.get("tabId") || "");
  const [serviceId, setServiceId] = useState(() => initial.get("serviceId") || "");
  const [from, setFrom] = useState(() => initial.get("from") || "");
  const [to, setTo] = useState(() => initial.get("to") || "");
  const [startFrom, setStartFrom] = useState(() => initial.get("startFrom") || "");
  const [startTo, setStartTo] = useState(() => initial.get("startTo") || "");
  const [currency, setCurrency] = useState(() => initial.get("currency") || "");
  const [statuses, setStatuses] = useState<MisEntryStatus[]>(() => {
    const encoded = initial.get("statuses") || initial.get("status") || "";
    return encoded.split(",").map((value) => value.trim()).filter((value): value is MisEntryStatus =>
      ["draft", "submitted", "approved", "rejected", "returned", "cancelled"].includes(value),
    );
  });
  const status = statuses.length === 1 ? statuses[0] : "all";
  const statusSelectValue = statuses.length > 1 ? "__multiple" : status;
  const [entryType, setEntryType] = useState<MisTabType | "all">(() => (initial.get("entryType") as MisTabType) || "all");
  const [page, setPage] = useState(1);
  const { data: access } = useMisGetCurrentAccess();
  const canListEntries = Boolean(access?.permissions.includes("view_entries") || access?.projectPermissions.some((grant) => grant.permissions.includes("view_entries")));
  const canCreate = Boolean(access?.permissions.includes("create_entries") || access?.projectPermissions.some((grant) => grant.permissions.includes("create_entries")));
  const canBulkCreate = canCreate;
  const selectedProjectId = projectIds.includes(",") ? "" : projectIds;
  const { data: selectedProject } = useMisGetProject(selectedProjectId, {
    query: {
      enabled: Boolean(selectedProjectId),
      queryKey: getMisGetProjectQueryKey(selectedProjectId),
    },
  });

  const entryParams = {
    projectIds: projectIds || undefined,
    tabId: tabId || undefined,
    serviceId: serviceId || undefined,
    from: from || undefined,
    to: to || undefined,
    startFrom: startFrom || undefined,
    startTo: startTo || undefined,
    currency: currency || undefined,
    statuses: statuses.length ? statuses.join(",") : undefined,
    entryType: entryType === "all" ? undefined : entryType,
    search: search || undefined,
    page,
    pageSize,
  };
  const { data, isLoading, error } = useMisListEntries(entryParams, {
    query: { queryKey: getMisListEntriesQueryKey(entryParams), enabled: canListEntries },
  });
  const { data: tabs } = useMisListTabs({ active: true }, {
    query: { queryKey: getMisListTabsQueryKey({ active: true }) },
  });
  const serviceParams = { active: true };
  const { data: services } = useMisListProjectServices(selectedProjectId, serviceParams, {
    query: {
      enabled: Boolean(selectedProjectId),
      queryKey: getMisListProjectServicesQueryKey(selectedProjectId, serviceParams),
    },
  });

  const resetPage = () => setPage(1);
  const clearFilters = () => {
    setSearch("");
    setProjectIds("");
    setProjectName(null);
    setTabId("");
    setServiceId("");
    setFrom("");
    setTo("");
    setStartFrom("");
    setStartTo("");
    setCurrency("");
    setStatuses([]);
    setEntryType("all");
    resetPage();
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Entries</h1>
          <p className="mt-1 text-muted-foreground">Manage period transactions across authorized projects.</p>
        </div>
        <div className="flex flex-wrap gap-2">
            {canListEntries && (
              <Link href="/bulk-entries" className="inline-flex h-10 items-center justify-center rounded-md border bg-card px-4 py-2 font-medium transition-colors hover:bg-muted" data-testid="link-bulk-entry-history">
                Bulk history
              </Link>
            )}
          {canBulkCreate && (
            <Link href="/entries/bulk" className="inline-flex h-10 items-center justify-center rounded-md bg-secondary px-4 py-2 font-medium text-secondary-foreground transition-colors hover:bg-secondary/80" data-testid="link-bulk-entry">
              Bulk Entry
            </Link>
          )}
          {canCreate && (
            <Link href="/entries/new" className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-primary/90" data-testid="link-new-entry">
              <Plus className="mr-2 h-4 w-4" /> New Entry
            </Link>
          )}
        </div>
      </div>

      <section className="rounded-xl border bg-card p-4 shadow-sm" aria-label="Entry filters">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="entry-search">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input id="entry-search" className="pl-9" placeholder="Project, service, or remarks" value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} data-testid="input-entry-search" />
            </div>
          </div>
          <MisEntryProjectSelector
            id="entry-project-filter"
            label="Project"
            value={selectedProjectId}
            selectedName={projectName || selectedProject?.name || (projectIds ? "Filtered project" : null)}
            onChange={(project) => {
              setProjectIds(project.id);
              setProjectName(project.name);
              setTabId("");
              setServiceId("");
              resetPage();
            }}
          />
          <div className="space-y-2">
            <Label htmlFor="entry-tab-filter">Tab</Label>
            <Select value={tabId || "all"} onValueChange={(value) => { setTabId(value === "all" ? "" : value); setServiceId(""); resetPage(); }}>
              <SelectTrigger id="entry-tab-filter" data-testid="select-entry-tab-filter"><SelectValue placeholder="All tabs" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tabs</SelectItem>
                {tabs?.map((tab) => <SelectItem key={tab.id} value={tab.id}>{tab.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="entry-service-filter">Service</Label>
            <Select value={serviceId || "all"} disabled={!selectedProjectId} onValueChange={(value) => { setServiceId(value === "all" ? "" : value); resetPage(); }}>
              <SelectTrigger id="entry-service-filter" data-testid="select-entry-service-filter"><SelectValue placeholder={selectedProjectId ? "All services" : "Select a project first"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All services</SelectItem>
                {services?.filter((service) => !tabId || service.tabId === tabId).map((service) => <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="entry-from-filter">From</Label>
            <Input id="entry-from-filter" type="date" value={from} onChange={(event) => { setFrom(event.target.value); resetPage(); }} data-testid="input-entry-from-filter" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entry-to-filter">To</Label>
            <Input id="entry-to-filter" type="date" value={to} onChange={(event) => { setTo(event.target.value); resetPage(); }} data-testid="input-entry-to-filter" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entry-start-from-filter">Period starts from</Label>
            <Input id="entry-start-from-filter" type="date" value={startFrom} onChange={(event) => { setStartFrom(event.target.value); resetPage(); }} data-testid="input-entry-start-from-filter" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entry-start-to-filter">Period starts to</Label>
            <Input id="entry-start-to-filter" type="date" value={startTo} onChange={(event) => { setStartTo(event.target.value); resetPage(); }} data-testid="input-entry-start-to-filter" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entry-currency-filter">Currency</Label>
            <Input id="entry-currency-filter" value={currency} maxLength={3} placeholder="e.g. USD" onChange={(event) => { setCurrency(event.target.value.toUpperCase()); resetPage(); }} data-testid="input-entry-currency-filter" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entry-status-filter">Status</Label>
            <Select value={statusSelectValue} onValueChange={(value) => { setStatuses(value === "all" ? [] : [value as MisEntryStatus]); resetPage(); }}>
              <SelectTrigger id="entry-status-filter" data-testid="select-entry-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statuses.length > 1 && <SelectItem value="__multiple" disabled>{statuses.length} selected statuses</SelectItem>}
                {Object.values(MisEntryStatus).map((item) => <SelectItem key={item} value={item} className="capitalize">{item}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="entry-type-filter">Entry type</Label>
            <Select value={entryType} onValueChange={(value) => { setEntryType(value as MisTabType | "all"); resetPage(); }}>
              <SelectTrigger id="entry-type-filter" data-testid="select-entry-type-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {Object.values(MisTabType).map((item) => <SelectItem key={item} value={item} className="capitalize">{item}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="ghost" onClick={clearFilters} data-testid="button-clear-entry-filters">Clear filters</Button>
        </div>
      </section>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 font-medium text-muted-foreground">Project & service</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Period</th>
                <th className="px-4 py-3 font-medium text-right text-muted-foreground">Quantity</th>
                <th className="px-4 py-3 font-medium text-right text-muted-foreground">Amount</th>
                <th className="px-4 py-3 font-medium text-center text-muted-foreground">Status</th>
                <th className="px-4 py-3 font-medium text-right text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? Array.from({ length: 5 }, (_, index) => (
                <tr key={index}><td className="px-4 py-3"><Skeleton className="h-8 w-44" /></td><td className="px-4 py-3"><Skeleton className="h-5 w-36" /></td><td className="px-4 py-3"><Skeleton className="ml-auto h-5 w-16" /></td><td className="px-4 py-3"><Skeleton className="ml-auto h-5 w-20" /></td><td className="px-4 py-3"><Skeleton className="mx-auto h-5 w-16" /></td><td /></tr>
              )) : error ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-destructive" data-testid="text-entry-list-error">{error instanceof Error ? error.message : "Unable to load entries."}</td></tr>
              ) : data?.items.length ? data.items.map((entry) => {
                const parentIdentity = entry as typeof entry & { parentId?: string | null; bulkNumber?: string | null };
                return (
                <tr key={entry.id} className="transition-colors hover:bg-muted/30" data-testid={`row-entry-${entry.id}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{entry.tabName} · {entry.serviceName}</div>
                    <div className="text-xs text-muted-foreground">{entry.projectName}</div>
                    {parentIdentity.parentId && (
                      <Link
                        href={`/entries/parents/${parentIdentity.parentId}`}
                        className="mt-1 inline-flex items-center text-xs font-medium text-primary hover:underline"
                        data-testid={`link-entry-parent-${entry.id}`}
                      >
                        {parentIdentity.bulkNumber || "Bulk entry"}
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{readableDate(entry.fromDate)} – {readableDate(entry.toDate)}</td>
                  <td className="px-4 py-3 text-right">{entry.quantity} {entry.unit}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatMoney(entry.amount, entry.currency)}</td>
                  <td className="px-4 py-3 text-center"><MisEntryStatusBadge status={entry.status} /></td>
                  <td className="px-4 py-3 text-right"><Link href={parentIdentity.parentId ? `/entries/parents/${parentIdentity.parentId}` : `/entries/${entry.id}`} className="inline-flex h-8 items-center justify-center rounded-md border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted" data-testid={`link-view-entry-${entry.id}`}>View</Link></td>
                </tr>
                );
              }) : (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground"><FileText className="mx-auto mb-3 h-8 w-8 opacity-20" /><p data-testid="text-no-entries">No entries found.</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
        {data && data.total > 0 && (
          <div className="flex items-center justify-between border-t bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
            <span data-testid="text-entry-pagination">Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)} of {data.total} entries</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} data-testid="button-entry-previous">Previous</Button>
              <Button type="button" variant="outline" size="sm" disabled={page * pageSize >= data.total} onClick={() => setPage((current) => current + 1)} data-testid="button-entry-next">Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}