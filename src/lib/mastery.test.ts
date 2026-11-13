import { describe, expect, it } from "vitest";
import {
  CardState,
  gradeForAttempt,
  isIndependentCorrect,
  newWordAllowance,
  precisionGrade,
  wordMasteryLevel,
  type SkillSnapshot,
} from "./mastery";
import { scheduleReview } from "./srs";

const recall = (over: Partial<SkillSnapshot> = {}): SkillSnapshot => ({
  skill: "recall",
  exposures: 1,
  independent_correct: 0,
  correct_days: [],
  stability: 0,
  state: CardState.New,
  lapses: 0,
  ...over,
});

describe("grading attempts", () => {
  it("a correct answer with hints earns less credit than an independent one", () => {
    expect(gradeForAttempt({ verdict: "correct", hintsUsed: 1 })).toBe(2);
    expect(gradeForAttempt({ verdict: "correct", hintsUsed: 0 })).toBe(3);
    expect(isIndependentCorrect("correct", 1)).toBe(false);
  });

  it("wrong or 'I don't know' answers are graded Again", () => {
    expect(gradeForAttempt({ verdict: "incorrect", hintsUsed: 0 })).toBe(1);
    expect(gradeForAttempt({ verdict: "skipped", hintsUsed: 0 })).toBe(1);
  });

  it("a gist-level definition passes recall loosely but fails precision", () => {
    expect(gradeForAttempt({ verdict: "partial", hintsUsed: 0 })).toBe(2);
    expect(precisionGrade("partial", 0)).toBe(1);
  });
});

describe("mastery levels", () => {
  it("recognizing a word without recalling its definition is not mastery", () => {
    const level = wordMasteryLevel([
      { ...recall(), skill: "recognition", independent_correct: 5, correct_days: ["2026-01-01", "2026-01-03"], stability: 30, state: CardState.Review },
    ]);
    expect(level).toBe("recognized");
  });

  it("one correct recall is not mastery", () => {
    const level = wordMasteryLevel([
      recall({ independent_correct: 1, correct_days: ["2026-01-01"], stability: 30, state: CardState.Review }),
      { ...recall(), skill: "context", independent_correct: 1 },
    ]);
    expect(level).toBe("recalling");
  });

  it("three correct recalls on the same day are not mastery", () => {
    const level = wordMasteryLevel([
      recall({ independent_correct: 3, correct_days: ["2026-01-01"], stability: 30, state: CardState.Review }),
      { ...recall(), skill: "context", independent_correct: 1 },
    ]);
    expect(level).toBe("recalling");
  });

  it("mastery needs repeated recall across days plus another question format", () => {
    const base = recall({
      independent_correct: 3,
      correct_days: ["2026-01-01", "2026-01-04"],
      stability: 12,
      state: CardState.Review,
    });
    expect(wordMasteryLevel([base])).toBe("recalling");
    expect(wordMasteryLevel([base, { ...recall(), skill: "context", independent_correct: 1 }])).toBe("mastered");
  });

  it("forgetting a mastered word drops it out of mastery", () => {
    const mastered = recall({
      independent_correct: 4,
      correct_days: ["2026-01-01", "2026-01-04", "2026-01-15"],
      stability: 40,
      state: CardState.Review,
      last_review: undefined,
    } as Partial<SkillSnapshot>);
    const other = { ...recall(), skill: "context", independent_correct: 1 };
    expect(wordMasteryLevel([mastered, other])).toBe("mastered");

    const lapsed = scheduleReview(
      {
        due: "2026-02-20T00:00:00Z",
        stability: 40,
        difficulty: 5,
        scheduled_days: 40,
        learning_steps: 0,
        reps: 6,
        lapses: 0,
        state: CardState.Review,
        last_review: "2026-01-15T00:00:00Z",
      },
      1,
      new Date("2026-02-20T00:00:00Z"),
    );
    expect(lapsed.stability).toBeLessThan(40);
    expect(lapsed.lapses).toBe(1);
    expect(
      wordMasteryLevel([{ ...mastered, stability: lapsed.stability, state: lapsed.state }, other]),
    ).not.toBe("mastered");
  });
});

describe("daily new-word allowance", () => {
  it("offers the remaining daily goal when reviews are under control", () => {
    expect(newWordAllowance({ dailyGoal: 20, introducedToday: 5, dueReviews: 10 })).toBe(15);
  });
  it("halves new words when reviews reach twice the daily goal", () => {
    expect(newWordAllowance({ dailyGoal: 10, introducedToday: 0, dueReviews: 20 })).toBe(5);
  });
  it("pauses new words when reviews reach five times the daily goal", () => {
    expect(newWordAllowance({ dailyGoal: 10, introducedToday: 0, dueReviews: 50 })).toBe(0);
  });
});

import { rootMasteryLevel } from "./mastery";

describe("root mastery", () => {
  const meaning: SkillSnapshot = {
    skill: "root_meaning",
    exposures: 3,
    independent_correct: 3,
    correct_days: ["2026-01-01", "2026-01-05"],
    stability: 20,
    state: CardState.Review,
    lapses: 0,
  };

  it("knowing the root's meaning and defining one word is not mastery", () => {
    expect(rootMasteryLevel([meaning], { familySize: 20, wordsExplained: 1, attempts: 1, correct: 1 })).toBe("recalling");
  });

  it("requires at least 15 family words explained when the family is large enough", () => {
    expect(rootMasteryLevel([meaning], { familySize: 20, wordsExplained: 14, attempts: 14, correct: 14 })).toBe("recalling");
    expect(rootMasteryLevel([meaning], { familySize: 20, wordsExplained: 15, attempts: 15, correct: 15 })).toBe("mastered");
  });

  it("a smaller family must be explained in full", () => {
    expect(rootMasteryLevel([meaning], { familySize: 6, wordsExplained: 5, attempts: 5, correct: 5 })).toBe("recalling");
    expect(rootMasteryLevel([meaning], { familySize: 6, wordsExplained: 6, attempts: 6, correct: 6 })).toBe("mastered");
  });

  it("needs 80% accuracy across family-word attempts", () => {
    expect(rootMasteryLevel([meaning], { familySize: 15, wordsExplained: 15, attempts: 18, correct: 15 })).toBe("mastered");
    expect(rootMasteryLevel([meaning], { familySize: 15, wordsExplained: 15, attempts: 19, correct: 15 })).toBe("recalling");
  });

  it("explaining many words without recalling the root meaning on two days is not mastery", () => {
    const once = { ...meaning, independent_correct: 1, correct_days: ["2026-01-01"] };
    expect(rootMasteryLevel([once], { familySize: 15, wordsExplained: 15, attempts: 15, correct: 15 })).toBe("recalling");
  });
});
