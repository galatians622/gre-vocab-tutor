import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/app-shell";

export const Route = createFileRoute("/_authenticated/study")({
  head: () => ({
    meta: [
      { title: "Study — LexiMind GRE" },
      { name: "description", content: "Focused study session in LexiMind GRE." },
      { property: "og:title", content: "Study — LexiMind GRE" },
      { property: "og:description", content: "Focused study session in LexiMind GRE." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { focus?: string | undefined; minutes?: number | undefined } => ({
    focus: typeof s["focus"] === "string" ? s["focus"] : undefined,
    minutes: typeof s["minutes"] === "number" ? s["minutes"] : undefined,
  }),
  component: Page,
});

function Page() {
  return (
    <div>
      <PageHeader eyebrow="Focused study session" title="Study" />
      <div className="surface p-6 text-muted-foreground">Your study session will appear here.</div>
    </div>
  );
}
