import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/app-shell";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — LexiMind GRE" },
      { name: "description", content: "Study preferences in LexiMind GRE." },
      { property: "og:title", content: "Settings — LexiMind GRE" },
      { property: "og:description", content: "Study preferences in LexiMind GRE." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div>
      <PageHeader eyebrow="Study preferences" title="Settings" />
      <div className="surface p-6 text-muted-foreground">Settings are coming soon.</div>
    </div>
  );
}
