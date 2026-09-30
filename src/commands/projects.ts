import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "../config.js";
import {
  AgentDatabase,
  type StoredEditorialProject,
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
  acceptedPass: "structure" | "voice" | null;
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

  const acceptedPass = hasWorking
    ? acceptedRevisionPass(workingPath)
    : null;

  const stage = hasWorking
    ? "working"
    : hasDraft
      ? "draft"
      : project.status;

  let nextAction: string;

  if (!hasBrief) {
    nextAction = "Restore or recreate brief.md before continuing.";
  } else if (stage === "proposed") {
    nextAction = `forem-agent approve ${project.slug}`;
  } else if (stage === "approved") {
    nextAction = `forem-agent draft ${project.slug}`;
  } else if (stage === "draft") {
    nextAction = `forem-agent revise ${project.slug} --pass structure`;
  } else if (stage === "working") {
    nextAction = nextWorkingAction(project.slug, acceptedPass);
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
    acceptedPass,
    stage,
    nextAction,
  };
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
): string {
  if (acceptedPass === "structure") {
    return `forem-agent revise ${slug} --pass voice`;
  }
  if (acceptedPass === "voice") {
    return `forem-agent revise ${slug} --pass claim-check`;
  }

  return `forem-agent revise ${slug} --pass structure`;
}
