import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useResetPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import { QncLogo } from "@/components/QncLogo";
import { ThemeToggle } from "@/components/ThemeProvider";

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
    [],
  );

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = useResetPassword({
    mutation: {
      onSuccess: () => setDone(true),
      onError: (err: any) =>
        setError(err?.message ?? "This reset link is invalid or has expired"),
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    reset.mutate({ data: { token, newPassword } });
  }

  return (
    <div className="min-h-screen bg-sidebar text-sidebar-foreground grid place-items-center p-6 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40" />
      </div>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-12 w-12 rounded-md bg-primary text-primary-foreground grid place-items-center shrink-0 shadow-sm">
            <QncLogo className="h-7 w-7 text-white" />
          </div>
          <div className="leading-tight">
            <div className="font-bold tracking-tight text-lg">Qudrat National</div>
            <div className="text-[11px] uppercase tracking-[0.1em] text-sidebar-foreground/60 font-medium">
              COGS Tracker
            </div>
          </div>
        </div>

        {done ? (
          <div data-testid="text-reset-done">
            <div className="h-12 w-12 rounded-full bg-sidebar-accent grid place-items-center mb-4">
              <CheckCircle2 className="h-6 w-6 text-sidebar-primary" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mb-2">
              Password updated
            </h1>
            <p className="text-sm text-sidebar-foreground/70 mb-6">
              Your password has been changed. Sign in with your new password.
            </p>
            <Button
              size="lg"
              className="w-full bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
              onClick={() => navigate("/login")}
              data-testid="button-go-to-login"
            >
              Go to sign in
            </Button>
          </div>
        ) : !token ? (
          <div data-testid="text-reset-missing-token">
            <h1 className="text-2xl font-semibold tracking-tight mb-2">
              Invalid reset link
            </h1>
            <p className="text-sm text-sidebar-foreground/70 mb-6">
              This link is missing its reset code. Please use the link from your
              email, or request a new one.
            </p>
            <Link
              href="/forgot-password"
              className="inline-flex items-center gap-1.5 text-sm text-sidebar-primary hover:underline font-medium"
              data-testid="link-request-new"
            >
              <ArrowLeft className="h-4 w-4" />
              Request a new link
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight mb-2">
              Set a new password
            </h1>
            <p className="text-sm text-sidebar-foreground/70 mb-6">
              Choose a new password for your account (minimum 8 characters).
            </p>
            <form onSubmit={onSubmit} className="space-y-4" data-testid="form-reset-password">
              <div className="space-y-1.5">
                <Label htmlFor="rp-new" className="text-sidebar-foreground/80">
                  New password
                </Label>
                <PasswordInput
                  id="rp-new"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="bg-sidebar-accent/30 border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/40"
                  data-testid="input-reset-new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rp-confirm" className="text-sidebar-foreground/80">
                  Confirm new password
                </Label>
                <PasswordInput
                  id="rp-confirm"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-sidebar-accent/30 border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/40"
                  data-testid="input-reset-confirm-password"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" data-testid="text-reset-error">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                size="lg"
                disabled={reset.isPending}
                className="w-full bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
                data-testid="button-reset-password"
              >
                {reset.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Updating…
                  </>
                ) : (
                  "Update password"
                )}
              </Button>
              <p className="text-sm text-sidebar-foreground/60 text-center">
                <Link
                  href="/login"
                  className="text-sidebar-primary hover:underline font-medium"
                  data-testid="link-login"
                >
                  Back to sign in
                </Link>
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
