import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/*
 * Signed-in learner APIs. Every handler runs as the learner (RLS applies).
 * Heavy logic lives in learning.server.ts so the voice relay can share it.
 */

const taskSchema = z.enum(["learn", "definition_recall", "reverse_recall", "context", "deconstruct"]);
const focusSchema = z.enum(["mixed", "quick", "new", "weak", "definitions", "roots", "challenge", "teach"]);

const DONT_KNOW = /^(i\s*(don'?t|do not)\s*know|idk|no idea|not sure|skip|pass|\?+)\.?$/i;

function normalizeWord(s: string) {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}
function editDistance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

// ---------- preferences ----------

export const getPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("user_preferences").select("*").eq("user_id", context.userId).maybeSingle();
    return data;
  });

export const savePreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        display_name: z.string().max(80).nullable().optional(),
        test_date: z.string().nullable().optional(),
        daily_new_words: z.number().int().min(5).max(50).optional(),
        daily_minutes: z.number().int().min(5).max(120).optional(),
        target_level: z.string().max(40).optional(),
        onboarded: z.boolean().optional(),
        diagnostic: z.record(z.any()).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_preferences")
      .upsert(
        {
          ...(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as Record<string, never>),
          user_id: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- sessions ----------

export const startSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mode: z.enum(["focused", "diagnostic", "root"]), focus: z.string().max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("study_sessions")
      .insert({ user_id: context.userId, mode: data.mode, focus: data.focus })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row.id;
  });

export const endSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), reviewed: z.number().int().min(0), correct: z.number().int().min(0) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("study_sessions")
      .update({ ended_at: new Date().toISOString(), items_reviewed: data.reviewed, items_correct: data.correct })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    return { ok: true };
  });

// ---------- study ----------

export const getStudyQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ focus: focusSchema, minutes: z.number().int().min(5).max(60), difficulty: z.number().int().min(1).max(3).nullable() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { buildQueue } = await import("./learning.server");
    return buildQueue(context.supabase, context.userId, data);
  });

export const recordLearn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ wordId: z.string().uuid(), sessionId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { applyReview } = await import("./learning.server");
    await applyReview(context.supabase, context.userId, {
      itemType: "word",
      itemId: data.wordId,
      skill: "recall",
      activity: "learn",
      verdict: "exposure",
      sessionId: data.sessionId,
    });
    return { ok: true };
  });

const answerInput = z.object({
  wordId: z.string().uuid(),
  task: taskSchema,
  response: z.string().max(1000),
  hintsUsed: z.number().int().min(0).max(5),
  latencyMs: z.number().int().min(0).max(3_600_000).nullable(),
  confidence: z.number().int().min(1).max(3).nullable(),
  sessionId: z.string().uuid().nullable(),
  source: z.enum(["focused", "diagnostic"]).default("focused"),
  /** Learner self-assessment used only when automatic grading is unavailable. */
  selfVerdict: z.enum(["correct", "partial", "incorrect"]).nullable().default(null),
});

const SKILLS_FOR_TASK = {
  definition_recall: ["recall", "precision"],
  reverse_recall: ["recognition"],
  context: ["context"],
  deconstruct: ["root_recognition"],
} as const;

export const gradeAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => answerInput.parse(d))
  .handler(async ({ data, context }) => {
    if (data.task === "learn") throw new Error("Nothing to grade");
    const { loadWordsWithParts, wordReference, applyReview, itemLevel } = await import("./learning.server");
    const words = await loadWordsWithParts(context.supabase);
    const word = words.find((w) => w.id === data.wordId);
    if (!word) throw new Error("Word not found");

    const answer = data.response.trim();
    let verdict: "correct" | "partial" | "incorrect" | "skipped";
    let feedback = "";
    let misconception: string | null = null;
    let graded: "ai" | "exact" | "self" | "skip" = "exact";

    if (!answer || DONT_KNOW.test(answer)) {
      verdict = "skipped";
      graded = "skip";
      feedback = `No problem — here it is. We'll come back to “${word.word}” shortly.`;
    } else if (data.task === "reverse_recall") {
      const a = normalizeWord(answer);
      const b = normalizeWord(word.word);
      const dist = editDistance(a, b);
      if (a === b) {
        verdict = "correct";
        feedback = `Yes — “${word.word}”.`;
      } else if (dist === 1 && b.length > 4) {
        verdict = "correct";
        feedback = `Right word — the spelling is “${word.word}”.`;
      } else {
        verdict = "incorrect";
        const close = words.find((w) => normalizeWord(w.word) === a);
        feedback = close
          ? `“${close.word}” means ${close.definition.toLowerCase()} The word for this definition is “${word.word}”.`
          : `The word is “${word.word}”.`;
        if (close) misconception = `confused with ${close.word}`;
      }
    } else if (data.selfVerdict) {
      verdict = data.selfVerdict;
      graded = "self";
      feedback = "Self-graded. Compare your answer with the definition below.";
    } else {
      const { gradeWithAi, AiUnavailableError } = await import("./ai.server");
      const taskText =
        data.task === "definition_recall"
          ? `Define "${word.word}" in your own words.`
          : data.task === "context"
            ? `Infer the meaning of "${word.word}" from this sentence: ${word.examples[0] ?? ""}`
            : `Break "${word.word}" into its meaningful parts and explain how each part contributes to the meaning.`;
      try {
        const g = await gradeWithAi({ task: taskText, reference: wordReference(word), learnerAnswer: answer });
        verdict = g.verdict;
        feedback = g.feedback;
        misconception = g.misconception;
        graded = "ai";
      } catch (error) {
        if (error instanceof AiUnavailableError) {
          return { status: "needs_self_grade" as const, message: error.message };
        }
        throw error;
      }
    }

    for (const skill of SKILLS_FOR_TASK[data.task]) {
      await applyReview(context.supabase, context.userId, {
        itemType: "word",
        itemId: word.id,
        skill,
        activity: data.task,
        verdict,
        hintsUsed: data.hintsUsed,
        latencyMs: data.latencyMs,
        confidence: data.confidence,
        response: answer,
        feedback,
        misconception,
        sessionId: data.sessionId,
        source: data.source,
      });
    }
    // A deconstruction also exercises each real root it contains.
    if (data.task === "deconstruct" && verdict !== "skipped") {
      for (const p of word.parts.filter((x) => x.root.kind !== "suffix")) {
        await applyReview(context.supabase, context.userId, {
          itemType: "root",
          itemId: p.root.id,
          skill: "inference",
          activity: "deconstruct",
          verdict,
          hintsUsed: data.hintsUsed,
          sessionId: data.sessionId,
          source: data.source,
        });
      }
    }
    const level = await itemLevel(context.supabase, context.userId, "word", word.id);
    return { status: "graded" as const, verdict, feedback, misconception, graded, level };
  });

/** Multiple-choice check used only by the diagnostic; correctness is verified server-side. */
export const checkChoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        kind: z.enum(["word", "root"]),
        targetId: z.string().uuid(),
        chosenId: z.string().uuid().nullable(),
        latencyMs: z.number().int().nullable(),
        sessionId: z.string().uuid().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { applyReview } = await import("./learning.server");
    const correct = data.chosenId === data.targetId;
    if (data.kind === "word") {
      await applyReview(context.supabase, context.userId, {
        itemType: "word",
        itemId: data.targetId,
        skill: "recognition",
        activity: "diagnostic",
        verdict: correct ? "correct" : data.chosenId ? "incorrect" : "skipped",
        latencyMs: data.latencyMs,
        sessionId: data.sessionId,
        source: "diagnostic",
      });
    } else {
      // Recognizing a root's meaning in a list is exposure, not recall.
      await applyReview(context.supabase, context.userId, {
        itemType: "root",
        itemId: data.targetId,
        skill: "root_meaning",
        activity: "diagnostic",
        verdict: "exposure",
        sessionId: data.sessionId,
        source: "diagnostic",
      });
    }
    return { correct };
  });

export const getDiagnostic = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadWordsWithParts } = await import("./learning.server");
    const words = await loadWordsWithParts(context.supabase);
    const { data: roots } = await context.supabase.from("roots").select("id, slug, form, meaning, kind").in("kind", ["root", "prefix"]);
    const shuffle = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5);
    const options = (w: (typeof words)[number]) =>
      shuffle([w, ...shuffle(words.filter((x) => x.id !== w.id && x.part_of_speech === w.part_of_speech)).slice(0, 3)]).map((x) => ({
        id: x.id,
        label: x.definition,
      }));
    // Sample every difficulty band (1 = foundational, 3 = advanced), common GRE words first,
    // so results show both how familiar the core list is and where the learner's level drops off.
    const items: Array<
      | { type: "recognition"; targetId: string; word: string; level: number; common: boolean; options: { id: string; label: string }[] }
      | { type: "recall"; targetId: string; word: string; pos: string; level: number; common: boolean }
      | { type: "context"; targetId: string; word: string; sentence: string; level: number; common: boolean; options: { id: string; label: string }[] }
      | { type: "root"; targetId: string; form: string; level: number; common: boolean; options: { id: string; label: string }[] }
    > = [];
    for (const level of [1, 2, 3]) {
      const band = shuffle(words.filter((w) => w.difficulty === level)).sort((a, b) => b.gre_frequency - a.gre_frequency);
      const common = band.filter((w) => w.gre_frequency >= 2);
      const pool = [...shuffle(common.slice(0, 20)), ...band.filter((w) => w.gre_frequency < 2)];
      const take = (n: number) => pool.splice(0, n);
      for (const w of take(4)) items.push({ type: "recognition", targetId: w.id, word: w.word, level, common: w.gre_frequency >= 2, options: options(w) });
      for (const w of take(1)) items.push({ type: "recall", targetId: w.id, word: w.word, pos: w.part_of_speech, level, common: w.gre_frequency >= 2 });
      for (const w of take(1).filter((x) => x.examples[0]))
        items.push({ type: "context", targetId: w.id, word: w.word, sentence: w.examples[0]!, level, common: w.gre_frequency >= 2, options: options(w) });
    }
    const rootPool = shuffle(roots ?? []);
    for (const r of rootPool.slice(0, 3))
      items.push({
        type: "root",
        targetId: r.id,
        form: r.form,
        level: 0,
        common: true,
        options: shuffle([r, ...rootPool.filter((x) => x.id !== r.id).slice(0, 3)]).map((x) => ({ id: x.id, label: x.meaning })),
      });
    // Easiest band first so the learner warms up; roots interleaved.
    const words1 = items.filter((i) => i.type !== "root");
    const r = items.filter((i) => i.type === "root");
    return [...words1.slice(0, 6), r[0], ...words1.slice(6, 12), r[1], ...words1.slice(12), r[2]].filter((x): x is NonNullable<typeof x> => Boolean(x));
  });

// ---------- dashboard & progress ----------

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    const userId = context.userId;
    const L = await import("./learning.server");
    const { retrievability } = await import("./srs");
    const [prefs, words, states, learnedToday] = await Promise.all([
      db.from("user_preferences").select("*").eq("user_id", userId).maybeSingle(),
      L.loadWordsWithParts(db),
      L.loadStates(db, userId),
      L.introducedToday(db, userId),
    ]);
    const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
    const [events, sessions] = await Promise.all([
      db.from("review_events").select("activity, correct, verdict, created_at").eq("user_id", userId).gte("created_at", since30).limit(5000),
      db.from("study_sessions").select("started_at, ended_at, mode").eq("user_id", userId).gte("started_at", since7).limit(500),
    ]);
    const grouped = L.groupStates(states, "word");
    const now = Date.now();
    let introduced = 0;
    let mastered = 0;
    let needsReview = 0;
    for (const w of words) {
      const s = grouped.get(w.id);
      if (!s) continue;
      const lvl = L.levelFor(s, "word");
      if (lvl !== "new") introduced++;
      if (lvl === "mastered") mastered++;
      if (s.some((x) => new Date(x.due).getTime() <= now)) needsReview++;
    }
    const roots = await L.computeRootSummaries(db, userId, { words, states });
    const recallCards = states.filter((s) => s.item_type === "word" && s.skill === "recall" && s.state !== 0 && s.last_review);
    const retention = recallCards.length ? recallCards.reduce((a, s) => a + retrievability(s), 0) / recallCards.length : null;

    const graded = (events.data ?? []).filter((e) => e.verdict !== "exposure");
    const recallEvents = graded.filter((e) => e.activity === "definition_recall");
    const minutes = (from: number) =>
      Math.round(
        (sessions.data ?? [])
          .filter((s) => new Date(s.started_at).getTime() >= from)
          .reduce((a, s) => {
            const end = s.ended_at ? new Date(s.ended_at).getTime() : new Date(s.started_at).getTime();
            return a + Math.min(90 * 60_000, Math.max(0, end - new Date(s.started_at).getTime()));
          }, 0) / 60_000,
      );
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const upcoming = Array.from({ length: 7 }, (_, i) => {
      const start = todayStart.getTime() + i * 864e5;
      const end = start + 864e5;
      const ids = new Set(
        states
          .filter((s) => s.item_type === "word" && s.state !== 0)
          .filter((s) => {
            const t = new Date(s.due).getTime();
            return i === 0 ? t < end : t >= start && t < end;
          })
          .map((s) => s.item_id),
      );
      return { day: new Date(start).toISOString().slice(0, 10), count: ids.size };
    });

    const testDate = prefs.data?.test_date ?? null;
    return {
      prefs: prefs.data,
      totalWords: words.length,
      introduced,
      mastered,
      needsReview,
      rootsMastered: roots.filter((r) => r.level === "mastered").length,
      rootsStarted: roots.filter((r) => r.level !== "new").length,
      totalRoots: roots.length,
      minutesToday: minutes(todayStart.getTime()),
      minutesWeek: minutes(Date.now() - 7 * 864e5),
      retention,
      reviewAccuracy: graded.length ? graded.filter((e) => e.correct).length / graded.length : null,
      reviewCount: graded.length,
      recallAccuracy: recallEvents.length ? recallEvents.filter((e) => e.correct).length / recallEvents.length : null,
      recallCount: recallEvents.length,
      upcoming,
      learnedToday,
      dailyGoal: prefs.data?.daily_new_words ?? 10,
      daysToTest: testDate ? Math.ceil((new Date(testDate).getTime() - Date.now()) / 864e5) : null,
    };
  });

export const getProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    const L = await import("./learning.server");
    const [words, states] = await Promise.all([L.loadWordsWithParts(db), L.loadStates(db, context.userId)]);
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const { data: events } = await db
      .from("review_events")
      .select("correct, verdict, created_at, activity")
      .eq("user_id", context.userId)
      .gte("created_at", since)
      .limit(5000);

    const skills = ["recognition", "recall", "precision", "context", "root_recognition"] as const;
    const skillStats = skills.map((skill) => {
      const rows = states.filter((s) => s.item_type === "word" && s.skill === skill);
      const attempts = rows.reduce((a, s) => a + s.correct_count + s.incorrect_count, 0);
      const correct = rows.reduce((a, s) => a + s.correct_count, 0);
      return {
        skill,
        wordsTried: rows.filter((s) => s.correct_count + s.incorrect_count > 0).length,
        wordsSolid: rows.filter((s) => s.independent_correct > 0 && s.state !== 3).length,
        accuracy: attempts ? correct / attempts : null,
        attempts,
      };
    });

    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10);
      const dayEvents = (events ?? []).filter((e) => e.created_at.slice(0, 10) === d && e.verdict !== "exposure");
      return { day: d, correct: dayEvents.filter((e) => e.correct).length, missed: dayEvents.filter((e) => !e.correct).length };
    });

    const grouped = L.groupStates(states, "word");
    const levels = words.map((w) => ({ id: w.id, word: w.word, slug: w.slug, level: L.levelFor(grouped.get(w.id), "word") }));
    const roots = await L.computeRootSummaries(db, context.userId, { words, states });
    const levelById = new Map(levels.map((l) => [l.id, l]));
    return {
      skillStats,
      days,
      levelCounts: ["new", "introduced", "recognized", "recalling", "mastered"].map((lv) => ({
        level: lv,
        count: levels.filter((l) => l.level === lv).length,
      })),
      roots: roots
        .filter((r) => r.familyIds.length > 0 && r.root.kind !== "suffix")
        .map((r) => ({
          slug: r.root.slug,
          form: r.root.form,
          meaning: r.root.meaning,
          kind: r.root.kind,
          level: r.level,
          wordsExplained: r.wordsExplained,
          target: r.target,
          words: r.familyIds.map((id) => levelById.get(id)!).filter(Boolean),
        })),
    };
  });

// ---------- library ----------

export const getLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const L = await import("./learning.server");
    const [words, states] = await Promise.all([L.loadWordsWithParts(context.supabase), L.loadStates(context.supabase, context.userId)]);
    const grouped = L.groupStates(states, "word");
    return words.map((w) => ({
      id: w.id,
      slug: w.slug,
      word: w.word,
      part_of_speech: w.part_of_speech,
      definition: w.definition,
      difficulty: w.difficulty,
      gre_frequency: w.gre_frequency,
      roots: w.parts.filter((p) => p.root.kind !== "suffix").map((p) => p.root.form),
      level: L.levelFor(grouped.get(w.id), "word"),
    }));
  });

export const getWordDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ slug: z.string().min(1).max(60) }).parse(d))
  .handler(async ({ data, context }) => {
    const L = await import("./learning.server");
    const { retrievability } = await import("./srs");
    const [words, states] = await Promise.all([L.loadWordsWithParts(context.supabase), L.loadStates(context.supabase, context.userId)]);
    const word = words.find((w) => w.slug === data.slug);
    if (!word) return null;
    const grouped = L.groupStates(states, "word");
    const rootIds = new Set(word.parts.filter((p) => p.root.kind !== "suffix").map((p) => p.root.id));
    const related = words
      .filter((w) => w.id !== word.id && w.parts.some((p) => rootIds.has(p.root.id)))
      .map((w) => ({ slug: w.slug, word: w.word, definition: w.definition, level: L.levelFor(grouped.get(w.id), "word"), via: w.parts.filter((p) => rootIds.has(p.root.id)).map((p) => p.root.form) }));
    const confused = words.filter((w) => word.confused_with.includes(w.slug)).map((w) => ({ slug: w.slug, word: w.word, definition: w.definition }));
    const mine = grouped.get(word.id) ?? [];
    const { data: history } = await context.supabase
      .from("review_events")
      .select("activity, verdict, feedback, created_at, hints_used")
      .eq("user_id", context.userId)
      .eq("item_id", word.id)
      .order("created_at", { ascending: false })
      .limit(10);
    return {
      word,
      related,
      confused,
      level: L.levelFor(mine, "word"),
      skills: mine.map((s) => ({
        skill: s.skill,
        independent: s.independent_correct,
        correct: s.correct_count,
        incorrect: s.incorrect_count,
        hinted: s.hinted_count,
        due: s.due,
        retention: s.state === 0 ? null : retrievability(s),
      })),
      history: history ?? [],
    };
  });

// ---------- roots ----------

export const getRoots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const L = await import("./learning.server");
    const roots = await L.computeRootSummaries(context.supabase, context.userId);
    return roots.map((r) => ({
      ...r.root,
      familySize: r.familyIds.length,
      level: r.level,
      wordsExplained: r.wordsExplained,
      target: r.target,
      accuracy: r.attempts ? r.correct / r.attempts : null,
    }));
  });

export const getRootSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ slug: z.string().min(1).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const L = await import("./learning.server");
    const [words, states] = await Promise.all([L.loadWordsWithParts(context.supabase), L.loadStates(context.supabase, context.userId)]);
    const summaries = await L.computeRootSummaries(context.supabase, context.userId, { words, states });
    const summary = summaries.find((s) => s.root.slug === data.slug);
    if (!summary) return null;
    const grouped = L.groupStates(states, "word");
    const family = words
      .filter((w) => summary.familyIds.includes(w.id))
      .map((w) => {
        const s = grouped.get(w.id)?.find((x) => x.skill === "root_recognition");
        return { ...w, level: L.levelFor(grouped.get(w.id), "word"), explained: (s?.independent_correct ?? 0) > 0 };
      })
      // Common GRE words first; unexplained before explained so sessions push toward the target.
      .sort((a, b) => Number(a.explained) - Number(b.explained) || b.gre_frequency - a.gre_frequency || a.difficulty - b.difficulty);
    const affixIds = new Set<string>();
    for (const w of family) for (const p of w.parts) if (p.root.id !== summary.root.id) affixIds.add(p.root.id);
    const companions = summaries
      .filter((s) => affixIds.has(s.root.id))
      .map((s) => ({ slug: s.root.slug, form: s.root.form, kind: s.root.kind, meaning: s.root.meaning }));
    return {
      root: summary.root,
      level: summary.level,
      wordsExplained: summary.wordsExplained,
      target: summary.target,
      accuracy: summary.attempts ? summary.correct / summary.attempts : null,
      family,
      companions,
    };
  });

export const gradeRootMeaning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ rootId: z.string().uuid(), response: z.string().max(400), hintsUsed: z.number().int().min(0).max(3), sessionId: z.string().uuid().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: root } = await context.supabase.from("roots").select("*").eq("id", data.rootId).single();
    if (!root) throw new Error("Root not found");
    const { applyReview } = await import("./learning.server");
    const answer = data.response.trim();
    let verdict: "correct" | "partial" | "incorrect" | "skipped" = "skipped";
    let feedback = `“${root.form}” means “${root.meaning}.”`;
    if (answer && !DONT_KNOW.test(answer)) {
      const { gradeWithAi, AiUnavailableError } = await import("./ai.server");
      try {
        const g = await gradeWithAi({
          task: `What does the ${root.kind} "${root.form}" mean?`,
          reference: `${root.kind} ${root.form} (${root.origin}; ${root.source_word ?? ""}) means: ${root.meaning}. ${root.explanation}`,
          learnerAnswer: answer,
        });
        verdict = g.verdict;
        feedback = g.feedback;
      } catch (error) {
        if (error instanceof AiUnavailableError) return { status: "error" as const, message: error.message };
        throw error;
      }
    }
    await applyReview(context.supabase, context.userId, {
      itemType: "root",
      itemId: root.id,
      skill: "root_meaning",
      activity: "root_meaning",
      verdict,
      hintsUsed: data.hintsUsed,
      response: answer,
      feedback,
      sessionId: data.sessionId,
    });
    return { status: "graded" as const, verdict, feedback, meaning: root.meaning };
  });

export const gradeFamilyWord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rootId: z.string().uuid(),
        wordId: z.string().uuid(),
        definition: z.string().max(600),
        explanation: z.string().max(1000),
        hintsUsed: z.number().int().min(0).max(3),
        latencyMs: z.number().int().nullable(),
        sessionId: z.string().uuid().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const L = await import("./learning.server");
    const words = await L.loadWordsWithParts(context.supabase);
    const word = words.find((w) => w.id === data.wordId);
    if (!word) throw new Error("Word not found");
    const def = data.definition.trim();
    const exp = data.explanation.trim();
    let defVerdict: "correct" | "partial" | "incorrect" | "skipped" = "skipped";
    let expVerdict: "correct" | "partial" | "incorrect" | "skipped" = "skipped";
    let feedback = `“${word.word}” means ${word.definition.charAt(0).toLowerCase()}${word.definition.slice(1)}`;
    let misconception: string | null = null;
    if ((def && !DONT_KNOW.test(def)) || (exp && !DONT_KNOW.test(exp))) {
      const { gradeFamilyWithAi, AiUnavailableError } = await import("./ai.server");
      try {
        const g = await gradeFamilyWithAi({ word: word.word, reference: L.wordReference(word), definitionAnswer: def || "(no answer)", explanationAnswer: exp || "(no answer)" });
        defVerdict = def ? g.definition_verdict : "skipped";
        expVerdict = exp ? g.explanation_verdict : "skipped";
        feedback = g.feedback;
        misconception = g.misconception;
      } catch (error) {
        if (error instanceof AiUnavailableError) return { status: "error" as const, message: error.message };
        throw error;
      }
    }
    // Definition produced unaided counts as recall; the explanation trains root recognition.
    // The family-word explanation is only "correct" when BOTH the definition and the origin explanation are right.
    const familyVerdict = defVerdict === "correct" && expVerdict === "correct" ? "correct" : defVerdict === "skipped" && expVerdict === "skipped" ? "skipped" : defVerdict === "incorrect" || expVerdict === "incorrect" ? "incorrect" : "partial";
    const common = { itemType: "word" as const, itemId: word.id, hintsUsed: data.hintsUsed, latencyMs: data.latencyMs, sessionId: data.sessionId, misconception, feedback };
    await L.applyReview(context.supabase, context.userId, { ...common, skill: "recall", activity: "root_inference", verdict: defVerdict, response: def });
    await L.applyReview(context.supabase, context.userId, { ...common, skill: "root_recognition", activity: "root_inference", verdict: familyVerdict, response: exp });
    await L.applyReview(context.supabase, context.userId, {
      itemType: "root",
      itemId: data.rootId,
      skill: "inference",
      activity: "root_inference",
      verdict: familyVerdict,
      hintsUsed: data.hintsUsed,
      sessionId: data.sessionId,
    });
    return { status: "graded" as const, definitionVerdict: defVerdict, explanationVerdict: expVerdict, verdict: familyVerdict, feedback, misconception };
  });
