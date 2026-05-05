import { useState } from "react";
import { Link } from "wouter";
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
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { Plus, MapPin, Calendar, ChevronRight } from "lucide-react";

export default function Projects() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: projects, isLoading } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });
  const [open, setOpen] = useState(false);

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
      <div className="px-8 py-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <a className="block group" data-testid={`project-${p.id}`}>
                  <Card className="hover:border-accent/60 hover:shadow-md transition-all cursor-pointer h-full">
                    <CardContent className="pt-5 pb-5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold tracking-tight">{p.name}</div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" /> {p.location}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" /> {formatDate(p.contractStart)} → {formatDate(p.contractEnd)}
                      </div>
                      {p.notes && (
                        <p className="mt-3 text-xs text-muted-foreground line-clamp-2">{p.notes}</p>
                      )}
                    </CardContent>
                  </Card>
                </a>
              </Link>
            ))}
          </div>
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
