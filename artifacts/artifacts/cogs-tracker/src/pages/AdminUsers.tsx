import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers,
  useUpdateUserRole,
  useCreateUser,
  useUpdateUser,
  getListUsersQueryKey,
  type AppUser,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Pencil, Plus } from "lucide-react";

type Role = "admin" | "user";

interface UserFormState {
  email: string;
  firstName: string;
  lastName: string;
  mobile: string;
  password: string;
  role: Role;
}

const EMPTY_FORM: UserFormState = {
  email: "",
  firstName: "",
  lastName: "",
  mobile: "",
  password: "",
  role: "user",
};

export default function AdminUsers() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: users, isLoading } = useListUsers({
    query: { queryKey: getListUsersQueryKey() },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
  }

  const updateRole = useUpdateUserRole({
    mutation: {
      onSuccess: () => {
        toast({ title: "Role updated" });
        invalidate();
      },
      onError: (err: any) =>
        toast({
          title: "Update failed",
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  const createUser = useCreateUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "User created" });
        invalidate();
        setCreateOpen(false);
        setForm(EMPTY_FORM);
      },
      onError: (err: any) =>
        toast({
          title: "Could not create user",
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  const updateUser = useUpdateUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "User updated" });
        invalidate();
        setEditOpen(false);
        setEditTarget(null);
      },
      onError: (err: any) =>
        toast({
          title: "Update failed",
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM);

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AppUser | null>(null);
  const [editForm, setEditForm] = useState<UserFormState>(EMPTY_FORM);

  function openEdit(u: AppUser) {
    setEditTarget(u);
    setEditForm({
      email: u.email ?? "",
      firstName: u.firstName ?? "",
      lastName: u.lastName ?? "",
      mobile: u.mobile ?? "",
      password: "",
      role: (u.role as Role) ?? "user",
    });
    setEditOpen(true);
  }

  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      toast({
        title: "Password too short",
        description: "Password must be at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    createUser.mutate({
      data: {
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        mobile: form.mobile.trim() || null,
        role: form.role,
      },
    });
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    if (editForm.password && editForm.password.length < 8) {
      toast({
        title: "Password too short",
        description: "Password must be at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    const payload: any = {
      email: editForm.email.trim(),
      firstName: editForm.firstName.trim() || null,
      lastName: editForm.lastName.trim() || null,
      mobile: editForm.mobile.trim() || null,
    };
    if (editTarget.id !== me?.id) payload.role = editForm.role;
    if (editForm.password) payload.password = editForm.password;
    updateUser.mutate({ id: editTarget.id, data: payload });
  }

  return (
    <AppLayout>
      <PageHeader
        title="Users"
        subtitle="Create accounts, set passwords, and manage roles. Admins see every project; users see only what they've been granted."
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="button-add-user">
            <Plus className="h-4 w-4 mr-2" />
            Add user
          </Button>
        }
      />
      <div className="px-8 py-6">
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="px-6 py-8 text-sm text-muted-foreground">Loading…</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead className="w-[180px]">Role</TableHead>
                    <TableHead className="w-[80px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(users ?? []).map((u) => {
                    const isMe = u.id === me?.id;
                    return (
                      <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                        <TableCell>
                          <div className="font-medium flex items-center gap-2">
                            {[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}
                            {isMe && (
                              <Badge variant="outline" className="text-[10px]">
                                You
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{u.email}</TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {u.mobile ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={u.role}
                            onValueChange={(v) =>
                              updateRole.mutate({ id: u.id, data: { role: v as Role } })
                            }
                            disabled={isMe}
                          >
                            <SelectTrigger data-testid={`select-role-${u.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="user">User</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(u)}
                            data-testid={`button-edit-${u.id}`}
                            title="Edit user"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create user dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4" data-testid="form-create-user">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>First name</Label>
                <Input
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Last name</Label>
                <Input
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                data-testid="input-create-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Mobile <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Input
                type="tel"
                value={form.mobile}
                onChange={(e) => setForm({ ...form, mobile: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Password</Label>
                <PasswordInput
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  data-testid="input-create-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm({ ...form, role: v as Role })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createUser.isPending} data-testid="button-submit-create">
                {createUser.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create user"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit user dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitEdit} className="space-y-4" data-testid="form-edit-user">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>First name</Label>
                <Input
                  value={editForm.firstName}
                  onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Last name</Label>
                <Input
                  value={editForm.lastName}
                  onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                required
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Mobile <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Input
                type="tel"
                value={editForm.mobile}
                onChange={(e) => setEditForm({ ...editForm, mobile: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>
                  New password{" "}
                  <span className="text-muted-foreground text-xs">
                    (leave blank to keep current)
                  </span>
                </Label>
                <PasswordInput
                  minLength={editForm.password ? 8 : undefined}
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select
                  value={editForm.role}
                  onValueChange={(v) => setEditForm({ ...editForm, role: v as Role })}
                  disabled={editTarget?.id === me?.id}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateUser.isPending} data-testid="button-submit-edit">
                {updateUser.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
