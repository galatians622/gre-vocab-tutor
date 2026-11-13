/**
 * Learning rules for LexiMind. Pure functions, shared by focused study, the voice tutor and tests.
 *
 * Key distinctions the app must preserve:
 *  exposure (seen it) < recognition (can pick/identify it) < recall (can produce the meaning)
 *  < mastered (repeated independent recall across days and formats, with long-term stability).
 */

export type Verdict = "correct" | "partial" | "incorrect" | "skipped";
export type Grade = 1 | 2 | 3 | 4; // FSRS: Again, Hard, Good, Easy

export type WordSkill = "recognition" | "recall" | "precision" | "context" | "root_recognition";
export type RootSkill = "root_meaning" | "inference";
export type Skill = WordSkill | RootSkill;

export type Activity =
  | "learn"
  | "definition_recall"
  | "reverse_recall"
  | "context"
  | "deconstruct"
  | "root_meaning"
  | "root_inference"
  | "diagnostic"
  | "voice";

export type MasteryLevel = "new" | "introduced" | "recognized" | "recalling" | "mastered";

/** FSRS card states */
export const CardState = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;

/**
 * Converts an attempt into an FSRS grade.
 * - Wrong, skipped or "I don't know" -> Again.
 * - Partially right (gist but imprecise) -> Hard.
 * - Right but only after hints -> Hard: hinted answers earn less credit than independent ones.
 * - Right, independently -> Good; Easy only when also marked "certain".
 */
export function gradeForAttempt(input: {
  verdict: Verdict;
  hintsUsed: number;
  confidence?: number | null; // 1 guess, 2 fairly sure, 3 certain
}): Grade {
  if (input.verdict === "incorrect" || input.verdict === "skipped") return 1;
  if (input.verdict === "partial") return 2;
  if (input.hintsUsed > 0) return 2;
  if (input.confidence === 3) return 4;
  return 3;
}

/** Only an unaided, fully correct answer counts toward mastery. */
export function isIndependentCorrect(verdict: Verdict, hintsUsed: number) {
  return verdict === "correct" && hintsUsed === 0;
}

/** Precision is stricter than recall: a gist-level ("partial") definition fails precision. */
export function precisionGrade(verdict: Verdict, hintsUsed: number): Grade {
  if (verdict === "correct") return hintsUsed > 0 ? 2 : 3;
  return 1;
}

export type SkillSnapshot = {
  skill: Skill | string;
  exposures: number;
  independent_correct: number;
  correct_days: string[];
  stability: number;
  state: number;
  lapses: number;
};

export const MASTERY_RULES = {
  minIndependentRecalls: 3,
  minDistinctDays: 2,
  minStabilityDays: 7,
} as const;

/**
 * Word-level mastery from per-skill cards.
 * "Mastered" requires: at least 3 independent correct recalls, on at least 2 different days,
 * a recall memory stability of 7+ days, success in at least one other question format,
 * and the recall card must not currently be relearning after a lapse.
 */
export function wordMasteryLevel(states: SkillSnapshot[]): MasteryLevel {
  if (states.length === 0) return "new";
  const by = (s: string) => states.find((x) => x.skill === s);
  const recall = by("recall");
  const otherFormatSuccess = states.some(
    (s) => s.skill !== "recall" && s.skill !== "precision" && s.independent_correct > 0,
  );

  if (
    recall &&
    recall.independent_correct >= MASTERY_RULES.minIndependentRecalls &&
    new Set(recall.correct_days).size >= MASTERY_RULES.minDistinctDays &&
    recall.stability >= MASTERY_RULES.minStabilityDays &&
    recall.state !== CardState.Relearning &&
    otherFormatSuccess
  ) {
    return "mastered";
  }
  if (recall && recall.independent_correct > 0 && recall.state !== CardState.Relearning) return "recalling";
  if (states.some((s) => s.independent_correct > 0)) return "recognized";
  if (states.some((s) => s.exposures > 0)) return "introduced";
  return "new";
}

export type RootFamilyEvidence = {
  /** Words in the database that genuinely contain this root/affix. */
  familySize: number;
  /** Family words the learner defined AND explained (origin + how the parts make the meaning) unaided. */
  wordsExplained: number;
  /** All graded family-word explanation attempts and how many were fully correct. */
  attempts: number;
  correct: number;
};

export const ROOT_RULES = {
  familyTarget: 15,
  minAccuracy: 0.8,
  minMeaningRecalls: 2,
} as const;

/** How many family words must be explained before a root can count as mastered. */
export function rootFamilyTarget(familySize: number) {
  return Math.max(1, Math.min(ROOT_RULES.familyTarget, familySize));
}

/**
 * Root-level mastery. Knowing that "bene" means "good" and defining one word is NOT mastery.
 * Mastered requires: the root meaning recalled unaided on 2+ different days, AND the learner
 * independently defining and explaining at least 15 family words (or the whole family when it is
 * smaller), AND at least 80% accuracy across all family-word attempts.
 */
export function rootMasteryLevel(states: SkillSnapshot[], family?: RootFamilyEvidence): MasteryLevel {
  const meaning = states.find((s) => s.skill === "root_meaning");
  const meaningSolid =
    !!meaning &&
    meaning.independent_correct >= ROOT_RULES.minMeaningRecalls &&
    new Set(meaning.correct_days).size >= 2 &&
    meaning.state !== CardState.Relearning;
  const accuracy = family && family.attempts > 0 ? family.correct / family.attempts : 0;
  if (
    meaningSolid &&
    family &&
    family.wordsExplained >= rootFamilyTarget(family.familySize) &&
    accuracy >= ROOT_RULES.minAccuracy
  ) {
    return "mastered";
  }
  if ((meaning && meaning.independent_correct > 0 && meaning.state !== CardState.Relearning) || (family?.wordsExplained ?? 0) > 0) {
    return "recalling";
  }
  if (states.some((s) => s.independent_correct > 0)) return "recognized";
  if (states.some((s) => s.exposures > 0) || (family?.attempts ?? 0) > 0) return "introduced";
  return "new";
}

/**
 * How many brand-new words may be introduced right now.
 * Never introduce so many new words that existing reviews pile up:
 * - a review backlog of 5x the daily goal pauses new words entirely,
 * - a backlog of 2x the daily goal halves today's remaining allowance.
 */
export function newWordAllowance(input: { dailyGoal: number; introducedToday: number; dueReviews: number }) {
  const remaining = Math.max(0, input.dailyGoal - input.introducedToday);
  if (input.dueReviews >= input.dailyGoal * 5) return 0;
  if (input.dueReviews >= input.dailyGoal * 2) return Math.floor(remaining / 2);
  return remaining;
}

/** Rough number of study items that fit in a session. */
export function itemsForMinutes(minutes: number) {
  return Math.max(4, Math.round(minutes * 1.5));
}

/** In-session re-queue gap: a missed item comes back after a few other questions. */
export const RETRY_GAP = 3;

export const LEVEL_LABEL: Record<MasteryLevel, string> = {
  new: "Not started",
  introduced: "Introduced",
  recognized: "Recognized",
  recalling: "Recalling",
  mastered: "Mastered",
};

export const LEVEL_ORDER: MasteryLevel[] = ["new", "introduced", "recognized", "recalling", "mastered"];

export function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
