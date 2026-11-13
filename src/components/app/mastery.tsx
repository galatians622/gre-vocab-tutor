import { cn } from "@/lib/utils";
import { LEVEL_LABEL, type MasteryLevel } from "@/lib/mastery";

const DOT: Record<MasteryLevel, string> = {
  new: "bg-mastery-new",
  introduced: "bg-mastery-introduced",
  recognized: "bg-mastery-recognized",
  recalling: "bg-mastery-recalling",
  mastered: "bg-mastery-mastered",
};

export function MasteryDot({ level, className }: { level: MasteryLevel; className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", DOT[level], className)} title={LEVEL_LABEL[level]} />;
}

export function MasteryBadge({ level, className }: { level: MasteryLevel; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-xs font-semibold text-foreground",
        className,
      )}
    >
      <MasteryDot level={level} />
      {LEVEL_LABEL[level]}
    </span>
  );
}

export function MasteryLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {(Object.keys(LEVEL_LABEL) as MasteryLevel[]).map((l) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <MasteryDot level={l} /> {LEVEL_LABEL[l]}
        </span>
      ))}
    </div>
  );
}
