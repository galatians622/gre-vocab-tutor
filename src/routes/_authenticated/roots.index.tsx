import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/app-shell";
import { MasteryBadge } from "@/components/app/mastery";
import { rootsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/roots/")({
  head: () => ({
    meta: [
      { title: "Roots — LexiMind GRE" },
      { name: "description", content: "Explore roots, prefixes and suffixes in LexiMind GRE." },
      { property: "og:title", content: "Roots — LexiMind GRE" },
      { property: "og:description", content: "Explore roots, prefixes and suffixes in LexiMind GRE." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(rootsQuery),
  component: Page,
});

const KINDS = ["root", "prefix", "suffix"] as const;

function Page() {
  const { data } = useSuspenseQuery(rootsQuery);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("root");
  const list = useMemo(
    () => data.filter((r) => r.kind === kind && r.familySize > 0).sort((a, b) => b.familySize - a.familySize),
    [data, kind],
  );
  return (
    <div>
      <PageHeader eyebrow="Learn a part, unlock a family of words" title="Roots" />
      <div className="mb-4 flex gap-2">
        {KINDS.map((k) => (
          <button key={k} onClick={() => setKind(k)} className={cn("rounded-full border px-4 py-1.5 text-sm font-semibold capitalize", kind === k ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
            {k === "root" ? "Roots" : `${k}es`}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((r) => (
          <Link key={r.id} to="/roots/$slug" params={{ slug: r.slug }} className="surface block p-5 hover:shadow-[var(--shadow-soft)]">
            <div className="flex items-start justify-between gap-2">
              <div className="font-display text-2xl">{r.form}</div>
              <MasteryBadge level={r.level} />
            </div>
            <div className="mt-1 text-sm">“{r.meaning}”</div>
            <div className="mt-1 text-xs text-muted-foreground">{r.origin}</div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-primary" style={{ width: `${Math.min(100, (r.wordsExplained / Math.max(1, r.target)) * 100)}%` }} />
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              {r.wordsExplained} of {r.target} family words explained · {r.familySize} words
            </div>
          </Link>
        ))}
        {list.length === 0 && <div className="surface p-6 text-muted-foreground">No word families here yet.</div>}
      </div>
    </div>
  );
}
