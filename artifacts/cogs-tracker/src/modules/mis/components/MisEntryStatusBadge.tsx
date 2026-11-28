import { Badge } from "@/components/ui/badge";
import type { MisEntryStatus } from "@workspace/api-client-react";

export function MisEntryStatusBadge({ status }: { status: MisEntryStatus }) {
  const variant = status === "approved" ? "default" : status === "rejected" ? "destructive" : status === "submitted" ? "secondary" : "outline";
  return <Badge variant={variant} className="capitalize" data-testid={`status-entry-${status}`}>{status}</Badge>;
}