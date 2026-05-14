import { useEffect, useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Account() {
  const { user, setUser } = useAuth();
  const { toast } = useToast();

  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [mobile, setMobile] = useState(user?.mobile ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
    setMobile(user?.mobile ?? "");
  }, [user]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          mobile: mobile.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not save");
      }
      const updated = await res.json();
      setUser(updated);
      toast({ title: "Profile updated" });
    } catch (err: any) {
      toast({
        title: "Could not update profile",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({
        title: "Password too short",
        description: "Password must be at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch("/api/auth/me/password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not change password");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password changed" });
    } catch (err: any) {
      toast({
        title: "Could not change password",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <AppLayout>
      <PageHeader
        title="My account"
        subtitle="Update your profile and password."
      />
      <div className="px-8 py-6 grid gap-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveProfile} className="space-y-4" data-testid="form-profile">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input value={user?.email ?? ""} disabled />
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <div className="h-10 flex items-center">
                    <Badge variant={user?.role === "admin" ? "default" : "secondary"}>
                      {user?.role ?? "user"}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="acc-fn">First name</Label>
                  <Input
                    id="acc-fn"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    data-testid="input-account-firstname"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="acc-ln">Last name</Label>
                  <Input
                    id="acc-ln"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    data-testid="input-account-lastname"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-mob">
                  Mobile <span className="text-muted-foreground text-xs">(optional)</span>
                </Label>
                <Input
                  id="acc-mob"
                  type="tel"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="+966…"
                  data-testid="input-account-mobile"
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={savingProfile} data-testid="button-save-profile">
                  {savingProfile ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
                  ) : (
                    "Save changes"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={changePassword} className="space-y-4" data-testid="form-password">
              <div className="space-y-1.5">
                <Label htmlFor="pw-cur">Current password</Label>
                <PasswordInput
                  id="pw-cur"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  data-testid="input-current-password"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pw-new">New password</Label>
                  <PasswordInput
                    id="pw-new"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    data-testid="input-new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-confirm">Confirm new password</Label>
                  <PasswordInput
                    id="pw-confirm"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    data-testid="input-confirm-password"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={savingPassword} data-testid="button-change-password">
                  {savingPassword ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Updating…</>
                  ) : (
                    "Update password"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
