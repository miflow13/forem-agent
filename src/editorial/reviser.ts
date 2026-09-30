import { z } from "zod";
import { stripFrontmatter } from "./article-files.js";
import type { StructuredTextModel } from "../providers/structured-text-model.js";

export const revisionPasses = ["structure", "voice", "claim-check"] as const;
export type RevisionPass = (typeof revisionPasses)[number];

const rewriteSchema = z.object({
  summary: z.string().min(1),
  changes: z
    .array(
      z.object({
        location: z.string().min(1),
        issue: z.string().min(1),
        change: z.string().min(1),
      }),
    )
    .max(12),
  revised_markdown: z.string().min(1),
});

const claimReviewSchema = z.object({
  summary: z.string().min(1),
  claims: z
    .array(
      z.object({
        claim: z.string().min(1),
        risk: z.enum(["low", "medium", "high"]),
        why_verify: z.string().min(1),
        suggested_source_type: z.string().min(1),
      }),
    )
    .max(30),
});

export type RewriteRevision = z.infer<typeof rewriteSchema>;
export type ClaimReview = z.infer<typeof claimReviewSchema>;

export type ParsedRevisionProposal = {
  pass: Exclude<RevisionPass, "claim-check">;
  sourceArticle: string;
  sourceSha256: string | null;
  proposedArticle: string;
};

const REWRITE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "changes", "revised_markdown"],
  properties: {
    summary: { type: "string" },
    changes: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["location", "issue", "change"],
        properties: {
          location: { type: "string" },
          issue: { type: "string" },
          change: { type: "string" },
        },
      },
    },
    revised_markdown: { type: "string" },
  },
} satisfies Record<string, unknown>;

const CLAIM_REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "claims"],
  properties: {
    summary: { type: "string" },
    claims: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "claim",
          "risk",
          "why_verify",
          "suggested_source_type",
        ],
        properties: {
          claim: { type: "string" },
          risk: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
          why_verify: { type: "string" },
          suggested_source_type: { type: "string" },
        },
      },
    },
  },
} satisfies Record<string, unknown>;

export async function runRevisionPass(
  model: StructuredTextModel,
  pass: RevisionPass,
  input: {
    briefMarkdown: string;
    articleMarkdown: string;
    editorialNotesMarkdown: string | null;
  },
): Promise<
  | { kind: "rewrite"; data: RewriteRevision; model: string }
  | { kind: "claim-review"; data: ClaimReview; model: string }
> {
  if (pass === "claim-check") {
    const result = await model.generate({
      schemaName: "forem_claim_review",
      jsonSchema: CLAIM_REVIEW_JSON_SCHEMA,
      parse: (value) => claimReviewSchema.parse(value),
      instructions: [
        "You are reviewing claims in a technical article before publication.",
        "Identify factual, technical, security, behavioral, or product claims that deserve verification.",
        "Do not pretend to verify a claim. You have no independent browsing or source-retrieval step in this pass.",
        "Do not invent citations, URLs, studies, benchmarks, standards, or vendor behavior.",
        "Prefer primary documentation, standards, source code, or original research as suggested source types where appropriate.",
        "Use the separate editorial notes as unresolved author context, not as published article content.",
        "Risk means editorial risk if the claim is wrong or overstated, not a probability that it is wrong.",
      ].join("\n"),
      input: JSON.stringify({
        evidence_type: "article_claim_review_v2",
        approved_brief_markdown: input.briefMarkdown,
        current_article_markdown: stripFrontmatter(input.articleMarkdown),
        editorial_notes_markdown: input.editorialNotesMarkdown,
      }),
    });

    return {
      kind: "claim-review",
      data: result.data,
      model: result.model,
    };
  }

  const passInstructions =
    pass === "structure"
      ? [
          "Focus on article-level structure, pacing, transitions, repetition, and unnecessary length.",
          "Reduce repeated thesis statements and merge or tighten overlapping explanations.",
          "Keep strong technical examples, diagrams, tables, and useful checklists when they earn their space.",
          "Do not turn the article into a generic summary. Preserve its concrete technical direction.",
        ]
      : [
          "Focus on prose voice, rhythm, clarity, and signs of generic AI-written phrasing.",
          "Prefer direct, natural technical writing over inflated framing, repetitive caveats, or canned transitions.",
          "Preserve the author's existing specificity and technical meaning.",
          "Do not invent first-hand experiences or fill author placeholders.",
        ];

  const result = await model.generate({
    schemaName: `forem_${pass}_revision`,
    jsonSchema: REWRITE_JSON_SCHEMA,
    parse: (value) => rewriteSchema.parse(value),
    instructions: [
      `You are performing a ${pass} revision pass on a technical article.`,
      ...passInstructions,
      "Return a complete revised Markdown article body plus a concise change report.",
      "Do not add new factual claims, measurements, citations, quotations, personal experiences, or verification results.",
      "Editorial notes are separate internal context. Do not append them to revised_markdown or turn them into publishable sections.",
      "Do not silently resolve author placeholders or verification work from editorial notes.",
      "The approved brief defines the intended thesis and scope, but the current article is the source of truth for human edits.",
      "Do not include YAML frontmatter in revised_markdown.",
    ].join("\n"),
    input: JSON.stringify({
      evidence_type: `article_${pass}_revision_v2`,
      approved_brief_markdown: input.briefMarkdown,
      current_article_markdown: stripFrontmatter(input.articleMarkdown),
      editorial_notes_markdown: input.editorialNotesMarkdown,
    }),
  });

  return {
    kind: "rewrite",
    data: result.data,
    model: result.model,
  };
}

export function renderRewriteProposal(input: {
  pass: Exclude<RevisionPass, "claim-check">;
  sourceArticle: string;
  sourceSha256: string;
  model: string;
  revision: RewriteRevision;
}): string {
  const lines = [
    "---",
    `revision_pass: ${input.pass}`,
    `source_article: ${input.sourceArticle}`,
    `source_sha256: ${input.sourceSha256}`,
    `model: ${input.model}`,
    `created_at: ${new Date().toISOString()}`,
    "---",
    "",
    `# ${titleCase(input.pass)} revision proposal`,
    "",
    "> This is a non-destructive proposal. The source article was not changed.",
    "",
    "## Summary",
    "",
    input.revision.summary,
    "",
    "## Proposed changes",
    "",
  ];

  if (input.revision.changes.length === 0) {
    lines.push("- No material changes proposed.", "");
  } else {
    for (const change of input.revision.changes) {
      lines.push(
        `### ${change.location}`,
        "",
        `**Issue:** ${change.issue}`,
        "",
        `**Change:** ${change.change}`,
        "",
      );
    }
  }

  lines.push(
    "## Proposed article",
    "",
    input.revision.revised_markdown.trim(),
    "",
  );

  return lines.join("\n");
}

export function renderClaimReview(input: {
  sourceArticle: string;
  sourceSha256: string;
  model: string;
  review: ClaimReview;
}): string {
  const lines = [
    "---",
    "revision_pass: claim-check",
    `source_article: ${input.sourceArticle}`,
    `source_sha256: ${input.sourceSha256}`,
    `model: ${input.model}`,
    `created_at: ${new Date().toISOString()}`,
    "---",
    "",
    "# Claim verification report",
    "",
    "> This pass identifies claims to verify. It does not independently verify them.",
    "",
    "## Summary",
    "",
    input.review.summary,
    "",
    "## Claims",
    "",
  ];

  if (input.review.claims.length === 0) {
    lines.push("- No material verification targets identified.", "");
  } else {
    for (const [index, claim] of input.review.claims.entries()) {
      lines.push(
        `### ${index + 1}. ${claim.claim}`,
        "",
        `- Risk: ${claim.risk}`,
        `- Why verify: ${claim.why_verify}`,
        `- Suggested source type: ${claim.suggested_source_type}`,
        "",
      );
    }
  }

  return lines.join("\n");
}

export function parseRevisionProposal(
  markdown: string,
): ParsedRevisionProposal {
  const lines = markdown.split(/\r?\n/);
  const frontmatter = parseFrontmatter(lines);
  const rawPass = frontmatter.revision_pass;

  if (rawPass === "claim-check") {
    throw new Error(
      "Claim-check reports cannot be accepted as article revisions.",
    );
  }
  if (rawPass !== "structure" && rawPass !== "voice") {
    throw new Error("Revision proposal has an unknown or missing revision_pass.");
  }

  const sourceArticle =
    frontmatter.source_article ??
    frontmatter.source_draft ??
    "draft.md";

  const proposedArticle = extractTrailingSection(markdown, "Proposed article");
  if (!proposedArticle.trim()) {
    throw new Error("Revision proposal has no Proposed article section.");
  }

  return {
    pass: rawPass,
    sourceArticle,
    sourceSha256: frontmatter.source_sha256 ?? null,
    proposedArticle: proposedArticle.trim() + "\n",
  };
}

function parseFrontmatter(lines: string[]): Record<string, string> {
  if (lines[0]?.trim() !== "---") return {};

  const result: Record<string, string> = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "---") break;

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2]?.trim() ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function extractTrailingSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const marker = `## ${heading}`;
  const start = lines.findIndex((line) => line.trim() === marker);
  if (start < 0) return "";

  return lines.slice(start + 1).join("\n").trim();
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
