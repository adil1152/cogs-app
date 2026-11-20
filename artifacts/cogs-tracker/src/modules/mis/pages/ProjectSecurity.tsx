import { useState } from "react";
import { useParams } from "wouter";
import { ProjectPicker } from "../components/ProjectPicker";
import Authorities from "./Authorities";
import { useMisAccess } from "../hooks/useMisAccess";
import { hasPermission } from "../lib/access";

export default function ProjectSecurity() {
  const params = useParams<{ id?: string }>();
  const [selected, setSelected] = useState<string | null>(params.id ?? null);
  const { data: access } = useMisAccess();
  if (!hasPermission(access, "authorities")) return <p>You do not have permission to configure project security.</p>;
  return <div className="space-y-6">
    <div><h1 className="text-3xl font-semibold">Project Security</h1><p className="mt-2 text-muted-foreground">Choose a project to manage its user assignments. Global MIS grants continue to apply.</p></div>
    <div className="max-w-md"><ProjectPicker value={selected} onChange={setSelected} placeholder="Select a project" /></div>
    {selected ? <Authorities key={selected} projectId={selected} /> : <p className="rounded-lg border bg-card p-8 text-muted-foreground">Select a project to view and configure access.</p>}
  </div>;
}