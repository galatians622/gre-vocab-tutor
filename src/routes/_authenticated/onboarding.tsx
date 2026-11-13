import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/app-shell";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Get started — LexiMind GRE" },
      { name: "description", content: "Set your goal and take a short diagnostic in LexiMind GRE." },
      { property: "og:title", content: "Get started — LexiMind GRE" },
      { property: "og:description", content: "Set your goal and take a short diagnostic in LexiMind GRE." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div>
      <PageHeader eyebrow="Set your goal and take a short diagnostic" title="Get started" />
      <div className="surface p-6 text-muted-foreground">Onboarding is coming soon.</div>
    </div>
  );
}
