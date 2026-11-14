import { describe, expect, it } from "vitest";
import { type VoiceAnswer, clearedCount, fillSet, newSet, nextWord, recordResult, replaySets, setComplete } from "./voice-set";

const slugs = Array.from({ length: 12 }, (_, i) => `w${i}`);
const ten = () => newSet(slugs);

/** Asks words in the order the set picks them, answering with `answer(slug, step)`. */
function run(set: ReturnType<typeof newSet>, steps: number, answer: (slug: string, n: number) => boolean) {
  const asked: string[] = [];
  for (let n = 0; n < steps; n++) {
    const w = nextWord(set);
    if (!w) break;
    asked.push(w.slug);
    recordResult(set, w.slug, answer(w.slug, n) ? "correct" : "incorrect", 0);
  }
  return asked;
}

describe("voice word sets", () => {
  it("holds at most 10 words", () => {
    expect(ten().words).toHaveLength(10);
    expect(fillSet(newSet(["a"]), slugs).words).toHaveLength(10);
  });

  it("goes through every word once when all are right the first time", () => {
    const s = ten();
    expect(run(s, 10, () => true)).toEqual(slugs.slice(0, 10));
    expect(s.phase).toBe("review");
  });

  it("brings a missed word back after three other words", () => {
    const s = ten();
    const asked = run(s, 6, (slug, n) => !(slug === "w0" && n === 0));
    expect(asked).toEqual(["w0", "w1", "w2", "w3", "w0", "w4"]);
  });

  it("one right answer on the retest clears the word", () => {
    const s = ten();
    run(s, 5, (slug, n) => !(slug === "w0" && n === 0));
    expect(s.words[0]!.passed).toBe(true);
  });

  it("keeps retesting until the word is right on the first try", () => {
    const s = ten();
    const asked = run(s, 9, (slug, n) => !(slug === "w0" && n < 5));
    expect(asked.filter((x) => x === "w0")).toHaveLength(3); // missed, missed, then right
  });

  it("hinted correct answers do not clear a word", () => {
    const s = ten();
    recordResult(s, "w0", "correct", 1);
    expect(s.words[0]!.passed).toBe(false);
  });

  it("reviews every word once more, then the set is done", () => {
    const s = ten();
    run(s, 10, () => true);
    expect(clearedCount(s)).toBe(0);
    expect(setComplete(s)).toBe(false);
    expect(run(s, 10, () => true)).toEqual(slugs.slice(0, 10));
    expect(setComplete(s)).toBe(true);
  });

  it("misses in the review round come back until right", () => {
    const s = ten();
    run(s, 10, () => true);
    let missed = false;
    const asked = run(s, 20, (slug) => {
      if (slug === "w2" && !missed) return !(missed = true);
      return true;
    });
    expect(asked.filter((x) => x === "w2")).toHaveLength(2);
    expect(setComplete(s)).toBe(true);
  });

  it("skips words that are still being graded", () => {
    const s = newSet(["a", "b"]);
    expect(nextWord(s, "a")!.slug).toBe("b");
    expect(nextWord(newSet(["a"]), "a")).toBeNull();
  });

  it("rebuilds sets from saved answers", () => {
    const answers: VoiceAnswer[] = [...slugs.slice(0, 10), ...slugs.slice(0, 10)].map((slug) => ({
      slug,
      verdict: "correct",
      hintsUsed: 0,
    }));
    answers.push({ slug: "w10", verdict: "partial", hintsUsed: 0 });
    const { set, finished } = replaySets(answers);
    expect(finished.size).toBe(10);
    expect(set.setNumber).toBe(2);
    expect(set.words.map((w) => w.slug)).toEqual(["w10"]);
  });
});
