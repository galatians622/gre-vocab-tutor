// Voice Tutor word sets: the learner can't move to a new set of words until every
// word in the current set is mastered.
// - A word answered correctly (no hints) on its very first ask needs ONE more clean correct answer.
// - Any word missed, partially answered or hinted needs THREE clean correct answers in a row afterwards.
export const SET_SIZE = 10;

export type Verdict = "correct" | "partial" | "incorrect" | "skipped";

export type SetWord = {
  slug: string;
  asks: number;
  firstTryCorrect: boolean | null;
  streak: number;
  lastAskedAt: number;
};

export type VoiceSet = { words: SetWord[]; clock: number; lastSlug: string | null; setNumber: number };

export function newSet(slugs: string[], setNumber = 1): VoiceSet {
  return {
    words: slugs.slice(0, SET_SIZE).map((slug) => ({ slug, asks: 0, firstTryCorrect: null, streak: 0, lastAskedAt: -1 })),
    clock: 0,
    lastSlug: null,
    setNumber,
  };
}

export function requiredStreak(w: SetWord) {
  return w.firstTryCorrect === true ? 2 : 3;
}

export function isMastered(w: SetWord) {
  return w.firstTryCorrect !== null && w.streak >= requiredStreak(w);
}

export function remaining(w: SetWord) {
  return Math.max(0, requiredStreak(w) - w.streak);
}

export function recordResult(set: VoiceSet, slug: string, verdict: Verdict, hintsUsed: number) {
  const w = set.words.find((x) => x.slug === slug);
  if (!w) return null;
  const clean = verdict === "correct" && hintsUsed === 0;
  if (w.firstTryCorrect === null) w.firstTryCorrect = clean;
  w.asks += 1;
  w.streak = clean ? w.streak + 1 : 0;
  // A miss after a strong start means the word now needs the full three in a row.
  if (!clean) w.firstTryCorrect = false;
  w.lastAskedAt = set.clock++;
  set.lastSlug = slug;
  return w;
}

export function setComplete(set: VoiceSet) {
  return set.words.length > 0 && set.words.every(isMastered);
}

/** Next word to ask: new words first, then the weakest; never the same word twice in a row when avoidable. */
export function nextWord(set: VoiceSet): SetWord | null {
  const open = set.words.filter((w) => !isMastered(w));
  if (!open.length) return null;
  const pool = open.length > 1 ? open.filter((w) => w.slug !== set.lastSlug) : open;
  return [...pool].sort((a, b) => {
    if ((a.asks === 0) !== (b.asks === 0)) return a.asks === 0 ? -1 : 1;
    if (a.asks === 0) return 0;
    return remaining(b) - remaining(a) || a.lastAskedAt - b.lastAskedAt;
  })[0]!;
}
