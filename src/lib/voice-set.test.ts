import { describe, expect, it } from "vitest";
import { isMastered, newSet, nextWord, recordResult, setComplete } from "./voice-set";

const ten = Array.from({ length: 12 }, (_, i) => `w${i}`);

describe("voice word sets", () => {
  it("holds at most 10 words", () => {
    expect(newSet(ten).words).toHaveLength(10);
  });
  it("first-try correct word needs one more correct answer", () => {
    const s = newSet(["a", "b"]);
    const w = recordResult(s, "a", "correct", 0)!;
    expect(isMastered(w)).toBe(false);
    recordResult(s, "a", "correct", 0);
    expect(isMastered(w)).toBe(true);
  });
  it("partial word needs three correct in a row", () => {
    const s = newSet(["a", "b"]);
    const w = recordResult(s, "a", "partial", 0)!;
    recordResult(s, "a", "correct", 0);
    recordResult(s, "a", "correct", 0);
    expect(isMastered(w)).toBe(false);
    recordResult(s, "a", "correct", 0);
    expect(isMastered(w)).toBe(true);
  });
  it("a miss resets the streak to zero", () => {
    const s = newSet(["a"]);
    const w = recordResult(s, "a", "incorrect", 0)!;
    recordResult(s, "a", "correct", 0);
    recordResult(s, "a", "correct", 0);
    recordResult(s, "a", "incorrect", 0);
    expect(w.streak).toBe(0);
  });
  it("hinted correct answers do not count", () => {
    const s = newSet(["a"]);
    const w = recordResult(s, "a", "correct", 1)!;
    expect(w.firstTryCorrect).toBe(false);
    expect(w.streak).toBe(0);
  });
  it("set is complete only when every word is mastered", () => {
    const s = newSet(["a", "b"]);
    for (let i = 0; i < 2; i++) recordResult(s, "a", "correct", 0);
    expect(setComplete(s)).toBe(false);
    for (let i = 0; i < 2; i++) recordResult(s, "b", "correct", 0);
    expect(setComplete(s)).toBe(true);
  });
  it("does not ask the same word twice in a row when others remain", () => {
    const s = newSet(["a", "b"]);
    recordResult(s, "a", "incorrect", 0);
    expect(nextWord(s)!.slug).toBe("b");
  });
});
