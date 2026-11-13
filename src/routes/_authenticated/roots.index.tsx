import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/app-shell";

export const Route = createFileRoute("/_authenticated/roots/")({
  head: () => ({
    meta: [
      { title: "Roots — LexiMind GRE" },
      { name: "description", content: "Explore roots, prefixes and suffixes in LexiMind GRE." },
      { property: "og:title", content: "Roots — LexiMind GRE" },
      { property: "og:description", content: "Explore roots, prefixes and suffixes in LexiMind GRE." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div>
      <PageHeader eyebrow="Explore roots, prefixes and suffixes" title="Roots" />
      <div className="surface p-6 text-muted-foreground">The roots explorer is coming soon.</div>
    </div>
  );
}
