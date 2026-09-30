import { createHash } from "node:crypto";
import type { WritingMode } from "../storage/database.js";
import type { SectionAssistanceType } from "./drafter.js";

export type ExtractedEditorialNotes = {
  articleMarkdown: string;
  notesMarkdown: string | null;
};

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function stripFrontmatter(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return markdown;

  const closing = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (closing < 0) return markdown;

  return lines.slice(closing + 1).join("\n").trimStart();
}

export function hasArticleBody(markdown: string): boolean {
  return stripFrontmatter(markdown)
    .replace(/^#{1,6}\s+.*$/gm, "")
    .trim().length > 0;
}

export function extractEditorialNotes(
  markdown: string,
): ExtractedEditorialNotes {
  const lines = markdown.split(/\r?\n/);
  const targets = new Set([
    "## Author notes to complete",
    "## Claims to verify before publishing",
  ]);

  const kept: string[] = [];
  const captured: string[] = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index] ?? "";

    if (!targets.has(line.trim())) {
      kept.push(line);
      index += 1;
      continue;
    }

    const section: string[] = [line];
    index += 1;

    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (/^##\s+/.test(next)) break;
      section.push(next);
      index += 1;
    }

    while (section.length > 0 && section.at(-1)?.trim() === "") {
      section.pop();
    }

    captured.push(section.join("\n"));
  }

  return {
    articleMarkdown: kept.join("\n").trimEnd() + "\n",
    notesMarkdown:
      captured.length > 0
        ? captured.join("\n\n").trimEnd() + "\n"
        : null,
  };
}

export function renderEditorialNotesMarkdown(input: {
  projectId: string;
  slug: string;
  personalExperiencePlaceholders: string[];
  technicalClaimsToVerify: string[];
}): string {
  const lines = [
    "---",
    `project_id: ${input.projectId}`,
    `slug: ${input.slug}`,
    "status: editorial-notes",
    "---",
    "",
    "# Editorial Notes",
    "",
    "> Internal author and verification notes. This file is not part of the publishable article.",
    "",
    "## Author notes to complete",
    "",
    ...(input.personalExperiencePlaceholders.length > 0
      ? input.personalExperiencePlaceholders.map((item) => `- ${item}`)
      : ["- _None identified_"]),
    "",
    "## Claims to verify before publishing",
    "",
    ...(input.technicalClaimsToVerify.length > 0
      ? input.technicalClaimsToVerify.map((item) => `- ${item}`)
      : ["- _None identified_"]),
    "",
  ];

  return lines.join("\n");
}

export function mergeEditorialNotes(
  existing: string | null,
  captured: string | null,
): string | null {
  if (!captured) return existing;
  if (!existing) {
    return [
      "# Editorial Notes",
      "",
      "> Internal author and verification notes. This file is not part of the publishable article.",
      "",
      captured.trim(),
      "",
    ].join("\n");
  }

  if (existing.includes(captured.trim())) return existing;

  return [
    existing.trimEnd(),
    "",
    "## Notes captured from accepted revision",
    "",
    captured.trim(),
    "",
  ].join("\n");
}

export function renderWorkingMarkdown(input: {
  projectId: string;
  slug: string;
  acceptedRevision: string;
  articleMarkdown: string;
}): string {
  return [
    "---",
    `project_id: ${input.projectId}`,
    `slug: ${input.slug}`,
    "status: working",
    `accepted_revision: ${JSON.stringify(input.acceptedRevision)}`,
    `accepted_at: ${new Date().toISOString()}`,
    "---",
    "",
    stripFrontmatter(input.articleMarkdown).trim(),
    "",
  ].join("\n");
}

export function renderAuthorWorkingMarkdown(input: {
  projectId: string;
  slug: string;
  title: string;
  writingMode: Extract<WritingMode, "human" | "section_assisted">;
}): string {
  return [
    "---",
    `project_id: ${input.projectId}`,
    `slug: ${input.slug}`,
    "status: working",
    `writing_mode: ${input.writingMode}`,
    "source_brief: brief.md",
    "---",
    "",
    `# ${input.title}`,
    "",
  ].join("\n");
}

export type ParsedSectionAssistanceProposal = {
  sourceArticle: string;
  sourceSha256: string | null;
  sectionIndex: number;
  sectionHeading: string;
  assistanceType: SectionAssistanceType;
  proposedContent: string;
};

export function renderSectionAssistanceProposal(input: {
  sourceSha256: string;
  sectionIndex: number;
  sectionHeading: string;
  assistanceType: SectionAssistanceType;
  model: string;
  proposedContent: string;
}): string {
  return [
    "---",
    "revision_pass: section_assist",
    "source_article: working.md",
    `source_sha256: ${input.sourceSha256}`,
    `section_index: ${input.sectionIndex}`,
    `section_heading: ${JSON.stringify(input.sectionHeading)}`,
    `assistance_type: ${input.assistanceType}`,
    `model: ${input.model}`,
    `created_at: ${new Date().toISOString()}`,
    "---",
    "",
    "# Section assistance proposal",
    "",
    "> This model output is a non-destructive proposal. Review it before accepting it into working.md.",
    "",
    "## Proposed section content",
    "",
    input.proposedContent.trim(),
    "",
  ].join("\n");
}

export function parseSectionAssistanceProposal(
  markdown: string,
): ParsedSectionAssistanceProposal {
  const lines = markdown.split(/\r?\n/);
  const fields: Record<string, string> = {};

  if (lines[0]?.trim() === "---") {
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.trim() === "---") break;
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) continue;
      let value = match[2]?.trim() ?? "";
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      fields[match[1] ?? ""] = value;
    }
  }

  if (fields.revision_pass !== "section_assist") {
    throw new Error("Proposal is not section assistance.");
  }
  if (
    fields.assistance_type !== "talking_points" &&
    fields.assistance_type !== "starter" &&
    fields.assistance_type !== "draft_section"
  ) {
    throw new Error("Section proposal has an unknown assistance type.");
  }

  const marker = lines.findIndex(
    (line) => line.trim() === "## Proposed section content",
  );
  const proposedContent =
    marker >= 0 ? lines.slice(marker + 1).join("\n").trim() : "";
  const sectionIndex = Number(fields.section_index);
  if (!Number.isInteger(sectionIndex) || sectionIndex < 1) {
    throw new Error("Section proposal has an invalid section index.");
  }
  if (!fields.section_heading || !proposedContent) {
    throw new Error("Section proposal is missing its heading or content.");
  }

  return {
    sourceArticle: fields.source_article ?? "",
    sourceSha256: fields.source_sha256 ?? null,
    sectionIndex,
    sectionHeading: fields.section_heading,
    assistanceType: fields.assistance_type,
    proposedContent: proposedContent + "\n",
  };
}
