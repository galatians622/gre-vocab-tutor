// Voice Tutor word sets of 10, in two rounds:
// 1. Learn round: every word is taught once. A word the learner gets right on the first try (no
//    hints) is cleared. A missed word comes back after a few other words, until it's right on the
//    first try.
// 2. Review round: once all 10 are cleared, every word is asked once more. Missed words come back
//    the same way until they're right on the first try.
// The next set starts when the review round is done.
export const SET_SIZE = 10;
/** How many other words come between a miss and the retest. */
export const RETEST_GAP = 3;

export type Verdict = "correct" | "partial" | "incorrect" | "skipped";
export type Phase = "learn" | "review";

export type SetWord = {
  slug: string;
  /** Times asked in total. */
  asks: number;
  /** Times asked in the current round. */
  phaseAsks: number;
  /** Cleared in the current round. */
  passed: boolean;
  /** Clock value when a missed word may be retested. */
  dueAt: number;
  firstTryCorrect: boolean | null;
  lastAskedAt: number;
};

export type VoiceSet = { words: SetWord[]; clock: number; lastSlug: string | null; setNumber: number; phase: Phase };

export function newSet(slugs: string[], setNumber = 1): VoiceSet {
  return { words: slugs.slice(0, SET_SIZE).map(blankWord), clock: 0, lastSlug: null, setNumber, phase: "learn" };
}

export function blankWord(slug: string): SetWord {
  return { slug, asks: 0, phaseAsks: 0, passed: false, dueAt: 0, firstTryCorrect: null, lastAskedAt: -1 };
}

/** Adds words to a set that has open slots. */
export function fillSet(set: VoiceSet, slugs: string[]) {
  for (const slug of slugs) {
    if (set.words.length >= SET_SIZE) break;
    if (!set.words.some((w) => w.slug === slug)) set.words.push(blankWord(slug));
  }
  return set;
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
  w.phaseAsks += 1;
  w.passed = clean;
  w.lastAskedAt = set.clock++;
  w.dueAt = clean ? 0 : set.clock + RETEST_GAP;
  set.lastSlug = slug;
  if (set.phase === "learn" && set.words.length >= SET_SIZE && set.words.every((x) => x.passed)) {
    set.phase = "review";
    for (const x of set.words) {
      x.passed = false;
      x.phaseAsks = 0;
      x.dueAt = 0;
    }
  }
  return w;
}

export function setComplete(set: VoiceSet) {
  return set.phase === "review" && set.words.length > 0 && set.words.every((w) => w.passed);
}

/** Words cleared in the current round. */
export function clearedCount(set: VoiceSet) {
  return set.words.filter((w) => w.passed).length;
}

/**
 * Next word: a missed word whose retest is due, otherwise the next word not yet asked this round,
 * otherwise the missed word that has waited longest. Never the same word twice in a row when avoidable.
 * `exclude` skips words whose grades are still being saved.
 */
export function nextWord(set: VoiceSet, exclude?: string | ReadonlySet<string>): SetWord | null {
  const skip = (slug: string) => (typeof exclude === "string" ? slug === exclude : (exclude?.has(slug) ?? false));
  const open = set.words.filter((w) => !w.passed && !skip(w.slug));
  if (!open.length) return null;
  const pool = open.length > 1 ? open.filter((w) => w.slug !== set.lastSlug) : open;
  const due = pool.filter((w) => w.phaseAsks > 0 && w.dueAt <= set.clock).sort((a, b) => a.dueAt - b.dueAt);
  if (due[0]) return due[0];
  const fresh = pool.find((w) => w.phaseAsks === 0);
  if (fresh) return fresh;
  return [...pool].sort((a, b) => a.dueAt - b.dueAt)[0]!;
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
    if (!set.words.some((w) => w.slug === a.slug)) {
      if (finished.has(a.slug) || set.words.length >= SET_SIZE) continue;
      set.words.push(blankWord(a.slug));
    }
    recordResult(set, a.slug, a.verdict, a.hintsUsed);
    if (setComplete(set)) {
      set.words.forEach((w) => finished.add(w.slug));
      set = newSet([], set.setNumber + 1);
    }
  }
  return { set, finished };
}
