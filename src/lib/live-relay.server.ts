import process from "node:process";
import { gradeVoiceWord } from "./ai.server";
import { applyReview, buildQueue, loadWordsWithParts, selectAll, wordReference, type WordWithParts } from "./learning.server";
import { userClientFromToken, type DB } from "./supabase-user.server";
import {
  MASTERY_STREAK,
  SET_SIZE,
  fillSet,
  masteredCount,
  newSet,
  nextWord,
  recordResult,
  remaining,
  replaySets,
  setComplete,
  type SetWord,
  type Verdict,
  type VoiceSet,
} from "./voice-set";

type Learner = {
  db: DB;
  userId: string;
  words: Map<string, WordWithParts>;
  set: VoiceSet;
  /** Words from sets the learner already finished; never reused in a new set. */
  finished: Set<string>;
};
/** The word the tutor is working on right now. */
type CurrentWord = { slug: string; startIndex: number; quickCheck: boolean };
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
    "Greet the learner warmly and briefly as Lexi, their GRE vocabulary tutor. In one sentence say you'll work through a set of 10 words together until each one sticks. Then go straight into the first word from the word briefing.",
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

You get a WORD BRIEFING for every word. It holds the verified definition, example sentence, word parts, etymology, the learner's progress and the mode. Use only those facts. Never invent definitions or etymologies, and never read the briefing's labels aloud.

MODE TEACH (first time with this word):
1. Lead with the roots. Say the word clearly, break it into its parts from the briefing and give each part's meaning, then ask: "Given those pieces, what do you think it means?" For example: "Benevolent. Bene means well, vol means wish, and ent makes it describe a person. Put those together. What do you think it means?" Never give the definition first. If the briefing lists no word parts, say so briefly and ask what they think it means.
2. If they are unsure or only partly right, nudge them to connect the pieces (for example: "So someone who wishes others well is...?") and let them try again. Give at most two extra clues.
3. Tell them honestly how they did: confirm what was right, correct what was off, then give the verified definition and read the example sentence. Point out exactly how each part builds the meaning.
4. Ask them to say the definition back in their own words. It must capture the core meaning.
5. Ask them to use the word in their own sentence. If it misuses the word, explain why and ask for another. If you are still not sure they understand, check another way, such as a quick scenario or asking for an opposite.
6. Delegate only after the learner has BOTH stated the definition correctly AND used the word correctly in a sentence of their own.

MODE QUICK CHECK (a word they have seen before):
1. Ask them to define it without giving the roots first. If they are stuck, remind them of the roots and ask what the pieces suggest.
2. If they miss it, correct it with the verified definition and example and show how the roots build the meaning, then have them say the definition back correctly.
3. Ask them to use it in a sentence. If the sentence is wrong, explain and ask for another.
4. Delegate only after they have BOTH stated the definition correctly AND used the word correctly in a sentence.

No skipping: never move on until both the definition and the sentence are correct. If the learner asks to skip or move on early, encourage them, give another clue or a simpler example, and keep working on the word together. Stay patient and upbeat.

Grading: judge every answer yourself against the verified definition and react right away. Never wait for the backend before giving feedback. Be honest: say clearly when an answer is partly right or wrong, and praise only correct answers.

Keep it flowing:
- Keep each reply short: one or two sentences and one question at a time.
- When you delegate, say a short bridge such as "Nice work, let's keep going." The next briefing arrives in a moment. Introduce the next word as soon as it arrives, without waiting for the learner and without asking if they are ready.
- Mention progress now and then using the briefing, for example "That's four of ten mastered."
- If the learner goes off topic or asks a question, answer briefly, then return to the word.

Set rules: words come in sets of 10. A word is mastered after the learner defines it correctly with no hints ${MASTERY_STREAK} times in a row. Missed words come back later in the set. A new set starts only when every word in the set is mastered.

Backchannel policy: Use moderate neutral listening sounds without taking over.
Interruption policy: Stop your answer and listen when the learner interrupts.
Delegation policy:
Backend tools: Save the finished word's result to the learner's progress and return the briefing for the next word.
Delegate to the backend when: The learner has correctly stated the definition AND correctly used the word in their own sentence. Never delegate before both are done, even if the learner asks to skip.
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

async function prepareLearner(auth: { db: DB; userId: string }): Promise<Learner> {
  const [all, events] = await Promise.all([
    cachedWords(auth.db),
    selectAll(
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
    ),
  ]);
  const words = new Map(all.map((w) => [w.slug, w]));
  const slugById = new Map(all.map((w) => [w.id, w.slug]));
  const verdicts = new Set<Verdict>(["correct", "partial", "incorrect", "skipped"]);
  const answers = events.flatMap((e) => {
    const slug = slugById.get(e.item_id);
    const verdict = e.verdict as Verdict;
    return slug && verdicts.has(verdict) ? [{ slug, verdict, hintsUsed: e.hints_used ?? 0 }] : [];
  });
  const { set, finished } = replaySets(answers);
  const learner: Learner = { ...auth, words, set, finished };
  await topUpSet(learner);
  return learner;
}

/** Fills open slots in the current set: due and weak words first, then new words. */
async function topUpSet(learner: Learner) {
  if (learner.set.words.length >= SET_SIZE) return;
  const taken = (slug: string) => learner.finished.has(slug) || learner.set.words.some((w) => w.slug === slug);
  const { items } = await buildQueue(learner.db, learner.userId, { focus: "mixed", minutes: 30 });
  const picks: string[] = [];
  for (const i of items) if (!taken(i.word.slug) && !picks.includes(i.word.slug)) picks.push(i.word.slug);
  fillSet(learner.set, picks);
  if (learner.set.words.length < SET_SIZE) {
    for (const w of learner.words.values()) {
      if (learner.set.words.length >= SET_SIZE) break;
      if (!taken(w.slug)) fillSet(learner.set, [w.slug]);
    }
  }
}

function briefing(learner: Learner, word: WordWithParts, entry: SetWord, note?: string) {
  const set = learner.set;
  const lines = [
    "WORD BRIEFING (verified facts for you only; do not read these labels aloud)",
    entry.asks === 0
      ? "Mode: TEACH. First time with this word."
      : `Mode: QUICK CHECK. Seen ${entry.asks} time${entry.asks === 1 ? "" : "s"} before.`,
    `Word: ${word.word} (${word.part_of_speech})`,
    `Definition: ${word.definition}`,
    `Plain English: ${word.plain_english}`,
  ];
  if (word.examples?.[0]) lines.push(`Example sentence: ${word.examples[0]}`);
  if (word.parts.length) {
    lines.push(
      "Word parts: " +
        word.parts.map((p) => `${p.surface} = "${p.root.meaning}" (${p.root.kind}, ${p.root.origin}): ${p.contribution}`).join(" | "),
    );
  }
  if (word.etymology) lines.push(`Etymology: ${word.etymology}`);
  if (word.confused_note) lines.push(`Commonly confused: ${word.confused_note}`);
  lines.push(
    `Progress: set ${set.setNumber}, ${masteredCount(set)} of ${set.words.length} words mastered. ` +
      `This word needs ${remaining(entry)} more clean correct answer${remaining(entry) === 1 ? "" : "s"}.`,
  );
  if (note) lines.push(note);
  return lines.join("\n");
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
  let delegationChain: Promise<void> = Promise.resolve();
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

  function sendCommentary(delegationID: string | null, content: string, lastEventID?: string) {
    const chunks = [...commentaryChunks(content)];
    chunks.forEach((chunk, i) => {
      gateway?.send(
        JSON.stringify({
          type: "session.commentary.append",
          event_id: i === chunks.length - 1 && lastEventID ? lastEventID : crypto.randomUUID(),
          delegation_id: delegationID,
          content: chunk,
        }),
      );
    });
  }

  function emitProgress() {
    if (!learner) return;
    const word = current ? learner.words.get(current.slug) : undefined;
    emit({
      type: "app.voice.progress",
      progress: {
        set_number: learner.set.setNumber,
        mastered: masteredCount(learner.set),
        set_size: learner.set.words.length,
        word: word?.word ?? null,
        mode: current?.quickCheck ? "review" : "teach",
      },
    });
  }

  /** Makes `entry` the current word and returns its briefing for the tutor. */
  function startWord(entry: SetWord, note?: string) {
    const word = learner!.words.get(entry.slug)!;
    current = { slug: entry.slug, startIndex: transcripts.length, quickCheck: entry.asks > 0 };
    emitProgress();
    return briefing(learner!, word, entry, note);
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
        });
      }
      recordResult(active.set, word.slug, verdict, hints);
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
    if (!pick && grading.size) {
      // Only words being graded are left open: their grades decide whether the set is done.
      await Promise.race([Promise.allSettled([...grading.values()]), sleep(30_000)]);
      if (closing) return;
      pick = nextWord(active.set);
    }
    let note: string | undefined;
    if (!pick && setComplete(active.set)) {
      active.set.words.forEach((w) => active.finished.add(w.slug));
      active.set = newSet([], active.set.setNumber + 1);
      await topUpSet(active);
      if (closing) return;
      pick = nextWord(active.set);
      note = `The learner just mastered every word in set ${active.set.setNumber - 1}. Congratulate them warmly, then start set ${active.set.setNumber} with this word.`;
    }
    if (!pick) {
      return deliver(id, "There are no more words available right now. Congratulate the learner on their progress and wrap up the session.");
    }
    deliver(id, startWord(pick, note ?? "Introduce this word now."));
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
          const first = nextWord(learner!.set);
          const brief = first
            ? startWord(first, learner!.set.words.some((w) => w.asks > 0) ? "The learner is resuming this set from an earlier session." : undefined)
            : "There are no words available right now. Apologize briefly.";
          sendCommentary(null, `${brief}\n\nBegin the conversation now, following the instructions provided.`, greetingCommand.id);
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
          emit({ type: "app.delegation.pending", delegation_id: id });
          delegationChain = delegationChain
            .then(() => handleDelegation(event))
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
