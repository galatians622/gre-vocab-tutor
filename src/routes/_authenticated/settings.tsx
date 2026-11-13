import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/app-shell";
import { savePreferences } from "@/lib/learning.functions";
import { prefsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — LexiMind GRE" },
      { name: "description", content: "Study preferences in LexiMind GRE." },
      { property: "og:title", content: "Settings — LexiMind GRE" },
      { property: "og:description", content: "Study preferences in LexiMind GRE." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(prefsQuery),
  component: Page,
});

const LEVELS = ["foundational", "intermediate", "advanced"];

function Page() {
  const { data } = useSuspenseQuery(prefsQuery);
  const qc = useQueryClient();
  const save = useServerFn(savePreferences);
  const [name, setName] = useState(data?.display_name ?? "");
  const [testDate, setTestDate] = useState(data?.test_date ?? "");
  const [daily, setDaily] = useState(data?.daily_new_words ?? 10);
  const [minutes, setMinutes] = useState(data?.daily_minutes ?? 20);
  const [level, setLevel] = useState(data?.target_level ?? "foundational");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Study preferences" title="Settings" />
      <form
        className="surface space-y-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await save({ data: { display_name: name || null, test_date: testDate || null, daily_new_words: daily, daily_minutes: minutes, target_level: level } });
            await qc.invalidateQueries();
            toast.success("Settings saved");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block">
          <span className="text-sm font-semibold">Your name</span>
          <Input className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">GRE test date</span>
          <Input type="date" className="mt-1.5" value={testDate} onChange={(e) => setTestDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">New words per day: {daily}</span>
          <input type="range" min={5} max={50} step={5} value={daily} onChange={(e) => setDaily(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-primary)]" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">Minutes per day: {minutes}</span>
          <input type="range" min={5} max={120} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-primary)]" />
        </label>
        <div>
          <div className="text-sm font-semibold">Start new words at</div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <button type="button" key={l} onClick={() => setLevel(l)} className={cn("rounded-full border px-4 py-1.5 text-sm font-semibold capitalize", level === l ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>Save</Button>
      </form>
      <div className="surface mt-4 flex items-center justify-between gap-3 p-5">
        <div className="text-sm">Retake the placement test to re-check your level.</div>
        <Button asChild variant="soft"><Link to="/onboarding">Retake</Link></Button>
      </div>
    </div>
  );
}
