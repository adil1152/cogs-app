import { useState } from "react";
import {
  getMisListTabsQueryKey,
  MisFinancialClass,
  MisTab,
  MisTabInput,
  MisTabType,
  useMisCreateTab,
  useMisListTabs,
  useMisUpdateTab,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layers, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";

function TabDialog({ tab, open, onOpenChange }: { tab?: MisTab; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createTab = useMisCreateTab();
  const updateTab = useMisUpdateTab();
  const editing = Boolean(tab);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const data: MisTabInput = {
      name: String(values.get("name") ?? "").trim(),
      code: String(values.get("code") ?? "").trim(),
      description: String(values.get("description") ?? "").trim() || null,
      type: values.get("type") as MisTabType,
      financialClass: values.get("financialClass") as MisFinancialClass,
      sequence: Number(values.get("sequence")),
      active: values.get("active") === "on",
      allowEntry: values.get("allowEntry") === "on",
      allowReporting: values.get("allowReporting") === "on",
      // Additive fields from the interactive MIS contract. The generated
      // client is refreshed separately when the published schema lands.
      rateEnabled: values.get("rateEnabled") === "on",
      calculatePercentAgainstIncome: values.get("calculatePercentAgainstIncome") === "on",
    } as MisTabInput & {
      rateEnabled: boolean;
      calculatePercentAgainstIncome: boolean;
    };
    const callbacks = {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getMisListTabsQueryKey() });
        toast({ title: editing ? "Tab updated" : "Tab created" });
        onOpenChange(false);
      },
      onError: (error: unknown) => toast({ title: editing ? "Unable to update tab" : "Unable to create tab", description: errorMessage(error), variant: "destructive" as const }),
    };
    if (tab) updateTab.mutate({ id: tab.id, data }, callbacks);
    else createTab.mutate({ data }, callbacks);
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-[520px]">
      <DialogHeader><DialogTitle>{editing ? "Edit tab" : "Create tab"}</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2"><Label htmlFor="tab-name">Name</Label><Input id="tab-name" name="name" defaultValue={tab?.name} required /></div>
          <div className="space-y-2"><Label htmlFor="tab-code">Code</Label><Input id="tab-code" name="code" defaultValue={tab?.code} required /></div>
          <div className="col-span-2 space-y-2"><Label htmlFor="tab-description">Description</Label><Input id="tab-description" name="description" defaultValue={tab?.description ?? ""} /></div>
          <div className="space-y-2"><Label htmlFor="tab-sequence">Sequence</Label><Input id="tab-sequence" name="sequence" type="number" min="0" defaultValue={tab?.sequence ?? 10} required /></div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select name="type" defaultValue={tab?.type ?? MisTabType.income}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value={MisTabType.income}>Income</SelectItem><SelectItem value={MisTabType.cost}>Cost</SelectItem>
              <SelectItem value={MisTabType.expense}>Expense</SelectItem><SelectItem value={MisTabType.salary}>Salary</SelectItem>
              <SelectItem value={MisTabType.other}>Other</SelectItem>
            </SelectContent></Select>
          </div>
          <div className="col-span-2 space-y-2">
            <Label>Financial class</Label>
            <Select name="financialClass" defaultValue={tab?.financialClass ?? MisFinancialClass.income}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value={MisFinancialClass.income}>Income</SelectItem><SelectItem value={MisFinancialClass.cost}>Cost</SelectItem>
              <SelectItem value={MisFinancialClass.expense}>Expense</SelectItem><SelectItem value={MisFinancialClass.salary}>Salary</SelectItem>
              <SelectItem value={MisFinancialClass.excluded}>Excluded</SelectItem>
            </SelectContent></Select>
            <p className="text-xs text-muted-foreground">Financial class is independent from tab type, including Other.</p>
          </div>
          <div className="col-span-2 space-y-3 border-t pt-3">
            <div className="flex items-center justify-between"><Label htmlFor="tab-active">Active</Label><Switch id="tab-active" name="active" defaultChecked={tab?.active ?? true} /></div>
            <div className="flex items-center justify-between"><Label htmlFor="tab-entry">Allow entries</Label><Switch id="tab-entry" name="allowEntry" defaultChecked={tab?.allowEntry ?? true} /></div>
            <div className="flex items-center justify-between"><Label htmlFor="tab-reporting">Allow reporting</Label><Switch id="tab-reporting" name="allowReporting" defaultChecked={tab?.allowReporting ?? true} /></div>
            <div className="flex items-center justify-between"><div><Label htmlFor="tab-rate-enabled">Enable quantity × rate</Label><p className="text-xs text-muted-foreground">Default calculation mode for new services in this type.</p></div><Switch id="tab-rate-enabled" name="rateEnabled" defaultChecked={(tab as MisTab & { rateEnabled?: boolean } | undefined)?.rateEnabled ?? true} /></div>
            <div className="flex items-center justify-between"><div><Label htmlFor="tab-percent-income">Calculate % against total income</Label><p className="text-xs text-muted-foreground">Project tabs may override this type default.</p></div><Switch id="tab-percent-income" name="calculatePercentAgainstIncome" defaultChecked={(tab as MisTab & { calculatePercentAgainstIncome?: boolean } | undefined)?.calculatePercentAgainstIncome ?? (tab?.type === MisTabType.income || tab?.type === MisTabType.other)} /></div>
          </div>
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={createTab.isPending || updateTab.isPending}>{editing ? "Save changes" : "Create tab"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export default function Configuration() {
  const { data: tabs, isLoading, isError } = useMisListTabs();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MisTab | null>(null);
  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-4"><div><h1 className="text-3xl font-semibold tracking-tight">Configuration</h1><p className="mt-1 text-muted-foreground">Manage global MIS tabs available to projects.</p></div><Button onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />Add tab</Button></div>
    <TabDialog open={creating} onOpenChange={setCreating} />
    {editing && <TabDialog key={editing.id} tab={editing} open onOpenChange={(open) => !open && setEditing(null)} />}
    <Card><CardHeader><CardTitle>Global tabs master</CardTitle><CardDescription>Type and financial class are intentionally separate controls.</CardDescription></CardHeader><CardContent>
       <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/50"><tr><th className="px-4 py-3">Sequence</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Financial class</th><th className="px-4 py-3">Calculation</th><th className="px-4 py-3">Settings</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y">
         {isLoading ? <tr><td colSpan={7} className="p-4"><Skeleton className="h-8 w-full" /></td></tr> : isError ? <tr><td colSpan={7} className="p-8 text-center text-destructive">Tabs could not be loaded. Please retry.</td></tr> : tabs?.length ? tabs.map((tab) => { const interactiveTab = tab as MisTab & { rateEnabled?: boolean; calculatePercentAgainstIncome?: boolean }; return <tr key={tab.id}><td className="px-4 py-3">{tab.sequence}</td><td className="px-4 py-3 font-medium">{tab.name}<div className="text-xs text-muted-foreground">{tab.code}</div></td><td className="px-4 py-3 capitalize">{tab.type}</td><td className="px-4 py-3 capitalize">{tab.financialClass}</td><td className="space-x-1 px-4 py-3"><Badge variant={interactiveTab.rateEnabled ? "default" : "secondary"}>{interactiveTab.rateEnabled ? "Quantity × rate" : "Direct amount"}</Badge><Badge variant={interactiveTab.calculatePercentAgainstIncome ? "default" : "outline"}>{interactiveTab.calculatePercentAgainstIncome ? "% of income" : "No %"}</Badge></td><td className="space-x-1 px-4 py-3"><Badge variant={tab.active ? "default" : "secondary"}>{tab.active ? "Active" : "Inactive"}</Badge>{!tab.allowEntry && <Badge variant="outline">No entries</Badge>}{!tab.allowReporting && <Badge variant="outline">Hidden</Badge>}</td><td className="px-4 py-3 text-right"><Button aria-label={`Edit ${tab.name}`} variant="ghost" size="icon" onClick={() => setEditing(tab)}><Pencil className="h-4 w-4" /></Button></td></tr>; }) : <tr><td colSpan={7} className="p-12 text-center text-muted-foreground"><Layers className="mx-auto mb-3 h-8 w-8 opacity-20" />No tabs configured.</td></tr>}
      </tbody></table></div>
    </CardContent></Card>
  </div>;
}