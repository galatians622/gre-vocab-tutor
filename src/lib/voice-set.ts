// Voice Tutor word sets of 10 unique words, built for exposure to as many words as possible.
// - New word right on the first try (no hints): checked once more a few words later, then done.
// - Missed word: comes back a few words later. Right once and it's done.
// - Missed twice in one set: it stops holding up the set and comes back in the next set instead.
//   A word only moves to the next set once; after that, regular spaced review picks it up.
// - The set never asks the same word twice in a row. The next set starts as soon as every word
//   is done or moved on.
export const SET_SIZE = 10;
/** How many other words come between a miss and the retest. */
export const RETEST_GAP = 3;
/** How many other words come between a first-try success and its one check. */
export const CHECK_GAP = 4;
/** Misses in one set before the word moves to the next set. */
export const MAX_MISSES = 2;
/** How many times a word can move to the next set. */
export const MAX_CARRIES = 1;

export type Verdict = "correct" | "partial" | "incorrect" | "skipped";
/**
 * new: not taught yet. review: a word seen before, asked once. check: right on the first try,
 * one more check due. retry: missed, retest due. done: finished. carried: moves to the next set.
 */
export type Status = "new" | "review" | "check" | "retry" | "done" | "carried";

export type SetWord = {
  slug: string;
  status: Status;
  /** Times asked in this set. */
  asks: number;
  /** Misses in this set. */
  misses: number;
  /** Clock value when the word is due again. */
  dueAt: number;
  firstTryCorrect: boolean | null;
  lastAskedAt: number;
  /** Times this word has already moved to a later set. */
  carries: number;
};

export type VoiceSet = { words: SetWord[]; clock: number; lastSlug: string | null; setNumber: number };

export function blankWord(slug: string, status: Status = "new", dueAt = 0, carries = 0): SetWord {
  return { slug, status, asks: 0, misses: 0, dueAt, firstTryCorrect: null, lastAskedAt: -1, carries };
}

export function newSet(slugs: string[], setNumber = 1): VoiceSet {
  return fillSet({ words: [], clock: 0, lastSlug: null, setNumber }, slugs);
}

/** Adds words to open slots. Every word in a set is unique. */
export function fillSet(set: VoiceSet, slugs: string[], status: Status = "new") {
  for (const slug of slugs) addWord(set, blankWord(slug, status));
  return set;
}

export function addWord(set: VoiceSet, word: SetWord) {
  if (set.words.length >= SET_SIZE || set.words.some((w) => w.slug === word.slug)) return false;
  set.words.push(word);
  return true;
}

/** Spreads reviewed or carried words through a set so they don't come back to back. */
export function spacedDue(index: number) {
  return 1 + index * 3;
}

export function isOpen(w: SetWord) {
  return w.status === "new" || w.status === "review" || w.status === "check" || w.status === "retry";
}

export function isClean(verdict: Verdict, hintsUsed: number) {
  return verdict === "correct" && hintsUsed === 0;
}

export function recordResult(set: VoiceSet, slug: string, verdict: Verdict, hintsUsed: number) {
  const w = set.words.find((x) => x.slug === slug);
  if (!w || !isOpen(w)) return null;
  const clean = isClean(verdict, hintsUsed);
  if (w.firstTryCorrect === null) w.firstTryCorrect = clean;
  w.asks += 1;
  w.lastAskedAt = set.clock++;
  set.lastSlug = slug;
  if (clean) {
    w.status = w.status === "new" ? "check" : "done";
    w.dueAt = set.clock + CHECK_GAP;
  } else {
    w.misses += 1;
    w.status = w.misses >= MAX_MISSES ? "carried" : "retry";
    w.dueAt = set.clock + RETEST_GAP;
  }
  return w;
}

export function setComplete(set: VoiceSet) {
  return set.words.length > 0 && !set.words.some(isOpen);
}

/** Words finished or moved on in this set. */
export function doneCount(set: VoiceSet) {
  return set.words.filter((w) => !isOpen(w)).length;
}

/**
 * Next word: a check or retest that is due, otherwise the next new word, otherwise whichever
 * pending word is due soonest. Never the same word twice in a row: if the word just asked is the
 * only one left, it is settled instead (a check counts as done, a retest moves to the next set).
 * `exclude` skips words whose grades are still being saved.
 */
export function nextWord(set: VoiceSet, exclude?: string | ReadonlySet<string>): SetWord | null {
  const skip = (slug: string) => (typeof exclude === "string" ? slug === exclude : (exclude?.has(slug) ?? false));
  const open = set.words.filter((w) => isOpen(w) && !skip(w.slug));
  const pool = open.filter((w) => w.slug !== set.lastSlug);
  if (!pool.length) {
    const last = open[0];
    if (!last) return null;
    if (last.status === "new" || last.status === "review") return last;
    last.status = last.status === "check" ? "done" : "carried";
    return null;
  }
  const waiting = pool.filter((w) => w.status !== "new").sort((a, b) => a.dueAt - b.dueAt);
  const due = waiting.find((w) => w.dueAt <= set.clock);
  if (due) return due;
  const fresh = pool.find((w) => w.status === "new");
  if (fresh) return fresh;
  return waiting[0]!;
}

/** Words that move from a finished set to the next one. */
export function carriedWords(set: VoiceSet) {
  return set.words.filter((w) => w.status === "carried" && w.carries < MAX_CARRIES).map((w) => w.slug);
}

/** Starts the next set with the words carried over from `prev`, spread through the set. */
export function nextSet(prev: VoiceSet, extraCarry: string[] = []): VoiceSet {
  const set = newSet([], prev.setNumber + 1);
  const carries = new Map(prev.words.map((w) => [w.slug, w.carries]));
  const slugs = [...new Set([...carriedWords(prev), ...extraCarry])];
  slugs.forEach((slug, i) => addWord(set, blankWord(slug, "retry", spacedDue(i), (carries.get(slug) ?? 0) + 1)));
  return set;
}

export type VoiceAnswer = { slug: string; verdict: Verdict; hintsUsed: number };

/**
 * Rebuilds the learner's voice sets from saved voice answers (oldest first), for accounts that
 * have no saved set yet. Returns the current set and every word in finished sets.
 */
export function replaySets(answers: VoiceAnswer[]): { set: VoiceSet; finished: Set<string> } {
  const finished = new Set<string>();
  let set = newSet([], 1);
  for (const a of answers) {
    const inSet = set.words.find((w) => w.slug === a.slug);
    if (!inSet) {
      if (finished.has(a.slug) || !addWord(set, blankWord(a.slug))) continue;
    } else if (!isOpen(inSet)) continue;
    recordResult(set, a.slug, a.verdict, a.hintsUsed);
    if (setComplete(set)) {
      set.words.forEach((w) => finished.add(w.slug));
      set = nextSet(set);
    }
  }
  return { set, finished };
}
