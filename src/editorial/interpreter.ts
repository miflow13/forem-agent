import { z } from "zod";
import type { ArticleAnalysis } from "../analytics/analyze.js";
import type { StructuredTextModel } from "../providers/structured-text-model.js";

export const articleInterpretationSchema = z.object({
  summary: z.string(),
  observations: z.array(z.string()).max(6),
  possible_explanations: z.array(z.string()).max(6),
  editorial_lessons: z.array(z.string()).max(6),
  cautions: z.array(z.string()).max(6),
});

export type ArticleInterpretation = z.infer<
  typeof articleInterpretationSchema
>;

const ARTICLE_INTERPRETATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "observations",
    "possible_explanations",
    "editorial_lessons",
    "cautions",
  ],
  properties: {
    summary: { type: "string" },
    observations: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
    possible_explanations: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
    editorial_lessons: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
    cautions: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
  },
} satisfies Record<string, unknown>;

export async function interpretArticleAnalysis(
  model: StructuredTextModel,
  analysis: ArticleAnalysis,
): Promise<{ interpretation: ArticleInterpretation; model: string }> {
  const result = await model.generate({
    schemaName: "meldr_article_interpretation",
    jsonSchema: ARTICLE_INTERPRETATION_JSON_SCHEMA,
    parse: (value) => articleInterpretationSchema.parse(value),
    instructions: [
      "You are an editorial analyst for a Forem/DEV writing assistant.",
      "Interpret only the evidence supplied in the JSON input.",
      "Never invent measurements, page views, follower conversion, referrers, revenue, demographics, reaction identities, ranking formulas, or success probabilities.",
      "Treat engagement and residual values as local heuristics, not Forem-provided metrics.",
      "Separate observations from possible explanations. Explanations must be phrased as hypotheses, not causes.",
      "Do not manufacture personal experience or claim to know why readers behaved a certain way.",
      "Keep recommendations editorial and actionable, but grounded in the supplied evidence and limitations.",
    ].join("\n"),
    input: JSON.stringify({
      evidence_type: "article_analysis_v1",
      analysis,
    }),
  });

  return {
    interpretation: result.data,
    model: result.model,
  };
}
