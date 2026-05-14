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
  useSubmitDailyEntry,
  useListEntryApprovals,
  useListEntryAudit,
  useListProjectApprovers,
  useListEntryAttachments,
  useCreateEntryAttachment,
  useDeleteEntryAttachment,
  getGetProjectQueryKey,
  getListProjectServicesQueryKey,
  getGetDailyEntryQueryKey,
  getListProjectEntriesQueryKey,
  getGetDashboardQueryKey,
  getGetRecentActivityQueryKey,
  getListEntryApprovalsQueryKey,
  getListEntryAuditQueryKey,
  getListProjectApproversQueryKey,
  getListEntryAttachmentsQueryKey,
  type ServiceCostInput,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
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
import { readReturnTo } from "@/lib/return-to";
import { MEAL_WEIGHTS, computeMealMandays } from "@/lib/cogs-formula";
import {
  ArrowLeft,
  Trash2,
  Lock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  History,
  Send,
  Paperclip,
  Upload,
  FileText,
} from "lucide-react";

const DEFAULT_APPROVAL_LEVELS = [
  "OP",
  "SOP",
  "COO",
  "CC",
  "Additional",
] as const;

interface SubLine {
  subItemId: string;
  name: string;
  sortOrder: number;
  cost: string;
  mandays: string;
}

interface ServiceLine {
  projectServiceId: string;
  name: string;
  kind: "food" | "standard" | "group";
  cost: string;
  mandays: string;
  // Food-only meal counts; auto-derive mandays via MEAL_WEIGHTS.
  breakfastQty: string;
  lunchQty: string;
  dinnerQty: string;
  midnightQty: string;
  mealBoxQty: string;
  // Food-only manual mandays added on top of the meal-formula auto value.
  foodManualMandays: string;
  // Group-only: per-sub-item cost+mandays. Total cost/mandays are sums.
  subItems: SubLine[];
}

function emptyLine(svc: {
  id: string;
  name: string;
  kind: "food" | "standard" | "group";
  subItems?: Array<{ id: string; name: string; sortOrder: number }>;
}): ServiceLine {
  const subs: SubLine[] = svc.kind === "group"
    ? [...(svc.subItems ?? [])]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => ({
          subItemId: s.id,
          name: s.name,
          sortOrder: s.sortOrder,
          cost: "",
          mandays: "",
        }))
    : [];
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
    foodManualMandays: "",
    subItems: subs,
  };
}

function lineCost(l: ServiceLine): number {
  if (l.kind === "group") {
    return l.subItems.reduce((s, r) => {
      const n = Number(r.cost);
      return s + (Number.isNaN(n) ? 0 : n);
    }, 0);
  }
  const n = Number(l.cost);
  return Number.isNaN(n) ? 0 : n;
}

function lineMandays(l: ServiceLine): number {
  if (l.kind === "food") {
    const auto = computeMealMandays({
      breakfastQty: Number(l.breakfastQty) || 0,
      lunchQty: Number(l.lunchQty) || 0,
      dinnerQty: Number(l.dinnerQty) || 0,
      midnightQty: Number(l.midnightQty) || 0,
      mealBoxQty: Number(l.mealBoxQty) || 0,
    });
    const manual = Number(l.foodManualMandays);
    return auto + (Number.isNaN(manual) ? 0 : manual);
  }
  if (l.kind === "group") {
    return l.subItems.reduce((s, r) => {
      const n = Number(r.mandays);
      return s + (Number.isNaN(n) ? 0 : n);
    }, 0);
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

  // Captured once on mount: if the user landed here via a "drill-in" from a
  // report page, returnTo holds the encoded URL we should send them back to.
  const [back] = useState(() => readReturnTo());
  const exitUrl = back?.url ?? `/projects/${projectId}`;

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
  const approvalLevelNames = useMemo<string[]>(() => {
    const chain = (project as any)?.approvalChain as
      | Array<{ position: number; levelName: string }>
      | undefined;
    if (chain && chain.length > 0) {
      return [...chain]
        .sort((a, b) => a.position - b.position)
        .map((c) => c.levelName);
    }
    return [...DEFAULT_APPROVAL_LEVELS];
  }, [project]);
  const status = (existingEntry?.status ?? "draft") as
    | "draft"
    | "pending"
    | "approved";
  const isDraft = status === "draft";
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
  const [manualMandays, setManualMandays] = useState("");
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
      setManualMandays(
        existingEntry.manualMandays != null && Number(existingEntry.manualMandays) !== 0
          ? String(existingEntry.manualMandays)
          : "",
      );
      setNotes(existingEntry.notes ?? "");
      const byId = new Map(existingEntry.serviceCosts.map((s) => [s.projectServiceId, s]));
      setLines(
        services.map((svc) => {
          const sc = byId.get(svc.id);
          const kind = svc.kind as "food" | "standard" | "group";
          const projectSubs = ((svc as any).subItems ?? []) as Array<{
            id: string;
            name: string;
            sortOrder: number;
          }>;
          const subById = new Map(
            (sc?.subCosts ?? []).map((s: any) => [s.subItemId, s]),
          );
          const subs: SubLine[] =
            kind === "group"
              ? [...projectSubs]
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((s) => {
                    const sub: any = subById.get(s.id);
                    return {
                      subItemId: s.id,
                      name: s.name,
                      sortOrder: s.sortOrder,
                      cost: sub?.cost != null ? String(sub.cost) : "",
                      mandays: sub?.mandays != null ? String(sub.mandays) : "",
                    };
                  })
              : [];
          return {
            projectServiceId: svc.id,
            name: svc.name,
            kind,
            cost:
              kind === "group"
                ? ""
                : sc?.cost != null
                ? String(sc.cost)
                : "",
            mandays:
              kind === "standard" && sc?.mandays != null ? String(sc.mandays) : "",
            breakfastQty: sc?.breakfastQty != null ? String(sc.breakfastQty) : "",
            lunchQty: sc?.lunchQty != null ? String(sc.lunchQty) : "",
            dinnerQty: sc?.dinnerQty != null ? String(sc.dinnerQty) : "",
            midnightQty: sc?.midnightQty != null ? String(sc.midnightQty) : "",
            mealBoxQty: sc?.mealBoxQty != null ? String(sc.mealBoxQty) : "",
            foodManualMandays:
              kind === "food" && sc?.manualMandays != null && Number(sc.manualMandays) !== 0
                ? String(sc.manualMandays)
                : "",
            subItems: subs,
          };
        }),
      );
    } else {
      setLines(
        services.map((s) =>
          emptyLine({
            id: s.id,
            name: s.name,
            kind: s.kind as any,
            subItems: (s as any).subItems,
          }),
        ),
      );
      if (project && !location) setLocation(project.location);
    }
  }, [services, existingEntry, isEdit, project]);

  const totals = useMemo(() => {
    let totalCost = 0;
    let summedMandays = 0;
    for (const l of lines) {
      totalCost += lineCost(l);
      summedMandays += lineMandays(l);
    }
    const manual = Number(manualMandays) || 0;
    const tm = totalMandaysOverride
      ? Number(totalMandaysManual) || 0
      : summedMandays + manual;
    const cpm = tm ? totalCost / tm : null;
    return {
      totalCost,
      summedMandays,
      manualMandays: manual,
      totalMandays: tm,
      costPerManday: cpm,
    };
  }, [lines, totalMandaysOverride, totalMandaysManual, manualMandays]);

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
        navigate(exitUrl);
      },
      onError: (err: any) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
    },
  });
  const update = useUpdateDailyEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Entry updated" });
        invalidateAll();
        navigate(exitUrl);
      },
      onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
    },
  });
  const del = useDeleteDailyEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Entry deleted" });
        invalidateAll();
        navigate(exitUrl);
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
  const submit = useSubmitDailyEntry({
    mutation: {
      onSuccess: () => {
        toast({ title: "Submitted for approval" });
        invalidateAll();
      },
      onError: (err: any) =>
        toast({
          title: "Submit failed",
          description: err.message,
          variant: "destructive",
        }),
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
    let serviceCosts: ServiceCostInput[];
    try {
      serviceCosts = lines
      .filter((l) => {
        if (l.kind === "group") {
          return l.subItems.some((s) => s.cost !== "" || s.mandays !== "");
        }
        if (l.cost !== "") return true;
        if (l.kind === "food") {
          return (
            l.breakfastQty !== "" ||
            l.lunchQty !== "" ||
            l.dinnerQty !== "" ||
            l.midnightQty !== "" ||
            l.mealBoxQty !== "" ||
            l.foodManualMandays !== ""
          );
        }
        return l.mandays !== "";
      })
      .map((l) => {
        if (l.kind === "group") {
          const subCosts = l.subItems
            .filter((s) => s.cost !== "" || s.mandays !== "")
            .map((s) => {
              const cost = s.cost !== "" ? Number(s.cost) : 0;
              const mandays = s.mandays !== "" ? Number(s.mandays) : 0;
              if (Number.isNaN(cost) || cost < 0) {
                throw new Error(`Invalid cost for ${l.name} → ${s.name}`);
              }
              if (Number.isNaN(mandays) || mandays < 0) {
                throw new Error(`Invalid mandays for ${l.name} → ${s.name}`);
              }
              return { subItemId: s.subItemId, cost, mandays };
            });
          const totalCost = subCosts.reduce((acc, s) => acc + s.cost, 0);
          const totalMd = subCosts.reduce((acc, s) => acc + s.mandays, 0);
          return {
            projectServiceId: l.projectServiceId,
            kind: "group",
            cost: totalCost,
            mandays: totalMd,
            subCosts,
          } as ServiceCostInput;
        }
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
          if (l.foodManualMandays !== "") {
            const fm = Number(l.foodManualMandays);
            if (Number.isNaN(fm) || fm < 0) {
              throw new Error(`Invalid manual mandays for ${l.name}`);
            }
            base.manualMandays = fm;
          }
          base.mandays = lineMandays(l);
        } else if (l.mandays !== "") {
          base.mandays = Number(l.mandays);
        }
        return base as ServiceCostInput;
      });
    } catch (err: any) {
      toast({ title: "Check the form", description: err.message, variant: "destructive" });
      return;
    }
    const manualNum = Number(manualMandays);
    if (manualMandays !== "" && (Number.isNaN(manualNum) || manualNum < 0)) {
      toast({ title: "Manual mandays invalid", variant: "destructive" });
      return;
    }
    const payload: any = {
      entryDate,
      location,
      totalMandaysOverride,
      manualMandays: manualMandays === "" ? 0 : manualNum,
      notes,
      serviceCosts,
    };
    if (totalMandaysOverride) payload.totalMandays = Number(totalMandaysManual);
    if (isEdit) update.mutate({ id: entryId!, data: payload });
    else create.mutate({ id: projectId, data: payload });
  }

  // Attachments (only meaningful when editing an existing entry)
  const { data: attachments } = useListEntryAttachments(entryId ?? "", {
    query: {
      enabled: !!entryId,
      queryKey: getListEntryAttachmentsQueryKey(entryId ?? ""),
    },
  });
  const attachmentList = attachments ?? [];
  const pdfRequired = !!project?.pdfRequired;
  const submitBlockedByPdf =
    pdfRequired && isEdit && isDraft && attachmentList.length === 0;

  const createAttachment = useCreateEntryAttachment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Attachment uploaded" });
        if (entryId) {
          queryClient.invalidateQueries({
            queryKey: getListEntryAttachmentsQueryKey(entryId),
          });
          queryClient.invalidateQueries({
            queryKey: getGetDailyEntryQueryKey(entryId),
          });
          queryClient.invalidateQueries({
            queryKey: getListEntryAuditQueryKey(entryId),
          });
        }
      },
      onError: (err: any) =>
        toast({
          title: "Could not save attachment",
          description: err.message,
          variant: "destructive",
        }),
    },
  });
  const deleteAttachment = useDeleteEntryAttachment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Attachment removed" });
        if (entryId) {
          queryClient.invalidateQueries({
            queryKey: getListEntryAttachmentsQueryKey(entryId),
          });
          queryClient.invalidateQueries({
            queryKey: getGetDailyEntryQueryKey(entryId),
          });
          queryClient.invalidateQueries({
            queryKey: getListEntryAuditQueryKey(entryId),
          });
        }
      },
      onError: (err: any) =>
        toast({
          title: "Could not remove attachment",
          description: err.message,
          variant: "destructive",
        }),
    },
  });
  const { uploadFile, isUploading } = useUpload({
    onError: (err) =>
      toast({
        title: "Upload failed",
        description: err.message,
        variant: "destructive",
      }),
  });

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !entryId) return;
    const result = await uploadFile(file);
    if (!result) return;
    createAttachment.mutate({
      id: entryId,
      data: {
        objectPath: result.objectPath,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
      },
    });
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
          <Link href={exitUrl}>
            <Button variant="outline" data-testid="button-back">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {back ? `Back to ${back.label}` : "Back"}
            </Button>
          </Link>
        }
      />

      {isEdit && (
        <div className="px-8 pt-4 space-y-3">
          <StatusPill status={status} />
          {!isDraft && (
            <ApprovalStrip
              currentLevel={currentLevel}
              isLocked={isLocked}
              canApprove={isNextApprover && !isLocked && nextLevel <= approvalLevelNames.length}
              levelNames={approvalLevelNames}
              canReject={isCurrentApprover && currentLevel > 0 && !isLocked}
              canReset={canResetApproval && (currentLevel > 0 || isLocked)}
              approvals={approvals ?? []}
              onApprove={() => approve.mutate({ id: entryId! })}
              onReject={() => reject.mutate({ id: entryId! })}
              onReset={() => reset.mutate({ id: entryId! })}
              pending={approve.isPending || reject.isPending || reset.isPending}
            />
          )}
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
                  const cost = lineCost(l);
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
                      {l.kind === "group" ? (
                        <div className="space-y-2">
                          {l.subItems.length === 0 && (
                            <div className="text-xs text-muted-foreground italic">
                              No sub-services configured. Add some on the
                              project's Services tab.
                            </div>
                          )}
                          {l.subItems.length > 0 && (
                            <div className="overflow-hidden rounded-md border border-border">
                              <table className="w-full text-sm">
                                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                                  <tr>
                                    <th className="px-3 py-1.5 text-left font-medium">Sub-service</th>
                                    <th className="px-3 py-1.5 text-right font-medium">Cost (SAR)</th>
                                    <th className="px-3 py-1.5 text-right font-medium">Mandays</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {l.subItems.map((s, si) => (
                                    <tr key={s.subItemId} data-testid={`sub-row-${i}-${si}`}>
                                      <td className="px-3 py-1.5 font-medium">{s.name}</td>
                                      <td className="px-2 py-1">
                                        <Input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          value={s.cost}
                                          onChange={(e) =>
                                            setLine(i, {
                                              subItems: l.subItems.map((x, xi) =>
                                                xi === si ? { ...x, cost: e.target.value } : x,
                                              ),
                                            })
                                          }
                                          placeholder="0.00"
                                          className="h-8 text-right tabular-nums"
                                          data-testid={`input-sub-cost-${i}-${si}`}
                                        />
                                      </td>
                                      <td className="px-2 py-1">
                                        <Input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          value={s.mandays}
                                          onChange={(e) =>
                                            setLine(i, {
                                              subItems: l.subItems.map((x, xi) =>
                                                xi === si ? { ...x, mandays: e.target.value } : x,
                                              ),
                                            })
                                          }
                                          placeholder="0"
                                          className="h-8 text-right tabular-nums"
                                          data-testid={`input-sub-mandays-${i}-${si}`}
                                        />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot className="bg-muted/30 text-xs">
                                  <tr>
                                    <td className="px-3 py-1.5 font-medium text-muted-foreground">Totals</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                                      {formatCurrency(cost)}
                                    </td>
                                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">
                                      {formatNumber(md, 2)}
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          )}
                        </div>
                      ) : l.kind === "food" ? (
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
                          <div className="space-y-1.5">
                            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                              Manual mandays
                              <span className="ml-1 normal-case tracking-normal text-[10px] text-muted-foreground/80">
                                (added on top of meal-formula auto value)
                              </span>
                            </Label>
                            <Input
                              type="number" step="0.01" min="0"
                              value={l.foodManualMandays}
                              onChange={(e) => setLine(i, { foodManualMandays: e.target.value })}
                              placeholder="0"
                              data-testid={`input-food-manual-mandays-${i}`}
                            />
                          </div>
                          <div className="text-xs text-muted-foreground tabular-nums">
                            Auto mandays:{" "}
                            <span className="font-semibold text-foreground">
                              {formatNumber(
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
                            {l.foodManualMandays !== "" && !Number.isNaN(Number(l.foodManualMandays)) && (
                              <>
                                {" + "}
                                <span className="font-semibold text-foreground">
                                  {formatNumber(Number(l.foodManualMandays), 2)}
                                </span>
                                {" manual = "}
                                <span className="font-semibold text-foreground">{formatNumber(md, 2)}</span>
                              </>
                            )}
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

            {isEdit && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Paperclip className="h-4 w-4" />
                    Attachments
                    {pdfRequired && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-1.5 py-0.5">
                        Required
                      </span>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upload supporting documents (e.g. signed daily sheets) for
                    this entry.
                    {pdfRequired &&
                      " At least one attachment is required before submitting for approval."}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {attachmentList.length === 0 ? (
                    <div className="text-sm text-muted-foreground rounded-md border border-dashed border-border px-4 py-6 text-center">
                      No attachments yet.
                    </div>
                  ) : (
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {attachmentList.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-center gap-3 px-3 py-2 text-sm"
                          data-testid={`attachment-row-${a.id}`}
                        >
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <a
                            href={`/api/storage/objects/${encodeURI(a.objectPath)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 truncate hover:underline"
                          >
                            {a.fileName}
                          </a>
                          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                            {formatFileSize(a.fileSize)}
                          </span>
                          {!isLocked && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive h-7 w-7 p-0"
                              onClick={() =>
                                deleteAttachment.mutate({
                                  id: entryId!,
                                  attachmentId: a.id,
                                })
                              }
                              disabled={deleteAttachment.isPending}
                              data-testid={`button-delete-attachment-${a.id}`}
                              aria-label={`Remove ${a.fileName}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!isLocked && (
                    <div>
                      <label
                        className="inline-flex items-center gap-2 text-sm font-medium cursor-pointer rounded-md border border-border bg-background px-3 py-1.5 hover:bg-muted"
                        data-testid="button-upload-attachment"
                      >
                        <Upload className="h-4 w-4" />
                        {isUploading ? "Uploading…" : "Upload file"}
                        <input
                          type="file"
                          className="sr-only"
                          onChange={onPickFile}
                          disabled={isUploading || createAttachment.isPending}
                        />
                      </label>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card className="border-accent/40 bg-accent/5 sticky top-6">
              <CardHeader><CardTitle className="text-base">Live totals</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Row label="Total cost" value={formatCurrency(totals.totalCost)} accent />
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Service mandays</span>
                    <span className="tabular-nums">
                      {formatNumber(totals.summedMandays, 2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <Label
                      htmlFor="input-manual-mandays"
                      className="text-muted-foreground"
                    >
                      + Manual mandays
                    </Label>
                    <Input
                      id="input-manual-mandays"
                      type="number"
                      step="0.01"
                      min="0"
                      value={manualMandays}
                      onChange={(e) => setManualMandays(e.target.value)}
                      placeholder="0"
                      disabled={totalMandaysOverride}
                      className="w-28 text-right tabular-nums"
                      data-testid="input-manual-mandays"
                    />
                  </div>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Override total
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
                    <span
                      className="tabular-nums font-semibold text-base"
                      data-testid="text-total-mandays"
                    >
                      {formatNumber(totals.totalMandays, 2)}
                    </span>
                  )}
                </div>
                <Row label="Cost / manday" value={totals.costPerManday != null ? `${formatCurrency(totals.costPerManday)}` : "—"} />
                <Button type="submit" className="w-full" disabled={create.isPending || update.isPending || isLocked} data-testid="button-save-entry">
                  {isEdit ? "Save changes" : "Save as draft"}
                </Button>
                {isEdit && isDraft && !isLocked && (
                  <>
                    <Button
                      type="button"
                      className="w-full"
                      variant="default"
                      disabled={submit.isPending || submitBlockedByPdf}
                      onClick={() => submit.mutate({ id: entryId! })}
                      data-testid="button-submit-for-approval"
                    >
                      <Send className="mr-2 h-4 w-4" /> Submit for approval
                    </Button>
                    {submitBlockedByPdf && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        This project requires at least one PDF attachment before
                        submission.
                      </p>
                    )}
                  </>
                )}
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

function StatusPill({ status }: { status: "draft" | "pending" | "approved" }) {
  const map = {
    draft: {
      label: "Draft",
      className:
        "bg-muted text-muted-foreground border-border",
    },
    pending: {
      label: "Pending approval",
      className:
        "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    },
    approved: {
      label: "Approved",
      className:
        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    },
  } as const;
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center text-xs font-semibold uppercase tracking-wider rounded border px-2 py-0.5 ${s.className}`}
      data-testid={`status-pill-${status}`}
    >
      {s.label}
    </span>
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
  levelNames,
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
  levelNames: string[];
}) {
  const nextLevelName = levelNames[currentLevel];
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
                Approval progress: {currentLevel} of {levelNames.length}
              </span>
            )}
            <div className="flex items-center gap-1.5">
              {levelNames.map((name, i) => {
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
  CREATE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  UPDATE: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  DELETE: "bg-destructive/15 text-destructive border-destructive/30",
  APPROVE: "bg-primary/15 text-primary border-primary/30",
  REJECT: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  RESET: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  SUBMIT: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
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

function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
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
