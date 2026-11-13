import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type PartView = {
  position: number;
  surface: string;
  contribution: string;
  root: { slug: string; form: string; kind: string; meaning: string; origin: string };
};

const KIND_STYLE: Record<string, string> = {
  prefix: "border-accent bg-accent-soft",
  root: "border-primary bg-primary-soft",
  suffix: "border-border bg-secondary",
};

export function WordParts({ parts, compact = false }: { parts: PartView[]; compact?: boolean }) {
  if (!parts.length) return null;
  return (
    <div className={cn("flex flex-wrap items-stretch gap-2", compact && "gap-1.5")}>
      {parts.map((p, i) => (
        <Link
          key={`${p.root.slug}-${i}`}
          to="/roots/$slug"
          params={{ slug: p.root.slug }}
          className={cn(
            "group rounded-xl border-l-4 px-3 py-2 transition-shadow hover:shadow-[var(--shadow-soft)]",
            KIND_STYLE[p.root.kind] ?? KIND_STYLE.root,
            compact && "px-2.5 py-1.5",
          )}
        >
          <div className="font-display text-base font-semibold leading-tight">{p.surface}</div>
          <div className="text-xs text-muted-foreground">
            {p.root.kind} · “{p.root.meaning}”
          </div>
        </Link>
      ))}
    </div>
  );
}
