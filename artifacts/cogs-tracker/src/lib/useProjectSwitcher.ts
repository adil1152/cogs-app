import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import {
  useListProjects,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";

interface ProjectLite {
  id: string;
  name: string;
}

export interface ProjectSwitcher {
  prev: ProjectLite | null;
  next: ProjectLite | null;
  goPrev: () => void;
  goNext: () => void;
}

/**
 * Returns prev/next visible projects (sorted by name, wrap-around) and binds
 * ←/→ keyboard shortcuts that navigate to `${basePath}/${id}`. Ignores key
 * events while focus is in inputs/textareas/contenteditable, or when modifier
 * keys are held.
 */
export function useProjectSwitcher(
  currentId: string,
  basePath: (id: string) => string,
): ProjectSwitcher {
  const [, navigate] = useLocation();
  const { data } = useListProjects({
    query: { queryKey: getListProjectsQueryKey() },
  });

  const sorted = useMemo<ProjectLite[]>(
    () =>
      [...(data ?? [])]
        .map((p) => ({ id: p.id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

  const { prev, next } = useMemo(() => {
    if (sorted.length < 2 || !currentId) {
      return { prev: null, next: null };
    }
    const idx = sorted.findIndex((p) => p.id === currentId);
    if (idx < 0) return { prev: null, next: null };
    const prevIdx = (idx - 1 + sorted.length) % sorted.length;
    const nextIdx = (idx + 1) % sorted.length;
    return { prev: sorted[prevIdx], next: sorted[nextIdx] };
  }, [sorted, currentId]);

  const goPrev = () => prev && navigate(basePath(prev.id));
  const goNext = () => next && navigate(basePath(next.id));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          (t as HTMLElement).isContentEditable
        ) {
          return;
        }
      }
      if (e.key === "ArrowLeft" && prev) {
        e.preventDefault();
        navigate(basePath(prev.id));
      } else if (e.key === "ArrowRight" && next) {
        e.preventDefault();
        navigate(basePath(next.id));
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prev, next, basePath, navigate]);

  return { prev, next, goPrev, goNext };
}
