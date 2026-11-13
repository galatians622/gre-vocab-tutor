import { createEmptyCard, fsrs, type Card } from "ts-fsrs";
import type { Grade } from "./mastery";

/** FSRS scheduler with the standard 90% desired retention. */
const scheduler = fsrs({ enable_fuzz: true, request_retention: 0.9 });

export type StoredCard = {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days?: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
};

function toCard(row: StoredCard | null, now: Date): Card {
  if (!row) return createEmptyCard(now);
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  } as Card;
}

export function scheduleReview(row: StoredCard | null, grade: Grade, now = new Date()) {
  const next = scheduler.next(toCard(row, now), now, grade).card;
  return {
    due: next.due.toISOString(),
    stability: next.stability,
    difficulty: next.difficulty,
    scheduled_days: next.scheduled_days,
    learning_steps: next.learning_steps,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state as number,
    last_review: (next.last_review ?? now).toISOString(),
  };
}

/** Estimated probability of recall right now (0..1). New cards return 0. */
export function retrievability(row: StoredCard, now = new Date()) {
  if (row.state === 0 || !row.last_review) return 0;
  return scheduler.retrievability(toCard(row, now), now) as unknown as number;
}
