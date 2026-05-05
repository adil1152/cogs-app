import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers,
  useUpdateUserRole,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

export default function AdminUsers() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: users, isLoading } = useListUsers({
    query: { queryKey: getListUsersQueryKey() },
  });
  const updateRole = useUpdateUserRole({
    mutation: {
      onSuccess: () => {
        toast({ title: "Role updated" });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
    },
  });

  return (
    <AppLayout>
      <PageHeader
        title="Users"
        subtitle="Promote teammates to admin, or restrict them to user. Admins see every project; users see only what they've been granted."
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
                    <TableHead className="w-[200px]">Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(users ?? []).map((u) => {
                    const isMe = u.id === me?.id;
                    return (
                      <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                        <TableCell>
                          <div className="font-medium flex items-center gap-2">
                            {u.firstName ?? u.lastName ?? "—"}
                            {isMe && <Badge variant="outline" className="text-[10px]">You</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{u.email}</TableCell>
                        <TableCell>
                          <Select
                            value={u.role}
                            onValueChange={(v) => updateRole.mutate({ id: u.id, data: { role: v as any } })}
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
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
