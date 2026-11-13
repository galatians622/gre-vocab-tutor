import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/app-shell";

export const Route = createFileRoute("/_authenticated/progress")({
  head: () => ({
    meta: [
      { title: "Progress — LexiMind GRE" },
      { name: "description", content: "Your mastery over time in LexiMind GRE." },
      { property: "og:title", content: "Progress — LexiMind GRE" },
      { property: "og:description", content: "Your mastery over time in LexiMind GRE." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div>
      <PageHeader eyebrow="Your mastery over time" title="Progress" />
      <div className="surface p-6 text-muted-foreground">Detailed progress is coming soon.</div>
    </div>
  );
}
