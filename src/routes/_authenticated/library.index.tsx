import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/app-shell";
import { MasteryDot, MasteryLegend } from "@/components/app/mastery";
import { libraryQuery } from "@/lib/queries";
import { LEVEL_LABEL, LEVEL_ORDER, type MasteryLevel } from "@/lib/mastery";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/library/")({
  head: () => ({
    meta: [
      { title: "Word library — LexiMind GRE" },
      { name: "description", content: "Browse every GRE word in LexiMind GRE." },
      { property: "og:title", content: "Word library — LexiMind GRE" },
      { property: "og:description", content: "Browse every GRE word in LexiMind GRE." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(libraryQuery),
  component: Page,
});

const DIFF = { 1: "Foundational", 2: "Intermediate", 3: "Advanced" } as Record<number, string>;

function Page() {
  const { data } = useSuspenseQuery(libraryQuery);
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<MasteryLevel | "all">("all");
  const [diff, setDiff] = useState(0);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data
      .filter((w) => (level === "all" || w.level === level) && (!diff || w.difficulty === diff))
      .filter((w) => !s || w.word.toLowerCase().includes(s) || w.definition.toLowerCase().includes(s) || w.roots.some((r) => r.toLowerCase().includes(s)))
      .sort((a, b) => a.word.localeCompare(b.word));
  }, [data, q, level, diff]);
  return (
    <div>
      <PageHeader eyebrow={`${data.length} GRE words`} title="Word library" />
      <div className="mb-4 space-y-3">
        <Input placeholder="Search words, meanings or roots" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-2 text-sm">
          {(["all", ...LEVEL_ORDER] as const).map((l) => (
            <button key={l} onClick={() => setLevel(l)} className={cn("rounded-full border px-3 py-1", level === l ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
              {l === "all" ? "All" : LEVEL_LABEL[l]}
            </button>
          ))}
          <span className="mx-1 border-l" />
          {[0, 1, 2, 3].map((d) => (
            <button key={d} onClick={() => setDiff(d)} className={cn("rounded-full border px-3 py-1", diff === d ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
              {d ? DIFF[d] : "Any level"}
            </button>
          ))}
        </div>
        <MasteryLegend />
      </div>
      <div className="surface divide-y">
        {list.map((w) => (
          <Link key={w.id} to="/library/$slug" params={{ slug: w.slug }} className="flex items-start gap-3 p-4 hover:bg-secondary/50">
            <MasteryDot level={w.level} className="mt-2" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-display text-lg">{w.word}</span>
                <span className="text-xs italic text-muted-foreground">{w.part_of_speech}</span>
                {w.roots.length > 0 && <span className="text-xs text-primary">{w.roots.join(" + ")}</span>}
              </div>
              <p className="truncate text-sm text-muted-foreground">{w.definition}</p>
            </div>
          </Link>
        ))}
        {list.length === 0 && <div className="p-6 text-muted-foreground">No words match.</div>}
      </div>
    </div>
  );
}
