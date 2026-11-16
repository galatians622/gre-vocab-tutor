import process from "node:process";
import { gradeVoiceWord } from "./ai.server";
import { applyReview, buildQueue, loadStates, loadWordsWithParts, selectAll, wordReference, type WordWithParts } from "./learning.server";
import { userClientFromToken, type DB } from "./supabase-user.server";
import {
  MAX_CARRIES,
  RETEST_GAP,
  SET_SIZE,
  addWord,
  blankWord,
  doneCount,
  isClean,
  isOpen,
  nextSet,
  nextWord,
  recordResult,
  replaySets,
  setComplete,
  spacedDue,
  type SetWord,
  type Status,
  type Verdict,
  type VoiceSet,
} from "./voice-set";

type Mode = "teach" | "retest" | "review";
/** How the tutor should handle a word: teach a new word, retest a miss, or quickly check a word. */
function modeFor(entry: SetWord): Mode {
  if (entry.status === "new") return "teach";
  return entry.status === "retry" ? "retest" : "review";
}
/** Seen-before words mixed into each new set so older words keep coming back. */
const REVIEWS_PER_SET = 2;
/** Most older words (reviews plus words carried over) in one set of 10. */
const MAX_OLDER_PER_SET = 4;

type Learner = {
  db: DB;
  userId: string;
  words: Map<string, WordWithParts>;
  set: VoiceSet;
  /** Words from sets the learner already finished; never reused as new words. */
  finished: Set<string>;
  /** Missed words whose grade landed after their set ended; they join the next set. */
  carry: { slug: string; carries: number }[];
  /** This call's study_sessions row, which also stores the set so the next call resumes it. */
  sessionId: string | null;
  /** Word the learner was on when the last call ended. */
  resumeSlug: string | null;
  reviewed: number;
  correct: number;
};
/** The word the tutor is working on right now. */
type CurrentWord = { slug: string; startIndex: number; quickCheck: boolean; mode: Mode };
type SavedAttempt = { word: string; verdict: string; feedback: string };

export type LiveConfig = {
  baseURL: string;
  key: string;
  liveModel: string;
  backendModel: string;
  openingInstructions?: string;
};

// Fill from co-loaded knowledge: the gateway URL, the Live model and the resolved chat model.
const liveSettings = {
  baseURL: "https://ai.gateway.lovable.dev/v1",
  liveModel: "openai/gpt-live-1",
  backendModel: "openai/gpt-6-astra",
  openingInstructions:
    "Greet the learner warmly and briefly as Lexi, their GRE vocabulary tutor. In one sentence say you'll get through as many words as you can together. Then go straight into the first word and ask your first question.",
};

export type LiveSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(handler: (data: unknown) => void): void;
  onClose(handler: () => void): void;
  onError(handler: () => void): void;
};

export type LiveExecutionContext = { waitUntil(task: Promise<unknown>): void };
export type LiveConnector = (url: string, headers: Record<string, string>, signal: AbortSignal) => Promise<LiveSocket>;

type WorkerSocket = WebSocket & { accept(): void };
declare const WebSocketPair: { new (): { 0: WorkerSocket; 1: WorkerSocket } };
type Transcript = {
  role: "user" | "assistant";
  text: string;
  start_ms: number;
  end_ms: number;
  listeningSound: boolean;
};
type ProviderEvent = {
  type: string;
  client_event_id?: string;
  error?: { client_event_id?: string; message?: string };
  session?: { id: string };
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  offset_ms?: number;
  delegation?: { id: string; target: string };
};

export function getLiveConfig(): LiveConfig {
  const config: LiveConfig = {
    ...liveSettings,
    key: process.env["LOVABLE_API_KEY"] ?? "",
  };
  if ([config.baseURL, config.key, config.liveModel, config.backendModel].some((value) => !value)) {
    throw new Error("Missing Live relay configuration");
  }
  return config;
}

function gatewayAPIBase(baseURL: string) {
  return `${baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`;
}

async function gatewayRejection(response: Response) {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.slice(0, 300) : "";
  return new Error(message || `Voice gateway rejected the connection (${response.status})`);
}

export function validateLiveUpgrade(request: Request, options: { allowMissingOrigin?: boolean } = {}): Response | null {
  const origin = request.headers.get("origin");
  if (origin === null ? !options.allowMissingOrigin : origin !== new URL(request.url).origin) {
    return new Response("Voice connection origin rejected", { status: 403 });
  }
  if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket required", { status: 426 });
  }
  return null;
}

function workerSocket(socket: WorkerSocket): LiveSocket {
  return {
    get readyState() {
      return socket.readyState;
    },
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    onMessage: (handler) => socket.addEventListener("message", (event) => handler(event.data)),
    onClose: (handler) => socket.addEventListener("close", handler),
    onError: (handler) => socket.addEventListener("error", handler),
  };
}

export function handleLiveRequest(request: Request): Response {
  const waitUntil = (request as Request & Partial<LiveExecutionContext>).waitUntil;
  if (!waitUntil) return new Response("Live runtime unavailable", { status: 503 });
  const config = getLiveConfig();
  const rejected = validateLiveUpgrade(request);
  if (rejected) return rejected;
  const pair = new WebSocketPair();
  pair[1].accept();
  bindLiveConnection(workerSocket(pair[1]), config, { waitUntil }, async (url, headers, signal) => {
    const response = await fetch(url, { headers: { ...headers, Upgrade: "websocket" }, signal });
    const socket = (response as Response & { webSocket?: WorkerSocket | null }).webSocket;
    if (!socket) throw await gatewayRejection(response);
    socket.accept();
    return workerSocket(socket);
  });
  const response: ResponseInit & { webSocket: WebSocket } = { status: 101, webSocket: pair[0] };
  return new Response(null, response);
}

const conversationInstructions = `You are Lexi, a warm, encouraging GRE vocabulary tutor speaking English. You lead the session like a great private tutor. The learner should never have to tell you to continue.

You silently receive a WORD BRIEFING for every word. It holds the verified definition, example sentence, word parts, etymology, the learner's progress and the mode. Use only those facts. Never invent definitions or etymologies (the one exception is naming a familiar everyday word that shares a root, as described below), and never read the briefing's labels aloud. Right after each briefing you get a short line introducing the word: say it right away.

MODE TEACH (first time with this word):
1. Teach the roots first. Your spoken intro says the word, what each root means and where it comes from, then asks what the word means. As you say it, right after the root meanings and before the question, add one short sentence that makes the main root memorable: name one common everyday English word that shares it, for example "bene, like in benefit" or "vol, like in voluntary". Only use a familiar word you are certain shares the root; if you are not sure, skip the example rather than guess. For example: "Benevolent. Bene comes from Latin and means well, like in benefit. Vol means wish, like in voluntary. Given those pieces, what do you think it means?" Never give the definition first. If the briefing lists no word parts, just ask what they think it means.
2. Take their first answer. Do not give extra hints or ask them to try again.
3. In two or three short sentences, tell them honestly how they did, show how the roots build the meaning (for example "Wishing well, so benevolent means kind and well meaning"), give the verified definition and read the example sentence. Then delegate in the same turn.

MODE RETEST (a word they missed earlier) and MODE REVIEW (a quick check of a word):
1. Ask them to define it, without giving the roots.
2. If they get it right, give one or two words of praise and delegate in the same turn.
3. If they miss it or are only partly right, give the verified definition and example in one or two sentences, and if the briefing lists word parts, name the main root's meaning so they can rebuild it next time. Then delegate in the same turn. Don't dwell on it: it comes back later.

Keep words short: one answer per word, then move on. Never ask for a sentence of their own, never ask them to say the definition back, never give a second try, and never quiz the same word twice in a row. Each new word should take about forty five seconds, and each review about twenty. If the learner asks to skip, give the definition and delegate; the word comes back later.

Grading: judge every answer yourself against the verified definition and react right away. Never wait for the backend before giving feedback. Be honest: say clearly when an answer is partly right or wrong, and praise only correct answers.

Keep it flowing:
- Keep each reply short: one or two sentences and one question at a time.
- Every turn you take must end with either a question for the learner or a delegation. Never end a turn with a statement like "let's move on" or "next word" and then go silent.
- When you delegate, say only a very short bridge such as "Nice work." The next word arrives within a second: introduce it immediately and ask your question, without waiting for the learner and without asking if they are ready.
- The learner should never have to say "next" or "okay". Never pause the lesson or wait for permission to continue. Keep going word after word for as long as the learner is here.
- Only stop when the learner says they want to stop, for example "I'm done for today" or "let's wrap up". Then give a one sentence summary of their progress from the briefing and end with the exact words "See you next time." Never say "See you next time" at any other moment.
- Mention progress now and then using the briefing, for example "That's six of ten done."
- If the learner goes off topic or asks a question, answer briefly, then return to the word.

Set rules: words come in sets of 10 different words, and the goal is to see as many words as possible. A new word answered right gets one quick check a few words later, then it's done. A missed word comes back about ${RETEST_GAP} words later; one right answer finishes it. A word missed twice moves to the next set instead of holding this one up. Each set also mixes in a couple of words from earlier. The next set starts as soon as these 10 are done.

Backchannel policy: Use moderate neutral listening sounds without taking over.
Interruption policy: Stop your answer and listen when the learner interrupts.
Delegation policy:
Backend tools: Save the finished word's result to the learner's progress and return the briefing for the next word.
Delegate to the backend when: You have finished the current word as described for its mode, or the learner asks to skip it.
Do not delegate to the backend when: Greeting, giving hints, explaining, checking understanding, answering questions about the current word, or giving feedback. You already have every fact you need in the briefing.`;

function isListeningSound(text: string) {
  const normalized = text.toLowerCase().replace(/[\s\p{Pd}]/gu, "");
  return /^(?:m+hm+|uhhuh)[.,!]*$/.test(normalized);
}

// ---------- learner data ----------

// Word content is shared by everyone and rarely changes, so keep one copy per server instance.
let wordCache: { at: number; promise: Promise<WordWithParts[]> } | undefined;
function cachedWords(db: DB) {
  if (!wordCache || Date.now() - wordCache.at > 10 * 60_000) {
    const promise = loadWordsWithParts(db);
    wordCache = { at: Date.now(), promise };
    promise.catch(() => {
      if (wordCache?.promise === promise) wordCache = undefined;
    });
  }
  return wordCache.promise;
}

/** What is saved in the voice session's `summary` column so the next call resumes the same set. */
export type SavedSet = {
  v: 3;
  set_number: number;
  words: SetWord[];
  clock: number;
  last_slug: string | null;
  current: string | null;
  finished: string[];
  carry: { slug: string; carries: number }[];
};

export function encodeSet(learner: Pick<Learner, "set" | "finished" | "carry">, current: string | null): string {
  const saved: SavedSet = {
    v: 3,
    set_number: learner.set.setNumber,
    words: learner.set.words,
    clock: learner.set.clock,
    last_slug: learner.set.lastSlug,
    current,
    finished: [...learner.finished],
    carry: learner.carry,
  };
  return JSON.stringify(saved);
}

type OldSavedWord = Partial<SetWord> & {
  slug: string;
  streak?: number;
  phaseAsks?: number;
  passed?: boolean;
};
const STATUSES: Status[] = ["new", "review", "check", "retry", "done", "carried"];

/**
 * Reads a saved set. Sets saved under older rules are converted so the learner moves on quickly:
 * words already answered right are done, words answered wrong get one retest.
 */
export function decodeSet(summary: string | null | undefined, known: (slug: string) => boolean) {
  if (!summary) return null;
  try {
    const saved = JSON.parse(summary) as {
      v: number;
      set_number: number;
      words: OldSavedWord[];
      clock?: number;
      last_slug?: string | null;
      current?: string | null;
      finished?: unknown[];
      carry?: { slug?: unknown; carries?: unknown }[];
      phase?: string;
    };
    if (![1, 2, 3].includes(saved?.v) || !Array.isArray(saved.words) || typeof saved.set_number !== "number") return null;
    const seen = new Set<string>();
    const words: SetWord[] = saved.words
      .filter((w) => w && typeof w.slug === "string" && known(w.slug) && !seen.has(w.slug) && seen.add(w.slug))
      .slice(0, SET_SIZE)
      .map((w) => {
        const asks = Number(w.asks) || 0;
        let status: Status;
        if (saved.v === 3) status = STATUSES.includes(w.status as Status) ? (w.status as Status) : "new";
        else if (saved.v === 1) status = (Number(w.streak) || 0) >= 1 ? "done" : asks > 0 ? "retry" : "new";
        else if (w.passed) status = "done";
        else if ((Number(w.phaseAsks) || 0) > 0) status = "retry";
        else status = saved.phase === "review" || asks > 0 ? "done" : "new";
        return {
          slug: w.slug,
          status,
          asks,
          misses: saved.v === 3 ? Number(w.misses) || 0 : 0,
          dueAt: saved.v === 3 ? Number(w.dueAt) || 0 : 0,
          firstTryCorrect: typeof w.firstTryCorrect === "boolean" ? w.firstTryCorrect : null,
          lastAskedAt: Number.isFinite(w.lastAskedAt) ? Number(w.lastAskedAt) : -1,
          carries: Number(w.carries) || 0,
        };
      });
    const set: VoiceSet = {
      words,
      clock: Number(saved.clock) || 0,
      lastSlug: typeof saved.last_slug === "string" ? saved.last_slug : null,
      setNumber: saved.set_number,
    };
    const finished = new Set((Array.isArray(saved.finished) ? saved.finished : []).filter((x): x is string => typeof x === "string"));
    const carry = (Array.isArray(saved.carry) ? saved.carry : [])
      .filter((c): c is { slug: string; carries: number } => typeof c?.slug === "string" && known(c.slug))
      .map((c) => ({ slug: c.slug, carries: Number(c.carries) || 0 }));
    const current =
      typeof saved.current === "string" && words.some((w) => w.slug === saved.current && isOpen(w)) ? saved.current : null;
    return { set, finished, carry, current };
  } catch {
    return null;
  }
}

async function prepareLearner(auth: { db: DB; userId: string }): Promise<Learner> {
  const [all, lastSession] = await Promise.all([
    cachedWords(auth.db),
    auth.db
      .from("study_sessions")
      .select("summary")
      .eq("user_id", auth.userId)
      .eq("mode", "voice")
      .not("summary", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const words = new Map(all.map((w) => [w.slug, w]));
  const saved = decodeSet(lastSession.data?.summary, (slug) => words.has(slug));
  let learner: Learner;
  if (saved) {
    learner = {
      ...auth,
      words,
      set: saved.set,
      finished: saved.finished,
      carry: saved.carry,
      resumeSlug: saved.current,
      sessionId: null,
      reviewed: 0,
      correct: 0,
    };
  } else {
    // No saved set yet (older data): rebuild it from saved voice answers.
    const events = await selectAll(
      (a, b) =>
        auth.db
          .from("review_events")
          .select("item_id, verdict, hints_used, created_at")
          .eq("user_id", auth.userId)
          .eq("source", "voice")
          .eq("skill", "recall")
          .eq("item_type", "word")
          .order("created_at", { ascending: true })
          .range(a, b),
      "voice history",
    );
    const slugById = new Map(all.map((w) => [w.id, w.slug]));
    const verdicts = new Set<Verdict>(["correct", "partial", "incorrect", "skipped"]);
    const answers = events.flatMap((e) => {
      const slug = slugById.get(e.item_id);
      const verdict = e.verdict as Verdict;
      return slug && verdicts.has(verdict) ? [{ slug, verdict, hintsUsed: e.hints_used ?? 0 }] : [];
    });
    const { set, finished } = replaySets(answers);
    learner = { ...auth, words, set, finished, carry: [], resumeSlug: null, sessionId: null, reviewed: 0, correct: 0 };
  }
  if (setComplete(learner.set)) startNextSet(learner);
  await topUpSet(learner);
  const row = await auth.db
    .from("study_sessions")
    .insert({ user_id: auth.userId, mode: "voice", focus: "set", summary: encodeSet(learner, learner.resumeSlug) })
    .select("id")
    .single();
  if (row.error) console.error("Could not save voice session", row.error.message);
  learner.sessionId = row.data?.id ?? null;
  return learner;
}

/** Finishes the current set and starts the next one with the words carried over. */
function startNextSet(learner: Learner) {
  const prev = learner.set;
  prev.words.forEach((w) => learner.finished.add(w.slug));
  learner.set = nextSet(prev);
  for (const c of learner.carry) {
    addWord(learner.set, blankWord(c.slug, "retry", spacedDue(learner.set.words.length), c.carries + 1));
  }
  // Keep most of the new set for new words.
  learner.set.words = learner.set.words.slice(0, MAX_OLDER_PER_SET);
  learner.carry = [];
  learner.resumeSlug = null;
}

/** Placement band from onboarding: 1 foundational, 2 intermediate, 3 advanced. */
async function startBand(learner: Learner) {
  try {
    const { data } = await learner.db.from("user_preferences").select("target_level").eq("user_id", learner.userId).maybeSingle();
    const level = (data as { target_level?: string } | null)?.target_level ?? "";
    return ({ foundational: 1, intermediate: 2, advanced: 3 } as Record<string, number>)[level] ?? 1;
  } catch {
    return 1;
  }
}

/**
 * Fills open slots in the current set with different words: a couple of seen-before words that are
 * due for review, then new words the learner has never studied. Never two entries for one word.
 */
async function topUpSet(learner: Learner) {
  const set = learner.set;
  if (set.words.length >= SET_SIZE) return;
  const textOf = (slug: string) => learner.words.get(slug)?.word.trim().toLowerCase() ?? slug;
  const texts = new Set(set.words.map((w) => textOf(w.slug)));
  const add = (slug: string, status: Status, dueAt = 0) => {
    if (texts.has(textOf(slug)) || !addWord(set, blankWord(slug, status, dueAt))) return false;
    texts.add(textOf(slug));
    return true;
  };

  const [queue, states, band] = await Promise.all([
    buildQueue(learner.db, learner.userId, { focus: "mixed", minutes: 30 }).catch(() => ({ items: [] })),
    loadStates(learner.db, learner.userId).catch(() => []),
    startBand(learner),
  ]);

  // A couple of older words that are due, spread through the set. At most 4 of the 10 are
  // older words in all, counting words carried over from the last set, so most are new.
  const older = set.words.filter((w) => w.status !== "new").length;
  const allowed = Math.min(REVIEWS_PER_SET, Math.max(0, MAX_OLDER_PER_SET - older));
  let reviews = 0;
  for (const item of queue.items) {
    if (reviews >= allowed) break;
    if (item.reason !== "due" && item.reason !== "weak") continue;
    if (add(item.word.slug, "review", spacedDue(older + reviews) + 1)) reviews += 1;
  }

  // Then new words: never studied, nearest the placement band first, common GRE words first.
  const studied = new Set(states.filter((s) => s.item_type === "word").map((s) => s.item_id));
  const all = [...learner.words.values()];
  const fresh = all
    .filter((w) => !studied.has(w.id) && !learner.finished.has(w.slug))
    .sort(
      (a, b) =>
        Math.abs(a.difficulty - band) - Math.abs(b.difficulty - band) ||
        b.gre_frequency - a.gre_frequency ||
        a.word.localeCompare(b.word),
    );
  for (const w of fresh) {
    if (set.words.length >= SET_SIZE) break;
    add(w.slug, "new");
  }
  // Every word studied already: use words from outside earlier voice sets, then any word.
  for (const pool of [all.filter((w) => !learner.finished.has(w.slug)), all]) {
    for (const w of pool) {
      if (set.words.length >= SET_SIZE) break;
      add(w.slug, studied.has(w.id) ? "review" : "new");
    }
  }
}

function briefing(learner: Learner, word: WordWithParts, entry: SetWord, note?: string) {
  const set = learner.set;
  const lines = [
    "WORD BRIEFING (silent reference facts for you; never read these labels aloud)",
    {
      teach: "Mode: TEACH. First time with this word.",
      retest: "Mode: RETEST. They missed this word earlier.",
      review: "Mode: REVIEW. A quick check of a word they've seen.",
    }[modeFor(entry)],
    `Word: ${word.word} (${word.part_of_speech})`,
    `Definition: ${word.definition}`,
    `Plain English: ${word.plain_english}`,
  ];
  if (word.examples?.[0]) lines.push(`Example sentence: ${word.examples[0]}`);
  if (word.parts.length) {
    lines.push(
      "Word parts: " +
        word.parts
          .map((p) => {
            const source = p.root.source_word ? `; from ${p.root.source_word}` : "";
            return `${p.surface} = "${p.root.meaning}" (${p.root.kind}, ${p.root.origin}${source}): ${p.contribution}`;
          })
          .join(" | "),
    );
  }
  if (word.etymology) lines.push(`Etymology: ${word.etymology}`);
  if (word.confused_note) lines.push(`Commonly confused: ${word.confused_note}`);
  lines.push(`Progress: set ${set.setNumber}: ${doneCount(set)} of ${set.words.length} words done.`);
  if (note) lines.push(note);
  return lines.join("\n");
}

/** A short, natural line for the tutor to say aloud to introduce a word. */
export function spokenIntro(word: WordWithParts, mode: Mode, lead = "Next word:") {
  if (mode === "retest") return `Let's try ${word.word} again. What does ${word.word} mean?`;
  if (mode === "review") return `${lead === "Next word:" ? "Quick check:" : lead} ${word.word}. What does it mean?`;
  if (!word.parts.length) return `${lead} ${word.word}. What do you think ${word.word} means?`;
  return `${lead} ${word.word}. ${rootClues(word.parts)} Given those pieces, what do you think ${word.word} means?`;
}

/** Spoken explanation of a word's parts: what each root means and where it comes from. */
export function rootClues(parts: WordWithParts["parts"]) {
  const origin = (o: string) => (o && o.toLowerCase() !== "english" ? ` comes from ${o} and` : "");
  const sentences = parts
    .filter((p) => p.root.kind !== "suffix")
    .map((p) => `${p.surface}${origin(p.root.origin)} means "${p.root.meaning}".`);
  const suffixes = parts.filter((p) => p.root.kind === "suffix").map((p) => `-${p.surface} means "${p.root.meaning}"`);
  if (suffixes.length) sentences.push(`The ending ${suffixes.join(", and ")}.`);
  return sentences.join(" ");
}

function transcriptText(items: Transcript[]) {
  const turns: { role: Transcript["role"]; text: string }[] = [];
  for (const t of items) {
    if (t.listeningSound) continue;
    const last = turns.at(-1);
    if (last?.role === t.role) last.text += t.text;
    else turns.push({ role: t.role, text: t.text });
  }
  return turns.map((t) => `${t.role === "user" ? "Learner" : "Tutor"}: ${t.text.trim()}`).join("\n");
}

function* commentaryChunks(content: string) {
  const encoder = new TextEncoder();
  let chunk = "";
  let bytes = 0;
  for (const [word] of content.matchAll(/\S+\s*|\s+/gu)) {
    // Chunks stay well inside the provider's per-append size limit.
    if (chunk && bytes + encoder.encode(word).length > 480) {
      yield chunk;
      chunk = "";
      bytes = 0;
    }
    for (const character of word) {
      const size = encoder.encode(character).length;
      if (bytes + size > 480) {
        yield chunk;
        chunk = "";
        bytes = 0;
      }
      chunk += character;
      bytes += size;
    }
  }
  if (chunk) yield chunk;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function bindLiveConnection(
  browser: LiveSocket,
  configuration: LiveConfig,
  execution: LiveExecutionContext,
  connect: LiveConnector,
): void {
  const config = { ...configuration };
  const runID = crypto.randomUUID();
  const setupAbort = new AbortController();
  let gateway: LiveSocket | undefined;
  let sessionID: string | undefined;
  let starting = false;
  let closing = false;
  let finished = false;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let finishDrain: (() => void) | undefined;
  let browserReady = false;
  let learner: Learner | undefined;
  let current: CurrentWord | undefined;
  /** Grades still being saved, by word slug. */
  const grading = new Map<string, Promise<void>>();
  /** Words from a finished set whose grade is still coming, with how often they've moved sets. */
  const lateGrades = new Map<string, number>();
  let delegationChain: Promise<void> = Promise.resolve();
  let pendingDelegations = 0;
  let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  let recentTutorText = "";
  let signedOff = false;
  let greetingRequested = false;
  let greetingCommand: { id: string; type: "instructions" | "commentary" } | undefined;
  let greetingTimer: ReturnType<typeof setTimeout> | undefined;
  const startTimer = setTimeout(() => {
    emit({ type: "app.error", error: { message: "Voice startup message timed out" } });
    stop();
  }, 5000);
  const transcripts: Transcript[] = [];
  const delegations = new Set<string>();

  function emit(event: object) {
    if (browser.readyState !== 1) return;
    try {
      browser.send(JSON.stringify(event));
    } catch {
      stop();
    }
  }

  function close(socket?: LiveSocket) {
    if (!socket || socket.readyState === 3) return;
    try {
      socket.close(1000, "Call ended");
    } catch {
      return;
    }
  }

  function clearGreeting() {
    clearTimeout(greetingTimer);
    greetingCommand = undefined;
  }

  function sendCommentary(delegationID: string | null, content: string, lastEventID?: string, kind: "commentary" | "thinking" = "commentary") {
    const chunks = [...commentaryChunks(content)];
    chunks.forEach((chunk, i) => {
      gateway?.send(
        JSON.stringify({
          type: `session.${kind}.append`,
          event_id: i === chunks.length - 1 && lastEventID ? lastEventID : crypto.randomUUID(),
          delegation_id: delegationID,
          content: chunk,
        }),
      );
    });
  }

  let saveChain: Promise<void> = Promise.resolve();
  /** Saves the set and current word, so the next call picks up exactly here. */
  function saveState() {
    const active = learner;
    if (!active?.sessionId) return;
    const update = {
      summary: encodeSet(active, current?.slug ?? null),
      ended_at: new Date().toISOString(),
      items_reviewed: active.reviewed,
      items_correct: active.correct,
    };
    const id = active.sessionId;
    saveChain = saveChain
      .then(async () => {
        const { error } = await active.db.from("study_sessions").update(update).eq("id", id);
        if (error) console.error("Could not save voice progress", error.message);
      })
      .catch(() => undefined);
    execution.waitUntil(saveChain);
  }

  /** Gives the tutor a word: the facts silently, then a short line to say aloud right away. */
  function sendWord(delegationID: string | null, brief: string, spoken: string, lastEventID?: string) {
    sendCommentary(delegationID, brief, undefined, "thinking");
    sendCommentary(delegationID, spoken, lastEventID);
    const word = current ? learner?.words.get(current.slug)?.word : undefined;
    armNudge(spoken, word);
  }

  function sendInstruction(content: string) {
    if (closing || gateway?.readyState !== 1) return;
    const bytes = new TextEncoder().encode(content);
    gateway.send(
      JSON.stringify({
        type: "session.instructions.append",
        event_id: crypto.randomUUID(),
        delegation_id: null,
        content: bytes.length > 480 ? new TextDecoder().decode(bytes.slice(0, 470)).replace(/\uFFFD$/, "") : content,
      }),
    );
  }

  /** The new word the tutor hasn't said aloud yet, and what the tutor has said since it arrived. */
  let nudgeWord: string | undefined;
  let saidSinceWord = "";
  let nudges = 0;
  /**
   * Backup in case the tutor goes quiet after getting a new word: until the tutor actually says the
   * new word (or the learner speaks), keep reminding it to carry on. A short "Nice work" bridge
   * that finishes after the word arrived does not count.
   */
  function armNudge(spoken: string, word?: string) {
    clearTimeout(nudgeTimer);
    if (word !== undefined) {
      nudgeWord = word.toLowerCase();
      saidSinceWord = "";
      nudges = 0;
    }
    nudgeTimer = setTimeout(() => {
      if (closing || gateway?.readyState !== 1 || nudges >= 3) return;
      nudges += 1;
      sendInstruction(`Keep the lesson moving without waiting for the learner. Say this now: ${spoken}`);
      armNudge(spoken);
    }, 4000);
  }
  function clearNudge() {
    clearTimeout(nudgeTimer);
    nudgeWord = undefined;
  }

  /** What the tutor has said in its current turn, since the learner last spoke. */
  let tutorTurn = "";
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let stalls = 0;
  /**
   * Backup in case the tutor finishes a word but goes quiet without asking the next question or
   * delegating (for example after "Let's move on"). Silence after a question is the learner
   * thinking, so it's left alone.
   */
  function armStall() {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (closing || signedOff || nudgeWord || pendingDelegations > 0 || stalls >= 2) return;
      if (/\?\s*$/.test(tutorTurn.trim())) return;
      stalls += 1;
      sendInstruction(
        "Don't wait for the learner to say next. If you've finished the current word, delegate to the backend now to get the next word. Otherwise ask your next question.",
      );
      armStall();
    }, 6000);
  }

  function emitProgress() {
    if (!learner) return;
    const word = current ? learner.words.get(current.slug) : undefined;
    emit({
      type: "app.voice.progress",
      progress: {
        set_number: learner.set.setNumber,
        done: doneCount(learner.set),
        set_size: learner.set.words.length,
        word: word?.word ?? null,
        mode: current?.mode ?? "teach",
      },
    });
  }

  /** Makes `entry` the current word and returns its briefing and spoken introduction. */
  function startWord(entry: SetWord, note?: string, lead?: string) {
    const word = learner!.words.get(entry.slug)!;
    const mode = modeFor(entry);
    current = { slug: entry.slug, startIndex: transcripts.length, quickCheck: mode !== "teach", mode };
    emitProgress();
    saveState();
    return { brief: briefing(learner!, word, entry, note), spoken: spokenIntro(word, mode, lead) };
  }

  function requestGreeting() {
    const content = (
      config.openingInstructions ??
      "Start the conversation now in your configured language and role. Give a brief greeting suited to this app's purpose, ask one relevant opening question, then listen."
    ).trim();
    if (!content || !browserReady || !sessionID || !learner || greetingRequested || closing) return;
    greetingRequested = true;
    if (new TextEncoder().encode(content).length > 480) {
      emit({ type: "app.greeting.error", error: { message: "The opening instructions are too long" } });
      return;
    }
    greetingCommand = { id: crypto.randomUUID(), type: "instructions" };
    greetingTimer = setTimeout(() => {
      clearGreeting();
      emit({ type: "app.greeting.error", error: { message: "The opening could not be confirmed" } });
    }, 10_000);
    gateway?.send(
      JSON.stringify({
        type: "session.instructions.append",
        event_id: greetingCommand.id,
        delegation_id: null,
        content,
      }),
    );
  }

  function finish() {
    if (finished) return;
    finished = closing = true;
    clearTimeout(startTimer);
    clearTimeout(startupTimer);
    clearTimeout(closeTimer);
    clearTimeout(nudgeTimer);
    clearTimeout(stallTimer);
    clearGreeting();
    setupAbort.abort();
    close(gateway);
    close(browser);
    finishDrain?.();
  }

  function stop() {
    if (closing) return;
    closing = true;
    clearTimeout(startupTimer);
    clearTimeout(startTimer);
    clearTimeout(nudgeTimer);
    clearTimeout(stallTimer);
    clearGreeting();
    if (gateway?.readyState === 1) {
      execution.waitUntil(
        new Promise<void>((resolve) => {
          finishDrain = resolve;
        }),
      );
      closeTimer = setTimeout(finish, 15_000);
      try {
        gateway.send(JSON.stringify({ type: "session.close" }));
      } catch {
        finish();
      }
    } else {
      finish();
    }
  }

  /**
   * Grades a finished word in the background. The conversation has already moved on, so a slow
   * grader never makes the learner wait.
   */
  function gradeInBackground(word: CurrentWord, endIndex: number, offsetMs: number | undefined) {
    const active = learner!;
    const task = (async () => {
      // Let the learner's last words finish transcribing.
      await sleep(1500);
      const late = transcripts
        .slice(endIndex)
        .filter((t) => t.role === "user" && (typeof offsetMs !== "number" || t.start_ms <= offsetMs));
      const text = transcriptText([...transcripts.slice(word.startIndex, endIndex), ...late]);
      const entry = active.words.get(word.slug)!;
      const grade = await gradeVoiceWord({
        reference: wordReference(entry),
        transcript: text,
        quickCheck: word.quickCheck,
        signal: AbortSignal.timeout(45_000),
      });
      const verdict: Verdict = grade.learner_attempted ? grade.definition_verdict : "skipped";
      const hints = grade.hints_used;
      await applyReview(active.db, active.userId, {
        itemType: "word",
        itemId: entry.id,
        skill: "recall",
        activity: "voice",
        verdict,
        hintsUsed: hints,
        response: grade.learner_definition,
        feedback: grade.feedback,
        misconception: grade.misconception,
        source: "voice",
        sessionId: active.sessionId,
      });
      if (grade.explained_origin && grade.origin_verdict) {
        await applyReview(active.db, active.userId, {
          itemType: "word",
          itemId: entry.id,
          skill: "root_recognition",
          activity: "voice",
          verdict: grade.origin_verdict,
          hintsUsed: hints,
          response: grade.learner_definition,
          feedback: grade.feedback,
          source: "voice",
          sessionId: active.sessionId,
        });
      }
      if (!recordResult(active.set, word.slug, verdict, hints) && lateGrades.has(word.slug)) {
        // Its set already ended. A miss comes back in the current set if there's room, else the next.
        const carries = lateGrades.get(word.slug)!;
        lateGrades.delete(word.slug);
        const inSet = active.set.words.some((w) => w.slug === word.slug);
        if (!isClean(verdict, hints) && carries < MAX_CARRIES && !inSet) {
          const added = addWord(active.set, blankWord(word.slug, "retry", active.set.clock + RETEST_GAP, carries + 1));
          if (!added) active.carry.push({ slug: word.slug, carries });
        }
      }
      active.reviewed += 1;
      if (verdict === "correct" && hints === 0) active.correct += 1;
      saveState();
      const saved: SavedAttempt = { word: entry.word, verdict: hints > 0 && verdict === "correct" ? "partial" : verdict, feedback: grade.feedback };
      emit({ type: "app.voice.saved", saved });
      emitProgress();
    })()
      .catch((error) => {
        console.error("Voice grading failed", error);
        emit({ type: "app.voice.save_failed", word: active.words.get(word.slug)?.word ?? word.slug });
      })
      .finally(() => {
        if (grading.get(word.slug) === task) grading.delete(word.slug);
      });
    grading.set(word.slug, task);
    execution.waitUntil(task);
    return task;
  }

  function deliver(delegationID: string, content: string) {
    if (closing) return;
    if (gateway?.readyState !== 1) return stop();
    try {
      sendCommentary(delegationID, content);
    } catch {
      stop();
    }
  }

  async function handleDelegation(event: ProviderEvent) {
    const id = event.delegation?.id;
    if (!id || closing || !learner) return;
    const active = learner;
    const endIndex = transcripts.length;
    const finishing = current;

    if (finishing) {
      const answered = transcripts.slice(finishing.startIndex).some((t) => t.role === "user" && !t.listeningSound && t.text.trim());
      if (!answered) {
        const word = active.words.get(finishing.slug)!;
        return deliver(id, `Nothing to save yet: the learner has not answered "${word.word}". Keep working on this word with them.`);
      }
      gradeInBackground(finishing, endIndex, event.offset_ms);
    }

    // Pick the next word right away. Words still being graded are skipped.
    let pick = nextWord(active.set, new Set(grading.keys()));
    let note: string | undefined;
    let lead: string | undefined;
    if (!pick) {
      // Nothing left to ask in this set except words still being graded. Don't make the learner
      // wait for those grades: start the next set now. A late miss joins the set after that.
      for (const w of active.set.words) {
        if (!isOpen(w) || !grading.has(w.slug)) continue;
        lateGrades.set(w.slug, w.carries);
        w.status = "done";
      }
      const finishedSet = active.set.setNumber;
      const justAsked = finishing?.slug ?? active.set.lastSlug;
      startNextSet(active);
      await topUpSet(active);
      if (closing) return;
      // Never open the new set with the word that was just asked.
      active.set.lastSlug = justAsked;
      pick = nextWord(active.set, new Set(grading.keys()));
      note = `The learner just finished set ${finishedSet}.`;
      lead = `That's set ${finishedSet} done! On to set ${active.set.setNumber}. First word:`;
    }
    if (!pick) {
      return deliver(id, "There are no more words available right now. Congratulate the learner on their progress and wrap up the session.");
    }
    const next = startWord(pick, note, lead);
    if (closing) return;
    if (gateway?.readyState !== 1) return stop();
    try {
      sendWord(id, next.brief, next.spoken);
    } catch {
      stop();
    }
  }

  function receiveGateway(data: unknown) {
    try {
      if (typeof data !== "string" || data.length > 1024 * 1024) throw new Error("Invalid voice event");
      const event: ProviderEvent = JSON.parse(data);
      if (browser.readyState === 1) browser.send(data);
      if (event.type === "session.closed") return finish();
      if (event.type === "gateway.session.closing" || event.type === "gateway.error" || event.type === "app.error") {
        return stop();
      }
      if (closing) return;
      if (event.type === "gateway.session.created") {
        sessionID = event.session?.id;
        clearTimeout(startupTimer);
        requestGreeting();
      }
      if (
        greetingCommand &&
        event.type === `session.${greetingCommand.type}.appended` &&
        event.client_event_id === greetingCommand.id
      ) {
        if (greetingCommand.type === "instructions") {
          greetingCommand = { id: crypto.randomUUID(), type: "commentary" };
          const resume = learner!.set.words.find((w) => w.slug === learner!.resumeSlug && isOpen(w));
          const first = resume ?? nextWord(learner!.set);
          if (first) {
            const resuming = learner!.set.words.some((w) => w.asks > 0);
            const done = doneCount(learner!.set);
            const word = startWord(
              first,
              resuming ? "The learner is resuming this set from an earlier session." : undefined,
              resume ? "Let's go back to" : "First word:",
            );
            const hello = resuming
              ? `Welcome back! Let's pick up set ${learner!.set.setNumber} right where you left off. You've finished ${done} of ${learner!.set.words.length} words so far.`
              : "Hi, I'm Lexi, your GRE vocabulary tutor. Let's get through as many words as we can.";
            sendWord(null, word.brief, `${hello} ${word.spoken}`, greetingCommand.id);
          } else {
            sendCommentary(null, "Greet the learner and say there are no words available right now.", greetingCommand.id);
          }
        } else {
          clearGreeting();
          emit({ type: "app.greeting.accepted" });
        }
      } else if (greetingCommand && event.type === "error" && event.error?.client_event_id === greetingCommand.id) {
        clearGreeting();
        emit({ type: "app.greeting.error", error: { message: event.error.message ?? "The opening was rejected" } });
      }
      if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
        const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
        if (!event.delta?.trim()) return;
        if (role === "user" && !isListeningSound(event.delta)) {
          clearNudge();
          clearTimeout(stallTimer);
          tutorTurn = "";
          stalls = 0;
        }
        if (role === "assistant") {
          if (nudgeWord) {
            saidSinceWord = (saidSinceWord + event.delta).slice(-300).toLowerCase();
            if (saidSinceWord.includes(nudgeWord)) clearNudge();
          }
          tutorTurn = (tutorTurn + event.delta).slice(-300);
          armStall();
          recentTutorText = (recentTutorText + event.delta).slice(-200);
          if (!signedOff && /see you next time/i.test(recentTutorText)) {
            signedOff = true;
            // Let the goodbye finish playing, then end the call.
            setTimeout(() => emit({ type: "app.voice.finished" }), 4000);
          }
        }
        transcripts.push({
          role,
          text: event.delta,
          start_ms: event.start_ms ?? 0,
          end_ms: event.end_ms ?? 0,
          listeningSound: role === "user" && isListeningSound(event.delta),
        });
      } else if (event.type === "session.delegation.created") {
        const id = event.delegation?.id;
        if (id && event.delegation?.target === "client" && !delegations.has(id)) {
          delegations.add(id);
          pendingDelegations += 1;
          clearTimeout(stallTimer);
          emit({ type: "app.delegation.pending", delegation_id: id });
          delegationChain = delegationChain
            .then(() => handleDelegation(event))
            .finally(() => {
              pendingDelegations -= 1;
            })
            .catch((error) => {
              console.error("Voice delegation failed", error);
              if (!closing) deliver(id, "Saving that word failed. Tell the learner briefly, then keep practicing the current word.");
            });
        }
      }
    } catch {
      emit({ type: "app.error", error: { message: "Invalid voice event or lost connection" } });
      stop();
    }
  }

  async function startSession(sdp: string, token: unknown) {
    if (closing || browser.readyState !== 1) return;
    const auth = typeof token === "string" ? await userClientFromToken(token) : null;
    if (!auth) throw new Error("Please sign in again to use the voice tutor.");
    if (closing || browser.readyState !== 1) return;
    clearTimeout(startTimer);
    startupTimer = setTimeout(() => {
      emit({ type: "app.error", error: { message: "Voice startup timed out" } });
      stop();
    }, 40_000);
    // Load the learner's words and set while the voice line connects.
    const preparing = prepareLearner(auth);
    preparing.catch(() => undefined);
    const accepted = await connect(
      new URL(`${gatewayAPIBase(config.baseURL)}/live/sessions`).href,
      {
        "Lovable-API-Key": config.key,
        "X-Lovable-AIG-SDK": "fetch",
        "X-Lovable-AIG-Run-ID": runID,
      },
      setupAbort.signal,
    );
    if (closing || browser.readyState !== 1) {
      close(accepted);
      return;
    }
    gateway = accepted;
    gateway.onMessage(receiveGateway);
    gateway.onClose(finish);
    gateway.onError(() => {
      emit({ type: "app.error", error: { message: "Voice gateway connection failed" } });
      stop();
    });
    gateway.send(
      JSON.stringify({
        type: "session.start",
        session: {
          model: config.liveModel,
          instructions: conversationInstructions,
          audio: { output: { voice: "marin" } },
          delegation: { type: "client" },
        },
        transport: { type: "webrtc", sdp },
      }),
    );
    learner = await preparing;
    if (closing) return;
    emitProgress();
    requestGreeting();
  }

  browser.onMessage((data) => {
    try {
      if (typeof data !== "string" || data.length > 64 * 1024) throw new Error("Invalid client message");
      const event = JSON.parse(data);
      if (event.type === "session.close") return stop();
      if (closing) return;
      if (!gateway) {
        if (starting || event.type !== "app.start" || typeof event.sdp !== "string" || !event.sdp.trim()) {
          throw new Error("Voice startup message required");
        }
        starting = true;
        execution.waitUntil(
          startSession(event.sdp, event.token).catch((error) => {
            if (!closing)
              emit({
                type: "app.error",
                error: { message: error instanceof Error ? error.message : "Voice startup failed" },
              });
            stop();
          }),
        );
        return;
      }
      if (event.type === "app.ready") {
        browserReady = true;
        requestGreeting();
        return;
      }
      if (event.type !== "gateway.heartbeat") {
        throw new Error("Unsupported client event");
      }
      if (gateway.readyState !== 1) return stop();
      gateway.send(data);
    } catch {
      emit({ type: "app.error", error: { message: "Voice connection could not be started or continued" } });
      stop();
    }
  });
  browser.onClose(stop);
  browser.onError(stop);
}
