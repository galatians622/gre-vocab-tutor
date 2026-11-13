import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app/app-shell";
import { MasteryBadge, MasteryDot } from "@/components/app/mastery";
import { LEVEL_LABEL, type MasteryLevel } from "@/lib/mastery";
import { pct, progressQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/progress")({
  head: () => ({
    meta: [
      { title: "Progress — LexiMind GRE" },
      { name: "description", content: "Your mastery over time in LexiMind GRE." },
      { property: "og:title", content: "Progress — LexiMind GRE" },
      { property: "og:description", content: "Your mastery over time in LexiMind GRE." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(progressQuery),
  component: Page,
});

const SKILL: Record<string, string> = {
  recognition: "Recognize the word",
  recall: "Recall the definition",
  precision: "Precise definition",
  context: "Meaning in context",
  root_recognition: "Explain the origin",
};

function Page() {
  const { data } = useSuspenseQuery(progressQuery);
  const total = data.levelCounts.reduce((a, l) => a + l.count, 0) || 1;
  const maxDay = Math.max(1, ...data.days.map((d) => d.correct + d.missed));
  const roots = [...data.roots].sort((a, b) => b.wordsExplained / b.target - a.wordsExplained / a.target);
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Your mastery over time" title="Progress" />
      <div className="surface p-6">
        <div className="eyebrow mb-3">Words by mastery</div>
        <div className="flex h-4 overflow-hidden rounded-full bg-secondary">
          {data.levelCounts.map((l) => (
            <div key={l.level} className={`bg-mastery-${l.level}`} style={{ width: `${(l.count / total) * 100}%` }} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          {data.levelCounts.map((l) => (
            <div key={l.level} className="flex items-center gap-2">
              <MasteryDot level={l.level as MasteryLevel} /> {LEVEL_LABEL[l.level as MasteryLevel]}: <b>{l.count}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="surface p-6">
        <div className="eyebrow mb-3">Last 14 days</div>
        <div className="flex h-32 items-end gap-1">
          {data.days.map((d) => (
            <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.correct} right, ${d.missed} missed`}>
              <div className="rounded-t bg-accent" style={{ height: `${(d.missed / maxDay) * 100}%` }} />
              <div className="bg-primary" style={{ height: `${(d.correct / maxDay) * 100}%` }} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Teal: answered right on your own · Ochre: missed or needed help</p>
      </div>
      <div className="surface p-6">
        <div className="eyebrow mb-3">Skills</div>
        <div className="space-y-3">
          {data.skillStats.map((s) => (
            <div key={s.skill} className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold">{SKILL[s.skill]}</span>
              <span className="text-muted-foreground">
                {s.wordsSolid} solid / {s.wordsTried} tried · {pct(s.accuracy)} accuracy
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="surface p-6">
        <div className="eyebrow mb-3">Root families</div>
        <ul className="divide-y">
          {roots.map((r) => (
            <li key={r.slug}>
              <Link to="/roots/$slug" params={{ slug: r.slug }} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span>
                  <span className="font-display text-base">{r.form}</span> <span className="text-muted-foreground">“{r.meaning}”</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{r.wordsExplained}/{r.target}</span>
                  <MasteryBadge level={r.level} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
