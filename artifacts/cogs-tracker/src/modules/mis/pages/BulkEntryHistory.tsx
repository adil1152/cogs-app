import { useState } from "react";
import { Link } from "wouter";
import { FileStack, Plus, Search } from "lucide-react";
import { MisEntryStatus } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MisEntryStatusBadge } from "../components/MisEntryStatusBadge";
import { ProjectPicker } from "../components/ProjectPicker";
import { UserPicker } from "../components/UserPicker";
import { misParentErrorMessage, useMisListParents, type MisParentStatus } from "../hooks/useMisParents";

const pageSize = 50;

function readableDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function BulkEntryHistory() {
  const [bulkNumber, setBulkNumber] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState<string | null>(null);
  const [projectNumber, setProjectNumber] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [createdById, setCreatedById] = useState("");
  const [createdByName, setCreatedByName] = useState<string | null>(null);
  const [status, setStatus] = useState<MisParentStatus | "all">("all");
  const [entryType, setEntryType] = useState<"all" | "bulk">("bulk");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const params = {
    bulkNumber: bulkNumber.trim() || undefined,
    projectId: projectId || undefined,
    projectNumber: projectNumber.trim() || undefined,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    createdById: createdById || undefined,
    status: status === "all" ? undefined : status,
    entryType: entryType === "all" ? undefined : entryType,
    search: search.trim() || undefined,
    page,
    pageSize,
  };
  const { data, isLoading, error } = useMisListParents(params);

  const clearFilters = () => {
    setBulkNumber("");
    setProjectId("");
    setProjectName(null);
    setProjectNumber("");
    setFromDate("");
    setToDate("");
    setCreatedById("");
    setCreatedByName(null);
    setStatus("all");
    setEntryType("bulk");
    setSearch("");
    setPage(1);
  };
  const update = <T,>(setter: (value: T) => void, value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Bulk Entry History</h1>
          <p className="mt-1 text-muted-foreground">Find and review atomic bulk MIS transactions and their service lines.</p>
        </div>
        <Link href="/entries/bulk">
          <Button><Plus className="mr-2 h-4 w-4" />New bulk entry</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search bulk entries</CardTitle>
          <CardDescription>Filters apply to the parent transaction identity, period, creator, status, and entry type.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-history-number">Bulk number</Label>
              <Input id="bulk-history-number" value={bulkNumber} placeholder="MIS-BULK-000125" onChange={(event) => update(setBulkNumber, event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Project</Label>
              <ProjectPicker
                value={projectId || null}
                selectedLabel={projectName || projectId || null}
                onChange={(value) => {
                  update(setProjectId, value || "");
                  setProjectName(null);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-history-project-number">Project number</Label>
              <Input id="bulk-history-project-number" value={projectNumber} placeholder="Project code" onChange={(event) => update(setProjectNumber, event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-history-search">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="bulk-history-search" className="pl-9" value={search} placeholder="Project, number, or creator" onChange={(event) => update(setSearch, event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-history-from">From date</Label>
              <Input id="bulk-history-from" type="date" value={fromDate} onChange={(event) => update(setFromDate, event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-history-to">To date</Label>
              <Input id="bulk-history-to" type="date" value={toDate} onChange={(event) => update(setToDate, event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Created by</Label>
              <UserPicker
                value={createdById || null}
                selectedLabel={createdByName || createdById || null}
                source="entry-creators"
                onChange={(value) => {
                  update(setCreatedById, value || "");
                  setCreatedByName(null);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-history-status">Status</Label>
              <Select value={status} onValueChange={(value) => update(setStatus, value as MisParentStatus | "all")}>
                <SelectTrigger id="bulk-history-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {Object.values(MisEntryStatus).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-history-type">Entry type</Label>
              <Select value={entryType} onValueChange={(value) => update(setEntryType, value as "all" | "bulk")}>
                <SelectTrigger id="bulk-history-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="bulk">Bulk</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="ghost" onClick={clearFilters}>Clear filters</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Bulk number</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Project</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Period</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Created by</th>
                  <th className="px-4 py-3 font-medium text-center text-muted-foreground">Lines</th>
                  <th className="px-4 py-3 font-medium text-center text-muted-foreground">Status</th>
                  <th className="px-4 py-3 font-medium text-right text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? Array.from({ length: 5 }, (_, index) => (
                  <tr key={index}><td colSpan={7} className="px-4 py-4"><Skeleton className="h-7 w-full" /></td></tr>
                )) : error ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-destructive">{misParentErrorMessage(error)}</td></tr>
                ) : data?.items.length ? data.items.map((parent) => (
                  <tr key={parent.id} className="transition-colors hover:bg-muted/30" data-testid={`row-bulk-parent-${parent.id}`}>
                    <td className="px-4 py-3">
                      <Link href={`/entries/parents/${parent.id}`} className="font-medium text-primary hover:underline">{parent.bulkNumber}</Link>
                      <div className="text-xs text-muted-foreground">{parent.entryType}</div>
                    </td>
                    <td className="px-4 py-3"><div className="font-medium">{parent.projectName || parent.projectId}</div><div className="text-xs text-muted-foreground">{parent.projectNumber || "—"}</div></td>
                    <td className="px-4 py-3 text-muted-foreground">{readableDate(parent.fromDate)} – {readableDate(parent.toDate)}</td>
                    <td className="px-4 py-3">{parent.createdByName || parent.createdById}</td>
                    <td className="px-4 py-3 text-center">{parent.childCount ?? 0}</td>
                    <td className="px-4 py-3 text-center"><MisEntryStatusBadge status={parent.status} /></td>
                    <td className="px-4 py-3 text-right"><Link href={`/entries/parents/${parent.id}`} className="inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted">View</Link></td>
                  </tr>
                )) : (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground"><FileStack className="mx-auto mb-3 h-8 w-8 opacity-20" />No bulk entries found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {data && data.total > 0 && (
            <div className="flex items-center justify-between border-t bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
              <span>Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total} bulk entries</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
                <Button type="button" variant="outline" size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage((current) => current + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
