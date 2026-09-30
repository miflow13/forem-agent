import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { AppConfig } from "../config.js";
import {
  generateEditorialBrief,
  selectPlanEvidence,
  type EditorialBrief,
} from "../editorial/planner.js";
import {
  EditorialWorkspace,
  slugify,
  type WorkspaceProject,
} from "../editorial/workspace.js";
import type { StructuredTextModel } from "../providers/structured-text-model.js";
import { createConfiguredModel } from "../providers/configured-model.js";
import {
  AgentDatabase,
  type StoredEditorialProject,
} from "../storage/database.js";

export type PlanResult = {
  project: StoredEditorialProject;
  workspace: WorkspaceProject;
  brief: EditorialBrief;
  model: string;
};

export async function runPlan(
  config: AppConfig,
  reference: string,
  injectedModel?: StructuredTextModel,
): Promise<PlanResult> {
  const model = injectedModel ?? createConfiguredModel(config);
  if (!model) {
    throw new Error(
      "Planning requires a configured model. Set OPENAI_API_KEY or inject a StructuredTextModel.",
    );
  }

  const database = new AgentDatabase(config.databasePath);
  const workspace = new EditorialWorkspace(config.workspaceDir);

  try {
    const evidence = selectPlanEvidence(
      reference,
      database.listLatestResearchArticles(),
    );
    const generated = await generateEditorialBrief(model, evidence);
    const title = generated.brief.title_options[0] ?? reference;
    const slug = uniqueProjectSlug(slugify(title), database);
    const projectId = randomUUID();

    const createdWorkspace = workspace.createProject(
      projectId,
      slug,
      generated.brief,
      {
        model: generated.model,
        reference: evidence.reference,
      },
    );

    try {
      const project = database.createEditorialProject({
        id: projectId,
        slug,
        title,
        thesis: generated.brief.thesis,
        audience: generated.brief.intended_reader,
        status: "proposed",
        workspacePath: createdWorkspace.path,
      });

      return {
        project,
        workspace: createdWorkspace,
        brief: generated.brief,
        model: generated.model,
      };
    } catch (error) {
      workspace.removeProject(createdWorkspace.path);
      throw error;
    }
  } finally {
    database.close();
  }
}

export function approvePlan(
  config: AppConfig,
  reference: string,
): StoredEditorialProject {
  const database = new AgentDatabase(config.databasePath);
  const workspace = new EditorialWorkspace(config.workspaceDir);

  try {
    const project = database.findEditorialProject(reference);
    if (!project) {
      throw new Error(`Unknown editorial project: ${reference}`);
    }
    if (project.status !== "proposed") {
      throw new Error(
        `Project ${project.slug} is "${project.status}", not "proposed".`,
      );
    }

    const briefPath = resolve(project.workspacePath, "brief.md");
    workspace.approveBrief(briefPath);

    try {
      return database.setEditorialProjectStatus(
        project.id,
        "approved",
      );
    } catch (error) {
      workspace.revertApproval(briefPath);
      throw error;
    }
  } finally {
    database.close();
  }
}

function uniqueProjectSlug(
  base: string,
  database: AgentDatabase,
): string {
  if (!database.editorialProjectSlugExists(base)) return base;

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!database.editorialProjectSlugExists(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not allocate a unique project slug.");
}
