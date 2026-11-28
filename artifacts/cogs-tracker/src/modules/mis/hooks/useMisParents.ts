import { useMutation } from "@tanstack/react-query";
import {
  getMisGetEntryParentHistoryQueryKey,
  getMisGetEntryParentQueryKey,
  getMisListEntryParentsQueryKey,
  misActOnEntryParent,
  misCreateBulkEntries,
  misDeleteEntryParent,
  misUpdateEntryParent,
  useMisGetEntryParent,
  useMisGetEntryParentHistory,
  useMisListEntryParents,
  type MisBulkEntriesInput,
  type MisEntry,
  type MisParent as ApiMisParent,
  type MisParentActionInput as ApiMisParentActionInput,
  type MisParentDetail,
  type MisParentEditInput,
  type MisParentHistoryItem as ApiMisParentHistoryItem,
  type MisParentPage,
  type MisParentStatus as ApiMisParentStatus,
  type MisListEntryParentsParams,
} from "@workspace/api-client-react";

export type MisParentStatus = ApiMisParentStatus;
export type MisParentAction = ApiMisParentActionInput["action"];
export type MisParent = ApiMisParent;

/**
 * Parent children deliberately keep the generated legacy line shape instead
 * of projecting a new, smaller response.
 */
export type MisParentChild = MisEntry;

export type MisParentListItem = MisParent & { childCount?: number };

export type MisParentListResponse = MisParentPage;

export type MisParentDetailResponse = MisParentDetail;

export type MisParentLineInput = MisBulkEntriesInput["lines"][number] & {
  /** Original child ID; supplied only when replacing an existing parent. */
  id?: string;
};

export type MisCreateParentInput = MisBulkEntriesInput;

export type MisUpdateParentInput = MisParentEditInput;

export type MisParentActionInput = ApiMisParentActionInput;

export interface MisParentConflictExisting {
  id?: string;
  bulkNumber?: string;
  fromDate?: string;
  toDate?: string;
  status?: MisParentStatus;
  parentId?: string;
}

export interface MisParentConflict {
  reason?: string;
  existing?: MisParentConflictExisting;
  canView?: boolean;
  openUrl?: string;
}

export interface MisParentErrorBody {
  error?: string;
  conflict?: MisParentConflict;
  parentId?: string;
  openUrl?: string;
}

export type MisParentListParams = MisListEntryParentsParams;

export function useMisListParents(
  params?: MisParentListParams,
  options?: { enabled?: boolean },
) {
  return useMisListEntryParents(params, {
    query: {
      queryKey: getMisListEntryParentsQueryKey(params),
      enabled: options?.enabled !== false,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
    },
  });
}

export function useMisGetParent(
  id: string,
  options?: { enabled?: boolean },
) {
  return useMisGetEntryParent(id, {
    query: {
      queryKey: getMisGetEntryParentQueryKey(id),
      enabled: Boolean(id) && options?.enabled !== false,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
    },
  });
}

export function useMisGetParentHistory(
  id: string,
  options?: { enabled?: boolean },
) {
  return useMisGetEntryParentHistory(id, {
    query: {
      queryKey: getMisGetEntryParentHistoryQueryKey(id),
      enabled: Boolean(id) && options?.enabled !== false,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
    },
  });
}

export type MisParentHistoryItem = ApiMisParentHistoryItem;

export function useMisCreateParent() {
  return useMutation({
    mutationFn: (data: MisCreateParentInput) => misCreateBulkEntries(data),
  });
}

export function useMisUpdateParent() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: MisUpdateParentInput }) => misUpdateEntryParent(id, data),
  });
}

export function useMisParentAction() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: MisParentActionInput }) => misActOnEntryParent(id, data),
  });
}

export function useMisDeleteParent() {
  return useMutation({
    mutationFn: (id: string) => misDeleteEntryParent(id),
  });
}

function bodyFromError(error: unknown): MisParentErrorBody | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { data?: unknown };
  if (!candidate.data || typeof candidate.data !== "object") return null;
  return candidate.data as MisParentErrorBody;
}

/**
 * Generated client errors expose the response body as `error.data`. Keeping
 * conflict extraction here lets child routes safely redirect without parsing
 * an untyped response in each screen.
 */
export function getMisParentConflict(error: unknown): MisParentConflict | null {
  const body = bodyFromError(error);
  if (!body) return null;
  if (body.conflict) return body.conflict;
  if (body.parentId) {
    return {
      canView: Boolean(body.openUrl),
      openUrl: body.openUrl,
      existing: { parentId: body.parentId },
    };
  }
  return null;
}

export function safeMisParentUrl(value: string | undefined): value is string {
  return Boolean(value && /^\/mis\/entries\/parents\/[^/?#]+$/.test(value));
}

export function misParentErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const body = bodyFromError(error);
  return body?.error || "The MIS parent request could not be completed.";
}
