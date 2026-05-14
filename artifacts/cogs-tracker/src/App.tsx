import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Account from "@/pages/Account";
import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/Projects";
import ProjectDetail from "@/pages/ProjectDetail";
import EntryForm from "@/pages/EntryForm";
import ProjectSummary from "@/pages/ProjectSummary";
import Reports from "@/pages/Reports";
import EntryWiseReport from "@/pages/EntryWiseReport";
import ProjectComparisonReport from "@/pages/ProjectComparisonReport";
import AdminUsers from "@/pages/AdminUsers";
import AdminSecurityGroups from "@/pages/AdminSecurityGroups";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function Gate() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  // When the user logs out and lands on a private page, bounce them to /login.
  useEffect(() => {
    if (isLoading) return;
    const isPublic = location === "/login" || location === "/register";
    if (!isAuthenticated && !isPublic) {
      setLocation("/login");
    } else if (isAuthenticated && isPublic) {
      setLocation("/");
    }
  }, [isAuthenticated, isLoading, location, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/register" component={Register} />
        <Route component={Login} />
      </Switch>
    );
  }
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/account" component={Account} />
      <Route path="/projects" component={Projects} />
      <Route path="/projects/:id/entries/new" component={EntryForm} />
      <Route path="/projects/:id/entries/:entryId" component={EntryForm} />
      <Route path="/projects/:id/summary" component={ProjectSummary} />
      <Route path="/projects/:id" component={ProjectDetail} />
      <Route path="/reports/entry-wise" component={EntryWiseReport} />
      <Route path="/reports/comparison" component={ProjectComparisonReport} />
      <Route path="/reports" component={Reports} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/security-groups" component={AdminSecurityGroups} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Gate />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
