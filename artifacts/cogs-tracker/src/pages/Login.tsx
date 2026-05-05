import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Activity, BarChart3, Lock, Utensils } from "lucide-react";

export default function Login() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen bg-sidebar text-sidebar-foreground grid lg:grid-cols-2">
      <div className="flex flex-col justify-between p-10 lg:p-14">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-md bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center">
            <Activity className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-semibold tracking-tight text-lg leading-tight">COGS Tracker</div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-sidebar-foreground/60">
              Operations Cockpit
            </div>
          </div>
        </div>

        <div className="max-w-md">
          <h1 className="text-4xl lg:text-5xl font-semibold tracking-tight leading-[1.1]">
            Daily mandays.
            <br />
            <span className="text-sidebar-primary">Real costs.</span>
            <br />
            One screen.
          </h1>
          <p className="mt-5 text-sidebar-foreground/70 text-base leading-relaxed">
            Track meals, mandays and service spend across every project you run — with a security
            field that lets admins decide exactly who sees each project's report.
          </p>
          <div className="mt-8 space-y-3">
            <Button
              size="lg"
              onClick={login}
              className="w-full bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
              data-testid="button-login"
            >
              Log in with Replit
            </Button>
            <p className="text-xs text-sidebar-foreground/50">
              The first user to log in becomes the admin.
            </p>
          </div>
        </div>

        <div className="text-xs text-sidebar-foreground/40">
          © {new Date().getFullYear()} COGS Tracker
        </div>
      </div>
      <div className="hidden lg:flex flex-col gap-6 p-14 bg-sidebar-accent/40 border-l border-sidebar-border">
        <Card title="Meal-weighted mandays" icon={Utensils}>
          Breakfast counts as 0.2, lunch / dinner / midnight / meal box each as 0.4. Live math under
          every entry — no spreadsheets, no second-guessing.
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
