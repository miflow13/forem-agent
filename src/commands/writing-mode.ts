import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "../config.js";
import {
  renderAuthorWorkingMarkdown,
  renderEditorialNotesMarkdown,
} from "../editorial/article-files.js";
import { parseDraftBrief } from "../editorial/drafter.js";
import {
  AgentDatabase,
  type WritingMode,
} from "../storage/database.js";

export type WritingModeResult = {
  projectId: string;
  slug: string;
  writingMode: WritingMode;
  workingPath: string | null;
  editorialNotesPath: string | null;
};

export function selectWritingMode(
  config: AppConfig,
  reference: string,
  writingMode: WritingMode,
): WritingModeResult {
  const database = new AgentDatabase(config.databasePath);

  try {
    const project = database.findEditorialProject(reference);
    if (!project) {
      throw new Error(`Unknown editorial project: ${reference}`);
    }
    if (project.status !== "approved") {
      throw new Error(
        `Project ${project.slug} is "${project.status}", not "approved". Approve the brief before choosing a writing mode.`,
      );
    }
    if (project.writingMode) {
      throw new Error(
        `Project ${project.slug} already uses ${project.writingMode} writing mode.`,
      );
    }

    const briefPath = resolve(project.workspacePath, "brief.md");
    const draftPath = resolve(project.workspacePath, "draft.md");
    const workingPath = resolve(project.workspacePath, "working.md");
    const editorialNotesPath = resolve(
      project.workspacePath,
      "editorial-notes.md",
    );

    if (!existsSync(briefPath)) {
      throw new Error(`Approved brief is missing: ${briefPath}`);
    }
    if (existsSync(draftPath) || existsSync(workingPath)) {
      throw new Error(
        "Refusing to overwrite existing article content while choosing a writing mode.",
      );
    }

    if (writingMode === "ai_first_draft") {
      database.setEditorialProjectWritingMode(reference, writingMode);
      return {
        projectId: project.id,
        slug: project.slug,
        writingMode,
        workingPath: null,
        editorialNotesPath: null,
      };
    }

    if (existsSync(editorialNotesPath)) {
      throw new Error(
        `Editorial notes already exist: ${editorialNotesPath}. Refusing to overwrite author-owned notes.`,
      );
    }

    const brief = parseDraftBrief(readFileSync(briefPath, "utf8"));
    if (brief.status !== "approved") {
      throw new Error(
        `brief.md status is "${brief.status ?? "missing"}", not "approved".`,
      );
    }

    const working = renderAuthorWorkingMarkdown({
      projectId: project.id,
      slug: project.slug,
      title: brief.title,
      writingMode,
    });
    const notes = renderEditorialNotesMarkdown({
      projectId: project.id,
      slug: project.slug,
      personalExperiencePlaceholders:
        brief.personalExperiencePlaceholders,
      technicalClaimsToVerify: brief.technicalClaimsToVerify,
    });

    let wroteWorking = false;
    let wroteNotes = false;
    try {
      writeFileSync(workingPath, working, { encoding: "utf8", flag: "wx" });
      wroteWorking = true;
      writeFileSync(editorialNotesPath, notes, {
        encoding: "utf8",
        flag: "wx",
      });
      wroteNotes = true;
      database.setEditorialProjectWritingMode(reference, writingMode);
    } catch (error) {
      if (wroteWorking) rmSync(workingPath, { force: true });
      if (wroteNotes) rmSync(editorialNotesPath, { force: true });
      throw error;
    }

    return {
      projectId: project.id,
      slug: project.slug,
      writingMode,
      workingPath,
      editorialNotesPath,
    };
  } finally {
    database.close();
  }
}
