import type { Database } from "@/integrations/supabase/types";
import {
  CardState,
  dayKey,
  gradeForAttempt,
  isIndependentCorrect,
  itemsForMinutes,
  newWordAllowance,
  precisionGrade,
  rootMasteryLevel,
  wordMasteryLevel,
  type Activity,
  type MasteryLevel,
  type Skill,
  type Verdict,
} from "./mastery";
import { retrievability, scheduleReview } from "./srs";
import type { DB } from "./supabase-user.server";

export type WordRow = Database["public"]["Tables"]["words"]["Row"];
export type RootRow = Database["public"]["Tables"]["roots"]["Row"];
export type StateRow = Database["public"]["Tables"]["review_states"]["Row"];
export type MorphemeRow = Database["public"]["Tables"]["word_morphemes"]["Row"];

export type WordPart = {
  position: number;
  surface: string;
  contribution: string;
  root: Pick<RootRow, "id" | "slug" | "form" | "kind" | "meaning" | "origin">;
};
export type WordWithParts = WordRow & { parts: WordPart[] };

export type StudyTask = "learn" | "definition_recall" | "reverse_recall" | "context" | "deconstruct";
export type QueueItem = {
  key: string;
  task: StudyTask;
  reason: "new" | "due" | "weak" | "practice";
  word: WordWithParts;
};
export type StudyFocus = "mixed" | "quick" | "new" | "weak" | "definitions" | "roots" | "challenge" | "teach";

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not load ${what}: ${res.error.message}`);
  return res.data as T;
}

// ---------- content ----------

export async function loadWordsWithParts(db: DB): Promise<WordWithParts[]> {
  const [words, parts, roots] = await Promise.all([
    db.from("words").select("*").order("word"),
    db.from("word_morphemes").select("*"),
    db.from("roots").select("id, slug, form, kind, meaning, origin"),
  ]);
  const rootById = new Map(must(roots, "roots").map((r) => [r.id, r]));
  const byWord = new Map<string, WordPart[]>();
  for (const p of must(parts, "word parts")) {
    const root = rootById.get(p.root_id);
    if (!root) continue;
    const list = byWord.get(p.word_id) ?? [];
    list.push({ position: p.position, surface: p.surface, contribution: p.contribution, root });
    byWord.set(p.word_id, list);
  }
  return must(words, "words").map((w) => ({
    ...w,
    parts: (byWord.get(w.id) ?? []).sort((a, b) => a.position - b.position),
  }));
}

export async function loadStates(db: DB, userId: string) {
  const res = await db.from("review_states").select("*").eq("user_id", userId).limit(5000);
  return must(res, "review history");
}

export function groupStates(states: StateRow[], itemType: "word" | "root") {
  const map = new Map<string, StateRow[]>();
  for (const s of states) {
    if (s.item_type !== itemType) continue;
    const list = map.get(s.item_id) ?? [];
    list.push(s);
    map.set(s.item_id, list);
  }
  return map;
}

export function levelFor(states: StateRow[] | undefined, itemType: "word" | "root"): MasteryLevel {
  if (!states?.length) return "new";
  return itemType === "word" ? wordMasteryLevel(states) : rootMasteryLevel(states);
}

/** 0..1 estimated recall right now for the item's weakest reviewed skill. */
export function itemRetention(states: StateRow[] | undefined, now = new Date()) {
  const reviewed = (states ?? []).filter((s) => s.state !== CardState.New && s.last_review);
  if (!reviewed.length) return null;
  return Math.min(...reviewed.map((s) => retrievability(s, now)));
}

// ---------- recording ----------

export type ReviewInput = {
  itemType: "word" | "root";
  itemId: string;
  skill: Skill;
  activity: Activity;
  verdict: Verdict | "exposure";
  hintsUsed?: number;
  latencyMs?: number | null;
  confidence?: number | null;
  response?: string | null;
  feedback?: string | null;
  misconception?: string | null;
  sessionId?: string | null;
  source?: "focused" | "voice" | "diagnostic";
};

export async function applyReview(db: DB, userId: string, input: ReviewInput) {
  const now = new Date();
  const hints = input.hintsUsed ?? 0;
  const existingRes = await db
    .from("review_states")
    .select("*")
    .eq("user_id", userId)
    .eq("item_type", input.itemType)
    .eq("item_id", input.itemId)
    .eq("skill", input.skill)
    .maybeSingle();
  const existing = must(existingRes, "review state");

  const base = {
    user_id: userId,
    item_type: input.itemType,
    item_id: input.itemId,
    skill: input.skill,
    updated_at: now.toISOString(),
  };

  if (input.verdict === "exposure") {
    const row = existing
      ? { ...base, exposures: existing.exposures + 1 }
      : { ...base, exposures: 1, due: now.toISOString() };
    must(await db.from("review_states").upsert(row, { onConflict: "user_id,item_type,item_id,skill" }).select("id"), "save");
    await db.from("review_events").insert({
      user_id: userId,
      session_id: input.sessionId ?? null,
      item_type: input.itemType,
      item_id: input.itemId,
      skill: input.skill,
      activity: input.activity,
      source: input.source ?? "focused",
      rating: 3,
      correct: false,
      verdict: "exposure",
    });
    return { grade: null, due: existing?.due ?? now.toISOString() };
  }

  const verdict = input.verdict;
  const grade =
    input.skill === "precision"
      ? precisionGrade(verdict, hints)
      : gradeForAttempt({ verdict, hintsUsed: hints, confidence: input.confidence ?? null });
  const next = scheduleReview(existing, grade, now);
  const independent = isIndependentCorrect(verdict, hints) || (input.skill === "precision" && grade >= 3);
  const today = dayKey(now);
  const prevDays = existing?.correct_days ?? [];
  const latencies = [existing?.avg_latency_ms, input.latencyMs].filter((x): x is number => typeof x === "number");

  const row = {
    ...base,
    ...next,
    exposures: (existing?.exposures ?? 0) + 1,
    correct_count: (existing?.correct_count ?? 0) + (verdict === "correct" ? 1 : 0),
    incorrect_count: (existing?.incorrect_count ?? 0) + (verdict === "correct" ? 0 : 1),
    hinted_count: (existing?.hinted_count ?? 0) + (hints > 0 ? 1 : 0),
    independent_correct: (existing?.independent_correct ?? 0) + (independent ? 1 : 0),
    correct_days: independent && !prevDays.includes(today) ? [...prevDays, today].slice(-30) : prevDays,
    avg_latency_ms: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    last_confidence: input.confidence ?? existing?.last_confidence ?? null,
  };
  must(await db.from("review_states").upsert(row, { onConflict: "user_id,item_type,item_id,skill" }).select("id"), "save");
  must(
    await db.from("review_events").insert({
      user_id: userId,
      session_id: input.sessionId ?? null,
      item_type: input.itemType,
      item_id: input.itemId,
      skill: input.skill,
      activity: input.activity,
      source: input.source ?? "focused",
      rating: grade,
      correct: verdict === "correct",
      hints_used: hints,
      latency_ms: input.latencyMs ?? null,
      confidence: input.confidence ?? null,
      response: input.response?.slice(0, 1000) ?? null,
      verdict,
      feedback: input.feedback?.slice(0, 1000) ?? null,
      misconception: input.misconception?.slice(0, 300) ?? null,
    }),
    "save event",
  );
  return { grade, due: next.due };
}

export async function itemLevel(db: DB, userId: string, itemType: "word" | "root", itemId: string) {
  const res = await db.from("review_states").select("*").eq("user_id", userId).eq("item_type", itemType).eq("item_id", itemId);
  return levelFor(must(res, "states"), itemType);
}

// ---------- queue ----------

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function introducedToday(db: DB, userId: string) {
  const res = await db
    .from("review_events")
    .select("item_id")
    .eq("user_id", userId)
    .eq("activity", "learn")
    .gte("created_at", startOfToday());
  return new Set(must(res, "today").map((r) => r.item_id)).size;
}

function chooseReviewTask(word: WordWithParts, states: StateRow[], focus: StudyFocus): StudyTask {
  const by = (s: string) => states.find((x) => x.skill === s);
  const recall = by("recall");
  if (focus === "definitions") return "definition_recall";
  if (focus === "roots") return word.parts.some((p) => p.root.kind !== "suffix") ? "deconstruct" : "definition_recall";
  if (!recall || recall.independent_correct === 0 || recall.state === CardState.Relearning) return "definition_recall";
  const now = Date.now();
  if (new Date(recall.due).getTime() <= now && focus !== "challenge") return "definition_recall";
  const formats: { task: StudyTask; skill: string }[] = [
    { task: "context", skill: "context" },
    { task: "reverse_recall", skill: "recognition" },
  ];
  if (word.parts.some((p) => p.root.kind !== "suffix")) formats.push({ task: "deconstruct", skill: "root_recognition" });
  formats.sort((a, b) => (by(a.skill)?.independent_correct ?? 0) - (by(b.skill)?.independent_correct ?? 0));
  return formats[0]!.task;
}

function isWeak(states: StateRow[]) {
  return states.some((s) => s.lapses > 0 || s.incorrect_count > s.correct_count || s.state === CardState.Relearning);
}

export async function buildQueue(
  db: DB,
  userId: string,
  opts: { focus: StudyFocus; minutes: number; difficulty?: number | null },
) {
  const [words, states, prefsRes, learnedToday] = await Promise.all([
    loadWordsWithParts(db),
    loadStates(db, userId),
    db.from("user_preferences").select("daily_new_words").eq("user_id", userId).maybeSingle(),
    introducedToday(db, userId),
  ]);
  const dailyGoal = prefsRes.data?.daily_new_words ?? 10;
  const grouped = groupStates(states, "word");
  const now = Date.now();
  const total = itemsForMinutes(opts.minutes);
  const diffOk = (w: WordRow) => !opts.difficulty || w.difficulty === opts.difficulty;

  const started = words.filter((w) => grouped.has(w.id));
  const due = started
    .map((w) => {
      const s = grouped.get(w.id)!;
      const dueAt = Math.min(...s.map((x) => new Date(x.due).getTime()));
      const ret = itemRetention(s) ?? 0;
      const lapses = s.reduce((a, x) => a + x.lapses, 0);
      return { w, s, dueAt, priority: (1 - ret) + lapses * 0.25 + (isWeak(s) ? 0.3 : 0) };
    })
    .filter((x) => x.dueAt <= now)
    .sort((a, b) => b.priority - a.priority);

  const weak = started
    .filter((w) => isWeak(grouped.get(w.id)!))
    .map((w) => ({ w, s: grouped.get(w.id)! }));

  const allowance = newWordAllowance({ dailyGoal, introducedToday: learnedToday, dueReviews: due.length });
  const fresh = words
    .filter((w) => !grouped.has(w.id) && diffOk(w))
    .sort((a, b) => b.gre_frequency - a.gre_frequency || a.difficulty - b.difficulty || a.word.localeCompare(b.word));

  const items: QueueItem[] = [];
  const used = new Set<string>();
  const push = (w: WordWithParts, task: StudyTask, reason: QueueItem["reason"]) => {
    items.push({ key: `${w.id}:${task}:${items.length}`, task, reason, word: w });
    used.add(w.id);
  };

  const addReviews = (list: { w: WordWithParts; s: StateRow[] }[], reason: QueueItem["reason"], limit: number) => {
    for (const { w, s } of list) {
      if (items.length >= limit) break;
      if (used.has(w.id)) continue;
      push(w, chooseReviewTask(w, s, opts.focus), reason);
    }
  };

  const newCount =
    opts.focus === "weak" || opts.focus === "definitions" || opts.focus === "challenge" || opts.focus === "quick"
      ? 0
      : opts.focus === "new" || opts.focus === "teach"
        ? Math.min(allowance, Math.ceil(total / 2))
        : Math.min(allowance, Math.floor(total / 3));

  if (opts.focus === "weak") {
    addReviews(weak, "weak", total);
    addReviews(due, "due", total);
  } else if (opts.focus === "challenge") {
    const strong = started
      .filter((w) => ["recalling", "mastered"].includes(levelFor(grouped.get(w.id), "word")))
      .sort((a, b) => b.difficulty - a.difficulty)
      .map((w) => ({ w, s: grouped.get(w.id)! }));
    addReviews(strong, "practice", total);
    addReviews(due, "due", total);
  } else {
    addReviews(due, "due", total - newCount * 2);
    if (opts.focus !== "new" && opts.focus !== "teach") addReviews(weak, "weak", total - newCount * 2);
  }

  // New words: teach first, quiz again a few items later (spaced within the session).
  const newWords = fresh.slice(0, newCount);
  for (const [i, w] of newWords.entries()) {
    const at = Math.min(items.length, i * 3);
    items.splice(at, 0, { key: `${w.id}:learn`, task: "learn", reason: "new", word: w });
    used.add(w.id);
  }
  for (const w of newWords) {
    const learnIdx = items.findIndex((x) => x.key === `${w.id}:learn`);
    const at = Math.min(items.length, learnIdx + 4);
    items.splice(at, 0, { key: `${w.id}:recall`, task: "definition_recall", reason: "new", word: w });
  }

  return {
    items: items.slice(0, Math.max(total, newWords.length * 2)),
    stats: { due: due.length, weak: weak.length, allowance, dailyGoal, learnedToday },
  };
}

// ---------- references for grading ----------

export function wordReference(w: WordWithParts) {
  const lines = [
    `Word: ${w.word} (${w.part_of_speech})`,
    `Primary definition: ${w.definition}`,
  ];
  if (w.secondary_meanings.length) lines.push(`Secondary meanings: ${w.secondary_meanings.join("; ")}`);
  lines.push(`Plain English: ${w.plain_english}`);
  if (w.synonyms.length) lines.push(`Synonyms: ${w.synonyms.join(", ")}`);
  if (w.confused_note) lines.push(`Commonly confused: ${w.confused_note}`);
  if (w.etymology) lines.push(`Etymology (${w.etymology_status}): ${w.etymology}`);
  if (w.parts.length) {
    lines.push(
      "Word parts: " +
        w.parts.map((p) => `${p.surface} = ${p.root.form} (${p.root.kind}, ${p.root.origin}) "${p.root.meaning}" — ${p.contribution}`).join(" | "),
    );
  }
  return lines.join("\n");
}

// ---------- root summaries ----------

export type RootSummary = {
  root: RootRow;
  familyIds: string[];
  level: MasteryLevel;
  wordsExplained: number;
  attempts: number;
  correct: number;
  target: number;
};

export async function computeRootSummaries(db: DB, userId: string, preloaded?: { words: WordWithParts[]; states: StateRow[] }) {
  const [rootsRes, words, states] = await Promise.all([
    db.from("roots").select("*").order("slug"),
    preloaded ? Promise.resolve(preloaded.words) : loadWordsWithParts(db),
    preloaded ? Promise.resolve(preloaded.states) : loadStates(db, userId),
  ]);
  const roots = must(rootsRes, "roots");
  const wordStates = groupStates(states, "word");
  const rootStates = groupStates(states, "root");
  const { rootFamilyTarget } = await import("./mastery");
  return roots.map((root): RootSummary => {
    const family = words.filter((w) => w.parts.some((p) => p.root.id === root.id));
    let wordsExplained = 0;
    let attempts = 0;
    let correct = 0;
    for (const w of family) {
      const s = wordStates.get(w.id)?.find((x) => x.skill === "root_recognition");
      if (!s) continue;
      if (s.independent_correct > 0) wordsExplained++;
      attempts += s.correct_count + s.incorrect_count;
      correct += s.correct_count;
    }
    const evidence = { familySize: family.length, wordsExplained, attempts, correct };
    return {
      root,
      familyIds: family.map((w) => w.id),
      level: rootMasteryLevel(rootStates.get(root.id) ?? [], evidence),
      wordsExplained,
      attempts,
      correct,
      target: rootFamilyTarget(family.length),
    };
  });
}
