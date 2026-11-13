import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app/app-shell";
import { MasteryBadge, MasteryDot } from "@/components/app/mastery";
import { WordReveal } from "@/components/study/word-reveal";
import { pct, wordQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/library/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} — Word library — LexiMind GRE` },
      { name: "description", content: `Definition, roots and your progress on ${params.slug}.` },
      { property: "og:title", content: `${params.slug} — LexiMind GRE` },
      { property: "og:description", content: `Definition, roots and your progress on ${params.slug}.` },
    ],
  }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(wordQuery(params.slug)),
  component: Page,
});

const SKILL: Record<string, string> = {
  recognition: "Recognize",
  recall: "Recall definition",
  precision: "Precise definition",
  context: "Use in context",
  root_recognition: "Explain origin",
};

function Page() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(wordQuery(slug));
  if (!data) return <div className="surface p-6">Word not found. <Link to="/library" className="underline">Back to library</Link></div>;
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/library" className="mb-3 inline-block text-sm text-muted-foreground underline">← Word library</Link>
      <PageHeader title={data.word.word}>
        <MasteryBadge level={data.level} />
      </PageHeader>
      <div className="surface mb-4 p-6">
        <WordReveal w={data.word} showWord={false} />
      </div>
      {data.skills.length > 0 && (
        <div className="surface mb-4 p-6">
          <div className="eyebrow mb-3">Your skills</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.skills.map((s) => (
              <div key={s.skill} className="rounded-xl bg-secondary p-3 text-sm">
                <div className="font-semibold">{SKILL[s.skill] ?? s.skill}</div>
                <div className="text-muted-foreground">
                  {s.independent} on your own · {s.incorrect} missed · memory {pct(s.retention)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.related.length > 0 && (
        <div className="surface p-6">
          <div className="eyebrow mb-3">Same roots</div>
          <ul className="divide-y">
            {data.related.slice(0, 20).map((r) => (
              <li key={r.slug}>
                <Link to="/library/$slug" params={{ slug: r.slug }} className="flex items-center gap-2 py-2 text-sm">
                  <MasteryDot level={r.level} /> <span className="font-semibold">{r.word}</span>
                  <span className="text-xs text-primary">{r.via.join(", ")}</span>
                  <span className="truncate text-muted-foreground">{r.definition}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
