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
