import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  FolderKanban,
  BarChart3,
  Users,
  ShieldCheck,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { QncLogo } from "@/components/QncLogo";
import { ThemeToggle } from "@/components/ThemeProvider";

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  /** Tailwind text color class for the icon (in expanded view). */
  iconColor: string;
  adminOnly?: boolean;
  match?: (path: string) => boolean;
}

const NAV: NavItem[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    iconColor: "text-sky-500",
    match: (p) => p === "/",
  },
  {
    label: "Projects",
    href: "/projects",
    icon: FolderKanban,
    iconColor: "text-amber-500",
    match: (p) => p.startsWith("/projects"),
  },
  {
    label: "Reports",
    href: "/reports",
    icon: BarChart3,
    iconColor: "text-emerald-500",
    match: (p) => p.startsWith("/reports"),
  },
  {
    label: "Users",
    href: "/admin/users",
    icon: Users,
    iconColor: "text-violet-500",
    adminOnly: true,
    match: (p) => p === "/admin/users",
  },
  {
    label: "Security groups",
    href: "/admin/security-groups",
    icon: ShieldCheck,
    iconColor: "text-rose-500",
    adminOnly: true,
    match: (p) => p.startsWith("/admin/security-groups"),
  },
];

const COLLAPSE_KEY = "qnc-sidebar-collapsed";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const isAdmin = user?.role === "admin";
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  return (
    <div className="min-h-screen text-foreground flex">
      <aside
        className={cn(
          "shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col transition-[width] duration-200",
          "sticky top-0 self-start h-screen z-30",
          collapsed ? "w-16" : "w-60",
        )}
        data-testid="app-sidebar"
        data-collapsed={collapsed ? "true" : "false"}
      >
        <div
          className={cn(
            "py-5 border-b border-sidebar-border flex items-center",
            collapsed ? "px-2 justify-center" : "px-5 gap-3",
          )}
        >
          <div className="h-10 w-10 rounded-md bg-white grid place-items-center shrink-0 p-1 ring-1 ring-sidebar-border">
            <QncLogo className="h-full w-full" />
          </div>
          {!collapsed && (
            <div className="leading-tight min-w-0 flex-1">
              <div className="font-semibold tracking-tight text-[15px] truncate">
                Qudrat National Co.
              </div>
              <div className="text-[10.5px] uppercase tracking-wider text-sidebar-foreground/60 truncate">
                Full facility management
              </div>
            </div>
          )}
        </div>

        <nav className={cn("flex-1 py-4 space-y-1", collapsed ? "px-1.5" : "px-2")}>
          {NAV.filter((n) => !n.adminOnly || isAdmin).map((item) => {
            const active = item.match ? item.match(location) : location === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <a
                  className={cn(
                    "flex items-center rounded-md text-sm font-medium transition-colors",
                    collapsed ? "h-10 w-full justify-center" : "gap-3 px-3 py-2",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                  )}
                  data-testid={`nav-${item.label.toLowerCase()}`}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      active ? "text-sidebar-accent-foreground" : item.iconColor,
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </a>
              </Link>
            );
          })}
        </nav>

        <div
          className={cn(
            "border-t border-sidebar-border",
            collapsed ? "p-2 space-y-2" : "p-3",
          )}
        >
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setCollapsed((v) => !v)}
            className={cn(
              "h-8 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40",
              collapsed ? "w-full" : "w-8 ml-auto flex",
            )}
            data-testid="button-toggle-sidebar"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>

          {collapsed ? (
            <div className="flex flex-col items-center gap-1.5">
              <div className="h-8 w-8 rounded-full bg-sidebar-accent grid place-items-center text-xs font-semibold text-sidebar-accent-foreground">
                {(user?.firstName?.[0] ?? user?.email?.[0] ?? "?").toUpperCase()}
              </div>
              <ThemeToggle className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 h-8 w-8" />
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
          ) : (
            <div className="flex items-center gap-2.5 px-1 py-1 mt-1">
              <div className="h-8 w-8 rounded-full bg-sidebar-accent grid place-items-center text-xs font-semibold text-sidebar-accent-foreground">
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
              <ThemeToggle className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40" />
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
          )}
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
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="border-b border-border bg-card/60 backdrop-blur">
      <div className="px-8 py-6 flex items-end justify-between gap-4">
        <div>
          <h1
            className="text-2xl font-semibold tracking-tight"
            data-testid="page-title"
          >
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
