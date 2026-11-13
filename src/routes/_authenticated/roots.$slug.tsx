import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { ArrowRight, Lightbulb, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/app/app-shell";
import { MasteryBadge, MasteryDot } from "@/components/app/mastery";
import { WordParts } from "@/components/app/word-parts";
import { WordReveal, VERDICT_LABEL, VERDICT_STYLE } from "@/components/study/word-reveal";
import { endSession, gradeFamilyWord, gradeRootMeaning, startSession } from "@/lib/learning.functions";
import { rootSessionQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/roots/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} word family — LexiMind GRE` },
      { name: "description", content: `Study the ${params.slug} word family in LexiMind GRE.` },
      { property: "og:title", content: `${params.slug} word family — LexiMind GRE` },
      { property: "og:description", content: `Study the ${params.slug} word family.` },
    ],
  }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(rootSessionQuery(params.slug)),
  component: Page,
});

type Data = NonNullable<Awaited<ReturnType<NonNullable<ReturnType<typeof rootSessionQuery>["queryFn"]>>>>;

function Page() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(rootSessionQuery(slug));
  const [mode, setMode] = useState<"overview" | "session">("overview");
  if (!data)
    return (
      <div className="surface p-6">
        That root isn't in the library. <Link to="/roots" className="underline">Back to roots</Link>
      </div>
    );
  return mode === "overview" ? <Overview d={data} onStart={() => setMode("session")} /> : <FamilySession d={data} onExit={() => setMode("overview")} />;
}

function Overview({ d, onStart }: { d: Data; onStart: () => void }) {
  const r = d.root;
  return (
    <div>
      <PageHeader eyebrow={`${r.kind} · ${r.origin}`} title={r.form}>
        <MasteryBadge level={d.level} />
      </PageHeader>
      <div className="surface mb-4 space-y-3 p-6">
        <p className="text-xl">“{r.meaning}”</p>
        {r.source_word && <p className="text-sm text-muted-foreground">From {r.source_word}</p>}
        <p className="text-sm">{r.explanation}</p>
        <p className="text-sm text-muted-foreground">
          Mastery needs the meaning recalled on two separate days and {d.target} family words defined and explained on your own. Explained so far: {d.wordsExplained} / {d.target}.
        </p>
        <Button size="lg" onClick={onStart} disabled={!d.family.length}>
          Start family session <ArrowRight />
        </Button>
      </div>
      {d.companions.length > 0 && (
        <div className="surface mb-4 p-6">
          <div className="eyebrow mb-2">Prefixes and suffixes in this family</div>
          <div className="flex flex-wrap gap-2">
            {d.companions.map((c) => (
              <Link key={c.slug} to="/roots/$slug" params={{ slug: c.slug }} className="rounded-xl border bg-card px-3 py-2 text-sm">
                <span className="font-semibold">{c.form}</span> <span className="text-muted-foreground">“{c.meaning}”</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="surface p-6">
        <div className="eyebrow mb-3">Family · {d.family.length} words</div>
        <ul className="divide-y">
          {d.family.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-3 py-2.5">
              <Link to="/library/$slug" params={{ slug: w.slug }} className="flex items-center gap-2 font-semibold">
                <MasteryDot level={w.level} /> {w.word}
              </Link>
              <span className="text-xs text-muted-foreground">{w.explained ? "Explained" : w.gre_frequency >= 3 ? "Common on the GRE" : ""}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type Res = { verdict: string; feedback: string };

function FamilySession({ d, onExit }: { d: Data; onExit: () => void }) {
  const qc = useQueryClient();
  const start = useServerFn(startSession);
  const end = useServerFn(endSession);
  const gradeRoot = useServerFn(gradeRootMeaning);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"recall" | "teach" | "words" | "done">("recall");
  const [rootRes, setRootRes] = useState<Res | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [idx, setIdx] = useState(0);
  const [tally, setTally] = useState({ reviewed: 0, correct: 0, explained: d.wordsExplained });
  const r = d.root;

  async function ensureSession() {
    if (sessionId) return sessionId;
    const id = await start({ data: { mode: "root", focus: r.slug } });
    setSessionId(id);
    return id;
  }
  async function finish() {
    if (sessionId) await end({ data: { id: sessionId, reviewed: tally.reviewed, correct: tally.correct } });
    await qc.invalidateQueries();
    setPhase("done");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between text-sm text-muted-foreground">
        <button onClick={onExit} className="underline">Exit</button>
        <span>
          {r.form} family · {tally.explained} / {d.target} explained
        </span>
      </div>
      {phase === "recall" && (
        <div className="surface animate-rise p-6">
          <div className="eyebrow mb-2">Step 1 · The {r.kind}</div>
          <div className="font-display text-5xl">{r.form}</div>
          {!rootRes ? (
            <form
              className="mt-5 space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const id = await ensureSession();
                const g = await gradeRoot({ data: { rootId: r.id, response: answer, hintsUsed: 0, sessionId: id } });
                setBusy(false);
                setRootRes(g.status === "graded" ? { verdict: g.verdict, feedback: g.feedback } : { verdict: "skipped", feedback: g.message });
              }}
            >
              <p className="text-sm text-muted-foreground">What does this {r.kind} mean? Leave it blank if you don't know.</p>
              <Textarea autoFocus rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} />
              <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} {answer.trim() ? "Check" : "Show me"}</Button>
            </form>
          ) : (
            <div className="mt-5 space-y-4">
              <div className={cn("rounded-xl border-l-4 p-4", VERDICT_STYLE[rootRes.verdict])}>
                <div className="font-semibold">{VERDICT_LABEL[rootRes.verdict]}</div>
                <p className="mt-1 text-sm">{rootRes.feedback}</p>
              </div>
              <Button size="lg" className="w-full" onClick={() => setPhase("teach")}>Continue <ArrowRight /></Button>
            </div>
          )}
        </div>
      )}
      {phase === "teach" && (
        <div className="surface animate-rise space-y-4 p-6">
          <div className="eyebrow">Step 2 · How it works</div>
          <div className="font-display text-4xl">{r.form} = “{r.meaning}”</div>
          <p className="text-sm text-muted-foreground">{r.origin}{r.source_word ? ` · from ${r.source_word}` : ""}</p>
          <p>{r.explanation}</p>
          {d.companions.length > 0 && (
            <div>
              <div className="eyebrow mb-2">You'll also see these parts</div>
              <ul className="space-y-1 text-sm">
                {d.companions.slice(0, 10).map((c) => (
                  <li key={c.slug}><span className="font-semibold">{c.form}</span> ({c.kind}) — {c.meaning}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm">
            Next: {Math.min(d.family.length, Math.max(d.target, 15))} words built on {r.form}. For each, give the definition in your own words, then explain where it comes from and how its parts produce that meaning.
          </p>
          <Button size="lg" className="w-full" onClick={() => setPhase("words")}>Start the words <ArrowRight /></Button>
        </div>
      )}
      {phase === "words" && d.family[idx] && (
        <FamilyCard
          key={d.family[idx].id}
          d={d}
          w={d.family[idx]}
          position={`${idx + 1} of ${d.family.length}`}
          ensureSession={ensureSession}
          onNext={(res) => {
            setTally((t) => ({
              reviewed: t.reviewed + 1,
              correct: t.correct + (res.verdict === "correct" ? 1 : 0),
              explained: t.explained + (res.verdict === "correct" && !d.family[idx]!.explained ? 1 : 0),
            }));
            if (idx + 1 >= d.family.length) void finish();
            else setIdx(idx + 1);
          }}
          onStop={() => void finish()}
        />
      )}
      {phase === "done" && (
        <div className="surface space-y-3 p-6">
          <div className="font-display text-3xl">Session saved</div>
          <p>
            You got {tally.correct} of {tally.reviewed} words fully right — definition and origin. {tally.explained} of {d.target} needed for this family are now explained.
          </p>
          <p className="text-sm text-muted-foreground">Missed words return in your regular reviews. Come back on another day to recall the root again.</p>
          <div className="flex gap-2">
            <Button asChild><Link to="/roots">More roots</Link></Button>
            <Button asChild variant="soft"><Link to="/dashboard">Dashboard</Link></Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FamilyCard({
  d,
  w,
  position,
  ensureSession,
  onNext,
  onStop,
}: {
  d: Data;
  w: Data["family"][number];
  position: string;
  ensureSession: () => Promise<string>;
  onNext: (r: Res) => void;
  onStop: () => void;
}) {
  const grade = useServerFn(gradeFamilyWord);
  const [def, setDef] = useState("");
  const [exp, setExp] = useState("");
  const [hints, setHints] = useState(0);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<(Res & { definitionVerdict?: string; explanationVerdict?: string }) | null>(null);
  const t0 = useRef(Date.now());
  const rootPart = w.parts.find((p) => p.root.id === d.root.id);

  async function submit(skip = false) {
    setBusy(true);
    const sessionId = await ensureSession();
    const g = await grade({
      data: { rootId: d.root.id, wordId: w.id, definition: skip ? "" : def, explanation: skip ? "" : exp, hintsUsed: hints, latencyMs: Date.now() - t0.current, sessionId },
    });
    setBusy(false);
    setRes(g.status === "graded" ? g : { verdict: "skipped", feedback: g.message });
  }

  return (
    <div className="surface animate-rise p-6">
      <div className="mb-2 flex justify-between text-xs text-muted-foreground">
        <span className="eyebrow">Family word</span>
        <span>{position}</span>
      </div>
      <div className="font-display text-4xl">{w.word}</div>
      <p className="mt-1 text-sm text-muted-foreground">
        Contains <span className="font-semibold text-foreground">{rootPart?.surface ?? d.root.form}</span> — “{d.root.meaning}” · {w.part_of_speech}
      </p>
      {hints >= 1 && <div className="mt-4"><WordParts parts={w.parts} compact /></div>}
      {hints >= 2 && w.examples[0] && <p className="mt-3 text-sm italic">“{w.examples[0]}”</p>}
      {!res ? (
        <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="block">
            <span className="text-sm font-semibold">1. What does it mean?</span>
            <Textarea autoFocus rows={2} className="mt-1" value={def} onChange={(e) => setDef(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm font-semibold">2. Where does it come from, and how do its parts build that meaning?</span>
            <Textarea rows={3} className="mt-1" value={exp} onChange={(e) => setExp(e.target.value)} placeholder={`e.g. ${d.root.form} means “${d.root.meaning}”, and …`} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || (!def.trim() && !exp.trim())}>{busy && <Loader2 className="animate-spin" />} Check</Button>
            {hints < 2 && <Button type="button" variant="soft" onClick={() => setHints(hints + 1)}><Lightbulb /> {hints === 0 ? "Show parts" : "Show a sentence"}</Button>}
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void submit(true)}>I don't know</Button>
            <Button type="button" variant="ghost" onClick={onStop}>End session</Button>
          </div>
          {hints > 0 && <p className="text-xs text-muted-foreground">With hints, this word won't count toward root mastery yet.</p>}
        </form>
      ) : (
        <div className="mt-5 space-y-4">
          <div className={cn("rounded-xl border-l-4 p-4", VERDICT_STYLE[res.verdict])}>
            <div className="font-semibold">{VERDICT_LABEL[res.verdict]}</div>
            {res.definitionVerdict && (
              <p className="mt-1 text-xs text-muted-foreground">
                Definition: {VERDICT_LABEL[res.definitionVerdict]} · Origin explanation: {VERDICT_LABEL[res.explanationVerdict ?? "skipped"]}
              </p>
            )}
            <p className="mt-1 text-sm">{res.feedback}</p>
          </div>
          <WordReveal w={w} showWord={false} />
          <Button size="lg" className="w-full" onClick={() => onNext(res)}>Next word <ArrowRight /></Button>
        </div>
      )}
    </div>
  );
}
