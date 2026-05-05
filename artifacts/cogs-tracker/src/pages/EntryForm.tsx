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
  getGetProjectQueryKey,
  getListProjectServicesQueryKey,
  getGetDailyEntryQueryKey,
  getListProjectEntriesQueryKey,
  getGetDashboardQueryKey,
  getGetRecentActivityQueryKey,
  type ServiceCostInput,
} from "@workspace/api-client-react";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { computeMealMandays } from "@/lib/cogs-formula";
import { formatCurrency, formatNumber, todayISO } from "@/lib/format";
import { ArrowLeft, Trash2 } from "lucide-react";

interface ServiceLine {
  projectServiceId: string;
  name: string;
  kind: "food" | "standard";
  cost: string;
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
    breakfastQty: "",
    lunchQty: "",
    dinnerQty: "",
    midnightQty: "",
    mealBoxQty: "",
  };
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

  const { data: project } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });
  const { data: services } = useListProjectServices(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectServicesQueryKey(projectId) },
  });
  const { data: existingEntry } = useGetDailyEntry(entryId ?? "", {
    query: { enabled: !!entryId, queryKey: getGetDailyEntryQueryKey(entryId ?? "") },
  });

  const [entryDate, setEntryDate] = useState(todayISO());
  const [location, setLocation] = useState("");
  const [totalMandays, setTotalMandays] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ServiceLine[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Initialize lines when services load (for new entry) or when entry+services load (for edit)
  useEffect(() => {
    if (!services) return;
    if (isEdit) {
      if (!existingEntry) return;
      setEntryDate(existingEntry.entryDate);
      setLocation(existingEntry.location);
      setTotalMandays(String(existingEntry.totalMandays));
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
    let mealMandays = 0;
    for (const l of lines) {
      const c = Number(l.cost);
      if (!Number.isNaN(c)) totalCost += c;
      if (l.kind === "food") {
        mealMandays += computeMealMandays({
          breakfastQty: Number(l.breakfastQty) || 0,
          lunchQty: Number(l.lunchQty) || 0,
          dinnerQty: Number(l.dinnerQty) || 0,
          midnightQty: Number(l.midnightQty) || 0,
          mealBoxQty: Number(l.mealBoxQty) || 0,
        });
      }
    }
    const tm = Number(totalMandays) || 0;
    const cpm = tm ? totalCost / tm : null;
    return { totalCost, mealMandays, costPerManday: cpm };
  }, [lines, totalMandays]);

  const create = useCreateDailyEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Entry saved" });
        queryClient.invalidateQueries({ queryKey: getListProjectEntriesQueryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey() });
        navigate(`/projects/${projectId}`);
      },
      onError: (err: any) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
    },
  });
  const update = useUpdateDailyEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Entry updated" });
        queryClient.invalidateQueries({ queryKey: getListProjectEntriesQueryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: getGetDailyEntryQueryKey(entryId!) });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey() });
        navigate(`/projects/${projectId}`);
      },
      onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
    },
  });
  const del = useDeleteDailyEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Entry deleted" });
        queryClient.invalidateQueries({ queryKey: getListProjectEntriesQueryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey() });
        navigate(`/projects/${projectId}`);
      },
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const tm = Number(totalMandays);
    if (!entryDate || !location || Number.isNaN(tm) || tm < 0) {
      toast({ title: "Check the form", description: "Date, location and mandays are required.", variant: "destructive" });
      return;
    }
    const serviceCosts: ServiceCostInput[] = lines
      .filter((l) => {
        if (l.kind === "standard") return l.cost !== "";
        return (
          l.cost !== "" || l.breakfastQty !== "" || l.lunchQty !== "" ||
          l.dinnerQty !== "" || l.midnightQty !== "" || l.mealBoxQty !== ""
        );
      })
      .map((l) => ({
        projectServiceId: l.projectServiceId,
        kind: l.kind as any,
        cost: l.cost !== "" ? Number(l.cost) : 0,
        ...(l.kind === "food"
          ? {
              breakfastQty: Number(l.breakfastQty) || 0,
              lunchQty: Number(l.lunchQty) || 0,
              dinnerQty: Number(l.dinnerQty) || 0,
              midnightQty: Number(l.midnightQty) || 0,
              mealBoxQty: Number(l.mealBoxQty) || 0,
            }
          : {}),
      }));
    const payload = { entryDate, location, totalMandays: tm, notes, serviceCosts };
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
      <form onSubmit={onSubmit} className="px-8 py-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Day</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
                <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required data-testid="input-entry-date" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Location</Label>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} required data-testid="input-entry-location" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Total mandays</Label>
                <Input
                  type="number" step="0.01" min="0"
                  value={totalMandays} onChange={(e) => setTotalMandays(e.target.value)}
                  required data-testid="input-entry-mandays"
                />
              </div>
              <div className="md:col-span-3 space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Notes</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-entry-notes" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Service costs</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                For food services, enter meal counts and total food spend. Meal mandays are
                computed live (breakfast 0.2, lunch / dinner / midnight / meal box 0.4 each).
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {lines.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No services configured for this project yet — add some on the project page first.
                </div>
              )}
              {lines.map((l, i) => (
                <div key={l.projectServiceId} className="rounded-md border border-border bg-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{l.name}</span>
                      <Badge variant={l.kind === "food" ? "default" : "secondary"}>{l.kind}</Badge>
                    </div>
                    {l.kind === "food" && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        Meal mandays: {formatNumber(
                          computeMealMandays({
                            breakfastQty: Number(l.breakfastQty) || 0,
                            lunchQty: Number(l.lunchQty) || 0,
                            dinnerQty: Number(l.dinnerQty) || 0,
                            midnightQty: Number(l.midnightQty) || 0,
                            mealBoxQty: Number(l.mealBoxQty) || 0,
                          }),
                          2,
                        )}
                      </span>
                    )}
                  </div>
                  {l.kind === "food" && (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
                      <MealInput label="Breakfast" value={l.breakfastQty} onChange={(v) => setLine(i, { breakfastQty: v })} data-testid={`input-breakfast-${i}`} />
                      <MealInput label="Lunch" value={l.lunchQty} onChange={(v) => setLine(i, { lunchQty: v })} data-testid={`input-lunch-${i}`} />
                      <MealInput label="Dinner" value={l.dinnerQty} onChange={(v) => setLine(i, { dinnerQty: v })} data-testid={`input-dinner-${i}`} />
                      <MealInput label="Midnight" value={l.midnightQty} onChange={(v) => setLine(i, { midnightQty: v })} data-testid={`input-midnight-${i}`} />
                      <MealInput label="Meal box" value={l.mealBoxQty} onChange={(v) => setLine(i, { mealBoxQty: v })} data-testid={`input-mealbox-${i}`} />
                    </div>
                  )}
                  <div className="space-y-1.5 max-w-xs">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      {l.kind === "food" ? "Total food spend" : "Daily cost"}
                    </Label>
                    <Input
                      type="number" step="0.01" min="0"
                      value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })}
                      placeholder="0.00"
                      data-testid={`input-cost-${i}`}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="border-accent/40 bg-accent/5 sticky top-6">
            <CardHeader><CardTitle className="text-base">Live totals</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Row label="Total cost" value={formatCurrency(totals.totalCost)} accent />
              <Row label="Total mandays" value={formatNumber(Number(totalMandays) || 0, 2)} />
              <Row label="Meal mandays (food)" value={formatNumber(totals.mealMandays, 2)} />
              <Row label="Cost / manday" value={totals.costPerManday != null ? formatCurrency(totals.costPerManday) : "—"} />
              <Button type="submit" className="w-full" disabled={create.isPending || update.isPending} data-testid="button-save-entry">
                {isEdit ? "Save changes" : "Save entry"}
              </Button>
              {isEdit && (
                <Button
                  type="button" variant="outline" className="w-full text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                  data-testid="button-delete-entry"
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete entry
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </form>
      {isEdit && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
              <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => del.mutate({ id: entryId! })}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </AppLayout>
  );
}

function MealInput({ label, value, onChange, ...rest }: { label: string; value: string; onChange: (v: string) => void; [k: string]: any }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input type="number" min="0" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" {...rest} />
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
