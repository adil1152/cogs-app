import { cn } from "@/lib/utils";

const LOGO_SRC = `${import.meta.env.BASE_URL}qnc-logo.png`;

export function QncLogo({ className }: { className?: string }) {
  return (
    <img
      src={LOGO_SRC}
      alt="Qudrat National Company"
      className={cn("object-contain", className)}
      draggable={false}
    />
  );
}
