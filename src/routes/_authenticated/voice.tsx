import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app/app-shell";

export const Route = createFileRoute("/_authenticated/voice")({
  head: () => ({
    meta: [
      { title: "Voice Tutor — LexiMind GRE" },
      { name: "description", content: "Practice out loud in LexiMind GRE." },
      { property: "og:title", content: "Voice Tutor — LexiMind GRE" },
      { property: "og:description", content: "Practice out loud in LexiMind GRE." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div>
      <PageHeader eyebrow="Practice out loud" title="Voice Tutor" />
      <div className="surface p-6 text-muted-foreground">The voice tutor is coming soon.</div>
    </div>
  );
}
