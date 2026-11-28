import { useState } from "react";
import { Link } from "wouter";
import {
  getMisListProjectsQueryKey,
  MisEntryStatus,
  MisProjectInput,
  useMisCreateProject,
  useMisGetCurrentAccess,
  useMisListProjects,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarDays, Plus, Search, Settings } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { UserPicker } from "../components/UserPicker";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";

function CreateProjectDialog({ open, onOpenChange, canSearchUsers }: { open: boolean; onOpenChange: (open: boolean) => void; canSearchUsers: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useMisCreateProject();
  const [managerId, setManagerId] = useState<string | null>(null);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currency = String(form.get("currency") ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      toast({ title: "Currency must be a 3-letter ISO code", variant: "destructive" });
      return;
    }
    const data: MisProjectInput = {
      name: String(form.get("name") ?? "").trim(),
      code: String(form.get("code") ?? "").trim(),
      managerId,
      status: form.get("status") as MisProjectInput["status"],
      startDate: String(form.get("startDate") ?? "") || null,
      endDate: String(form.get("endDate") ?? "") || null,
      currency,
      reportingSettings: {
        defaultEntryStatus: form.get("defaultEntryStatus") as MisEntryStatus,
        preventDuplicatePeriods: form.get("preventDuplicatePeriods") === "on",
      },
    };
    create.mutate({ data }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getMisListProjectsQueryKey() });
        toast({ title: "Project created" });
        onOpenChange(false);
      },
      onError: (error) => toast({ title: "Unable to create project", description: errorMessage(error), variant: "destructive" }),
    });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-[600px]"><DialogHeader><DialogTitle>Create project</DialogTitle><DialogDescription>Set all writable project details now; tabs and services are configured on the project page.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-5"><div className="grid grid-cols-2 gap-4">
      <div className="col-span-2 space-y-2"><Label htmlFor="new-project-name">Project name</Label><Input id="new-project-name" name="name" required /></div>
      <div className="space-y-2"><Label htmlFor="new-project-code">Project code</Label><Input id="new-project-code" name="code" required /></div>
      <div className="space-y-2"><Label htmlFor="new-project-currency">Currency</Label><Input id="new-project-currency" name="currency" maxLength={3} defaultValue="SAR" required /></div>
      <div className="col-span-2 space-y-2"><Label>Project manager</Label><UserPicker value={managerId} onChange={setManagerId} canSearch={canSearchUsers} /><p className="text-xs text-muted-foreground">{canSearchUsers ? "Optional." : "Only a global MIS administrator can search and assign a manager."}</p></div>
      <div className="space-y-2"><Label>Status</Label><Select name="status" defaultValue="active"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select></div>
      <div className="space-y-2"><Label>Default entry status</Label><Select name="defaultEntryStatus" defaultValue={MisEntryStatus.approved}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={MisEntryStatus.draft}>Draft</SelectItem><SelectItem value={MisEntryStatus.submitted}>Submitted</SelectItem><SelectItem value={MisEntryStatus.approved}>Approved</SelectItem><SelectItem value={MisEntryStatus.rejected}>Rejected</SelectItem><SelectItem value={MisEntryStatus.cancelled}>Cancelled</SelectItem></SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="new-project-start">Start date</Label><Input id="new-project-start" name="startDate" type="date" /></div><div className="space-y-2"><Label htmlFor="new-project-end">End date</Label><Input id="new-project-end" name="endDate" type="date" /></div>
      <div className="col-span-2 flex items-center gap-2 border-t pt-3"><Switch id="new-project-duplicates" name="preventDuplicatePeriods" /><Label htmlFor="new-project-duplicates">Prevent duplicate entry periods</Label></div>
    </div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create project"}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}

export default function Projects() {
  const { data: access } = useMisGetCurrentAccess();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debouncedSearch = useDebounce(search, 300);
  const params = { search: debouncedSearch || undefined, page, pageSize: 20 };
  const { data, isLoading, isError } = useMisListProjects(params);
  const canCreate = access?.permissions.includes("projects") ?? false;
  const canSearchUsers = access?.roles.includes("mis_admin") ?? false;
  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h1 className="text-3xl font-semibold tracking-tight">Projects</h1><p className="mt-1 text-muted-foreground">Manage MIS project configurations, services, and reporting settings.</p></div>{canCreate && <Button onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />New project</Button>}</div>
    <div className="relative max-w-sm"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search projects…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
    <CreateProjectDialog key={creating ? "new-open" : "new-closed"} open={creating} onOpenChange={setCreating} canSearchUsers={canSearchUsers} />
    <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/50"><tr><th className="p-4">Code</th><th className="p-4">Project</th><th className="p-4">Status</th><th className="p-4">Period</th><th className="p-4">Manager</th><th className="p-4 text-right">Actions</th></tr></thead><tbody className="divide-y">
      {isLoading ? Array.from({ length: 4 }, (_, index) => <tr key={index}><td colSpan={6} className="p-4"><Skeleton className="h-5 w-full" /></td></tr>) : isError ? <tr><td colSpan={6} className="p-10 text-center text-destructive">Projects could not be loaded. Please retry.</td></tr> : data?.items.length ? data.items.map((project) => <tr key={project.id} className="hover:bg-muted/30"><td className="p-4 font-medium">{project.code}</td><td className="p-4 font-medium"><Link href={`/projects/${project.id}`} className="hover:text-primary">{project.name}</Link></td><td className="p-4"><Badge variant={project.status === "active" ? "default" : "secondary"} className="capitalize">{project.status}</Badge></td><td className="p-4 text-muted-foreground"><CalendarDays className="mr-1 inline h-3.5 w-3.5" />{project.startDate ? format(new Date(project.startDate), "MMM yyyy") : "—"} – {project.endDate ? format(new Date(project.endDate), "MMM yyyy") : "—"}</td><td className="p-4 text-muted-foreground">{project.manager?.displayName ?? "—"}</td><td className="p-4 text-right"><Link href={`/projects/${project.id}`} aria-label={`Configure ${project.name}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"><Settings className="h-4 w-4" /></Link></td></tr>) : <tr><td colSpan={6} className="p-12 text-center text-muted-foreground"><Building2 className="mx-auto mb-3 h-8 w-8 opacity-20" />No projects found.</td></tr>}
    </tbody></table></div>
    {data && data.total > 0 && <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground"><span>Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div>}
    </CardContent></Card>
  </div>;
}