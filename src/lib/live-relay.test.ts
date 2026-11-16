import { afterEach, describe, expect, it, vi } from "vitest";

const words = Array.from({ length: 12 }, (_, i) => ({
  id: `id${i}`,
  slug: `w${i}`,
  word: `word${i}`,
  part_of_speech: "adjective",
  definition: `meaning ${i}`,
  plain_english: `plain ${i}`,
  examples: [`example ${i}`],
  etymology: null,
  confused_note: null,
  parts: [],
}));

const reviews: { itemId: string; skill: string; verdict: string }[] = [];
let gradeDelay = 0;

const sessionRows: { summary: string | null }[] = [];
const updates: { summary: string }[] = [];

/** Just enough of the Supabase query builder for the relay's study_sessions calls. */
function fakeDb() {
  const query = (op: "select" | "insert" | "update", payload?: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "order", "limit"]) q[m] = () => q;
    q["maybeSingle"] = async () => ({ data: sessionRows.at(-1) ?? null, error: null });
    q["single"] = async () => {
      sessionRows.push(payload as { summary: string });
      return { data: { id: `s${sessionRows.length}` }, error: null };
    };
    q["then"] = (resolve: (v: unknown) => void) => {
      if (op === "update") {
        updates.push(payload as { summary: string });
        Object.assign(sessionRows.at(-1)!, payload);
      }
      resolve({ data: null, error: null });
    };
    return q;
  };
  return {
    from: () => ({
      select: () => query("select"),
      insert: (row: unknown) => query("insert", row),
      update: (row: unknown) => query("update", row),
    }),
  };
}

vi.mock("./supabase-user.server", () => ({
  userClientFromToken: async () => ({ db: fakeDb(), userId: "u1" }),
}));
vi.mock("./learning.server", () => ({
  loadWordsWithParts: async () => words,
  selectAll: async () => [],
  buildQueue: async () => ({ items: [] }),
  loadStates: async () => [],
  wordReference: (w: { word: string }) => `Word: ${w.word}`,
  applyReview: async (_db: unknown, _u: string, input: { itemId: string; skill: string; verdict: string }) => {
    reviews.push(input);
    return { grade: 3, due: "" };
  },
}));
vi.mock("./ai.server", () => ({
  gradeVoiceWord: async () => {
    await new Promise((r) => setTimeout(r, gradeDelay));
    return {
      learner_attempted: true,
      definition_verdict: "correct",
      hints_used: 0,
      learner_definition: "x",
      explained_origin: false,
      origin_verdict: null,
      feedback: "Nice",
      misconception: null,
    };
  },
}));

import { bindLiveConnection, decodeSet, type LiveSocket } from "./live-relay.server";

function fakeSocket() {
  const handlers: { message: ((d: unknown) => void)[]; close: (() => void)[] } = { message: [], close: [] };
  const sent: string[] = [];
  const socket: LiveSocket & { sent: string[]; push(d: object): void } = {
    readyState: 1,
    sent,
    send: (d) => void sent.push(d),
    close: () => undefined,
    onMessage: (h) => void handlers.message.push(h),
    onClose: (h) => void handlers.close.push(h),
    onError: () => undefined,
    push: (d) => handlers.message.forEach((h) => h(JSON.stringify(d))),
  };
  return socket;
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const parsed = (s: { sent: string[] }) => s.sent.map((x) => JSON.parse(x));

async function startCall() {
  const browser = fakeSocket();
  const gateway = fakeSocket();
  bindLiveConnection(
    browser,
    { baseURL: "https://x/v1", key: "k", liveModel: "m", backendModel: "b", openingInstructions: "Hi" },
    { waitUntil: () => undefined },
    async () => gateway,
  );
  browser.push({ type: "app.start", sdp: "sdp", token: "a.b.c" });
  await tick(5);
  browser.push({ type: "app.ready" });
  gateway.push({ type: "gateway.session.created", session: { id: "s" } });
  const instructions = parsed(gateway).find((e) => e.type === "session.instructions.append");
  gateway.push({ type: "session.instructions.appended", client_event_id: instructions.event_id });
  return { browser, gateway };
}

function commentary(gateway: { sent: string[] }, delegation: string | null, kind = "commentary") {
  return parsed(gateway)
    .filter((e) => e.type === `session.${kind}.append` && e.delegation_id === delegation)
    .map((e) => e.content)
    .join("");
}

afterEach(() => {
  reviews.length = 0;
  sessionRows.length = 0;
  updates.length = 0;
  gradeDelay = 0;
});

describe("voice relay", () => {
  it("briefs the tutor on the first word in the greeting", async () => {
    const { gateway } = await startCall();
    const facts = commentary(gateway, null, "thinking");
    expect(facts).toContain("Word: word0");
    expect(facts).toContain("Definition: meaning 0");
    expect(facts).toContain("Mode: TEACH");
    const spoken = commentary(gateway, null);
    expect(spoken).toContain("First word: word0");
    expect(spoken).not.toContain("Definition:");
  });

  it("saves the grade after the tutor moves on", async () => {
    const { gateway, browser } = await startCall();
    gateway.push({ type: "session.input_transcript.delta", delta: "it means meaning zero", start_ms: 1 });
    gateway.push({ type: "session.delegation.created", delegation: { id: "d1", target: "client" } });
    await tick(1700);
    expect(reviews).toEqual([expect.objectContaining({ itemId: "id0", skill: "recall", verdict: "correct" })]);
    expect(parsed(browser).some((e) => e.type === "app.voice.saved")).toBe(true);
  });

  it("nudges the tutor if it goes quiet after a new word", async () => {
    const { gateway } = await startCall();
    gateway.push({ type: "session.input_transcript.delta", delta: "it means meaning zero", start_ms: 1 });
    gateway.push({ type: "session.delegation.created", delegation: { id: "d1", target: "client" } });
    await tick(5200);
    const nudges = parsed(gateway).filter((e) => e.type === "session.instructions.append" && e.content.includes("word1"));
    expect(nudges).toHaveLength(1);
  }, 10_000);

  it("does not nudge once the tutor is talking", async () => {
    const { gateway } = await startCall();
    gateway.push({ type: "session.output_transcript.delta", delta: "Hi! First word: word0. What do you think it means?", start_ms: 1 });
    await tick(5200);
    expect(parsed(gateway).filter((e) => e.type === "session.instructions.append")).toHaveLength(1); // greeting only
  }, 10_000);

  it("ends the call after the tutor signs off", async () => {
    const { gateway, browser } = await startCall();
    gateway.push({ type: "session.output_transcript.delta", delta: "Great work today. See you next ", start_ms: 1 });
    gateway.push({ type: "session.output_transcript.delta", delta: "time.", start_ms: 2 });
    await tick(4100);
    expect(parsed(browser).some((e) => e.type === "app.voice.finished")).toBe(true);
  }, 10_000);

  it("picks up the same set and word in the next call", async () => {
    const first = await startCall();
    first.gateway.push({ type: "session.input_transcript.delta", delta: "it means meaning zero", start_ms: 1 });
    first.gateway.push({ type: "session.delegation.created", delegation: { id: "d1", target: "client" } });
    await tick(1700); // word0 graded and saved, now on word1
    const saved = JSON.parse(sessionRows.at(-1)!.summary!);
    expect(saved.current).toBe("w1");
    expect(saved.words).toHaveLength(10);

    const second = await startCall();
    const spoken = commentary(second.gateway, null);
    expect(spoken).toContain("Welcome back");
    expect(spoken).toContain("Let's go back to word1");
    const resumed = JSON.parse(sessionRows.at(-1)!.summary!);
    expect(resumed.words.map((w: { slug: string }) => w.slug)).toEqual(saved.words.map((w: { slug: string }) => w.slug));
    expect(resumed.words[0].asks).toBe(1);
    expect(resumed.words[0].status).toBe("check");
  });

  it("converts sets saved under the old three-in-a-row rule", () => {
    const words = Array.from({ length: 10 }, (_, i) => ({ slug: `w${i}`, asks: 4, streak: i < 5 ? 1 : 0, firstTryCorrect: false, lastAskedAt: i }));
    const decoded = decodeSet(JSON.stringify({ v: 1, set_number: 1, words, clock: 40, last_slug: "w9", current: "w5", finished: [] }), () => true)!;
    expect(decoded.set.words.filter((w) => w.status === "done")).toHaveLength(5);
    expect(decoded.set.words.filter((w) => w.status === "retry")).toHaveLength(5);
    expect(decoded.current).toBe("w5");
  });

  it("converts sets saved under the review-round rule and drops duplicate words", () => {
    const words = [
      { slug: "w0", asks: 2, phaseAsks: 1, passed: true },
      { slug: "w1", asks: 3, phaseAsks: 2, passed: false },
      { slug: "w1", asks: 3, phaseAsks: 2, passed: false },
      { slug: "w2", asks: 1, phaseAsks: 0, passed: false },
    ];
    const decoded = decodeSet(JSON.stringify({ v: 2, phase: "review", set_number: 3, words, clock: 9, last_slug: "w0", current: "w2", finished: [] }), () => true)!;
    expect(decoded.set.words.map((w) => [w.slug, w.status])).toEqual([["w0", "done"], ["w1", "retry"], ["w2", "done"]]);
    expect(decoded.current).toBeNull();
  });

  it("keeps nudging after a short bridge until the tutor says the new word", async () => {
    const { gateway } = await startCall();
    gateway.push({ type: "session.input_transcript.delta", delta: "it means meaning zero", start_ms: 1 });
    gateway.push({ type: "session.delegation.created", delegation: { id: "d1", target: "client" } });
    await tick(5);
    gateway.push({ type: "session.output_transcript.delta", delta: "Nice work.", start_ms: 2 }); // bridge, then silence
    await tick(4200);
    const nudges = parsed(gateway).filter((e) => e.type === "session.instructions.append" && e.content.includes("word1"));
    expect(nudges).toHaveLength(1);
  }, 10_000);

  it("prompts the tutor to carry on if it goes quiet without a question", async () => {
    const { gateway } = await startCall();
    gateway.push({ type: "session.output_transcript.delta", delta: "First word: word0. What do you think it means?", start_ms: 1 });
    gateway.push({ type: "session.input_transcript.delta", delta: "it means meaning zero", start_ms: 2 });
    gateway.push({ type: "session.output_transcript.delta", delta: "Exactly right. Let's move on.", start_ms: 3 });
    await tick(6200);
    const prompts = parsed(gateway).filter((e) => e.type === "session.instructions.append" && e.content.includes("delegate"));
    expect(prompts).toHaveLength(1);
  }, 10_000);

  it("leaves the learner to think after a question", async () => {
    const { gateway } = await startCall();
    gateway.push({ type: "session.output_transcript.delta", delta: "First word: word0. What do you think it means?", start_ms: 1 });
    await tick(6200);
    expect(parsed(gateway).filter((e) => e.type === "session.instructions.append")).toHaveLength(1); // greeting only
  }, 10_000);

  it("starts the next set without waiting for the last grade", async () => {
    const set = Array.from({ length: 10 }, (_, i) => ({
      slug: `w${i}`,
      status: i === 9 ? "check" : "done",
      asks: 1,
      misses: 0,
      dueAt: 0,
      firstTryCorrect: true,
      lastAskedAt: i,
      carries: 0,
    }));
    sessionRows.push({ summary: JSON.stringify({ v: 3, set_number: 1, words: set, clock: 10, last_slug: "w8", current: "w9", finished: [], carry: [] }) });
    gradeDelay = 5000;
    const { gateway } = await startCall();
    expect(commentary(gateway, null)).toContain("Let's go back to word9");
    gateway.push({ type: "session.input_transcript.delta", delta: "it means meaning nine", start_ms: 1 });
    gateway.push({ type: "session.delegation.created", delegation: { id: "d1", target: "client" } });
    await tick(20);
    expect(commentary(gateway, "d1")).toContain("set 1 done");
    expect(commentary(gateway, "d1")).toMatch(/word1[01]/);
    const saved = JSON.parse(sessionRows.at(-1)!.summary!);
    expect(saved.set_number).toBe(2);
    expect(new Set(saved.words.map((w: { slug: string }) => w.slug)).size).toBe(saved.words.length);
  });

  it("does not move on before the learner has answered", async () => {
    const { gateway } = await startCall();
    gateway.push({ type: "session.delegation.created", delegation: { id: "d1", target: "client" } });
    await tick(5);
    expect(commentary(gateway, "d1")).toContain("has not answered");
  });
  // Runs last: its slow grade finishes after the test ends.
  it("hands over the next word immediately while the last one is graded in the background", async () => {
    gradeDelay = 5000;
    const { gateway } = await startCall();
    gateway.push({ type: "session.input_transcript.delta", delta: "it means meaning zero", start_ms: 1 });
    gateway.push({ type: "session.delegation.created", delegation: { id: "d1", target: "client" } });
    await tick(5);
    expect(commentary(gateway, "d1", "thinking")).toContain("Word: word1");
    expect(commentary(gateway, "d1")).toContain("Next word: word1");
    expect(reviews).toHaveLength(0); // still grading, the learner did not wait
  });

});

describe("spokenIntro", () => {
  const part = (surface: string, kind: string, meaning: string, origin = "Latin") => ({
    position: 0,
    surface,
    contribution: "",
    root: { id: surface, slug: surface, form: surface, kind, meaning, origin, source_word: null },
  });
  const word = {
    ...words[0],
    word: "benevolent",
    parts: [
      part("bene", "prefix", "well"),
      part("vol", "root", "wish"),
      part("ent", "suffix", "doing"),
    ],
  };

  it("explains each root's meaning and origin before asking for the definition", async () => {
    const { spokenIntro } = await import("./live-relay.server");
    const line = spokenIntro(word as never, "teach");
    expect(line).toBe(
      'Next word: benevolent. bene comes from Latin and means "well". vol comes from Latin and means "wish". The ending -ent means "doing". Given those pieces, what do you think benevolent means?',
    );
  });

  it("gives no roots in review mode", async () => {
    const { spokenIntro } = await import("./live-relay.server");
    expect(spokenIntro(word as never, "review")).not.toContain("Latin");
  });
});
