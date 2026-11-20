import { useState } from "react";
import { Link } from "wouter";
import { ProjectPicker } from "../components/ProjectPicker";

export default function ServiceRates() {
  const [projectId, setProjectId] = useState<string | null>(null);
  return <div className="space-y-6">
    <div><h1 className="text-3xl font-semibold">Service Rates</h1><p className="mt-2 text-muted-foreground">Manage project services, codes, currencies, default rates, and effective dates in project settings.</p></div>
    <div className="max-w-lg space-y-5 rounded-xl border bg-card p-6">
      <ProjectPicker value={projectId} onChange={setProjectId} placeholder="Select a project" />
      {projectId ? <Link href={`/projects/${projectId}`} className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Open service configuration</Link> : <p className="text-sm text-muted-foreground">Choose a project to continue.</p>}
    </div>
  </div>;
}