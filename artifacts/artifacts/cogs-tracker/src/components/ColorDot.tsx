import { resolveServiceColor } from "@/lib/serviceColor";
import { cn } from "@/lib/utils";

interface Props {
  color: string | null | undefined;
  /** Used as the fallback when color is null (stable hash → palette). */
  name?: string | null;
  size?: number;
  className?: string;
  title?: string;
}

export function ColorDot({
  color,
  name,
  size = 10,
  className,
  title,
}: Props) {
  const resolved = resolveServiceColor(color, name);
  return (
    <span
      aria-hidden
      title={title}
      className={cn(
        "inline-block shrink-0 rounded-full border border-black/10",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: resolved,
      }}
    />
  );
}
