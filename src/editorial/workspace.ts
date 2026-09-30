import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { EditorialBrief } from "./planner.js";

export type WorkspaceProject = {
  id: string;
  slug: string;
  path: string;
  briefPath: string;
};

export class EditorialWorkspace {
  constructor(private readonly root: string) {}

  createProject(
    projectId: string,
    slug: string,
    brief: EditorialBrief,
    metadata: { model: string; reference: string },
  ): WorkspaceProject {
    const safeSlug = slugify(slug);
    const path = resolve(this.root, safeSlug);

    if (existsSync(path)) {
      throw new Error(`Workspace project already exists: ${path}`);
    }

    mkdirSync(path, { recursive: true });
    const briefPath = resolve(path, "brief.md");

    try {
      writeFileSync(
        briefPath,
        renderBriefMarkdown(
          projectId,
          safeSlug,
          "proposed",
          brief,
          metadata,
        ),
        "utf8",
      );
    } catch (error) {
      rmSync(path, { recursive: true, force: true });
      throw error;
    }

    return { id: projectId, slug: safeSlug, path, briefPath };
  }

  approveBrief(briefPath: string): void {
    const before = readFileSync(briefPath, "utf8");

    if (!before.includes("status: proposed")) {
      throw new Error(
        "Brief is not in proposed status and cannot be approved.",
      );
    }

    const after = before.replace(
      "status: proposed",
      "status: approved",
    );
    writeFileSync(briefPath, after, "utf8");
  }

  revertApproval(briefPath: string): void {
    const before = readFileSync(briefPath, "utf8");
    writeFileSync(
      briefPath,
      before.replace("status: approved", "status: proposed"),
      "utf8",
    );
  }

  removeProject(path: string): void {
    rmSync(path, { recursive: true, force: true });
  }
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 72);

  return slug || "untitled-article";
}

export function renderBriefMarkdown(
  projectId: string,
  slug: string,
  status: "proposed" | "approved",
  brief: EditorialBrief,
  metadata: { model: string; reference: string },
): string {
  const lines = [
    "---",
    `project_id: ${projectId}`,
    `slug: ${slug}`,
    `status: ${status}`,
    `model: ${metadata.model}`,
    `source_reference: ${JSON.stringify(metadata.reference)}`,
    "---",
    "",
    "# Editorial Brief",
    "",
    "## Intended reader",
    "",
    brief.intended_reader,
    "",
    "## Reader problem",
    "",
    brief.reader_problem,
    "",
    "## Thesis",
    "",
    brief.thesis,
    "",
    "## What this article covers",
    "",
    ...bullets(brief.covers),
    "",
    "## What this article does not cover",
    "",
    ...bullets(brief.does_not_cover),
    "",
    "## Evidence",
    "",
    ...bullets(brief.evidence_summary),
    "",
    "## Competing angles",
    "",
    ...bullets(brief.competing_angles),
    "",
    "## Differentiation",
    "",
    brief.differentiation,
    "",
    "## Outline",
    "",
  ];

  for (const [index, section] of brief.outline.entries()) {
    lines.push(
      `### ${index + 1}. ${section.heading}`,
      "",
      section.intent,
      "",
      "Evidence to use:",
      ...bullets(section.evidence),
      "",
    );
  }

  lines.push(
    "## Personal-experience placeholders",
    "",
    ...bullets(brief.personal_experience_placeholders),
    "",
    "## Technical claims to verify",
    "",
    ...bullets(brief.technical_claims_to_verify),
    "",
    "## Title options",
    "",
    ...brief.title_options.map((title, index) => `${index + 1}. ${title}`),
    "",
    "## Suggested tags",
    "",
    brief.tags.length > 0
      ? brief.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")
      : "_None proposed_",
    "",
    "## Risks and counterarguments",
    "",
    ...bullets(brief.risks_and_counterarguments),
    "",
    "> Edit this file directly. Drafting is enabled only after explicit approval.",
    "",
  );

  return lines.join("\n");
}

function bullets(values: string[]): string[] {
  return values.length > 0
    ? values.map((value) => `- ${value}`)
    : ["- _None identified_"];
}
