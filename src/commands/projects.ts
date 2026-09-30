import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "../config.js";
import { hasArticleBody } from "../editorial/article-files.js";
import { parseDraftBrief } from "../editorial/drafter.js";
import {
  AgentDatabase,
  type StoredEditorialProject,
  type WritingMode,
} from "../storage/database.js";

export type ProjectSummary = {
  project: StoredEditorialProject;
  briefPath: string;
  draftPath: string;
  workingPath: string;
  editorialNotesPath: string;
  hasBrief: boolean;
  hasDraft: boolean;
  hasWorking: boolean;
  hasEditorialNotes: boolean;
  hasArticleContent: boolean;
  acceptedPass: "structure" | "voice" | null;
  nextSectionNumber: number | null;
  writingMode: WritingMode | null;
  stage: "proposed" | "approved" | "draft" | "working" | string;
  nextAction: string;
};

export function listProjects(config: AppConfig): ProjectSummary[] {
  const database = new AgentDatabase(config.databasePath);

  try {
    return database.listEditorialProjects().map(summarizeProject);
  } finally {
    database.close();
  }
}

export function getProjectStatus(
  config: AppConfig,
  reference: string,
): ProjectSummary {
  const database = new AgentDatabase(config.databasePath);

  try {
    const project = database.findEditorialProject(reference);
    if (!project) {
      throw new Error(`Unknown editorial project: ${reference}`);
    }
    return summarizeProject(project);
  } finally {
    database.close();
  }
}

function summarizeProject(project: StoredEditorialProject): ProjectSummary {
  const briefPath = resolve(project.workspacePath, "brief.md");
  const draftPath = resolve(project.workspacePath, "draft.md");
  const workingPath = resolve(project.workspacePath, "working.md");
  const editorialNotesPath = resolve(
    project.workspacePath,
    "editorial-notes.md",
  );

  const hasBrief = existsSync(briefPath);
  const hasDraft = existsSync(draftPath);
  const hasWorking = existsSync(workingPath);
  const hasEditorialNotes = existsSync(editorialNotesPath);
  const hasArticleContent =
    (hasWorking && hasArticleBody(readFileSync(workingPath, "utf8"))) ||
    (hasDraft && hasArticleBody(readFileSync(draftPath, "utf8")));

  const acceptedPass = hasWorking
    ? acceptedRevisionPass(workingPath)
    : null;

  const stage = hasWorking
    ? "working"
    : hasDraft
      ? "draft"
      : project.status;
  const writingMode = effectiveWritingMode(
    project,
    hasDraft,
    hasWorking,
  );
  const nextSectionNumber =
    writingMode === "section_assisted" && hasWorking
      ? findNextSectionNumber(briefPath, workingPath)
      : null;

  let nextAction: string;

  if (!hasBrief) {
    nextAction = "Restore or recreate brief.md before continuing.";
  } else if (stage === "proposed") {
    nextAction = `meldr approve ${project.slug}`;
  } else if (stage === "approved") {
    nextAction =
      writingMode === "ai_first_draft"
        ? `meldr draft ${project.slug}`
        : `meldr mode ${project.slug}`;
  } else if (stage === "draft") {
    nextAction = `meldr revise ${project.slug} --pass structure`;
  } else if (stage === "working") {
    nextAction =
      writingMode === "human" && !hasArticleContent
        ? `Write in working.md before review: ${workingPath}`
        : nextWorkingAction(
            project.slug,
            acceptedPass,
            writingMode,
            nextSectionNumber,
          );
  } else {
    nextAction = "Inspect the project workspace before continuing.";
  }

  return {
    project,
    briefPath,
    draftPath,
    workingPath,
    editorialNotesPath,
    hasBrief,
    hasDraft,
    hasWorking,
    hasEditorialNotes,
    hasArticleContent,
    acceptedPass,
    nextSectionNumber,
    writingMode,
    stage,
    nextAction,
  };
}

function effectiveWritingMode(
  project: StoredEditorialProject,
  hasDraft: boolean,
  hasWorking: boolean,
): WritingMode | null {
  if (project.writingMode) return project.writingMode;
  if (hasDraft) return "ai_first_draft";
  if (hasWorking) return "human";
  return null;
}

function acceptedRevisionPass(
  workingPath: string,
): "structure" | "voice" | null {
  const markdown = readFileSync(workingPath, "utf8");
  const accepted = markdown.match(
    /^accepted_revision:\s*["']?([^"'\r\n]+)["']?$/m,
  )?.[1];

  if (accepted?.includes("-structure.md")) return "structure";
  if (accepted?.includes("-voice.md")) return "voice";
  return null;
}

function nextWorkingAction(
  slug: string,
  acceptedPass: "structure" | "voice" | null,
  writingMode: WritingMode | null,
  nextSectionNumber: number | null,
): string {
  if (
    writingMode === "section_assisted" &&
    acceptedPass === null &&
    nextSectionNumber !== null
  ) {
    return `meldr section ${slug} ${nextSectionNumber} --assist talking_points`;
  }
  if (acceptedPass === "structure") {
    return `meldr revise ${slug} --pass voice`;
  }
  if (acceptedPass === "voice") {
    return `meldr revise ${slug} --pass claim-check`;
  }

  return `meldr revise ${slug} --pass structure`;
}

function findNextSectionNumber(
  briefPath: string,
  workingPath: string,
): number | null {
  if (!existsSync(briefPath) || !existsSync(workingPath)) return null;

  try {
    const brief = parseDraftBrief(readFileSync(briefPath, "utf8"));
    const working = readFileSync(workingPath, "utf8");
    const completedHeadings = new Set(
      working
        .split(/\r?\n/)
        .map((line) => line.match(/^##\s+(.+)$/)?.[1]?.trim())
        .filter((heading): heading is string => Boolean(heading)),
    );
    const nextIndex = brief.outline.findIndex(
      (section) => !completedHeadings.has(section.heading),
    );
    return nextIndex < 0 ? null : nextIndex + 1;
  } catch {
    return null;
  }
}
