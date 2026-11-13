import { cn } from "@/lib/utils";

export function Logo({ className, tone = "default" }: { className?: string; tone?: "default" | "ink" }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(
          "grid h-8 w-8 place-items-center rounded-xl font-display text-lg italic leading-none",
          tone === "ink" ? "bg-ink-foreground text-ink" : "bg-primary text-primary-foreground",
        )}
        aria-hidden
      >
        L
      </span>
      <span className={cn("font-display text-lg font-semibold tracking-tight", tone === "ink" ? "text-ink-foreground" : "text-foreground")}>
        LexiMind <span className="text-muted-foreground font-normal">GRE</span>
      </span>
    </span>
  );
}
