import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { QncLogo } from "@/components/QncLogo";
import { ThemeToggle } from "@/components/ThemeProvider";

export default function Register() {
  const { register } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await register({
        email: email.trim(),
        password,
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        mobile: mobile.trim() || null,
      });
    } catch (err: any) {
      setError(err?.message ?? "Could not create account");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-sidebar text-sidebar-foreground grid place-items-center p-6 relative">
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40" />
      </div>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-11 w-11 rounded-md bg-white grid place-items-center shrink-0 p-1.5">
            <QncLogo className="h-full w-full" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight text-base">
              Qudrat National Company
            </div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-sidebar-foreground/60">
              Full facility management
            </div>
          </div>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight mb-1">Create account</h1>
        <p className="text-sm text-sidebar-foreground/70 mb-6">
          Sign up to track your projects' daily costs.
        </p>

        <form onSubmit={onSubmit} className="space-y-4" data-testid="form-register">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fn" className="text-sidebar-foreground/80">First name</Label>
              <Input
                id="fn"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="bg-sidebar-accent/30 border-sidebar-border text-sidebar-foreground"
                data-testid="input-register-firstname"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ln" className="text-sidebar-foreground/80">Last name</Label>
              <Input
                id="ln"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="bg-sidebar-accent/30 border-sidebar-border text-sidebar-foreground"
                data-testid="input-register-lastname"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em" className="text-sidebar-foreground/80">Email</Label>
            <Input
              id="em"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-sidebar-accent/30 border-sidebar-border text-sidebar-foreground"
              placeholder="you@company.com"
              data-testid="input-register-email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mob" className="text-sidebar-foreground/80">
              Mobile <span className="text-sidebar-foreground/40">(optional)</span>
            </Label>
            <Input
              id="mob"
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className="bg-sidebar-accent/30 border-sidebar-border text-sidebar-foreground"
              placeholder="+966…"
              data-testid="input-register-mobile"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw" className="text-sidebar-foreground/80">Password</Label>
            <PasswordInput
              id="pw"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-sidebar-accent/30 border-sidebar-border text-sidebar-foreground"
              placeholder="At least 8 characters"
              data-testid="input-register-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw2" className="text-sidebar-foreground/80">Confirm password</Label>
            <PasswordInput
              id="pw2"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="bg-sidebar-accent/30 border-sidebar-border text-sidebar-foreground"
              data-testid="input-register-confirm"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" data-testid="text-register-error">
              {error}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            disabled={submitting}
            className="w-full bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
            data-testid="button-register"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </Button>
          <p className="text-sm text-sidebar-foreground/60 text-center">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-sidebar-primary hover:underline font-medium"
              data-testid="link-login"
            >
              Sign in
            </Link>
          </p>
          <p className="text-[11px] text-sidebar-foreground/40 text-center">
            The first user to register becomes the admin.
          </p>
        </form>
      </div>
    </div>
  );
}
