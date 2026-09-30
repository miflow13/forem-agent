import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { AppConfig } from "../config.js";
import {
  parseSectionAssistanceProposal,
  renderSectionAssistanceProposal,
  sha256,
} from "../editorial/article-files.js";
import {
  generateSectionAssistance,
  parseDraftBrief,
  type SectionAssistanceType,
} from "../editorial/drafter.js";
import { createConfiguredModel } from "../providers/configured-model.js";
import type { StructuredTextModel } from "../providers/structured-text-model.js";
import { AgentDatabase } from "../storage/database.js";

export type { SectionAssistanceType } from "../editorial/drafter.js";

export type SectionAssistanceResult = {
  projectId: string;
  slug: string;
  sectionIndex: number;
  sectionHeading: string;
  assistanceType: SectionAssistanceType;
  proposalPath: string;
  model: string;
};

export async function runSectionAssistance(
  config: AppConfig,
  reference: string,
  sectionNumber: number,
  assistanceType: SectionAssistanceType,
  injectedModel?: StructuredTextModel,
): Promise<SectionAssistanceResult> {
  const database = new AgentDatabase(config.databasePath);

  try {
    const project = database.findEditorialProject(reference);
    if (!project) throw new Error(`Unknown editorial project: ${reference}`);
    if (project.writingMode !== "section_assisted") {
      throw new Error(
        `Project ${project.slug} is not in section-assisted writing mode.`,
      );
    }

    const briefPath = resolve(project.workspacePath, "brief.md");
    const workingPath = resolve(project.workspacePath, "working.md");
    if (!existsSync(briefPath)) {
      throw new Error(`Project brief is missing: ${briefPath}`);
    }
    if (!existsSync(workingPath)) {
      throw new Error(`Human-owned article is missing: ${workingPath}`);
    }

    const brief = parseDraftBrief(readFileSync(briefPath, "utf8"));
    const model = injectedModel ?? createConfiguredModel(config);
    if (!model) {
      throw new Error(
        "Section assistance requires a configured AI provider.",
      );
    }

    const sourceMarkdown = readFileSync(workingPath, "utf8");
    const generated = await generateSectionAssistance(
      model,
      brief,
      sectionNumber,
      assistanceType,
    );
    const revisionsDir = resolve(project.workspacePath, "revisions");
    mkdirSync(revisionsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const proposalPath = resolve(
      revisionsDir,
      `${stamp}-section-${sectionNumber}-${assistanceType}.md`,
    );

    writeFileSync(
      proposalPath,
      renderSectionAssistanceProposal({
        sourceSha256: sha256(sourceMarkdown),
        sectionIndex: sectionNumber,
        sectionHeading: generated.heading,
        assistanceType,
        model: generated.model,
        proposedContent: generated.markdown,
      }),
      { encoding: "utf8", flag: "wx" },
    );

    return {
      projectId: project.id,
      slug: project.slug,
      sectionIndex: sectionNumber,
      sectionHeading: generated.heading,
      assistanceType,
      proposalPath,
      model: generated.model,
    };
  } finally {
    database.close();
  }
}

export function acceptSectionAssistance(
  config: AppConfig,
  reference: string,
  proposalReference: string,
): { proposalPath: string; workingPath: string; sectionHeading: string } {
  const database = new AgentDatabase(config.databasePath);

  try {
    const project = database.findEditorialProject(reference);
    if (!project) throw new Error(`Unknown editorial project: ${reference}`);
    if (project.writingMode !== "section_assisted") {
      throw new Error(
        `Project ${project.slug} is not in section-assisted writing mode.`,
      );
    }

    const revisionsDir = resolve(project.workspacePath, "revisions");
    const proposalPath = resolveProposalPath(
      revisionsDir,
      proposalReference,
    );
    if (!existsSync(proposalPath)) {
      throw new Error(`Section proposal not found: ${proposalPath}`);
    }

    const proposal = parseSectionAssistanceProposal(
      readFileSync(proposalPath, "utf8"),
    );
    if (proposal.sourceArticle !== "working.md" || !proposal.sourceSha256) {
      throw new Error(
        "Section proposal does not reference a protected working.md source.",
      );
    }

    const workingPath = resolve(project.workspacePath, "working.md");
    if (!existsSync(workingPath)) {
      throw new Error(`Human-owned article is missing: ${workingPath}`);
    }
    const current = readFileSync(workingPath, "utf8");
    if (sha256(current) !== proposal.sourceSha256) {
      throw new Error(
        "Section proposal is stale because working.md changed after it was created. Request assistance again.",
      );
    }

    const updated = [
      current.trimEnd(),
      "",
      `## ${proposal.sectionHeading}`,
      "",
      proposal.proposedContent.trim(),
      "",
    ].join("\n");
    writeFileSync(workingPath, updated, "utf8");

    return {
      proposalPath,
      workingPath,
      sectionHeading: proposal.sectionHeading,
    };
  } finally {
    database.close();
  }
}

function resolveProposalPath(
  revisionsDir: string,
  reference: string,
): string {
  const candidate = isAbsolute(reference)
    ? resolve(reference)
    : resolve(revisionsDir, reference);
  const rel = relative(revisionsDir, candidate);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error(
      "Section proposal must be inside this project's revisions directory.",
    );
  }
  return candidate.endsWith(".md") ? candidate : `${candidate}.md`;
}
