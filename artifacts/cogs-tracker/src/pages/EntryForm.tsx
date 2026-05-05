import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProject,
  useListProjectServices,
  useGetDailyEntry,
  useCreateDailyEntry,
  useUpdateDailyEntry,
  useDeleteDailyEntry,
  useApproveDailyEntry,
  useRejectDailyEntry,
  useListEntryApprovals,
  getGetProjectQueryKey,
  getListProjectServicesQueryKey,
  getGetDailyEntryQueryKey,
  getListProjectEntriesQueryKey,
  getGetDashboardQueryKey,
  getGetRecentActivityQueryKey,
  getListEntryApprovalsQueryKey,
  type ServiceCostInput,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatNumber, todayISO } from "@/lib/format";
import { ArrowLeft, Trash2, Lock, CheckCircle2, XCircle } from "lucide-react";

const APPROVAL_LEVELS = ["OP", "SOP", "COO", "CC", "Additional"] as const;

interface ServiceLine {
  projectServiceId: string;
  name: string;
  kind: "food" | "standard";
  cost: string;
  mandays: string;
}

function emptyLine(svc: { id: string; name: string; kind: "food" | "standard" }): ServiceLine {
  return { projectServiceId: svc.id, name: svc.name, kind: svc.kind, cost: "", mandays: "" };
}

export default function EntryForm() {
  const [, params] = useRoute<{ id: string; entryId?: string }>("/projects/:id/entries/:entryId");
  const [, newParams] = useRoute<{ id: string }>("/projects/:id/entries/new");
  const projectId = params?.id ?? newParams?.id ?? "";
  const entryId = params?.entryId && params.entryId !== "new" ? params.entryId : undefined;
  const isEdit = !!entryId;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: project } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });
  const { data: services } = useListProjectServices(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectServicesQueryKey(projectId) },
  });
  const { data: existingEntry } = useGetDailyEntry(entryId ?? "", {
    query: { enabled: !!entryId, queryKey: getGetDailyEntryQueryKey(entryId ?? "") },
  });
  const { data: approvals } = useListEntryApprovals(entryId ?? "", {
    query: { enabled: !!entryId, queryKey: getListEntryApprovalsQueryKey(entryId ?? "") },
  });

  const isLocked = !!existingEntry?.isLocked;
  const currentLevel = existingEntry?.currentApprovalLevel ?? 0;

  const [entryDate, setEntryDate] = useState(todayISO());
  const [location, setLocation] = useState("");
  const [totalMandaysOverride, setTotalMandaysOverride] = useState(false);
  const [totalMandaysManual, setTotalMandaysManual] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ServiceLine[]>([]);

  useEffect(() => {
    if (!services) return;
    if (isEdit) {
      if (!existingEntry) return;
      setEntryDate(existingEntry.entryDate);
      setLocation(existingEntry.location);
      setTotalMandaysOverride(!!existingEntry.totalMandaysOverride);
      setTotalMandaysManual(String(existingEntry.totalMandays));
      setNotes(existingEntry.notes ?? "");
      const byId = new Map(existingEntry.serviceCosts.map((s) => [s.projectServiceId, s]));
      setLines(
        services.map((svc) => {
          const sc = byId.get(svc.id);
          return {
            projectServiceId: svc.id,
            name: svc.name,
            kind: svc.kind as "food" | "standard",
            cost: sc?.cost != null ? String(sc.cost) : "",
            mandays:
              sc?.mandays != null
                ? String(sc.mandays)
                : sc?.mandayContribution != null && sc.mandayContribution > 0
                  ? String(sc.mandayContribution)
                  : "",
          };
        }),
      );
    } else {
      setLines(services.map((s) => emptyLine({ id: s.id, name: s.name, kind: s.kind as any })));
      if (project && !location) setLocation(project.location);
    }
  }, [services, existingEntry, isEdit, project]);

  const totals = useMemo(() => {
    let totalCost = 0;
    let summedMandays = 0;
    for (const l of lines) {
      const c = Number(l.cost);
      if (!Number.isNaN(c)) totalCost += c;
      const m = Number(l.mandays);
      if (!Number.isNaN(m)) summedMandays += m;
    }
    const tm = totalMandaysOverride
      ? Number(totalMandaysManual) || 0
      : summedMandays;
    const cpm = tm ? totalCost / tm : null;
    return { totalCost, summedMandays, totalMandays: tm, costPerManday: cpm };
  }, [lines, totalMandaysOverride, totalMandaysManual]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListProjectEntriesQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey() });
    if (entryId) {
      queryClient.invalidateQueries({ queryKey: getGetDailyEntryQueryKey(entryId) });
      queryClient.invalidateQueries({ queryKey: getListEntryApprovalsQueryKey(entryId) });
    }
  };

  const create = useCreateDailyEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Entry saved" });
        invalidateAll();
        navigate(`/projects/${projectId}`);
      },
      onError: (err: any) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
    },
  });
  const update = useUpdateDailyEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Entry updated" });
        invalidateAll();
        navigate(`/projects/${projectId}`);
      },
      onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
    },
  });
  const del = useDeleteDailyEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Entry deleted" });
        invalidateAll();
        navigate(`/projects/${projectId}`);
      },
      onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
    },
  });
  const approve = useApproveDailyEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Approval recorded" });
        invalidateAll();
      },
      onError: (err: any) => toast({ title: "Approval failed", description: err.message, variant: "destructive" }),
    },
  });
  const reject = useRejectDailyEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Entry sent back to draft" });
        invalidateAll();
      },
      onError: (err: any) => toast({ title: "Reject failed", description: err.message, variant: "destructive" }),
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLocked) return;
    if (!entryDate || !location) {
      toast({ title: "Check the form", description: "Date and location are required.", variant: "destructive" });
      return;
    }
    if (totalMandaysOverride) {
      const tm = Number(totalMandaysManual);
      if (Number.isNaN(tm) || tm < 0) {
        toast({ title: "Manual mandays invalid", variant: "destructive" });
        return;
      }
    }
    const serviceCosts: ServiceCostInput[] = lines
      .filter((l) => l.cost !== "" || l.mandays !== "")
      .map((l) => ({
        projectServiceId: l.projectServiceId,
        kind: l.kind as any,
        cost: l.cost !== "" ? Number(l.cost) : 0,
        ...(l.mandays !== "" ? { mandays: Number(l.mandays) } : {}),
      }));
    const payload: any = {
      entryDate,
      location,
      totalMandaysOverride,
      notes,
      serviceCosts,
    };
    if (totalMandaysOverride) payload.totalMandays = Number(totalMandaysManual);
    if (isEdit) update.mutate({ id: entryId!, data: payload });
    else create.mutate({ id: projectId, data: payload });
  }

  function setLine(idx: number, patch: Partial<ServiceLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  return (
    <AppLayout>
      <PageHeader
        title={isEdit ? "Edit daily entry" : "New daily entry"}
        subtitle={project ? project.name : ""}
        actions={
          <Link href={`/projects/${projectId}`}>
            <Button variant="outline" data-testid="button-back"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
          </Link>
        }
      />

      {isEdit && (
        <div className="px-8 pt-4">
          <ApprovalStrip
            currentLevel={currentLevel}
            isLocked={isLocked}
            isAdmin={isAdmin}
            approvals={approvals ?? []}
            onApprove={() => approve.mutate({ id: entryId! })}
            onReject={() => reject.mutate({ id: entryId! })}
            pending={approve.isPending || reject.isPending}
          />
        </div>
      )}

      <form onSubmit={onSubmit} className="px-8 py-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <fieldset disabled={isLocked} className="contents">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Day</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
                  <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required data-testid="input-entry-date" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Location</Label>
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} required data-testid="input-entry-location" />
                </div>
                <div className="md:col-span-2 space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Notes</Label>
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-entry-notes" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Service costs</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Enter cost and mandays per service. Total mandays auto-sum below — flip the
                  override switch to type in a different number.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {lines.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    No services configured for this project yet — add some on the project page first.
                  </div>
                )}
                {lines.map((l, i) => {
                  const cost = Number(l.cost) || 0;
                  const md = Number(l.mandays) || 0;
                  const cpm = md ? cost / md : null;
                  return (
                    <div key={l.projectServiceId} className="rounded-md border border-border bg-card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-medium">{l.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {cpm != null ? `${formatCurrency(cpm)} / manday` : "—"}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Cost (SAR)</Label>
                          <Input
                            type="number" step="0.01" min="0"
                            value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })}
                            placeholder="0.00"
                            data-testid={`input-cost-${i}`}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Mandays</Label>
                          <Input
                            type="number" step="0.01" min="0"
                            value={l.mandays} onChange={(e) => setLine(i, { mandays: e.target.value })}
                            placeholder="0"
                            data-testid={`input-mandays-${i}`}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="border-accent/40 bg-accent/5 sticky top-6">
              <CardHeader><CardTitle className="text-base">Live totals</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Row label="Total cost" value={formatCurrency(totals.totalCost)} accent />
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Manual mandays
                    </Label>
                    <Switch
                      checked={totalMandaysOverride}
                      onCheckedChange={setTotalMandaysOverride}
                      data-testid="switch-mandays-override"
                    />
                  </div>
                  {totalMandaysOverride ? (
                    <Input
                      type="number" step="0.01" min="0"
                      value={totalMandaysManual}
                      onChange={(e) => setTotalMandaysManual(e.target.value)}
                      className="w-28 text-right tabular-nums"
                      data-testid="input-total-mandays"
                    />
                  ) : (
                    <span className="tabular-nums font-semibold text-base">
                      {formatNumber(totals.summedMandays, 2)}
                    </span>
                  )}
                </div>
                <Row label="Cost / manday" value={totals.costPerManday != null ? `${formatCurrency(totals.costPerManday)}` : "—"} />
                <Button type="submit" className="w-full" disabled={create.isPending || update.isPending || isLocked} data-testid="button-save-entry">
                  {isEdit ? "Save changes" : "Save entry"}
                </Button>
                {isEdit && !isLocked && (
                  <Button
                    type="button" variant="outline" className="w-full text-destructive hover:text-destructive"
                    onClick={() => del.mutate({ id: entryId! })}
                    data-testid="button-delete-entry"
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete entry
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </fieldset>
      </form>
    </AppLayout>
  );
}

function ApprovalStrip({
  currentLevel,
  isLocked,
  isAdmin,
  approvals,
  onApprove,
  onReject,
  pending,
}: {
  currentLevel: number;
  isLocked: boolean;
  isAdmin: boolean;
  approvals: Array<any>;
  onApprove: () => void;
  onReject: () => void;
  pending: boolean;
}) {
  const nextLevelName = APPROVAL_LEVELS[currentLevel];
  const byLevel = new Map(approvals.map((a) => [a.level, a]));
  return (
    <Card className={isLocked ? "border-accent/60 bg-accent/10" : ""}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            {isLocked ? (
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-accent">
                <Lock className="h-4 w-4" /> Locked — fully approved
              </span>
            ) : (
              <span className="text-sm font-medium text-muted-foreground">
                Approval progress: {currentLevel} of {APPROVAL_LEVELS.length}
              </span>
            )}
            <div className="flex items-center gap-1.5">
              {APPROVAL_LEVELS.map((name, i) => {
                const level = i + 1;
                const done = level <= currentLevel;
                const a = byLevel.get(level);
                return (
                  <div
                    key={name}
                    className={`px-2 py-1 rounded text-xs font-medium border ${
                      done
                        ? "bg-accent/20 border-accent/50 text-accent-foreground"
                        : "bg-muted/40 border-border text-muted-foreground"
                    }`}
                    title={a ? `${a.approverName ?? "Approver"} • ${new Date(a.approvedAt).toLocaleString()}` : "Pending"}
                    data-testid={`approval-step-${name}`}
                  >
                    {done && <CheckCircle2 className="inline h-3 w-3 mr-1" />}
                    {name}
                  </div>
                );
              })}
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              {!isLocked && (
                <Button
                  type="button"
                  size="sm"
                  onClick={onApprove}
                  disabled={pending}
                  data-testid="button-approve"
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                  Approve as {nextLevelName}
                </Button>
              )}
              {currentLevel > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onReject}
                  disabled={pending}
                  data-testid="button-reject"
                >
                  <XCircle className="mr-1.5 h-4 w-4" />
                  Reject to draft
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-semibold ${accent ? "text-xl" : "text-base"}`}>{value}</span>
    </div>
  );
}
