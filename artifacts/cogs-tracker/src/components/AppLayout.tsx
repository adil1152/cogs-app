import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  FolderKanban,
  BarChart3,
  Users,
  LogOut,
  Activity,
} from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  match?: (path: string) => boolean;
}

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, match: (p) => p === "/" },
  { label: "Projects", href: "/projects", icon: FolderKanban, match: (p) => p.startsWith("/projects") },
  { label: "Reports", href: "/reports", icon: BarChart3, match: (p) => p.startsWith("/reports") },
  { label: "Users", href: "/admin/users", icon: Users, adminOnly: true, match: (p) => p.startsWith("/admin") },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const isAdmin = user?.role === "admin";

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <aside className="w-60 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col">
        <div className="px-5 py-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center">
              <Activity className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <div className="leading-tight">
              <div className="font-semibold tracking-tight">COGS Tracker</div>
              <div className="text-[11px] uppercase tracking-wider text-sidebar-foreground/60">
                Operations Cockpit
              </div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          {NAV.filter((n) => !n.adminOnly || isAdmin).map((item) => {
            const active = item.match ? item.match(location) : location === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <a
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                  )}
                  data-testid={`nav-${item.label.toLowerCase()}`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </a>
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="h-8 w-8 rounded-full bg-sidebar-accent grid place-items-center text-xs font-semibold">
              {(user?.firstName?.[0] ?? user?.email?.[0] ?? "?").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">
                {user?.firstName ?? user?.email ?? "—"}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-sidebar-foreground/60">
                {user?.role ?? "user"}
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={logout}
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 h-8 w-8"
              data-testid="button-logout"
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="border-b border-border bg-card/50">
      <div className="px-8 py-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="page-title">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
