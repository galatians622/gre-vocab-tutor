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

vi.mock("./supabase-user.server", () => ({
  userClientFromToken: async () => ({ db: {}, userId: "u1" }),
}));
vi.mock("./learning.server", () => ({
  loadWordsWithParts: async () => words,
  selectAll: async () => [],
  buildQueue: async () => ({ items: [] }),
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

import { bindLiveConnection, type LiveSocket } from "./live-relay.server";

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
    gateway.push({ type: "session.output_transcript.delta", delta: "Hi, first word", start_ms: 1 });
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
