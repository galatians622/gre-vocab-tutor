import { describe, expect, it } from "vitest";
import { type VoiceAnswer, fillSet, isMastered, newSet, nextWord, recordResult, replaySets, setComplete } from "./voice-set";

const twelve = Array.from({ length: 12 }, (_, i) => `w${i}`);

describe("voice word sets", () => {
  it("holds at most 10 words", () => {
    expect(newSet(twelve).words).toHaveLength(10);
    expect(fillSet(newSet(["a"]), twelve).words).toHaveLength(10);
  });
  it("a word needs three clean correct answers in a row", () => {
    const s = newSet(["a", "b"]);
    const w = recordResult(s, "a", "correct", 0)!;
    recordResult(s, "a", "correct", 0);
    expect(isMastered(w)).toBe(false);
    recordResult(s, "a", "correct", 0);
    expect(isMastered(w)).toBe(true);
  });
  it("a partial answer resets the streak", () => {
    const s = newSet(["a"]);
    const w = recordResult(s, "a", "correct", 0)!;
    recordResult(s, "a", "correct", 0);
    recordResult(s, "a", "partial", 0);
    expect(w.streak).toBe(0);
    expect(isMastered(w)).toBe(false);
  });
  it("hinted correct answers do not count", () => {
    const s = newSet(["a"]);
    const w = recordResult(s, "a", "correct", 1)!;
    expect(w.streak).toBe(0);
  });
  it("set is complete only when every word is mastered", () => {
    const s = newSet(["a", "b"]);
    for (let i = 0; i < 3; i++) recordResult(s, "a", "correct", 0);
    expect(setComplete(s)).toBe(false);
    for (let i = 0; i < 3; i++) recordResult(s, "b", "correct", 0);
    expect(setComplete(s)).toBe(true);
  });
  it("does not ask the same word twice in a row when others remain", () => {
    const s = newSet(["a", "b"]);
    recordResult(s, "a", "incorrect", 0);
    expect(nextWord(s)!.slug).toBe("b");
  });
  it("skips a word that is still being graded", () => {
    const s = newSet(["a", "b"]);
    expect(nextWord(s, "a")!.slug).toBe("b");
    expect(nextWord(newSet(["a"]), "a")).toBeNull();
  });
  it("resumes the current set from saved answers", () => {
    const answers: VoiceAnswer[] = twelve.slice(0, 10).flatMap((slug) =>
      [0, 1, 2].map(() => ({ slug, verdict: "correct" as const, hintsUsed: 0 })),
    );
    answers.push({ slug: "w10", verdict: "partial", hintsUsed: 0 });
    answers.push({ slug: "w3", verdict: "incorrect", hintsUsed: 0 }); // review of a finished word
    const { set, finished } = replaySets(answers);
    expect(finished.size).toBe(10);
    expect(set.setNumber).toBe(2);
    expect(set.words.map((w) => w.slug)).toEqual(["w10"]);
    expect(set.words[0]!.asks).toBe(1);
  });
});
