import { createHash } from "node:crypto";

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
