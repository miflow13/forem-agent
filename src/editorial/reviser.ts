import { z } from "zod";
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
    draftMarkdown: string;
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
        "Ignore clearly labeled author placeholders and purely subjective statements.",
        "Risk means editorial risk if the claim is wrong or overstated, not a probability that it is wrong.",
      ].join("\n"),
      input: JSON.stringify({
        evidence_type: "draft_claim_review_v1",
        approved_brief_markdown: input.briefMarkdown,
        current_draft_markdown: input.draftMarkdown,
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
      "Preserve explicit author notes and unresolved claims instead of silently resolving them.",
      "The approved brief defines the intended thesis and scope, but the current draft is the source of truth for human edits.",
      "Do not include YAML frontmatter in revised_markdown.",
    ].join("\n"),
    input: JSON.stringify({
      evidence_type: `draft_${pass}_revision_v1`,
      approved_brief_markdown: input.briefMarkdown,
      current_draft_markdown: stripFrontmatter(input.draftMarkdown),
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
  sourceDraft: string;
  model: string;
  revision: RewriteRevision;
}): string {
  const lines = [
    "---",
    `revision_pass: ${input.pass}`,
    `source_draft: ${input.sourceDraft}`,
    `model: ${input.model}`,
    `created_at: ${new Date().toISOString()}`,
    "---",
    "",
    `# ${titleCase(input.pass)} revision proposal`,
    "",
    "> This is a non-destructive proposal. The original draft.md was not changed.",
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
  sourceDraft: string;
  model: string;
  review: ClaimReview;
}): string {
  const lines = [
    "---",
    "revision_pass: claim-check",
    `source_draft: ${input.sourceDraft}`,
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

function stripFrontmatter(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return markdown;

  const closing = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (closing < 0) return markdown;

  return lines.slice(closing + 1).join("\n").trimStart();
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
