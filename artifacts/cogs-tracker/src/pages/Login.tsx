import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Activity, BarChart3, Lock, Utensils, Loader2 } from "lucide-react";
import { QncLogo } from "@/components/QncLogo";
import { ThemeToggle } from "@/components/ThemeProvider";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      // useAuth.setUser will flip Gate; nothing else to do.
    } catch (err: any) {
      setError(err?.message ?? "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-sidebar text-sidebar-foreground grid lg:grid-cols-2 relative">
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40" />
      </div>
      <div className="flex flex-col justify-between p-10 lg:p-14">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-md bg-primary text-primary-foreground grid place-items-center shrink-0 shadow-sm">
            <QncLogo className="h-7 w-7 text-white" />
          </div>
          <div className="leading-tight">
            <div className="font-bold tracking-tight text-lg">
              Qudrat National
            </div>
            <div className="text-[11px] uppercase tracking-[0.1em] text-sidebar-foreground/60 font-medium">
              COGS Tracker
            </div>
          </div>
        </div>

        <div className="max-w-md w-full">
          <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-[1.1] mb-2">
            Welcome back.
          </h1>
          <p className="text-sidebar-foreground/70 text-sm mb-8">
            Sign in to your COGS tracker account.
          </p>

          <form onSubmit={onSubmit} className="space-y-4" data-testid="form-login">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sidebar-foreground/80">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-sidebar-accent/30 border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/40"
                placeholder="you@company.com"
                data-testid="input-login-email"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sidebar-foreground/80">
                  Password
                </Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-sidebar-primary hover:underline font-medium"
                  data-testid="link-forgot-password"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                required
                minLength={1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-sidebar-accent/30 border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/40"
                placeholder="••••••••"
                data-testid="input-login-password"
              />
            </div>
            {error && (
              <p
                className="text-sm text-destructive"
                data-testid="text-login-error"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              disabled={submitting}
              className="w-full bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
              data-testid="button-login"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
            <p className="text-sm text-sidebar-foreground/60 text-center">
              Don't have an account?{" "}
              <Link
                href="/register"
                className="text-sidebar-primary hover:underline font-medium"
                data-testid="link-register"
              >
                Create one
              </Link>
            </p>
          </form>
        </div>

        <div className="text-xs text-sidebar-foreground/40">
          © {new Date().getFullYear()} Qudrat National Company
        </div>
      </div>
      <div className="hidden lg:flex flex-col gap-6 p-14 bg-sidebar-accent/40 border-l border-sidebar-border">
        <Card title="Meal-weighted mandays" icon={Utensils}>
          Define your own meal types and weights per food service — mandays auto-calculate with
          live math under every entry. No spreadsheets, no second-guessing.
        </Card>
        <Card title="Security field per project" icon={Lock}>
          Admins grant individual users permission to view the project's summary report. Everyone
          else sees nothing.
        </Card>
        <Card title="Trends, not just totals" icon={BarChart3}>
          Today, week-to-date, month-to-date — plus a 30-day cost-per-manday trend that catches
          drift before the budget meeting does.
        </Card>
      </div>
    </div>
  );
}

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-sidebar-border bg-sidebar/40 p-5">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="h-7 w-7 rounded bg-sidebar-primary/15 text-sidebar-primary grid place-items-center">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="font-medium text-sm">{title}</div>
      </div>
      <p className="text-sm text-sidebar-foreground/70 leading-relaxed">{children}</p>
    </div>
  );
}
