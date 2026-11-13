import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/app-shell";

export const Route = createFileRoute("/_authenticated/roots/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} — Roots — LexiMind GRE` },
      { name: "description", content: `Study the ${params.slug} word family in LexiMind GRE.` },
      { property: "og:title", content: `${params.slug} — LexiMind GRE` },
      { property: "og:description", content: `Study the ${params.slug} word family.` },
    ],
  }),
  component: Page,
});

function Page() {
  const { slug } = Route.useParams();
  return (
    <div>
      <PageHeader eyebrow="Root family" title={slug} />
      <div className="surface p-6 text-muted-foreground">The full family study for this root is coming soon.</div>
    </div>
  );
}
