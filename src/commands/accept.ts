import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import type { AppConfig } from "../config.js";
import {
  extractEditorialNotes,
  mergeEditorialNotes,
  renderWorkingMarkdown,
  sha256,
} from "../editorial/article-files.js";
import { parseRevisionProposal } from "../editorial/reviser.js";
import { AgentDatabase } from "../storage/database.js";

export type AcceptRevisionResult = {
  projectId: string;
  slug: string;
  pass: "structure" | "voice";
  revisionPath: string;
  workingPath: string;
  editorialNotesPath: string;
};

export function acceptRevision(
  config: AppConfig,
  projectReference: string,
  revisionReference: string,
): AcceptRevisionResult {
  const database = new AgentDatabase(config.databasePath);

  try {
    const project = database.findEditorialProject(projectReference);
    if (!project) {
      throw new Error(`Unknown editorial project: ${projectReference}`);
    }

    const revisionsDir = resolve(project.workspacePath, "revisions");
    const revisionPath = resolveRevisionPath(
      revisionsDir,
      revisionReference,
    );

    if (!existsSync(revisionPath)) {
      throw new Error(`Revision proposal not found: ${revisionPath}`);
    }

    const proposal = parseRevisionProposal(
      readFileSync(revisionPath, "utf8"),
    );

    if (!proposal.sourceSha256) {
      throw new Error(
        "This revision predates source-version protection. Re-run the revision pass before accepting it.",
      );
    }

    if (
      proposal.sourceArticle !== "draft.md" &&
      proposal.sourceArticle !== "working.md"
    ) {
      throw new Error(
        `Revision references unsupported source article: ${proposal.sourceArticle}`,
      );
    }

    const sourcePath = resolve(
      project.workspacePath,
      proposal.sourceArticle,
    );
    if (!existsSync(sourcePath)) {
      throw new Error(
        `Revision source is missing: ${sourcePath}`,
      );
    }

    const sourceMarkdown = readFileSync(sourcePath, "utf8");
    const currentHash = sha256(sourceMarkdown);
    if (currentHash !== proposal.sourceSha256) {
      throw new Error(
        "Revision is stale because its source article changed after the proposal was created. Run the revision pass again.",
      );
    }

    const workingPath = resolve(project.workspacePath, "working.md");
    const editorialNotesPath = resolve(
      project.workspacePath,
      "editorial-notes.md",
    );

    const extracted = extractEditorialNotes(
      proposal.proposedArticle,
    );
    const previousWorking = existsSync(workingPath)
      ? readFileSync(workingPath, "utf8")
      : null;
    const previousNotes = existsSync(editorialNotesPath)
      ? readFileSync(editorialNotesPath, "utf8")
      : null;
    const mergedNotes = mergeEditorialNotes(
      previousNotes,
      extracted.notesMarkdown,
    );

    const workingMarkdown = renderWorkingMarkdown({
      projectId: project.id,
      slug: project.slug,
      acceptedRevision: relative(
        project.workspacePath,
        revisionPath,
      ),
      articleMarkdown: extracted.articleMarkdown,
    });

    let wroteWorking = false;
    let wroteNotes = false;

    try {
      writeFileSync(workingPath, workingMarkdown, "utf8");
      wroteWorking = true;

      if (mergedNotes !== null && mergedNotes !== previousNotes) {
        writeFileSync(editorialNotesPath, mergedNotes, "utf8");
        wroteNotes = true;
      }
    } catch (error) {
      if (wroteWorking) {
        if (previousWorking === null) {
          rmSync(workingPath, { force: true });
        } else {
          writeFileSync(workingPath, previousWorking, "utf8");
        }
      }

      if (wroteNotes) {
        if (previousNotes === null) {
          rmSync(editorialNotesPath, { force: true });
        } else {
          writeFileSync(editorialNotesPath, previousNotes, "utf8");
        }
      }

      throw error;
    }

    return {
      projectId: project.id,
      slug: project.slug,
      pass: proposal.pass,
      revisionPath,
      workingPath,
      editorialNotesPath,
    };
  } finally {
    database.close();
  }
}

function resolveRevisionPath(
  revisionsDir: string,
  reference: string,
): string {
  const candidate = isAbsolute(reference)
    ? resolve(reference)
    : resolve(revisionsDir, reference);

  const rel = relative(revisionsDir, candidate);
  if (
    rel === ".." ||
    rel.startsWith("../") ||
    isAbsolute(rel)
  ) {
    throw new Error(
      "Revision must be a file inside this project's revisions directory.",
    );
  }

  if (existsSync(candidate)) return candidate;

  if (!candidate.endsWith(".md")) {
    const withExtension = `${candidate}.md`;
    if (existsSync(withExtension)) return withExtension;
  }

  return candidate;
}
