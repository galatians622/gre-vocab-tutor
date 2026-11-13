export type Outcome = { level: number; common: boolean; type: "recognition" | "recall" | "context" | "root"; correct: boolean; label: string };

/** A band counts as "known" at 75%+; new words start at the first band below that. */
export const KNOWN_BAND_ACCURACY = 0.75;

export function summarize(outcomes: Outcome[]) {
  const words = outcomes.filter((o) => o.type !== "root");
  const pct = (c: number, t: number) => (t ? c / t : 0);
  const byLevel = [1, 2, 3].map((level) => {
    const rows = words.filter((o) => o.level === level);
    const correct = rows.filter((o) => o.correct).length;
    return { level, total: rows.length, correct, accuracy: pct(correct, rows.length) };
  });
  const common = words.filter((o) => o.common);
  const roots = outcomes.filter((o) => o.type === "root");
  const startLevel = byLevel.find((b) => b.total > 0 && b.accuracy < KNOWN_BAND_ACCURACY)?.level ?? 3;
  return {
    byLevel,
    commonAccuracy: pct(common.filter((o) => o.correct).length, common.length),
    rootAccuracy: pct(roots.filter((o) => o.correct).length, roots.length),
    startLevel,
    missed: words.filter((o) => !o.correct).map((o) => o.label),
    known: words.filter((o) => o.correct).map((o) => o.label),
    takenAt: new Date().toISOString(),
  };
}
