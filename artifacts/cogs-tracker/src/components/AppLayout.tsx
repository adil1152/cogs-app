import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  FolderKanban,
  BarChart3,
  TableProperties,
  GitCompareArrows,
  Users,
  ShieldCheck,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  UserCircle,
  ChevronsUpDown,
  Settings,
} from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { QncLogo } from "@/components/QncLogo";
import { ThemeToggle } from "@/components/ThemeProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    match: (p) => p === "/reports",
  },
  {
    label: "Entry-wise",
    href: "/reports/entry-wise",
    icon: TableProperties,
    iconColor: "text-teal-500",
    match: (p) => p.startsWith("/reports/entry-wise"),
  },
  {
    label: "Comparison",
    href: "/reports/comparison",
    icon: GitCompareArrows,
    iconColor: "text-fuchsia-500",
    match: (p) => p.startsWith("/reports/comparison"),
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
  {
    label: "Settings",
    href: "/admin/settings",
    icon: Settings,
    iconColor: "text-slate-500",
    adminOnly: true,
    match: (p) => p.startsWith("/admin/settings"),
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
          "shrink-0 glass-sidebar text-sidebar-foreground border-r flex flex-col transition-[width] duration-200 shadow-sm",
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
          <div className="h-10 w-10 rounded-md bg-primary text-primary-foreground grid place-items-center shrink-0 shadow-sm">
            <QncLogo className="h-6 w-6 text-white" />
          </div>
          {!collapsed && (
            <div className="leading-tight min-w-0 flex-1 animate-in fade-in slide-in-from-left-2 duration-300">
              <div className="font-semibold tracking-tight text-[15px] truncate">
                Qudrat National
              </div>
              <div className="text-[10.5px] uppercase tracking-wider text-sidebar-foreground/60 truncate font-medium">
                COGS Tracker
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
                    "group flex items-center rounded-md text-sm font-medium transition-all duration-200",
                    collapsed ? "h-10 w-full justify-center" : "gap-3 px-3 py-2",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground hover:translate-x-0.5",
                  )}
                  data-testid={`nav-${item.label.toLowerCase()}`}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110",
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="h-8 w-8 rounded-full bg-sidebar-accent grid place-items-center text-xs font-semibold text-sidebar-accent-foreground hover:ring-2 hover:ring-sidebar-ring/40 transition-shadow"
                    data-testid="button-user-menu"
                    title="Account menu"
                  >
                    {(user?.firstName?.[0] ?? user?.email?.[0] ?? "?").toUpperCase()}
                  </button>
                </DropdownMenuTrigger>
                <UserMenuContent
                  name={user?.firstName ?? user?.email ?? "—"}
                  email={user?.email ?? ""}
                  role={user?.role ?? "user"}
                  onLogout={logout}
                />
              </DropdownMenu>
              <ThemeToggle className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 h-8 w-8" />
            </div>
          ) : (
            <div className="flex items-center gap-2 px-1 py-1 mt-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex-1 min-w-0 flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-sidebar-accent/40 transition-colors text-left"
                    data-testid="button-user-menu"
                  >
                    <div className="h-8 w-8 rounded-full bg-sidebar-accent grid place-items-center text-xs font-semibold text-sidebar-accent-foreground shrink-0">
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
                    <ChevronsUpDown className="h-3.5 w-3.5 text-sidebar-foreground/50 shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <UserMenuContent
                  name={user?.firstName ?? user?.email ?? "—"}
                  email={user?.email ?? ""}
                  role={user?.role ?? "user"}
                  onLogout={logout}
                />
              </DropdownMenu>
              <ThemeToggle className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40" />
            </div>
          )}
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}

function UserMenuContent({
  name,
  email,
  role,
  onLogout,
}: {
  name: string;
  email: string;
  role: string;
  onLogout: () => void;
}) {
  const [, navigate] = useLocation();
  return (
    <DropdownMenuContent side="top" align="start" className="w-56">
      <DropdownMenuLabel className="font-normal">
        <div className="text-sm font-semibold truncate">{name}</div>
        {email && (
          <div className="text-xs text-muted-foreground truncate">{email}</div>
        )}
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
          {role}
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => navigate("/account")}
        data-testid="menu-item-account"
      >
        <UserCircle className="h-4 w-4 mr-2 text-sky-500" />
        My account
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onLogout} data-testid="button-logout">
        <LogOut className="h-4 w-4 mr-2 text-rose-500" />
        Log out
      </DropdownMenuItem>
    </DropdownMenuContent>
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
    <div className="border-b glass">
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
