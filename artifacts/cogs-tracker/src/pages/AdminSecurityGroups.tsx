import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSecurityGroups,
  useCreateSecurityGroup,
  useUpdateSecurityGroup,
  useDeleteSecurityGroup,
  getListSecurityGroupsQueryKey,
  useListSecurityGroupMembers,
  useAddSecurityGroupMember,
  useRemoveSecurityGroupMember,
  getListSecurityGroupMembersQueryKey,
  useListUsers,
  getListUsersQueryKey,
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
import { UserCombobox } from "@/components/UserCombobox";
import { ShieldCheck, Plus, Pencil, Trash2, Lock, Users, X, Globe } from "lucide-react";

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
  const [managingMembers, setManagingMembers] = useState<SecurityGroup | null>(
    null,
  );

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
                    <TableHead className="text-center">
                      All-project members
                    </TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(groups ?? []).map((g) => (
                    <TableRow key={g.id} data-testid={`group-row-${g.id}`}>
                      <TableCell>
                        <div className="font-medium flex items-center gap-1.5">
                          {g.name}
                          {g.autoAssignNewProjects && (
                            <Badge variant="secondary" className="text-[10px] font-normal">
                              Auto-adds to new projects
                            </Badge>
                          )}
                        </div>
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
                      <TableCell className="text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setManagingMembers(g)}
                          data-testid={`members-group-${g.id}`}
                        >
                          <Users className="mr-1.5 h-3.5 w-3.5" />
                          {g.memberCount ?? 0}
                        </Button>
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
      {managingMembers && (
        <MembersDialog
          key={managingMembers.id}
          open
          onOpenChange={(o) => !o && setManagingMembers(null)}
          group={managingMembers}
          onChanged={invalidate}
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

function MembersDialog({
  open,
  onOpenChange,
  group,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  group: SecurityGroup;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  const { data: members, isLoading: membersLoading } =
    useListSecurityGroupMembers(group.id, {
      query: { queryKey: getListSecurityGroupMembersQueryKey(group.id) },
    });
  const { data: users } = useListUsers({
    query: { queryKey: getListUsersQueryKey() },
  });

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: getListSecurityGroupMembersQueryKey(group.id),
    });
    onChanged();
  };

  const addMember = useAddSecurityGroupMember({
    mutation: {
      onSuccess: () => {
        setSelectedUserId("");
        refresh();
      },
      onError: (err: any) =>
        toast({
          title: "Could not add member",
          description: err?.message ?? "Unknown error",
          variant: "destructive",
        }),
    },
  });
  const removeMember = useRemoveSecurityGroupMember({
    mutation: {
      onSuccess: refresh,
      onError: (err: any) =>
        toast({
          title: "Could not remove member",
          description: err?.message ?? "Unknown error",
          variant: "destructive",
        }),
    },
  });

  const memberUserIds = new Set((members ?? []).map((m) => m.userId));
  const availableUsers = (users ?? []).filter(
    (u) => !memberUserIds.has(u.id) && u.role !== "admin",
  );

  const userLabel = (u: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  }) => {
    const name = [u.firstName, u.lastName].filter(Boolean).join(" ");
    return name ? `${name} (${u.email})` : (u.email ?? "");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-blue-500" />
            All-project members — {group.name}
          </DialogTitle>
          <DialogDescription>
            {group.autoAssignNewProjects ? (
              <>
                Members of this group are automatically granted access to{" "}
                <span className="font-medium text-foreground">
                  every new project
                </span>{" "}
                when it is created. Existing projects are not affected.
              </>
            ) : (
              <>
                Members of this group get its permissions on{" "}
                <span className="font-medium text-foreground">
                  every project
                </span>
                , without needing per-project access. (Admins already see
                everything.)
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <UserCombobox
                users={availableUsers}
                value={selectedUserId}
                onSelect={setSelectedUserId}
                placeholder={
                  availableUsers.length === 0
                    ? "No more users to add"
                    : "Pick a user to add…"
                }
                testidPrefix="member-user"
              />
            </div>
            <Button
              onClick={() =>
                selectedUserId &&
                addMember.mutate({
                  id: group.id,
                  data: { userId: selectedUserId },
                })
              }
              disabled={!selectedUserId || addMember.isPending}
              data-testid="button-add-member"
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add
            </Button>
          </div>
          <div className="rounded-md border">
            {membersLoading ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                Loading…
              </div>
            ) : (members ?? []).length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                No members yet. Add a user above to give them this group's
                permissions on all projects.
              </div>
            ) : (
              <ul className="divide-y">
                {(members ?? []).map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between px-4 py-2.5 text-sm"
                    data-testid={`member-row-${m.id}`}
                  >
                    <div>
                      <div className="font-medium">{userLabel(m.user)}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMember.mutate({ id: m.id })}
                      disabled={removeMember.isPending}
                      data-testid={`remove-member-${m.id}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [autoAssignNewProjects, setAutoAssignNewProjects] = useState(
    group?.autoAssignNewProjects ?? false,
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
      autoAssignNewProjects,
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
          <div className="space-y-2 rounded-md border px-3 py-2.5 bg-muted/30">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={autoAssignNewProjects}
                onCheckedChange={(v) => setAutoAssignNewProjects(!!v)}
                className="mt-0.5"
                data-testid="group-auto-assign"
              />
              <span>
                <span className="font-medium">
                  Auto-add members to every new project
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Whenever a new project is created, everyone in this group's
                  member list is automatically granted access to it with this
                  group's permissions. Existing projects are not changed.
                </span>
              </span>
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
