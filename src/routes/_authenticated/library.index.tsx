import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/app-shell";

export const Route = createFileRoute("/_authenticated/library/")({
  head: () => ({
    meta: [
      { title: "Word library — LexiMind GRE" },
      { name: "description", content: "Browse every GRE word in LexiMind GRE." },
      { property: "og:title", content: "Word library — LexiMind GRE" },
      { property: "og:description", content: "Browse every GRE word in LexiMind GRE." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div>
      <PageHeader eyebrow="Browse every GRE word" title="Word library" />
      <div className="surface p-6 text-muted-foreground">The word library is coming soon.</div>
    </div>
  );
}
