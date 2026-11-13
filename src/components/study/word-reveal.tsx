import { WordParts, type PartView } from "@/components/app/word-parts";

export type RevealWord = {
  word: string;
  part_of_speech: string;
  pronunciation: string;
  definition: string;
  plain_english: string;
  examples: string[];
  synonyms: string[];
  etymology: string | null;
  etymology_status: string;
  memory_aid: string | null;
  confused_note: string | null;
  parts: PartView[];
};

/** The full reference card shown when teaching a word or after an answer is graded. */
export function WordReveal({ w, showWord = true }: { w: RevealWord; showWord?: boolean }) {
  return (
    <div className="space-y-4">
      {showWord && (
        <div>
          <div className="font-display text-4xl">{w.word}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {w.pronunciation} · <span className="italic">{w.part_of_speech}</span>
          </div>
        </div>
      )}
      <div>
        <div className="eyebrow mb-1">Definition</div>
        <p className="text-lg">{w.definition}</p>
        <p className="mt-1 text-sm text-muted-foreground">In plain English: {w.plain_english}</p>
      </div>
      {w.parts.length > 0 && (
        <div>
          <div className="eyebrow mb-2">Word parts</div>
          <WordParts parts={w.parts} />
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {w.parts.map((p, i) => (
              <li key={i}>
                <span className="font-semibold text-foreground">{p.surface}</span> — {p.contribution}
              </li>
            ))}
          </ul>
        </div>
      )}
      {w.etymology && (
        <div>
          <div className="eyebrow mb-1">Origin {w.etymology_status !== "verified" && <span className="normal-case">({w.etymology_status})</span>}</div>
          <p className="text-sm">{w.etymology}</p>
        </div>
      )}
      {w.examples[0] && (
        <div>
          <div className="eyebrow mb-1">In a sentence</div>
          <p className="text-sm italic">“{w.examples[0]}”</p>
        </div>
      )}
      {w.synonyms.length > 0 && <p className="text-sm text-muted-foreground">Similar: {w.synonyms.join(", ")}</p>}
      {w.confused_note && <p className="rounded-lg bg-accent-soft p-3 text-sm">Don't confuse: {w.confused_note}</p>}
      {w.memory_aid && (
        <p className="rounded-lg bg-secondary p-3 text-sm">
          <span className="font-semibold">Memory trick (not etymology):</span> {w.memory_aid}
        </p>
      )}
    </div>
  );
}

export const VERDICT_STYLE: Record<string, string> = {
  correct: "border-mastery-mastered bg-primary-soft",
  partial: "border-accent bg-accent-soft",
  incorrect: "border-destructive bg-destructive/10",
  skipped: "border-border bg-secondary",
};
export const VERDICT_LABEL: Record<string, string> = {
  correct: "Correct",
  partial: "Partly right",
  incorrect: "Not quite",
  skipped: "Here's the answer",
};
