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
  useResetDailyEntry,
  useListEntryApprovals,
  useListEntryAudit,
  useListProjectApprovers,
  getGetProjectQueryKey,
  getListProjectServicesQueryKey,
  getGetDailyEntryQueryKey,
  getListProjectEntriesQueryKey,
  getGetDashboardQueryKey,
  getGetRecentActivityQueryKey,
  getListEntryApprovalsQueryKey,
  getListEntryAuditQueryKey,
  getListProjectApproversQueryKey,
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
import { MEAL_WEIGHTS, computeMealMandays } from "@/lib/cogs-formula";
import {
  ArrowLeft,
  Trash2,
  Lock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  History,
} from "lucide-react";

const APPROVAL_LEVELS = ["OP", "SOP", "COO", "CC", "Additional"] as const;

interface ServiceLine {
  projectServiceId: string;
  name: string;
  kind: "food" | "standard";
  cost: string;
  mandays: string;
  // Food-only meal counts; auto-derive mandays via MEAL_WEIGHTS.
  breakfastQty: string;
  lunchQty: string;
  dinnerQty: string;
  midnightQty: string;
  mealBoxQty: string;
}

function emptyLine(svc: { id: string; name: string; kind: "food" | "standard" }): ServiceLine {
  return {
    projectServiceId: svc.id,
    name: svc.name,
    kind: svc.kind,
    cost: "",
    mandays: "",
    breakfastQty: "",
    lunchQty: "",
    dinnerQty: "",
    midnightQty: "",
    mealBoxQty: "",
  };
}

function lineMandays(l: ServiceLine): number {
  if (l.kind === "food") {
    return computeMealMandays({
      breakfastQty: Number(l.breakfastQty) || 0,
      lunchQty: Number(l.lunchQty) || 0,
      dinnerQty: Number(l.dinnerQty) || 0,
      midnightQty: Number(l.midnightQty) || 0,
      mealBoxQty: Number(l.mealBoxQty) || 0,
    });
  }
  const n = Number(l.mandays);
  return Number.isNaN(n) ? 0 : n;
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
  const { data: assignments } = useListProjectApprovers(projectId, {
    query: {
      enabled: !!projectId,
      queryKey: getListProjectApproversQueryKey(projectId),
    },
  });
  const { data: audit } = useListEntryAudit(entryId ?? "", {
    query: {
      enabled: !!entryId,
      queryKey: getListEntryAuditQueryKey(entryId ?? ""),
    },
  });

  const isLocked = !!existingEntry?.isLocked;
  const currentLevel = existingEntry?.currentApprovalLevel ?? 0;
  const canResetApproval = !!project?.currentUserCanResetApproval;
  const nextLevel = currentLevel + 1;
  const isNextApprover =
    isAdmin ||
    !!(assignments ?? []).find(
      (a) => a.level === nextLevel && a.userId === user?.id,
    );
  const isCurrentApprover =
    isAdmin ||
    !!(assignments ?? []).find(
      (a) => a.level === currentLevel && a.userId === user?.id,
    );

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
          const kind = svc.kind as "food" | "standard";
          return {
            projectServiceId: svc.id,
            name: svc.name,
            kind,
            cost: sc?.cost != null ? String(sc.cost) : "",
            mandays:
              kind === "standard" && sc?.mandays != null ? String(sc.mandays) : "",
            breakfastQty: sc?.breakfastQty != null ? String(sc.breakfastQty) : "",
            lunchQty: sc?.lunchQty != null ? String(sc.lunchQty) : "",
            dinnerQty: sc?.dinnerQty != null ? String(sc.dinnerQty) : "",
            midnightQty: sc?.midnightQty != null ? String(sc.midnightQty) : "",
            mealBoxQty: sc?.mealBoxQty != null ? String(sc.mealBoxQty) : "",
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
      summedMandays += lineMandays(l);
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
      queryClient.invalidateQueries({ queryKey: getListEntryAuditQueryKey(entryId) });
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
  const reset = useResetDailyEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Entry reset to draft" });
        invalidateAll();
      },
      onError: (err: any) =>
        toast({
          title: "Reset failed",
          description: err.message,
          variant: "destructive",
        }),
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
      .filter((l) => {
        if (l.cost !== "") return true;
        if (l.kind === "food") {
          return (
            l.breakfastQty !== "" ||
            l.lunchQty !== "" ||
            l.dinnerQty !== "" ||
            l.midnightQty !== "" ||
            l.mealBoxQty !== ""
          );
        }
        return l.mandays !== "";
      })
      .map((l) => {
        const base: any = {
          projectServiceId: l.projectServiceId,
          kind: l.kind,
          cost: l.cost !== "" ? Number(l.cost) : 0,
        };
        if (l.kind === "food") {
          // For food rows, persist the meal qtys; mandays is auto-derived from
          // MEAL_WEIGHTS (B 20%, L/D/M/MB 40%) and sent so the backend stores
          // and reuses the exact computed value.
          if (l.breakfastQty !== "") base.breakfastQty = Number(l.breakfastQty);
          if (l.lunchQty !== "") base.lunchQty = Number(l.lunchQty);
          if (l.dinnerQty !== "") base.dinnerQty = Number(l.dinnerQty);
          if (l.midnightQty !== "") base.midnightQty = Number(l.midnightQty);
          if (l.mealBoxQty !== "") base.mealBoxQty = Number(l.mealBoxQty);
          base.mandays = lineMandays(l);
        } else if (l.mandays !== "") {
          base.mandays = Number(l.mandays);
        }
        return base as ServiceCostInput;
      });
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
        subtitle={
          project ? (
            (
              <span className="inline-flex items-center gap-2">
                {existingEntry?.sequenceCode && (
                  <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-foreground">
                    {existingEntry.sequenceCode}
                  </span>
                )}
                <span>{project.name}</span>
              </span>
            ) as any
          ) : (
            ""
          )
        }
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
            canApprove={isNextApprover && !isLocked && nextLevel <= APPROVAL_LEVELS.length}
            canReject={isCurrentApprover && currentLevel > 0 && !isLocked}
            canReset={canResetApproval && (currentLevel > 0 || isLocked)}
            approvals={approvals ?? []}
            onApprove={() => approve.mutate({ id: entryId! })}
            onReject={() => reject.mutate({ id: entryId! })}
            onReset={() => reset.mutate({ id: entryId! })}
            pending={approve.isPending || reject.isPending || reset.isPending}
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
                  Standard services: enter cost + mandays. Food services: enter
                  meal counts and mandays auto-calculate using Breakfast 20%,
                  Lunch / Dinner / Midnight / Meal Box 40% each.
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
                  const md = lineMandays(l);
                  const cpm = md ? cost / md : null;
                  return (
                    <div key={l.projectServiceId} className="rounded-md border border-border bg-card p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-medium">
                          {l.name}
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                            {l.kind}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {cpm != null ? `${formatCurrency(cpm)} / manday` : "—"}
                        </span>
                      </div>
                      {l.kind === "food" ? (
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Cost (SAR)</Label>
                            <Input
                              type="number" step="0.01" min="0"
                              value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })}
                              placeholder="0.00"
                              data-testid={`input-cost-${i}`}
                            />
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                            <MealQty
                              label="Breakfast"
                              weight={MEAL_WEIGHTS.breakfast}
                              value={l.breakfastQty}
                              onChange={(v) => setLine(i, { breakfastQty: v })}
                              testId={`input-breakfast-${i}`}
                            />
                            <MealQty
                              label="Lunch"
                              weight={MEAL_WEIGHTS.lunch}
                              value={l.lunchQty}
                              onChange={(v) => setLine(i, { lunchQty: v })}
                              testId={`input-lunch-${i}`}
                            />
                            <MealQty
                              label="Dinner"
                              weight={MEAL_WEIGHTS.dinner}
                              value={l.dinnerQty}
                              onChange={(v) => setLine(i, { dinnerQty: v })}
                              testId={`input-dinner-${i}`}
                            />
                            <MealQty
                              label="Midnight"
                              weight={MEAL_WEIGHTS.midnight}
                              value={l.midnightQty}
                              onChange={(v) => setLine(i, { midnightQty: v })}
                              testId={`input-midnight-${i}`}
                            />
                            <MealQty
                              label="Meal Box"
                              weight={MEAL_WEIGHTS.mealBox}
                              value={l.mealBoxQty}
                              onChange={(v) => setLine(i, { mealBoxQty: v })}
                              testId={`input-mealbox-${i}`}
                            />
                          </div>
                          <div className="text-xs text-muted-foreground tabular-nums">
                            Auto mandays: <span className="font-semibold text-foreground">{formatNumber(md, 2)}</span>
                          </div>
                        </div>
                      ) : (
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
                      )}
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

      {isEdit && (
        <div className="px-8 pb-8">
          <AuditPanel events={audit ?? []} />
        </div>
      )}
    </AppLayout>
  );
}

function ApprovalStrip({
  currentLevel,
  isLocked,
  canApprove,
  canReject,
  canReset,
  approvals,
  onApprove,
  onReject,
  onReset,
  pending,
}: {
  currentLevel: number;
  isLocked: boolean;
  canApprove: boolean;
  canReject: boolean;
  canReset: boolean;
  approvals: Array<any>;
  onApprove: () => void;
  onReject: () => void;
  onReset: () => void;
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
          <div className="flex items-center gap-2">
            {canApprove && (
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
            {canReject && (
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
            {canReset && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onReset}
                disabled={pending}
                data-testid="button-reset"
                title="Clears all approvals and unlocks the entry. Audited."
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                Reset to draft
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatAuditField(field: string | null | undefined): string {
  if (!field) return "—";
  return field
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatAuditValue(v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  if (v.length > 80) return v.slice(0, 77) + "…";
  return v;
}

const AUDIT_ACTION_STYLES: Record<string, string> = {
  CREATE: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  UPDATE: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  DELETE: "bg-destructive/15 text-destructive border-destructive/30",
  APPROVE: "bg-accent/20 text-accent-foreground border-accent/40",
  REJECT: "bg-rose-500/15 text-rose-700 border-rose-500/30",
  RESET: "bg-sky-500/15 text-sky-700 border-sky-500/30",
};

function AuditPanel({ events }: { events: Array<any> }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <History className="h-4 w-4 text-muted-foreground" />
        <CardTitle className="text-base">History</CardTitle>
        <span className="text-xs text-muted-foreground ml-1">
          ({events.length} event{events.length === 1 ? "" : "s"})
        </span>
      </CardHeader>
      <CardContent className="p-0">
        {events.length === 0 ? (
          <div className="px-6 py-8 text-sm text-muted-foreground text-center">
            No history yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {events.map((e) => {
              const style =
                AUDIT_ACTION_STYLES[e.action] ??
                "bg-muted text-muted-foreground border-border";
              return (
                <div
                  key={e.id}
                  className="px-6 py-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4"
                  data-testid={`audit-row-${e.id}`}
                >
                  <div
                    className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider rounded border px-1.5 py-0.5 w-20 justify-center ${style}`}
                  >
                    {e.action}
                  </div>
                  <div className="flex-1 text-sm">
                    {e.action === "APPROVE" || e.action === "REJECT" ? (
                      <span>
                        Level{" "}
                        <span className="font-medium">
                          {e.levelName ?? e.level ?? "?"}
                        </span>
                      </span>
                    ) : e.action === "RESET" ? (
                      <span>
                        Reset from level{" "}
                        <span className="font-medium">{e.oldValue}</span> back
                        to draft
                      </span>
                    ) : e.action === "CREATE" || e.action === "DELETE" ? (
                      <span>
                        {e.action === "CREATE" ? "Created entry " : "Deleted entry "}
                        <span className="font-mono">
                          {e.newValue ?? e.oldValue}
                        </span>
                      </span>
                    ) : (
                      <span className="space-x-2">
                        <span className="font-medium">
                          {formatAuditField(e.field)}
                        </span>
                        <span className="text-muted-foreground line-through">
                          {formatAuditValue(e.oldValue)}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span>{formatAuditValue(e.newValue)}</span>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {e.actorName ?? "System"} ·{" "}
                    {new Date(e.occurredAt).toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MealQty({
  label,
  weight,
  value,
  onChange,
  testId,
}: {
  label: string;
  weight: number;
  value: string;
  onChange: (v: string) => void;
  testId: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}{" "}
        <span className="text-muted-foreground/70 normal-case">
          ({Math.round(weight * 100)}%)
        </span>
      </Label>
      <Input
        type="number"
        step="1"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="text-right tabular-nums"
        data-testid={testId}
      />
    </div>
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
