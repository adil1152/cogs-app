import { ReactNode, useEffect, useState } from "react";
import "../styles/mis-glass.css";
import { useMisAppearance } from "../hooks/useMisAppearance";
import { MisAppearancePicker } from "./MisAppearancePicker";
import { Link, Redirect, useLocation } from "wouter";
import { 
  BarChart3, 
  Settings2, 
  UsersRound, 
  FolderKanban, 
  FileText, 
  ArrowLeft,
  Loader2,
  LayoutDashboard,
  Menu,
  ClipboardList,
  History
} from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useMisAccess } from "../hooks/useMisAccess";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeProvider";
import { hasPermission } from "../lib/access";
import { canRequestAnalytics } from "./MisAnalyticsFilters";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

export function useSidebarState() {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem("mis_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggle = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("mis_sidebar_collapsed", String(next));
      } catch {}
      return next;
    });
  };

  return { isCollapsed, toggle };
}

export function MisLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user: globalUser } = useAuth();
  const { data: access, isLoading, error, refetch } = useMisAccess();
  const { isCollapsed, toggle } = useSidebarState();
  const appearanceState = useMisAppearance();
  const { appearance } = appearanceState;

  // Scope glass tokens to the MIS route lifetime (portals included); removed on unmount so COGS is untouched.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("mis-glass", appearance === "glass");
    return () => root.classList.remove("mis-glass");
  }, [appearance]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!error && access && !access.hasAccess) return <Redirect to="~/" replace />;

  if (error || !access) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-50/50 dark:bg-slate-950">
        <div className="max-w-md w-full border bg-card p-8 rounded-xl text-center space-y-6 shadow-sm">
          <div className="h-16 w-16 bg-rose-500/10 text-rose-500 rounded-full mx-auto grid place-items-center">
            <UsersRound className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{error ? "Unable to check MIS access" : "No MIS Access"}</h1>
            <p className="text-sm text-muted-foreground mt-2">
              {error
                ? "The access check failed. Please retry; your permissions have not been changed."
                : "You do not have permission to access the Management Information System. Please contact an MIS administrator."}
            </p>
            {error && <button type="button" className="mt-4 text-primary underline" onClick={() => void refetch()}>Retry access check</button>}
          </div>
          <Link href="~/" className="inline-flex items-center justify-center h-10 px-4 py-2 bg-primary text-primary-foreground font-medium rounded-md hover:opacity-90 transition-opacity">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Return to COGS
          </Link>
        </div>
      </div>
    );
  }
  
  const isGlobalAdmin = globalUser?.role === "admin";
  const NAV = [
    { label: "Dashboard", href: "/", icon: LayoutDashboard, exact: true, visible: true },
    { label: "Overview Report", href: "/overview-report", icon: ClipboardList, visible: hasPermission(access, "reports") && hasPermission(access, "financial") },
    { label: "Projects", href: "/projects", icon: FolderKanban, visible: true }, 
    { label: "Entries", href: "/entries", icon: FileText, visible: hasPermission(access, "entries") || hasPermission(access, "view_entries") || hasPermission(access, "create_entries") || hasPermission(access, "history") },
    { label: "Bulk Entries", href: "/bulk-entries", icon: FileText, visible: hasPermission(access, "view_entries") },
    { label: "Reports", href: "/reports", icon: BarChart3, visible: hasPermission(access, "reports") },
    { label: "MIS Analytics Dashboard", href: "/analytics", icon: BarChart3, visible: canRequestAnalytics(access) },
    { label: "Comparison", href: "/comparison", icon: BarChart3, visible: canRequestAnalytics(access) },
    { label: "Report Builder", href: "/report-builder", icon: FileText, visible: canRequestAnalytics(access) },
    { label: "Project Security", href: "/project-security", icon: UsersRound, visible: hasPermission(access, "authorities") },
    { label: "Service Rates", href: "/service-rates", icon: Settings2, visible: hasPermission(access, "services") },
    { label: "Global MIS Access", href: "/authorities", icon: UsersRound, visible: hasPermission(access, "authorities") },
    { label: "Configuration", href: "/configuration", icon: Settings2, visible: hasPermission(access, "configuration") },
    { label: "System Audit Log", href: "~/admin/audit-log", icon: History, visible: isGlobalAdmin },
  ];

  return (
    <TooltipProvider delayDuration={0}>
      <div data-appearance={appearance} data-testid="mis-shell" className={cn("mis-shell min-h-screen flex flex-col md:flex-row", appearance === "classic" && "bg-slate-50 dark:bg-slate-950")}>
        <aside className={cn("w-full glass-sidebar text-sidebar-foreground border-r shadow-sm flex flex-col shrink-0 transition-all duration-300", isCollapsed ? "md:w-20" : "md:w-64")}>
          <div className={cn("p-4 border-b border-sidebar-border flex items-center justify-between md:justify-start", isCollapsed ? "md:justify-center md:px-2" : "")}>
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="h-8 w-8 shrink-0 bg-primary text-primary-foreground rounded flex items-center justify-center">
                <BarChart3 className="h-5 w-5 text-white" />
              </div>
              <div className={cn("whitespace-nowrap transition-opacity", isCollapsed ? "md:hidden" : "block")}>
                <div className="font-semibold text-sm leading-tight text-sidebar-foreground">QNC MIS</div>
                <div className="text-[10px] text-sidebar-foreground/60 uppercase tracking-widest font-medium">Management Info</div>
              </div>
            </div>
            <div className="md:hidden flex items-center gap-1">
              <MisAppearancePicker {...appearanceState} compact />
              <ThemeToggle className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40" />
            </div>
          </div>

          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {NAV.filter(n => n.visible).map((item) => {
              const isActive = item.href.startsWith("~") ? false : item.exact ? location === item.href : location.startsWith(item.href);
              const Icon = item.icon;
              
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link href={item.href} className={cn(
                      "flex items-center rounded-md text-sm font-medium transition-colors h-10",
                      isCollapsed ? "md:justify-center md:px-0 px-3" : "px-3 gap-3",
                      isActive 
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
                    )}>
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className={cn("whitespace-nowrap", isCollapsed ? "md:hidden" : "block")}>
                        {item.label}
                      </span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className={cn(isCollapsed ? "hidden md:block" : "hidden")}>
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </nav>

          <div className="hidden md:flex p-3 border-t border-sidebar-border">
            <Tooltip>
              <TooltipTrigger asChild>
                <button 
                  onClick={toggle}
                  aria-expanded={!isCollapsed}
                  aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  className={cn(
                    "flex items-center rounded-md text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground transition-colors h-10",
                    isCollapsed ? "justify-center w-full" : "px-3 gap-3 w-full"
                  )}
                >
                  <Menu className="h-4 w-4 shrink-0" />
                  <span className={cn("whitespace-nowrap", isCollapsed ? "hidden" : "block")}>
                    Collapse
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className={cn(isCollapsed ? "block" : "hidden")}>
                Expand sidebar
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="p-3 border-t border-sidebar-border space-y-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="~/" className={cn(
                  "flex items-center rounded-md text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground transition-colors h-10",
                  isCollapsed ? "md:justify-center md:px-0 px-3" : "px-3 gap-3"
                )}>
                  <ArrowLeft className="h-4 w-4 shrink-0" />
                  <span className={cn("whitespace-nowrap", isCollapsed ? "md:hidden" : "block")}>
                    Return to COGS
                  </span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className={cn(isCollapsed ? "hidden md:block" : "hidden")}>
                Return to COGS
              </TooltipContent>
            </Tooltip>
            
            <div className="hidden md:block">
              <MisAppearancePicker {...appearanceState} isCollapsed={isCollapsed} />
            </div>
            <div className={cn("hidden md:flex items-center h-10", isCollapsed ? "justify-center" : "px-3")}>
              <ThemeToggle className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40" />
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 h-screen overflow-y-auto">
          <div className="w-full min-w-0 p-4 md:p-6 space-y-8">
            {children}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
