import { z } from "zod";
import type { StoredResearchArticle } from "../storage/database.js";
import type { StructuredTextModel } from "../providers/structured-text-model.js";

const outlineSectionSchema = z.object({
  heading: z.string(),
  intent: z.string(),
  evidence: z.array(z.string()).max(6),
});

export const editorialBriefSchema = z.object({
  intended_reader: z.string(),
  reader_problem: z.string(),
  thesis: z.string(),
  covers: z.array(z.string()).max(8),
  does_not_cover: z.array(z.string()).max(8),
  evidence_summary: z.array(z.string()).max(10),
  competing_angles: z.array(z.string()).max(6),
  differentiation: z.string(),
  outline: z.array(outlineSectionSchema).min(3).max(12),
  personal_experience_placeholders: z.array(z.string()).max(6),
  technical_claims_to_verify: z.array(z.string()).max(10),
  title_options: z.array(z.string()).min(1).max(5),
  tags: z.array(z.string()).max(4),
  risks_and_counterarguments: z.array(z.string()).max(8),
});

export type EditorialBrief = z.infer<typeof editorialBriefSchema>;

export type PlanEvidence = {
  reference: string;
  idea: string;
  articles: StoredResearchArticle[];
  limitations: string[];
};

const BRIEF_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "intended_reader",
    "reader_problem",
    "thesis",
    "covers",
    "does_not_cover",
    "evidence_summary",
    "competing_angles",
    "differentiation",
    "outline",
    "personal_experience_placeholders",
    "technical_claims_to_verify",
    "title_options",
    "tags",
    "risks_and_counterarguments",
  ],
  properties: {
    intended_reader: { type: "string" },
    reader_problem: { type: "string" },
    thesis: { type: "string" },
    covers: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    does_not_cover: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    evidence_summary: {
      type: "array",
      maxItems: 10,
      items: { type: "string" },
    },
    competing_angles: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
    differentiation: { type: "string" },
    outline: {
      type: "array",
      minItems: 3,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "intent", "evidence"],
        properties: {
          heading: { type: "string" },
          intent: { type: "string" },
          evidence: {
            type: "array",
            maxItems: 6,
            items: { type: "string" },
          },
        },
      },
    },
    personal_experience_placeholders: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
    technical_claims_to_verify: {
      type: "array",
      maxItems: 10,
      items: { type: "string" },
    },
    title_options: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: { type: "string" },
    },
    tags: {
      type: "array",
      maxItems: 4,
      items: { type: "string" },
    },
    risks_and_counterarguments: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
  },
} satisfies Record<string, unknown>;

export async function generateEditorialBrief(
  model: StructuredTextModel,
  evidence: PlanEvidence,
): Promise<{ brief: EditorialBrief; model: string }> {
  const packet = {
    evidence_type: "editorial_plan_v1",
    reference: evidence.reference,
    requested_idea: evidence.idea,
    limitations: evidence.limitations,
    articles: evidence.articles.map((article) => ({
      id: article.id,
      title: article.title,
      url: article.url,
      author: article.username,
      published_timestamp: article.publishedTimestamp,
      tags: article.tags,
      reactions: article.publicReactionsCount,
      comments: article.commentsCount,
      reading_time_minutes: article.readingTimeMinutes,
    })),
  };

  const result = await model.generate({
    schemaName: "meldr_editorial_brief",
    jsonSchema: BRIEF_JSON_SCHEMA,
    parse: (value) => editorialBriefSchema.parse(value),
    instructions: [
      "Create a proposed editorial brief for a human Forem/DEV author.",
      "Use only the supplied evidence packet for claims about community coverage or engagement.",
      "Do not invent metrics, private analytics, trends, search volume, reader demographics, causes, or success probabilities.",
      "Do not manufacture personal anecdotes. Put any useful personal-story opportunities in personal_experience_placeholders for the author to fill in.",
      "Treat reactions and comments as observable counts, not proof of why readers behaved a certain way.",
      "Technical claims that are not directly supported by the packet belong in technical_claims_to_verify.",
      "Offer no more than four Forem tags.",
      "The thesis and differentiation should be specific enough to guide drafting, but remain editable by the human author.",
    ].join("\n"),
    input: JSON.stringify(packet),
  });

  return { brief: result.data, model: result.model };
}

export function selectPlanEvidence(
  reference: string,
  articles: StoredResearchArticle[],
  limit = 12,
): PlanEvidence {
  if (articles.length === 0) {
    throw new Error(
      'No completed research data found. Run "meldr research" before planning.',
    );
  }

  const trimmed = reference.trim();
  if (!trimmed) throw new Error("Plan idea cannot be empty.");

  if (trimmed.toLowerCase().startsWith("tag:")) {
    const tag = trimmed.slice(4).trim().toLowerCase();
    if (!tag) throw new Error('Tag references must look like "tag:typescript".');

    const matching = articles
      .filter((article) =>
        article.tags.some((value) => value.toLowerCase() === tag),
      )
      .slice(0, limit);

    if (matching.length === 0) {
      throw new Error(`No articles for tag "#${tag}" exist in the latest research sample.`);
    }

    return {
      reference: `tag:${tag}`,
      idea: `Develop a differentiated article around the #${tag} community topic.`,
      articles: matching,
      limitations: [
        "Evidence comes from the latest locally stored research sample, not the complete Forem corpus.",
        "A tag signal is an editorial research input, not a prediction of article performance.",
      ],
    };
  }

  const tokens = tokenize(trimmed);
  const ranked = articles
    .map((article) => ({
      article,
      score: lexicalScore(tokens, article),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.article.publishedTimestamp.localeCompare(a.article.publishedTimestamp),
    );

  const related = ranked.filter((item) => item.score > 0).slice(0, limit);
  const selected =
    related.length > 0
      ? related.map((item) => item.article)
      : ranked.slice(0, limit).map((item) => item.article);

  return {
    reference: trimmed,
    idea: trimmed,
    articles: selected,
    limitations: [
      "Evidence comes from the latest locally stored research sample, not the complete Forem corpus.",
      related.length > 0
        ? "Related articles were selected with deterministic lexical overlap, not semantic embeddings."
        : "No lexical matches were found, so the newest locally stored articles are included only as broad context.",
    ],
  };
}

function lexicalScore(
  ideaTokens: Set<string>,
  article: StoredResearchArticle,
): number {
  if (ideaTokens.size === 0) return 0;

  const articleTokens = tokenize(
    [article.title, ...article.tags].join(" "),
  );

  let overlap = 0;
  for (const token of ideaTokens) {
    if (articleTokens.has(token)) overlap += 1;
  }

  return overlap / ideaTokens.size;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9+#.-]+/)
      .map((token) => token.replace(/^#/, ""))
      .filter((token) => token.length >= 2),
  );
}
