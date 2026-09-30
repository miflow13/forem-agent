import { z } from "zod";
import type { StructuredTextModel } from "../providers/structured-text-model.js";

const draftSectionSchema = z.object({
  markdown: z.string().min(1),
});

const DRAFT_SECTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["markdown"],
  properties: {
    markdown: { type: "string", minLength: 1 },
  },
} satisfies Record<string, unknown>;

export type ParsedDraftBrief = {
  projectId: string | null;
  slug: string | null;
  status: string | null;
  title: string;
  outline: Array<{
    heading: string;
    intent: string;
    evidence: string[];
  }>;
  personalExperiencePlaceholders: string[];
  technicalClaimsToVerify: string[];
  rawMarkdown: string;
};

export function parseDraftBrief(markdown: string): ParsedDraftBrief {
  const lines = markdown.split(/\r?\n/);
  const frontmatter = parseFrontmatter(lines);
  const outlineBlock = sectionLines(lines, "Outline");
  const outline = parseOutline(outlineBlock);
  const titleOptions = listItems(sectionLines(lines, "Title options"));
  const placeholders = listItems(
    sectionLines(lines, "Personal-experience placeholders"),
  );
  const technicalClaims = listItems(
    sectionLines(lines, "Technical claims to verify"),
  );

  if (outline.length === 0) {
    throw new Error(
      "Approved brief has no parseable outline sections. Keep outline sections as Markdown ### headings.",
    );
  }

  const title =
    titleOptions[0] ??
    frontmatter.slug?.replace(/-/g, " ") ??
    "Untitled article";

  return {
    projectId: frontmatter.project_id ?? null,
    slug: frontmatter.slug ?? null,
    status: frontmatter.status ?? null,
    title,
    outline,
    personalExperiencePlaceholders: placeholders,
    technicalClaimsToVerify: technicalClaims,
    rawMarkdown: markdown,
  };
}

export type DraftProgressEvent = {
  phase: "section-start" | "section-complete";
  index: number;
  total: number;
  heading: string;
};

export async function generateDraftSections(
  model: StructuredTextModel,
  brief: ParsedDraftBrief,
  onProgress?: (event: DraftProgressEvent) => void,
): Promise<{
  sections: Array<{ heading: string; markdown: string }>;
  model: string;
}> {
  const sections: Array<{ heading: string; markdown: string }> = [];
  let modelName = "unknown";

  for (const [index, section] of brief.outline.entries()) {
    onProgress?.({
      phase: "section-start",
      index: index + 1,
      total: brief.outline.length,
      heading: section.heading,
    });

    const result = await model.generate({
      schemaName: "forem_draft_section",
      jsonSchema: DRAFT_SECTION_JSON_SCHEMA,
      parse: (value) => draftSectionSchema.parse(value),
      instructions: [
        "You are drafting one section of a technical article from an author-approved editorial brief.",
        "Use only the supplied brief and section instructions as editorial direction.",
        "Write only the body of this section. Do not add the section heading.",
        "Do not invent personal experiences, first-hand anecdotes, measurements, private analytics, sources, quotations, or verification results.",
        "If the brief calls for first-hand experience, leave that material for the author rather than fabricating it.",
        "Treat claims listed for verification as unverified; do not strengthen them into facts.",
        "Keep the prose useful, specific, and consistent with the approved thesis.",
        "Return Markdown suitable for direct insertion into the article.",
      ].join("\n"),
      input: JSON.stringify({
        evidence_type: "approved_editorial_brief_v1",
        section_index: index + 1,
        section_count: brief.outline.length,
        section,
        approved_brief_markdown: brief.rawMarkdown,
      }),
    });

    modelName = result.model;
    sections.push({
      heading: section.heading,
      markdown: result.data.markdown.trim(),
    });

    onProgress?.({
      phase: "section-complete",
      index: index + 1,
      total: brief.outline.length,
      heading: section.heading,
    });
  }

  return { sections, model: modelName };
}

export function renderDraftMarkdown(input: {
  projectId: string;
  slug: string;
  title: string;
  model: string;
  sections: Array<{ heading: string; markdown: string }>;
}): string {
  const lines = [
    "---",
    `project_id: ${input.projectId}`,
    `slug: ${input.slug}`,
    "status: draft",
    `model: ${input.model}`,
    "source_brief: brief.md",
    "---",
    "",
    `# ${input.title}`,
    "",
  ];

  for (const section of input.sections) {
    lines.push(`## ${section.heading}`, "", section.markdown, "");
  }

  return lines.join("\n");
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

function sectionLines(lines: string[], heading: string): string[] {
  const marker = `## ${heading}`;
  const start = lines.findIndex((line) => line.trim() === marker);
  if (start < 0) return [];

  const result: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^##\s+/.test(line)) break;
    result.push(line);
  }
  return result;
}

function parseOutline(
  lines: string[],
): ParsedDraftBrief["outline"] {
  const sections: ParsedDraftBrief["outline"] = [];
  let current:
    | { heading: string; body: string[] }
    | null = null;

  const flush = () => {
    if (!current) return;

    const evidenceMarker = current.body.findIndex(
      (line) => line.trim().toLowerCase() === "evidence to use:",
    );
    const intentLines =
      evidenceMarker >= 0
        ? current.body.slice(0, evidenceMarker)
        : current.body;
    const evidenceLines =
      evidenceMarker >= 0 ? current.body.slice(evidenceMarker + 1) : [];

    sections.push({
      heading: current.heading,
      intent: intentLines
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n"),
      evidence: listItems(evidenceLines),
    });
  };

  for (const line of lines) {
    const headingMatch = line.match(/^###\s+(.+)$/);
    if (headingMatch) {
      flush();
      current = {
        heading: (headingMatch[1] ?? "")
          .replace(/^\d+\.\s*/, "")
          .trim(),
        body: [],
      };
      continue;
    }

    if (current) current.body.push(line);
  }

  flush();
  return sections.filter((section) => section.heading.length > 0);
}

function listItems(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .map((line) =>
      line
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .trim(),
    )
    .filter(
      (line) =>
        line.length > 0 &&
        line !== "_None identified_" &&
        line !== "_None proposed_",
    );
}
