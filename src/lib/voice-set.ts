// Voice Tutor word sets: the learner can't move to a new set of words until every
// word in the current set is mastered.
// A word is mastered once the learner defines it correctly, with no hints, three times in a row.
// Any miss, partial answer or hint resets that word's streak to zero.
export const SET_SIZE = 10;
export const MASTERY_STREAK = 3;

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
    words: slugs.slice(0, SET_SIZE).map(blankWord),
    clock: 0,
    lastSlug: null,
    setNumber,
  };
}

function blankWord(slug: string): SetWord {
  return { slug, asks: 0, firstTryCorrect: null, streak: 0, lastAskedAt: -1 };
}

/** Adds words to a set that has open slots (for example after resuming a partly asked set). */
export function fillSet(set: VoiceSet, slugs: string[]) {
  for (const slug of slugs) {
    if (set.words.length >= SET_SIZE) break;
    if (!set.words.some((w) => w.slug === slug)) set.words.push(blankWord(slug));
  }
  return set;
}

export function requiredStreak(_w?: SetWord) {
  return MASTERY_STREAK;
}

export function isMastered(w: SetWord) {
  return w.streak >= MASTERY_STREAK;
}

export function remaining(w: SetWord) {
  return Math.max(0, MASTERY_STREAK - w.streak);
}

export function isClean(verdict: Verdict, hintsUsed: number) {
  return verdict === "correct" && hintsUsed === 0;
}

export function recordResult(set: VoiceSet, slug: string, verdict: Verdict, hintsUsed: number) {
  const w = set.words.find((x) => x.slug === slug);
  if (!w) return null;
  const clean = isClean(verdict, hintsUsed);
  if (w.firstTryCorrect === null) w.firstTryCorrect = clean;
  w.asks += 1;
  w.streak = clean ? w.streak + 1 : 0;
  w.lastAskedAt = set.clock++;
  set.lastSlug = slug;
  return w;
}

export function setComplete(set: VoiceSet) {
  return set.words.length > 0 && set.words.every(isMastered);
}

export function masteredCount(set: VoiceSet) {
  return set.words.filter(isMastered).length;
}

/**
 * Next word to ask: new words first, then the weakest; never the same word twice in a row when avoidable.
 * `exclude` skips words whose grades are still being saved.
 */
export function nextWord(set: VoiceSet, exclude?: string | ReadonlySet<string>): SetWord | null {
  const skip = (slug: string) => (typeof exclude === "string" ? slug === exclude : exclude?.has(slug) ?? false);
  const open = set.words.filter((w) => !isMastered(w) && !skip(w.slug));
  if (!open.length) return null;
  const pool = open.length > 1 ? open.filter((w) => w.slug !== set.lastSlug) : open;
  return [...pool].sort((a, b) => {
    if ((a.asks === 0) !== (b.asks === 0)) return a.asks === 0 ? -1 : 1;
    if (a.asks === 0) return 0;
    return remaining(b) - remaining(a) || a.lastAskedAt - b.lastAskedAt;
  })[0]!;
}

export type VoiceAnswer = { slug: string; verdict: Verdict; hintsUsed: number };

/**
 * Rebuilds the learner's voice sets from their saved voice answers (oldest first), so a new call
 * picks up the same set where the last one stopped. Returns the current set and every word in
 * sets that were already completed.
 */
export function replaySets(answers: VoiceAnswer[]): { set: VoiceSet; finished: Set<string> } {
  const finished = new Set<string>();
  let set = newSet([], 1);
  for (const a of answers) {
    if (!set.words.some((w) => w.slug === a.slug)) {
      // Words from a finished set may come up again in a later set's review; skip those answers.
      if (finished.has(a.slug) || set.words.length >= SET_SIZE) continue;
      set.words.push(blankWord(a.slug));
    }
    recordResult(set, a.slug, a.verdict, a.hintsUsed);
    if (set.words.length >= SET_SIZE && setComplete(set)) {
      set.words.forEach((w) => finished.add(w.slug));
      set = newSet([], set.setNumber + 1);
    }
  }
  return { set, finished };
}
