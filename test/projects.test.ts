import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { getProjectStatus, listProjects } from "../src/commands/projects.js";
import { AgentDatabase } from "../src/storage/database.js";

test("projects navigation reflects workspace files and next actions", () => {
  const root = mkdtempSync(join(tmpdir(), "forem-agent-projects-"));
  const config: AppConfig = {
    foremBaseUrl: "https://dev.to/api",
    homeDir: root,
    databasePath: join(root, "forem-agent.db"),
    workspaceDir: join(root, "articles"),
    openaiModel: "fake-model",
    openaiBaseUrl: "https://api.openai.com/v1",
  };

  try {
    const database = new AgentDatabase(config.databasePath);

    const proposedPath = join(config.workspaceDir, "proposed-project");
    mkdirSync(proposedPath, { recursive: true });
    writeFileSync(join(proposedPath, "brief.md"), "status: proposed\n");

    database.createEditorialProject({
      id: "proposed-id",
      slug: "proposed-project",
      title: "Proposed Project",
      thesis: "Thesis",
      audience: "Readers",
      status: "proposed",
      workspacePath: proposedPath,
    });

    const draftedPath = join(config.workspaceDir, "drafted-project");
    mkdirSync(draftedPath, { recursive: true });
    writeFileSync(join(draftedPath, "brief.md"), "status: approved\n");
    writeFileSync(join(draftedPath, "draft.md"), "# Draft\n");

    database.createEditorialProject({
      id: "drafted-id",
      slug: "drafted-project",
      title: "Drafted Project",
      thesis: "Thesis",
      audience: "Readers",
      status: "approved",
      workspacePath: draftedPath,
    });

    database.close();

    const projects = listProjects(config);
    assert.equal(projects.length, 2);

    const proposed = getProjectStatus(config, "proposed-project");
    assert.equal(proposed.stage, "proposed");
    assert.match(proposed.nextAction, /approve proposed-project/);

    const drafted = getProjectStatus(config, "drafted-project");
    assert.equal(drafted.stage, "draft");
    assert.equal(drafted.hasDraft, true);
    assert.match(drafted.nextAction, /revision passes are the next workflow step/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
