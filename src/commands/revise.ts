import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import type { AppConfig } from "../config.js";
import {
  extractEditorialNotes,
  mergeEditorialNotes,
  sha256,
} from "../editorial/article-files.js";
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
  sourceArticle: string;
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
    const workingPath = resolve(project.workspacePath, "working.md");
    const editorialNotesPath = resolve(
      project.workspacePath,
      "editorial-notes.md",
    );

    if (!existsSync(briefPath)) {
      throw new Error(`Project brief is missing: ${briefPath}`);
    }
    if (!existsSync(draftPath) && !existsSync(workingPath)) {
      throw new Error(
        `Project has no draft yet and no working article: ${project.workspacePath}. Write or draft the article before running revisions.`,
      );
    }

    const sourcePath = existsSync(workingPath) ? workingPath : draftPath;
    const sourceMarkdown = readFileSync(sourcePath, "utf8");
    const extracted = extractEditorialNotes(sourceMarkdown);

    let editorialNotesMarkdown = existsSync(editorialNotesPath)
      ? readFileSync(editorialNotesPath, "utf8")
      : null;

    const mergedNotes = mergeEditorialNotes(
      editorialNotesMarkdown,
      extracted.notesMarkdown,
    );
    if (mergedNotes && mergedNotes !== editorialNotesMarkdown) {
      writeFileSync(editorialNotesPath, mergedNotes, "utf8");
      editorialNotesMarkdown = mergedNotes;
    }

    const briefMarkdown = readFileSync(briefPath, "utf8");
    const sourceHash = sha256(sourceMarkdown);
    const sourceArticle = basename(sourcePath);

    const revision = await runRevisionPass(model, pass, {
      briefMarkdown,
      articleMarkdown: extracted.articleMarkdown,
      editorialNotesMarkdown,
    });

    const revisionsDir = resolve(project.workspacePath, "revisions");
    mkdirSync(revisionsDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = resolve(
      revisionsDir,
      `${stamp}-${pass}.md`,
    );

    const rendered =
      revision.kind === "claim-review"
        ? renderClaimReview({
            sourceArticle,
            sourceSha256: sourceHash,
            model: revision.model,
            review: revision.data,
          })
        : renderRewriteProposal({
            pass: pass as Exclude<RevisionPass, "claim-check">,
            sourceArticle,
            sourceSha256: sourceHash,
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
      sourceArticle,
      model: revision.model,
      summary: revision.data.summary,
    };
  } finally {
    database.close();
  }
}
