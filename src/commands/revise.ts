import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "../config.js";
import {
  renderClaimReview,
  renderRewriteProposal,
  runRevisionPass,
  type RevisionPass,
} from "../editorial/reviser.js";
import { createConfiguredModel } from "../providers/configured-model.js";
import type { StructuredTextModel } from "../providers/structured-text-model.js";
import { AgentDatabase } from "../storage/database.js";

export type RevisionResult = {
  projectId: string;
  slug: string;
  pass: RevisionPass;
  outputPath: string;
  model: string;
  summary: string;
};

export async function runRevision(
  config: AppConfig,
  reference: string,
  pass: RevisionPass,
  injectedModel?: StructuredTextModel,
): Promise<RevisionResult> {
  const model = injectedModel ?? createConfiguredModel(config);
  if (!model) {
    throw new Error(
      "Revision requires a configured model. Set OPENAI_API_KEY or inject a StructuredTextModel.",
    );
  }

  const database = new AgentDatabase(config.databasePath);

  try {
    const project = database.findEditorialProject(reference);
    if (!project) {
      throw new Error(`Unknown editorial project: ${reference}`);
    }

    const briefPath = resolve(project.workspacePath, "brief.md");
    const draftPath = resolve(project.workspacePath, "draft.md");

    if (!existsSync(briefPath)) {
      throw new Error(`Project brief is missing: ${briefPath}`);
    }
    if (!existsSync(draftPath)) {
      throw new Error(
        `Project has no draft yet: ${draftPath}. Draft it before running revisions.`,
      );
    }

    const briefMarkdown = readFileSync(briefPath, "utf8");
    const draftMarkdown = readFileSync(draftPath, "utf8");
    const revision = await runRevisionPass(model, pass, {
      briefMarkdown,
      draftMarkdown,
    });

    const revisionsDir = resolve(project.workspacePath, "revisions");
    mkdirSync(revisionsDir, { recursive: true });

    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-");
    const outputPath = resolve(
      revisionsDir,
      `${stamp}-${pass}.md`,
    );

    const rendered =
      revision.kind === "claim-review"
        ? renderClaimReview({
            sourceDraft: "draft.md",
            model: revision.model,
            review: revision.data,
          })
        : renderRewriteProposal({
            pass,
            sourceDraft: "draft.md",
            model: revision.model,
            revision: revision.data,
          });

    writeFileSync(outputPath, rendered, {
      encoding: "utf8",
      flag: "wx",
    });

    return {
      projectId: project.id,
      slug: project.slug,
      pass,
      outputPath,
      model: revision.model,
      summary: revision.data.summary,
    };
  } finally {
    database.close();
  }
}
