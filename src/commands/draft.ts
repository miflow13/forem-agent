import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "../config.js";
import { renderEditorialNotesMarkdown } from "../editorial/article-files.js";
import {
  generateDraftSections,
  parseDraftBrief,
  renderDraftMarkdown,
  type DraftProgressEvent,
} from "../editorial/drafter.js";
import { createConfiguredModel } from "../providers/configured-model.js";
import type { StructuredTextModel } from "../providers/structured-text-model.js";
import { AgentDatabase } from "../storage/database.js";

export type DraftResult = {
  projectId: string;
  slug: string;
  draftPath: string;
  editorialNotesPath: string;
  sectionCount: number;
  model: string;
};

export async function runDraft(
  config: AppConfig,
  reference: string,
  injectedModel?: StructuredTextModel,
  onProgress?: (event: DraftProgressEvent) => void,
): Promise<DraftResult> {
  const database = new AgentDatabase(config.databasePath);

  try {
    const project = database.findEditorialProject(reference);
    if (!project) {
      throw new Error(`Unknown editorial project: ${reference}`);
    }
    if (project.status !== "approved") {
      throw new Error(
        `Project ${project.slug} is "${project.status}", not "approved". Approve the brief before drafting.`,
      );
    }
    if (project.writingMode !== "ai_first_draft") {
      throw new Error(
        `Choose AI first draft mode explicitly before drafting ${project.slug}.`,
      );
    }

    const briefPath = resolve(project.workspacePath, "brief.md");
    const draftPath = resolve(project.workspacePath, "draft.md");
    const editorialNotesPath = resolve(
      project.workspacePath,
      "editorial-notes.md",
    );

    if (!existsSync(briefPath)) {
      throw new Error(`Approved brief is missing: ${briefPath}`);
    }
    if (existsSync(draftPath)) {
      throw new Error(
        `Draft already exists: ${draftPath}. Refusing to overwrite human-editable content.`,
      );
    }
    if (existsSync(editorialNotesPath)) {
      throw new Error(
        `Editorial notes already exist: ${editorialNotesPath}. Refusing to overwrite author-owned notes.`,
      );
    }

    const model = injectedModel ?? createConfiguredModel(config);
    if (!model) {
      throw new Error(
        "Drafting requires a configured model. Set OPENAI_API_KEY or inject a StructuredTextModel.",
      );
    }

    const brief = parseDraftBrief(readFileSync(briefPath, "utf8"));
    if (brief.status !== "approved") {
      throw new Error(
        `brief.md status is "${brief.status ?? "missing"}", not "approved".`,
      );
    }

    const generated = await generateDraftSections(model, brief, onProgress);
    const markdown = renderDraftMarkdown({
      projectId: project.id,
      slug: project.slug,
      title: brief.title,
      model: generated.model,
      sections: generated.sections,
    });
    const editorialNotes = renderEditorialNotesMarkdown({
      projectId: project.id,
      slug: project.slug,
      personalExperiencePlaceholders:
        brief.personalExperiencePlaceholders,
      technicalClaimsToVerify: brief.technicalClaimsToVerify,
    });

    let wroteDraft = false;
    let wroteNotes = false;

    try {
      writeFileSync(draftPath, markdown, {
        encoding: "utf8",
        flag: "wx",
      });
      wroteDraft = true;

      writeFileSync(editorialNotesPath, editorialNotes, {
        encoding: "utf8",
        flag: "wx",
      });
      wroteNotes = true;
    } catch (error) {
      if (wroteDraft) rmSync(draftPath, { force: true });
      if (wroteNotes) rmSync(editorialNotesPath, { force: true });
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : null;
      if (code === "EEXIST") {
        throw new Error(
          `Draft already exists: ${draftPath}. Refusing to overwrite human-editable content.`,
        );
      }
      throw error;
    }

    return {
      projectId: project.id,
      slug: project.slug,
      draftPath,
      editorialNotesPath,
      sectionCount: generated.sections.length,
      model: generated.model,
    };
  } finally {
    database.close();
  }
}
