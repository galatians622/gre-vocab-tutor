import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/app/app-shell";
import { checkChoice, endSession, getDiagnostic, gradeAnswer, savePreferences, startSession } from "@/lib/learning.functions";
import { cn } from "@/lib/utils";
import { summarize, type Outcome } from "@/lib/diagnostic";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Get started — LexiMind GRE" },
      { name: "description", content: "Set your goal and take a short placement test in LexiMind GRE." },
      { property: "og:title", content: "Get started — LexiMind GRE" },
      { property: "og:description", content: "Set your goal and take a short placement test in LexiMind GRE." },
    ],
  }),
  component: Page,
});

type DiagItem = Awaited<ReturnType<typeof getDiagnostic>>[number];

const LEVEL_NAME: Record<number, string> = { 1: "Foundational", 2: "Intermediate", 3: "Advanced" };

function Page() {
  const [step, setStep] = useState<"goal" | "test" | "results">("goal");
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  return step === "goal" ? (
    <GoalStep onNext={() => setStep("test")} />
  ) : step === "test" ? (
    <TestStep
      onDone={(o) => {
        setOutcomes(o);
        setStep("results");
      }}
    />
  ) : (
    <Results outcomes={outcomes} />
  );
}

function GoalStep({ onNext }: { onNext: () => void }) {
  const save = useServerFn(savePreferences);
  const [testDate, setTestDate] = useState("");
  const [daily, setDaily] = useState(10);
  const [minutes, setMinutes] = useState(20);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Step 1 of 2" title="Set your goal" />
      <form
        className="surface space-y-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await save({ data: { test_date: testDate || null, daily_new_words: daily, daily_minutes: minutes } });
          onNext();
        }}
      >
        <label className="block">
          <span className="text-sm font-semibold">GRE test date (optional)</span>
          <Input type="date" className="mt-1.5" value={testDate} onChange={(e) => setTestDate(e.target.value)} />
        </label>
        <Choice label="New words per day" value={daily} options={[5, 10, 15, 20, 30]} onChange={setDaily} />
        <Choice label="Minutes per day" value={minutes} options={[10, 20, 30, 45, 60]} onChange={setMinutes} />
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          Continue to placement test <ArrowRight />
        </Button>
      </form>
    </div>
  );
}

function Choice({ label, value, options, onChange }: { label: string; value: number; options: number[]; onChange: (n: number) => void }) {
  return (
    <div>
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            type="button"
            key={o}
            onClick={() => onChange(o)}
            className={cn("rounded-full border px-4 py-1.5 text-sm font-semibold", value === o ? "border-primary bg-primary text-primary-foreground" : "bg-card")}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function TestStep({ onDone }: { onDone: (o: Outcome[]) => void }) {
  const load = useServerFn(getDiagnostic);
  const start = useServerFn(startSession);
  const { data, error } = useQuery({
    queryKey: ["diagnostic"],
    queryFn: async () => {
      const [items, sessionId] = await Promise.all([load(), start({ data: { mode: "diagnostic", focus: "placement" } })]);
      return { items, sessionId };
    },
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const [idx, setIdx] = useState(0);
  const outcomes = useRef<Outcome[]>([]);
  const end = useServerFn(endSession);

  if (error) return <div className="surface p-6">Couldn't load the placement test: {error.message}</div>;
  if (!data) return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const item = data.items[idx]!;
  const record = async (o: Outcome) => {
    outcomes.current.push(o);
    if (idx + 1 >= data.items.length) {
      await end({ data: { id: data.sessionId, reviewed: outcomes.current.length, correct: outcomes.current.filter((x) => x.correct).length } });
      onDone(outcomes.current);
    } else setIdx(idx + 1);
  };
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Step 2 of 2 · Placement test" title="What do you already know?" />
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Words get harder as you go. Choose “I don't know” rather than guessing — it makes your plan more accurate.
      </p>
      <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-primary transition-all" style={{ width: `${(idx / data.items.length) * 100}%` }} />
      </div>
      <DiagCard key={idx} item={item} sessionId={data.sessionId} onAnswer={record} />
    </div>
  );
}

function DiagCard({ item, sessionId, onAnswer }: { item: DiagItem; sessionId: string; onAnswer: (o: Outcome) => Promise<void> }) {
  const check = useServerFn(checkChoice);
  const grade = useServerFn(gradeAnswer);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const t0 = useRef(Date.now());
  const label = item.type === "root" ? item.form : item.word;

  async function choose(id: string | null) {
    setBusy(true);
    const r = await check({ data: { kind: item.type === "root" ? "root" : "word", targetId: item.targetId, chosenId: id, latencyMs: Date.now() - t0.current, sessionId } });
    await onAnswer({ level: item.level, common: item.common, type: item.type, correct: r.correct, label });
  }
  async function recall(answer: string) {
    setBusy(true);
    const r = await grade({
      data: { wordId: item.targetId, task: "definition_recall", response: answer, hintsUsed: 0, latencyMs: Date.now() - t0.current, confidence: null, sessionId, source: "diagnostic", selfVerdict: null },
    });
    await onAnswer({ level: item.level, common: item.common, type: item.type, correct: r.status === "graded" && r.verdict === "correct", label });
  }

  return (
    <div className="surface animate-rise p-6">
      <div className="eyebrow mb-2">
        {item.type === "root" ? "Word root" : item.type === "recall" ? "Define it" : item.type === "context" ? "In context" : "Pick the meaning"}
      </div>
      <div className="font-display text-4xl">{label}</div>
      {item.type === "context" && <p className="mt-3 italic">“{item.sentence}”</p>}
      {item.type === "recall" ? (
        <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void recall(text); }}>
          <Textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={`What does this ${item.pos} mean?`} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !text.trim()}>{busy && <Loader2 className="animate-spin" />} Check</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void recall("I don't know")}>I don't know</Button>
          </div>
        </form>
      ) : (
        <div className="mt-5 grid gap-2">
          {item.options.map((o) => (
            <button key={o.id} disabled={busy} onClick={() => void choose(o.id)} className="rounded-xl border bg-card p-3 text-left text-sm hover:border-primary disabled:opacity-60">
              {o.label}
            </button>
          ))}
          <button disabled={busy} onClick={() => void choose(null)} className="rounded-xl border border-dashed p-3 text-left text-sm text-muted-foreground">
            I don't know
          </button>
        </div>
      )}
    </div>
  );
}

function Results({ outcomes }: { outcomes: Outcome[] }) {
  const save = useServerFn(savePreferences);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [s] = useState(() => summarize(outcomes));
  const [busy, setBusy] = useState(false);
  const weakest = [...s.byLevel].filter((b) => b.total).sort((a, b) => a.accuracy - b.accuracy)[0];
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Placement results" title="Here's where you stand" />
      <div className="surface space-y-5 p-6">
        <div>
          <div className="eyebrow mb-1">Common GRE words</div>
          <p className="text-2xl font-display">You knew {Math.round(s.commonAccuracy * 100)}% of the most common words.</p>
        </div>
        <div className="space-y-3">
          {s.byLevel.map((b) => (
            <div key={b.level}>
              <div className="flex justify-between text-sm">
                <span className="font-semibold">{LEVEL_NAME[b.level]} words</span>
                <span>{b.correct} / {b.total}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                <div className={cn("h-full", b.accuracy >= 0.75 ? "bg-primary" : "bg-accent")} style={{ width: `${b.accuracy * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-sm">
          {weakest && weakest.accuracy < 0.75
            ? `${LEVEL_NAME[weakest.level]} words are your weakest area. New words will start at the ${LEVEL_NAME[s.startLevel]!.toLowerCase()} level, common GRE words first.`
            : "You're strong across all levels. New words will focus on advanced, high-frequency GRE vocabulary."}
        </p>
        {s.missed.length > 0 && <p className="text-sm text-muted-foreground">Words to work on: {s.missed.join(", ")}. They're already scheduled for review.</p>}
        <Button
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await save({ data: { onboarded: true, diagnostic: s, target_level: LEVEL_NAME[s.startLevel]!.toLowerCase() } });
            await qc.invalidateQueries();
            navigate({ to: "/study", search: { focus: "teach", minutes: 15 } });
          }}
        >
          Start my first session <ArrowRight />
        </Button>
        <Link to="/dashboard" className="block text-center text-sm text-muted-foreground underline">Go to dashboard</Link>
      </div>
    </div>
  );
}
