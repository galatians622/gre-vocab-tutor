import { describe, expect, it } from "vitest";
import {
  type VoiceAnswer,
  doneCount,
  fillSet,
  newSet,
  nextSet,
  nextWord,
  recordResult,
  replaySets,
  setComplete,
} from "./voice-set";

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

const noBackToBack = (asked: string[]) => asked.every((s, i) => i === 0 || asked[i - 1] !== s);

describe("voice word sets", () => {
  it("holds at most 10 unique words", () => {
    expect(ten().words).toHaveLength(10);
    expect(fillSet(newSet(["a"]), slugs).words).toHaveLength(10);
    expect(newSet(["a", "a", "b", "a"]).words.map((w) => w.slug)).toEqual(["a", "b"]);
  });

  it("all right first time: each word is asked twice in total, then the set is done", () => {
    const s = ten();
    const asked = run(s, 100, () => true);
    expect(asked).toHaveLength(20);
    for (const slug of slugs.slice(0, 10)) expect(asked.filter((x) => x === slug)).toHaveLength(2);
    expect(setComplete(s)).toBe(true);
    expect(noBackToBack(asked)).toBe(true);
  });

  it("introduces new words before the one check of a first-try word", () => {
    const asked = run(ten(), 5, () => true);
    expect(asked).toEqual(["w0", "w1", "w2", "w3", "w4"]);
  });

  it("brings a missed word back after three other words, and one right answer finishes it", () => {
    const s = ten();
    const asked = run(s, 5, (slug, n) => !(slug === "w0" && n === 0));
    expect(asked).toEqual(["w0", "w1", "w2", "w3", "w0"]);
    expect(s.words[0]!.status).toBe("done");
  });

  it("a word missed twice stops holding up the set and moves to the next set", () => {
    const s = ten();
    const asked = run(s, 100, (slug) => slug !== "w0");
    expect(asked.filter((x) => x === "w0")).toHaveLength(2);
    expect(setComplete(s)).toBe(true);
    const next = nextSet(s);
    expect(next.words.map((w) => w.slug)).toEqual(["w0"]);
    expect(next.words[0]!.status).toBe("retry");
  });

  it("a word moves to the next set only once", () => {
    const s = ten();
    run(s, 100, (slug) => slug !== "w0");
    const next = fillSet(nextSet(s), slugs.slice(10));
    run(next, 100, (slug) => slug !== "w0");
    expect(setComplete(next)).toBe(true);
    expect(nextSet(next).words).toHaveLength(0);
  });

  it("never gets stuck: a set that is always wrong still finishes quickly", () => {
    const s = ten();
    const asked = run(s, 100, () => false);
    expect(setComplete(s)).toBe(true);
    expect(asked.length).toBeLessThanOrEqual(20);
    expect(noBackToBack(asked)).toBe(true);
  });

  it("never asks the same word twice in a row, even when it is the last one left", () => {
    const s = newSet(["a", "b"]);
    const asked = run(s, 20, (slug, n) => !(slug === "b" && n === 1));
    expect(noBackToBack(asked)).toBe(true);
    expect(setComplete(s)).toBe(true);
  });

  it("hinted correct answers count as a miss", () => {
    const s = ten();
    recordResult(s, "w0", "correct", 1);
    expect(s.words[0]!.status).toBe("retry");
  });

  it("skips words that are still being graded", () => {
    const s = newSet(["a", "b"]);
    expect(nextWord(s, "a")!.slug).toBe("b");
    expect(nextWord(newSet(["a"]), "a")).toBeNull();
  });

  it("counts finished words", () => {
    const s = ten();
    const asked = run(s, 10, () => true);
    // Five new words, then a quick check on each of those five.
    expect(asked).toEqual(["w0", "w1", "w2", "w3", "w4", "w0", "w1", "w2", "w3", "w4"]);
    expect(doneCount(s)).toBe(5);
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
    expect(set.words[0]!.status).toBe("retry");
  });
});
