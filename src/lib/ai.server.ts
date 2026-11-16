import { createOpenAI } from "@ai-sdk/openai";
import { NoObjectGeneratedError, Output, streamText } from "ai";
import { z } from "zod";

export const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
export const TEXT_MODEL = "openai/gpt-6-astra";

export class AiUnavailableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

function provider() {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new AiUnavailableError("AI grading is not configured.");
  return createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey: key,
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
}

const gradeSchema = z.object({
  verdict: z.enum(["correct", "partial", "incorrect"]),
  feedback: z.string(),
  misconception: z.string().nullable(),
});
export type AiGrade = z.infer<typeof gradeSchema>;

function friendlyError(error: unknown): AiUnavailableError {
  const status = (error as { statusCode?: number })?.statusCode;
  if (status === 402) return new AiUnavailableError("AI credits have run out, so automatic grading is paused.", 402);
  if (status === 429) return new AiUnavailableError("The grader is busy right now. Try again in a moment.", 429);
  if (status === 403) return new AiUnavailableError("AI grading is not available for this workspace.", 403);
  return new AiUnavailableError("Automatic grading failed this time.", status);
}

/**
 * Semantic grading against verified reference data. The model only judges and explains;
 * the reference definition stays the source of truth.
 */
export async function gradeWithAi(input: {
  task: string;
  reference: string;
  learnerAnswer: string;
}): Promise<AiGrade> {
  const instructions = [
    "You grade a GRE vocabulary learner's free-text answer. Be strict but fair, like an excellent private tutor.",
    "The REFERENCE is authoritative. Judge meaning, not wording, spelling or grammar.",
    "correct: captures the core meaning precisely enough to distinguish it from near-synonyms.",
    "partial: right general direction but too vague, missing a key nuance (e.g. 'excessively', 'unfairly', 'impossible to'), or only half the meaning.",
    "incorrect: wrong, opposite, unrelated, or confused with a different word.",
    "feedback: 1-2 short sentences to the learner. Say what was right and name exactly what was missing or wrong. Do not repeat the full definition unless the answer was incorrect.",
    "Use only facts from the REFERENCE. Never invent etymology.",
    "misconception: a short label for the specific confusion (e.g. 'confused with energize', 'missing the sense of excess'), or null.",
  ].join("\n");
  try {
    const result = streamText({
      model: provider().responses(TEXT_MODEL),
      instructions,
      messages: [
        {
          role: "user",
          content: `TASK: ${input.task}\n\nREFERENCE:\n${input.reference}\n\nLEARNER ANSWER: """${input.learnerAnswer.slice(0, 600)}"""`,
        },
      ],
      output: Output.object({ schema: gradeSchema }),
      maxRetries: 1,
      providerOptions: {
        openai: {
          store: false,
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      },
    });
    for await (const _ of result.fullStream) {
      // drain to completion
    }
    const output = await result.output;
    return gradeSchema.parse(output);
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new AiUnavailableError("The grader returned an unreadable answer.");
    }
    if (error instanceof AiUnavailableError) throw error;
    console.error("AI grading failed", error);
    throw friendlyError(error);
  }
}

const voiceSchema = z.object({
  learner_attempted: z.boolean(),
  definition_verdict: z.enum(["correct", "partial", "incorrect", "skipped"]),
  hints_used: z.number().int().min(0).max(3),
  learner_definition: z.string(),
  explained_origin: z.boolean(),
  origin_verdict: z.enum(["correct", "partial", "incorrect"]).nullable(),
  feedback: z.string(),
  misconception: z.string().nullable(),
});
export type AiVoiceGrade = z.infer<typeof voiceSchema>;

/**
 * Grades one word from a spoken tutoring conversation, after the tutor has moved on. Runs in
 * the background so the conversation never waits for it.
 */
export async function gradeVoiceWord(input: {
  reference: string;
  transcript: string;
  quickCheck: boolean;
  signal?: AbortSignal;
}): Promise<AiVoiceGrade> {
  const instructions = [
    "You grade one word from a spoken GRE vocabulary tutoring conversation. The transcript comes from speech recognition, so ignore filler words and transcription slips.",
    "The REFERENCE is authoritative. Judge meaning, not wording.",
    "Grade the learner's OWN definition: the first real attempt they made before the tutor stated the definition. If they only repeated the tutor's definition, that does not count as correct.",
    "definition_verdict — correct: captures the core meaning precisely enough to distinguish it from near-synonyms; partial: right direction but vague or missing a key nuance; incorrect: wrong or confused with another word; skipped: the learner never really tried or asked to skip.",
    "hints_used: how many hints or clues the tutor gave BEFORE the learner's attempt that you graded. 0 if none.",
    "In first-time teaching mode the tutor always opens by breaking the word into its parts and giving their meanings. That opening breakdown, including where each root comes from and a familiar everyday word that shares it, is how the word is presented and is NOT a hint. Count only extra clues after it, such as leading questions or examples.",
    "In quick review mode the learner should define the word unaided, so any root meanings or clues the tutor gave before their attempt count as hints.",
    "learner_definition: the learner's attempt in a few words, or an empty string.",
    "explained_origin: true only if the learner themselves explained how a root, prefix or suffix builds the meaning. origin_verdict grades that explanation, or null if they did not try.",
    "feedback: 1-2 short sentences for the learner's progress log: what was right and what was missing. Use only facts from the REFERENCE.",
    "misconception: a short label for the specific confusion, or null.",
  ].join("\n");
  try {
    const result = streamText({
      model: provider().responses(TEXT_MODEL),
      instructions,
      ...(input.signal ? { abortSignal: input.signal } : {}),
      messages: [
        {
          role: "user",
          content:
            `MODE: ${input.quickCheck ? "quick review of a word the learner has seen before" : "first time teaching this word"}\n\n` +
            `REFERENCE:\n${input.reference}\n\nTRANSCRIPT:\n${input.transcript.slice(-6000)}`,
        },
      ],
      output: Output.object({ schema: voiceSchema }),
      maxRetries: 1,
      providerOptions: {
        openai: {
          store: false,
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      },
    });
    for await (const _ of result.fullStream) {
      // drain to completion
    }
    return voiceSchema.parse(await result.output);
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) throw new AiUnavailableError("The grader returned an unreadable answer.");
    if (error instanceof AiUnavailableError) throw error;
    console.error("AI voice grading failed", error);
    throw friendlyError(error);
  }
}

const familySchema = z.object({
  definition_verdict: z.enum(["correct", "partial", "incorrect"]),
  explanation_verdict: z.enum(["correct", "partial", "incorrect"]),
  feedback: z.string(),
  misconception: z.string().nullable(),
});
export type AiFamilyGrade = z.infer<typeof familySchema>;

/**
 * Grades a root-family attempt: the learner defines the word on their own and explains its
 * origin and how the root, prefix and suffix produce the meaning.
 */
export async function gradeFamilyWithAi(input: {
  word: string;
  reference: string;
  definitionAnswer: string;
  explanationAnswer: string;
}): Promise<AiFamilyGrade> {
  const instructions = [
    "You grade a GRE vocabulary learner in a root-family drill. The REFERENCE is authoritative; judge meaning, not spelling.",
    "Two separate verdicts:",
    "definition_verdict — correct: precise enough to distinguish from near-synonyms; partial: right direction but vague or missing a key nuance; incorrect: wrong.",
    "explanation_verdict — correct: names the root's meaning, mentions the relevant prefix/suffix where the reference lists one, and plausibly connects them to the definition (it may be informal); partial: names the root but does not connect it to the meaning, or misreads a part; incorrect: wrong or missing.",
    "Accept honest historical nuance: if the reference marks a link as indirect or uncertain, do not demand a neat breakdown.",
    "feedback: 2-3 short sentences to the learner: what was right, what was missing, and the correct connection when needed. Use only facts from the REFERENCE; never invent etymology.",
    "misconception: a short label for the specific confusion, or null.",
  ].join("\n");
  try {
    const result = streamText({
      model: provider().responses(TEXT_MODEL),
      instructions,
      messages: [
        {
          role: "user",
          content: `WORD: ${input.word}\n\nREFERENCE:\n${input.reference}\n\nLEARNER DEFINITION: """${input.definitionAnswer.slice(0, 500)}"""\nLEARNER EXPLANATION OF ORIGIN: """${input.explanationAnswer.slice(0, 800)}"""`,
        },
      ],
      output: Output.object({ schema: familySchema }),
      maxRetries: 1,
      providerOptions: {
        openai: {
          store: false,
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      },
    });
    for await (const _ of result.fullStream) {
      // drain to completion
    }
    return familySchema.parse(await result.output);
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) throw new AiUnavailableError("The grader returned an unreadable answer.");
    if (error instanceof AiUnavailableError) throw error;
    console.error("AI family grading failed", error);
    throw friendlyError(error);
  }
}
