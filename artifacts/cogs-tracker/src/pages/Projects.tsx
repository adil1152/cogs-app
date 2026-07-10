import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProjects,
  useCreateProject,
  getListProjectsQueryKey,
  type CreateProjectBody,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import {
  Plus,
  MapPin,
  Calendar,
  ChevronRight,
  Search,
  LayoutGrid,
  List,
} from "lucide-react";

const VIEW_KEY = "qnc-projects-view";

export default function Projects() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: projects, isLoading } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const setViewPersist = (v: "grid" | "list") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const filtered = useMemo(() => {
    if (!projects) return [];
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.location ?? "").toLowerCase().includes(q) ||
        ((p as any).code ?? "").toLowerCase().includes(q),
    );
  }, [projects, search]);

  return (
    <AppLayout>
      <PageHeader
        title="Projects"
        subtitle={
          isAdmin
            ? "Every project on the platform. Create new projects and grant viewing access from each project's page."
            : "Projects you have access to."
        }
        actions={
          isAdmin && (
            <Button onClick={() => setOpen(true)} data-testid="button-new-project">
              <Plus className="mr-2 h-4 w-4" /> New project
            </Button>
          )
        }
      />
      <div className="px-8 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, location or code…"
              className="pl-8"
              data-testid="input-project-search"
            />
          </div>
          <div className="flex items-center rounded-md border border-border p-0.5">
            <Button
              variant={view === "grid" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2.5"
              onClick={() => setViewPersist("grid")}
              title="Card view"
              data-testid="button-view-grid"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2.5"
              onClick={() => setViewPersist("list")}
              title="List view"
              data-testid="button-view-list"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
          {projects && projects.length > 0 && (
            <div
              className="text-xs text-muted-foreground"
              data-testid="text-project-count"
            >
              {filtered.length} of {projects.length} projects
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : projects && projects.length > 0 ? (
          filtered.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <div className="text-sm text-muted-foreground" data-testid="text-no-match">
                  No projects match “{search}”.
                </div>
              </CardContent>
            </Card>
          ) : view === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`}>
                  <a className="block group" data-testid={`project-${p.id}`}>
                    <Card
                      className={`hover:-translate-y-1 hover:border-accent/40 hover:shadow-md hover:bg-card/80 transition-all duration-300 cursor-pointer h-full ${
                        (p as any).disabled ? "opacity-60 grayscale-[0.5]" : ""
                      }`}
                    >
                      <CardContent className="pt-6 pb-6">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 font-bold tracking-tight text-lg">
                            {p.name}
                            {(p as any).disabled && (
                              <Badge variant="secondary" className="font-mono uppercase tracking-wider text-[10px]" data-testid={`badge-disabled-${p.id}`}>
                                Disabled
                              </Badge>
                            )}
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground/50 group-hover:text-accent group-hover:translate-x-1 transition-all duration-300" />
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground font-medium">
                          <MapPin className="h-4 w-4 text-accent/70" /> {p.location}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground font-medium">
                          <Calendar className="h-4 w-4 text-accent/70" /> {formatDate(p.contractStart)} → {formatDate(p.contractEnd)}
                        </div>
                        {p.notes && (
                          <p className="mt-4 text-xs text-muted-foreground/80 line-clamp-2 leading-relaxed">{p.notes}</p>
                        )}
                      </CardContent>
                    </Card>
                  </a>
                </Link>
              ))}
            </div>
          ) : (
            <ProjectListTable projects={filtered} />
          )
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="text-sm text-muted-foreground">
                {isAdmin
                  ? "No projects yet. Create the first one to get started."
                  : "You haven't been granted access to any projects yet. Ask your admin."}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      {isAdmin && <NewProjectDialog open={open} onOpenChange={setOpen} />}
    </AppLayout>
  );
}

function ProjectListTable({ projects }: { projects: any[] }) {
  const [, navigate] = useLocation();
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Contract</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => (
              <TableRow
                key={p.id}
                className={`cursor-pointer transition-colors hover:bg-accent/5 ${
                  p.disabled ? "opacity-60" : ""
                }`}
                onClick={() => navigate(`/projects/${p.id}`)}
                data-testid={`project-row-${p.id}`}
              >
                <TableCell>
                  <span className="inline-flex items-center gap-2 font-medium">
                    {p.name}
                    {p.disabled && (
                      <Badge variant="secondary" data-testid={`badge-disabled-${p.id}`}>
                        Disabled
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  {p.code ? (
                    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider">
                      {p.code}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{p.location}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {formatDate(p.contractStart)} → {formatDate(p.contractEnd)}
                </TableCell>
                <TableCell>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { register, handleSubmit, reset, formState } = useForm<CreateProjectBody>();
  const createProject = useCreateProject({
    mutation: {
      onSuccess: () => {
        toast({ title: "Project created" });
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        reset();
        onOpenChange(false);
      },
      onError: (err: any) =>
        toast({ title: "Could not create project", description: err.message, variant: "destructive" }),
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Set the basics. Add services and grant access from the project page.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((data) => createProject.mutate({ data }))}
          className="space-y-3"
        >
          <Field label="Project name" required>
            <Input {...register("name", { required: true })} data-testid="input-project-name" />
          </Field>
          <Field label="Location" required>
            <Input {...register("location", { required: true })} data-testid="input-project-location" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contract start" required>
              <Input type="date" {...register("contractStart", { required: true })} data-testid="input-contract-start" />
            </Field>
            <Field label="Contract end" required>
              <Input type="date" {...register("contractEnd", { required: true })} data-testid="input-contract-end" />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea rows={3} {...register("notes")} data-testid="input-project-notes" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="submit"
              disabled={createProject.isPending || !formState.isValid}
              data-testid="button-create-project"
            >
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}
