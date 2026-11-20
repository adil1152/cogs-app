import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getMisListPercentageServicesQueryKey,
  MisPercentageKind,
  type MisPercentageService,
  type MisPercentageServiceInput,
  useMisCreatePercentageService,
  useMisDeletePercentageService,
  useMisListPercentageServices,
  useMisUpdatePercentageService,
} from "@workspace/api-client-react";
import { Pencil, Percent, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

const errorMessage = (error: unknown) => {
  if (error && typeof error === "object" && "error" in error && typeof (error as { error: unknown }).error === "string") return (error as { error: string }).error;
  return error instanceof Error ? error.message : "The request could not be completed.";
};

const sectionLabel = (kind: MisPercentageKind) => kind === MisPercentageKind.overhead ? "Overhead" : "OP Expense";

function invalidate(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: [`/api/mis/projects/${projectId}/percentage-services`] });
  void queryClient.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/mis/dashboard") });
}

function PercentageServiceDialog({ projectId, kind, service, open, onOpenChange }: {
  projectId: string; kind: MisPercentageKind; service?: MisPercentageService; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useMisCreatePercentageService();
  const update = useMisUpdatePercentageService();
  const [name, setName] = useState(service?.name ?? "");
  const [pct, setPct] = useState(service ? String(service.percentage) : "");
  const [active, setActive] = useState(service?.active ?? true);
  const parsed = Number(pct);
  const valid = name.trim().length > 0 && name.trim().length <= 160 && pct !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
  const pending = create.isPending || update.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const data: MisPercentageServiceInput = { kind, name: name.trim(), percentage: parsed, active };
    const callbacks = {
      onSuccess: () => { invalidate(queryClient, projectId); toast({ title: service ? `${sectionLabel(kind)} service updated` : `${sectionLabel(kind)} service created` }); onOpenChange(false); },
      onError: (error: unknown) => toast({ title: service ? "Unable to update service" : "Unable to create service", description: errorMessage(error), variant: "destructive" as const }),
    };
    if (service) update.mutate({ id: projectId, serviceId: service.id, data }, callbacks);
    else create.mutate({ id: projectId, data }, callbacks);
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-[480px]"><DialogHeader><DialogTitle>{service ? `Edit ${sectionLabel(kind)} service` : `Add ${sectionLabel(kind)} service`}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2"><Label htmlFor={`pct-name-${kind}`}>Service name</Label><Input id={`pct-name-${kind}`} data-testid={`input-${kind}-name`} value={name} maxLength={160} onChange={(e) => setName(e.target.value)} required /></div>
      <div className="space-y-2"><Label htmlFor={`pct-value-${kind}`}>Percentage (0–100)</Label><Input id={`pct-value-${kind}`} data-testid={`input-${kind}-percentage`} type="number" min="0" max="100" step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} required />
        <p className="text-xs text-muted-foreground">Amount = combined selected-project income × {pct === "" ? "percentage" : `${pct}%`} ÷ 100</p></div>
      <div className="flex items-center justify-between border-t pt-3"><div><Label htmlFor={`pct-active-${kind}`}>Active</Label><p className="text-xs text-muted-foreground">Inactive services are kept but not applied.</p></div><Switch id={`pct-active-${kind}`} data-testid={`switch-${kind}-active`} checked={active} onCheckedChange={setActive} /></div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" data-testid={`button-save-${kind}`} disabled={!valid || pending}>{pending ? "Saving…" : service ? "Save changes" : "Add service"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

export function PercentageServicesSection({ projectId, kind, canWrite }: { projectId: string; kind: MisPercentageKind; canWrite: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const params = { kind };
  const { data, isLoading, isError, refetch } = useMisListPercentageServices(projectId, params, { query: { queryKey: getMisListPercentageServicesQueryKey(projectId, params), enabled: Boolean(projectId) } });
  const update = useMisUpdatePercentageService();
  const remove = useMisDeletePercentageService();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MisPercentageService | null>(null);
  const label = sectionLabel(kind);
  const services = data ?? [];
  const activeTotal = services.filter((s) => s.active).reduce((sum, s) => sum + s.percentage, 0);

  const toggleActive = (service: MisPercentageService) => {
    if (service.active && !window.confirm(`Deactivate "${service.name}"? It will no longer be applied to dashboard totals.`)) return;
    update.mutate({ id: projectId, serviceId: service.id, data: { kind, name: service.name, percentage: service.percentage, active: !service.active } }, {
      onSuccess: () => { invalidate(queryClient, projectId); toast({ title: service.active ? "Service deactivated" : "Service activated" }); },
      onError: (error) => toast({ title: "Unable to update service", description: errorMessage(error), variant: "destructive" }),
    });
  };
  const deleteService = (service: MisPercentageService) => {
    if (!window.confirm(`Delete "${service.name}" permanently? Consider deactivating instead.`)) return;
    remove.mutate({ id: projectId, serviceId: service.id }, {
      onSuccess: () => { invalidate(queryClient, projectId); toast({ title: "Service deleted" }); },
      onError: (error) => toast({ title: "Unable to delete service", description: errorMessage(error), variant: "destructive" }),
    });
  };

  return <Card>
    <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
      <div><CardTitle>{label} services</CardTitle><CardDescription>When this project is selected on the dashboard, these percentages apply to the combined selected-project income. These are separate from actual Expense entries recorded in bulk entry.</CardDescription></div>
      {canWrite && <Button data-testid={`button-add-${kind}`} onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />Add service</Button>}
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <p className="font-medium">Formula: combined selected-project income × sum of selected-project percentages ÷ 100</p>
        <p className="mt-1 text-xs text-muted-foreground">Income uses the dashboard's selected period and statuses, regardless of category or service filters, separated by currency. Percentages from all selected projects are additive, including projects with no entries in the period. Current settings are applied; percentages are not snapshotted per period.</p>
      </div>
      {!canWrite && <p className="text-xs text-muted-foreground">Read-only: changing {label} services requires Services or Configure project permission together with {label} permission.</p>}
      {isLoading ? <Skeleton className="h-32 w-full" /> : isError ? <div className="flex flex-col items-center gap-2 p-8 text-center"><p className="text-destructive">{label} services could not be loaded.</p><Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button></div>
        : services.length === 0 ? <div className="p-10 text-center text-muted-foreground"><Percent className="mx-auto mb-3 h-8 w-8 opacity-20" />No {label} services configured.</div>
        : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b text-left text-muted-foreground"><tr><th className="pb-2 font-medium">Service</th><th className="pb-2 text-right font-medium">Percentage</th><th className="pb-2 font-medium pl-4">Status</th>{canWrite && <th className="pb-2 text-right font-medium">Actions</th>}</tr></thead>
          <tbody className="divide-y">{services.map((service) => <tr key={service.id} data-testid={`row-${kind}-${service.id}`}>
            <td className="py-3 font-medium">{service.name}</td>
            <td className="py-3 text-right tabular-nums">{service.percentage}%</td>
            <td className="py-3 pl-4"><Badge variant={service.active ? "default" : "secondary"}>{service.active ? "Active" : "Inactive"}</Badge></td>
            {canWrite && <td className="py-3 text-right whitespace-nowrap">
              <Button variant="ghost" size="sm" data-testid={`button-toggle-${kind}-${service.id}`} disabled={update.isPending} onClick={() => toggleActive(service)}>{service.active ? "Deactivate" : "Activate"}</Button>
              <Button variant="ghost" size="icon" aria-label={`Edit ${service.name}`} data-testid={`button-edit-${kind}-${service.id}`} onClick={() => setEditing(service)}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Delete ${service.name}`} data-testid={`button-delete-${kind}-${service.id}`} disabled={remove.isPending} onClick={() => deleteService(service)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </td>}
          </tr>)}</tbody>
          <tfoot className="border-t"><tr><td className="pt-3 text-muted-foreground">Active total</td><td className="pt-3 text-right font-semibold tabular-nums">{Number(activeTotal.toFixed(4))}%</td><td colSpan={canWrite ? 2 : 1} /></tr></tfoot>
        </table></div>}
    </CardContent>
    {creating && <PercentageServiceDialog projectId={projectId} kind={kind} open onOpenChange={setCreating} />}
    {editing && <PercentageServiceDialog key={editing.id} projectId={projectId} kind={kind} service={editing} open onOpenChange={(open) => !open && setEditing(null)} />}
  </Card>;
}
