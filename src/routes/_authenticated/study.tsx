import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Lightbulb, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/app-shell";
import { WordParts } from "@/components/app/word-parts";
import { WordReveal, VERDICT_LABEL, VERDICT_STYLE } from "@/components/study/word-reveal";
import { endSession, getStudyQueue, gradeAnswer, recordLearn, startSession } from "@/lib/learning.functions";
import { RETRY_GAP } from "@/lib/mastery";
import { cn } from "@/lib/utils";

const FOCUSES = ["mixed", "quick", "new", "weak", "definitions", "roots", "challenge", "teach"] as const;
type Focus = (typeof FOCUSES)[number];
const FOCUS_LABEL: Record<Focus, string> = {
  mixed: "Mixed review",
  quick: "Quick review",
  new: "New words",
  weak: "Weak words",
  definitions: "Definitions",
  roots: "Roots",
  challenge: "Challenge",
  teach: "Learn new words",
};

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
  const search = Route.useSearch();
  const focus = (FOCUSES as readonly string[]).includes(search.focus ?? "") ? (search.focus as Focus) : null;
  if (!focus) return <Picker />;
  return <Session key={`${focus}-${search.minutes}`} focus={focus} minutes={Math.min(60, Math.max(5, search.minutes ?? 10))} />;
}

function Picker() {
  const options: { focus: Focus; minutes: number; body: string }[] = [
    { focus: "mixed", minutes: 15, body: "Due reviews plus a few new words." },
    { focus: "teach", minutes: 15, body: "Mostly new words, each quizzed again later in the session." },
    { focus: "quick", minutes: 5, body: "Only what's due. No new words." },
    { focus: "weak", minutes: 10, body: "Words you've missed or needed hints for." },
    { focus: "challenge", minutes: 10, body: "Harder questions on words you already know." },
  ];
  return (
    <div>
      <PageHeader eyebrow="Pick a session" title="Study" />
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((o) => (
          <Link key={o.focus} to="/study" search={{ focus: o.focus, minutes: o.minutes }} className="surface flex items-center justify-between gap-4 p-5 hover:shadow-[var(--shadow-soft)]">
            <div>
              <div className="font-display text-xl">{FOCUS_LABEL[o.focus]}</div>
              <div className="text-sm text-muted-foreground">
                {o.minutes} min · {o.body}
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-primary" />
          </Link>
        ))}
        <Link to="/roots" className="surface flex items-center justify-between gap-4 p-5 hover:shadow-[var(--shadow-soft)]">
          <div>
            <div className="font-display text-xl">Root family session</div>
            <div className="text-sm text-muted-foreground">Learn a root, then define and explain 15+ of its words.</div>
          </div>
          <ArrowRight className="h-5 w-5 text-primary" />
        </Link>
      </div>
    </div>
  );
}

type Queue = Awaited<ReturnType<typeof getStudyQueue>>;
type Item = Queue["items"][number];
type Result = { verdict: string; feedback: string };

function Session({ focus, minutes }: { focus: Focus; minutes: number }) {
  const qc = useQueryClient();
  const fetchQueue = useServerFn(getStudyQueue);
  const start = useServerFn(startSession);
  const end = useServerFn(endSession);
  const { data, error } = useQuery({
    queryKey: ["queue", focus, minutes],
    queryFn: async () => {
      const [q, sessionId] = await Promise.all([fetchQueue({ data: { focus, minutes, difficulty: null } }), start({ data: { mode: "focused", focus } })]);
      return { ...q, sessionId };
    },
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const [items, setItems] = useState<Item[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [tally, setTally] = useState({ reviewed: 0, correct: 0 });
  const retried = useRef(new Set<string>());
  const ended = useRef(false);

  useEffect(() => {
    if (data && !items) setItems(data.items);
  }, [data, items]);

  const done = items != null && idx >= items.length;
  useEffect(() => {
    if (done && data && !ended.current) {
      ended.current = true;
      void end({ data: { id: data.sessionId, ...tally } }).then(() => qc.invalidateQueries({ queryKey: ["dashboard"] }));
    }
  }, [done, data, tally, end, qc]);

  if (error) return <div className="surface p-6">Couldn't start the session: {error.message}</div>;
  if (!data || !items)
    return (
      <div className="grid min-h-[40vh] place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );

  if (items.length === 0)
    return (
      <div>
        <PageHeader eyebrow={FOCUS_LABEL[focus]} title="Nothing to study right now" />
        <div className="surface p-6">
          <p>No reviews are due and you've reached today's new-word goal ({data.stats.dailyGoal}). Come back tomorrow, or try a root family session.</p>
          <div className="mt-4 flex gap-2">
            <Button asChild><Link to="/roots">Root sessions</Link></Button>
            <Button asChild variant="soft"><Link to="/dashboard">Dashboard</Link></Button>
          </div>
        </div>
      </div>
    );

  if (done)
    return (
      <div>
        <PageHeader eyebrow="Session complete" title="Nice work" />
        <div className="surface space-y-3 p-6">
          <p className="text-lg">
            You answered {tally.correct} of {tally.reviewed} questions correctly on your own.
          </p>
          <p className="text-sm text-muted-foreground">Every answer has been saved and scheduled for its next review.</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild><Link to="/dashboard">Back to dashboard</Link></Button>
            <Button asChild variant="soft"><Link to="/progress">See progress</Link></Button>
          </div>
        </div>
      </div>
    );

  const item = items[idx]!;
  const next = (r?: Result) => {
    if (r) {
      setTally((t) => ({ reviewed: t.reviewed + 1, correct: t.correct + (r.verdict === "correct" ? 1 : 0) }));
      // Missed items come back a few cards later, once.
      if (r.verdict !== "correct" && !retried.current.has(item.key)) {
        retried.current.add(item.key);
        setItems((list) => {
          const copy = [...(list ?? [])];
          copy.splice(Math.min(copy.length, idx + 1 + RETRY_GAP), 0, { ...item, key: `${item.key}:retry`, reason: "weak" });
          return copy;
        });
      }
    }
    setIdx((i) => i + 1);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>{FOCUS_LABEL[focus]}</span>
        <span>
          {idx + 1} / {items.length}
        </span>
      </div>
      <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-primary transition-all" style={{ width: `${(idx / items.length) * 100}%` }} />
      </div>
      {item.task === "learn" ? (
        <LearnCard key={item.key} item={item} sessionId={data.sessionId} onNext={() => next()} />
      ) : (
        <QuizCard key={item.key} item={item} sessionId={data.sessionId} onNext={next} />
      )}
    </div>
  );
}

function LearnCard({ item, sessionId, onNext }: { item: Item; sessionId: string; onNext: () => void }) {
  const learn = useServerFn(recordLearn);
  const [busy, setBusy] = useState(false);
  return (
    <div className="surface animate-rise p-6">
      <div className="eyebrow mb-3 text-accent-foreground">New word</div>
      <WordReveal w={item.word} />
      <Button
        size="lg"
        className="mt-6 w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await learn({ data: { wordId: item.word.id, sessionId } });
          onNext();
        }}
      >
        Got it — continue <ArrowRight />
      </Button>
    </div>
  );
}

const PROMPT: Record<string, string> = {
  definition_recall: "Define this word in your own words.",
  reverse_recall: "Which word matches this definition?",
  context: "What does the word mean in this sentence?",
  deconstruct: "Break the word into its parts and explain how they build the meaning.",
};

function QuizCard({ item, sessionId, onNext }: { item: Item; sessionId: string; onNext: (r: Result) => void }) {
  const grade = useServerFn(gradeAnswer);
  const w = item.word;
  const [answer, setAnswer] = useState("");
  const [hints, setHints] = useState(0);
  const [busy, setBusy] = useState(false);
  const [needsSelf, setNeedsSelf] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const started = useRef(Date.now());
  const task = item.task as "definition_recall" | "reverse_recall" | "context" | "deconstruct";

  async function submit(selfVerdict: "correct" | "partial" | "incorrect" | null = null, override?: string) {
    setBusy(true);
    try {
      const r = await grade({
        data: {
          wordId: w.id,
          task,
          response: override ?? answer,
          hintsUsed: hints,
          latencyMs: Date.now() - started.current,
          confidence: null,
          sessionId,
          source: "focused",
          selfVerdict,
        },
      });
      if (r.status === "needs_self_grade") setNeedsSelf(true);
      else setResult({ verdict: r.verdict, feedback: r.feedback });
    } finally {
      setBusy(false);
    }
  }

  const hintText =
    task === "reverse_recall"
      ? hints >= 1
        ? `Starts with “${w.word.slice(0, hints + 1)}…” (${w.word.length} letters)`
        : null
      : hints >= 1 && w.parts.length
        ? null
        : hints >= 1
          ? `Similar to: ${w.synonyms.slice(0, 2).join(", ") || w.plain_english}`
          : null;

  return (
    <div className="surface animate-rise p-6">
      <div className="eyebrow mb-3">{item.reason === "new" ? "Check yourself" : item.reason === "weak" ? "Try again" : "Review"}</div>
      <p className="mb-2 text-sm text-muted-foreground">{PROMPT[task]}</p>
      {task === "reverse_recall" ? (
        <p className="font-display text-2xl leading-snug">{w.definition}</p>
      ) : (
        <div className="font-display text-4xl">{w.word}</div>
      )}
      {task === "context" && w.examples[0] && <p className="mt-3 italic">“{w.examples[0]}”</p>}
      {hints >= 1 && w.parts.length > 0 && task !== "reverse_recall" && (
        <div className="mt-4">
          <WordParts parts={w.parts} compact />
        </div>
      )}
      {hintText && <p className="mt-3 rounded-lg bg-accent-soft p-3 text-sm">{hintText}</p>}

      {!result && !needsSelf && (
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {task === "reverse_recall" ? (
            <Input autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type the word" autoCapitalize="none" />
          ) : (
            <Textarea autoFocus rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" />
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !answer.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : null} Check
            </Button>
            {hints < 2 && (
              <Button type="button" variant="soft" onClick={() => setHints((h) => h + 1)}>
                <Lightbulb /> Hint
              </Button>
            )}
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void submit(null, "I don't know")}>
              I don't know
            </Button>
          </div>
          {hints > 0 && <p className="text-xs text-muted-foreground">Answers with hints don't count toward mastery.</p>}
        </form>
      )}

      {needsSelf && !result && (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-muted-foreground">Automatic grading is unavailable right now. Compare your answer and grade yourself honestly.</p>
          <WordReveal w={w} showWord={false} />
          <div className="flex flex-wrap gap-2">
            {(["correct", "partial", "incorrect"] as const).map((v) => (
              <Button key={v} variant={v === "correct" ? "default" : "soft"} disabled={busy} onClick={() => void submit(v)}>
                {VERDICT_LABEL[v]}
              </Button>
            ))}
          </div>
        </div>
      )}

      {result && (
        <div className="mt-5 space-y-4">
          <div className={cn("rounded-xl border-l-4 p-4", VERDICT_STYLE[result.verdict])}>
            <div className="font-semibold">{VERDICT_LABEL[result.verdict]}</div>
            <p className="mt-1 text-sm">{result.feedback}</p>
          </div>
          <WordReveal w={w} showWord={task === "reverse_recall"} />
          <Button size="lg" className="w-full" autoFocus onClick={() => onNext(result)}>
            Next <ArrowRight />
          </Button>
        </div>
      )}
    </div>
  );
}
