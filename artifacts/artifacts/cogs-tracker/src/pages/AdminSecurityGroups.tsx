import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSecurityGroups,
  useCreateSecurityGroup,
  useUpdateSecurityGroup,
  useDeleteSecurityGroup,
  getListSecurityGroupsQueryKey,
  type SecurityGroup,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Plus, Pencil, Trash2, Lock } from "lucide-react";

export default function AdminSecurityGroups() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: groups, isLoading } = useListSecurityGroups({
    query: {
      enabled: isAdmin,
      queryKey: getListSecurityGroupsQueryKey(),
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListSecurityGroupsQueryKey(),
    });

  const [editing, setEditing] = useState<SecurityGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<SecurityGroup | null>(null);

  const del = useDeleteSecurityGroup({
    mutation: {
      onSuccess: () => {
        toast({ title: "Group deleted" });
        setDeleting(null);
        invalidate();
      },
      onError: (err: any) =>
        toast({
          title: "Could not delete",
          description: err?.message ?? "Unknown error",
          variant: "destructive",
        }),
    },
  });

  if (!isAdmin) {
    return (
      <AppLayout>
        <PageHeader title="Security groups" />
        <div className="px-8 py-10">
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <Lock className="h-5 w-5 mx-auto mb-2 text-muted-foreground/60" />
              Only admins can manage security groups.
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Security groups"
        subtitle="Reusable role templates. Pick a group when granting project access — its permissions are added on top of any extras you tick on the access row."
        actions={
          <Button
            onClick={() => setCreating(true)}
            data-testid="button-new-group"
          >
            <Plus className="mr-2 h-4 w-4" /> New group
          </Button>
        }
      />
      <div className="px-8 py-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-rose-500" /> All groups
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="px-6 py-8 text-sm text-muted-foreground">
                Loading…
              </div>
            ) : (groups ?? []).length === 0 ? (
              <div className="px-6 py-10 text-sm text-muted-foreground text-center">
                No security groups yet. Create one to define a reusable
                permission template.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-center">View summary</TableHead>
                    <TableHead className="text-center">Edit entries</TableHead>
                    <TableHead className="text-center">Reset to draft</TableHead>
                    <TableHead className="text-center">In use</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(groups ?? []).map((g) => (
                    <TableRow key={g.id} data-testid={`group-row-${g.id}`}>
                      <TableCell>
                        <div className="font-medium">{g.name}</div>
                        {g.description && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {g.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {g.canViewSummary ? "✓" : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {g.canEditEntries ? "✓" : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {g.canResetApproval ? "✓" : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={g.assignmentCount > 0 ? "secondary" : "outline"}
                        >
                          {g.assignmentCount}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(g)}
                          data-testid={`edit-group-${g.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(g)}
                          data-testid={`delete-group-${g.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {creating && (
        <GroupDialog
          key="new"
          open
          onOpenChange={(o) => !o && setCreating(false)}
          onSaved={invalidate}
        />
      )}
      {editing && (
        <GroupDialog
          key={editing.id}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          group={editing}
          onSaved={invalidate}
        />
      )}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this security group?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.assignmentCount && deleting.assignmentCount > 0
                ? `This group is currently assigned to ${deleting.assignmentCount} access row(s). You'll need to reassign those first.`
                : "This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && del.mutate({ id: deleting.id })}
              data-testid="confirm-delete-group"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

function GroupDialog({
  open,
  onOpenChange,
  group,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  group?: SecurityGroup;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [canViewSummary, setCanViewSummary] = useState(
    group?.canViewSummary ?? false,
  );
  const [canEditEntries, setCanEditEntries] = useState(
    group?.canEditEntries ?? false,
  );
  const [canResetApproval, setCanResetApproval] = useState(
    group?.canResetApproval ?? false,
  );

  const create = useCreateSecurityGroup({
    mutation: {
      onSuccess: () => {
        toast({ title: "Group created" });
        onSaved();
        onOpenChange(false);
      },
      onError: (err: any) =>
        toast({
          title: "Could not create",
          description: err?.message ?? "Unknown error",
          variant: "destructive",
        }),
    },
  });
  const update = useUpdateSecurityGroup({
    mutation: {
      onSuccess: () => {
        toast({ title: "Group updated" });
        onSaved();
        onOpenChange(false);
      },
      onError: (err: any) =>
        toast({
          title: "Could not update",
          description: err?.message ?? "Unknown error",
          variant: "destructive",
        }),
    },
  });

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const data = {
      name: trimmed,
      description: description.trim() || null,
      canViewSummary,
      canEditEntries,
      canResetApproval,
    };
    if (group) {
      update.mutate({ id: group.id, data });
    } else {
      create.mutate({ data });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {group ? "Edit security group" : "New security group"}
          </DialogTitle>
          <DialogDescription>
            Permissions here are added (OR-merged) on top of any per-row
            extras when this group is assigned.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              placeholder="e.g. Site Manager"
              data-testid="input-group-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Short note about who this is for"
              data-testid="input-group-description"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Permissions
            </Label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={canViewSummary}
                onCheckedChange={(v) => setCanViewSummary(!!v)}
                data-testid="group-perm-summary"
              />
              View project summary report
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={canEditEntries}
                onCheckedChange={(v) => setCanEditEntries(!!v)}
                data-testid="group-perm-edit"
              />
              Edit daily entries
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={canResetApproval}
                onCheckedChange={(v) => setCanResetApproval(!!v)}
                data-testid="group-perm-reset"
              />
              Reset entries to draft
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || create.isPending || update.isPending}
            data-testid="save-group"
          >
            {group ? "Save changes" : "Create group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
