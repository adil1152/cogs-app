import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ProjectSwitcher as Switcher } from "@/lib/useProjectSwitcher";

export function ProjectSwitcherButtons({ switcher }: { switcher: Switcher }) {
  const { prev, next, goPrev, goNext } = switcher;
  if (!prev && !next) return null;
  return (
    <div className="inline-flex items-center gap-0.5">
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={goPrev}
        disabled={!prev}
        title={prev ? `Previous: ${prev.name} (←)` : "No previous project"}
        data-testid="button-project-prev"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={goNext}
        disabled={!next}
        title={next ? `Next: ${next.name} (→)` : "No next project"}
        data-testid="button-project-next"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
