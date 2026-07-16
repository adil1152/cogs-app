import { useState } from "react";
import { Link } from "wouter";
import { useForgotPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, MailCheck, ArrowLeft } from "lucide-react";
import { QncLogo } from "@/components/QncLogo";
import { ThemeToggle } from "@/components/ThemeProvider";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const forgot = useForgotPassword({
    mutation: {
      onSuccess: (res) => {
        setEmailConfigured(res.emailConfigured);
        setSent(true);
      },
      onError: (err: any) => setError(err?.message ?? "Something went wrong"),
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    forgot.mutate({ data: { email: email.trim() } });
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

        {sent ? (
          <div data-testid="text-forgot-sent">
            <div className="h-12 w-12 rounded-full bg-sidebar-accent grid place-items-center mb-4">
              <MailCheck className="h-6 w-6 text-sidebar-primary" />
            </div>
            {emailConfigured ? (
              <>
                <h1 className="text-2xl font-semibold tracking-tight mb-2">
                  Check your email
                </h1>
                <p className="text-sm text-sidebar-foreground/70 mb-6">
                  If an account exists for <span className="font-medium">{email.trim()}</span>,
                  we've sent a password reset link. It's valid for 1 hour.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-semibold tracking-tight mb-2">
                  Email isn't set up yet
                </h1>
                <p className="text-sm text-sidebar-foreground/70 mb-6">
                  This app hasn't been configured to send emails. Please contact an
                  administrator — they can reset your password for you.
                </p>
              </>
            )}
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-sm text-sidebar-primary hover:underline font-medium"
              data-testid="link-back-to-login"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight mb-2">
              Forgot your password?
            </h1>
            <p className="text-sm text-sidebar-foreground/70 mb-6">
              Enter your account email and we'll send you a link to set a new one.
            </p>
            <form onSubmit={onSubmit} className="space-y-4" data-testid="form-forgot-password">
              <div className="space-y-1.5">
                <Label htmlFor="fp-email" className="text-sidebar-foreground/80">
                  Email
                </Label>
                <Input
                  id="fp-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-sidebar-accent/30 border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/40"
                  placeholder="you@company.com"
                  data-testid="input-forgot-email"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" data-testid="text-forgot-error">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                size="lg"
                disabled={forgot.isPending}
                className="w-full bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
                data-testid="button-send-reset-link"
              >
                {forgot.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Send reset link"
                )}
              </Button>
              <p className="text-sm text-sidebar-foreground/60 text-center">
                Remembered it?{" "}
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
