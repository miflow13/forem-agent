import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { getProjectStatus, listProjects } from "../src/commands/projects.js";
import { AgentDatabase } from "../src/storage/database.js";
import {
  friendlyNextStep,
  projectActions,
  writingModeMenuOptions,
} from "../src/tui/app.js";

test("projects navigation reflects draft and accepted working states", () => {
  const root = mkdtempSync(join(tmpdir(), "forem-agent-projects-"));
  const config: AppConfig = {
    foremBaseUrl: "https://dev.to/api",
    homeDir: root,
    databasePath: join(root, "forem-agent.db"),
    workspaceDir: join(root, "articles"),
    modelProvider: "openai",
    modelApiKey: "fake-key",
    modelName: "fake-model",
    modelBaseUrl: "https://api.openai.com/v1",
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

    const approvedPath = join(config.workspaceDir, "approved-project");
    mkdirSync(approvedPath, { recursive: true });
    writeFileSync(join(approvedPath, "brief.md"), "status: approved\n");

    database.createEditorialProject({
      id: "approved-id",
      slug: "approved-project",
      title: "Approved Project",
      thesis: "Thesis",
      audience: "Readers",
      status: "approved",
      workspacePath: approvedPath,
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

    const workingPath = join(config.workspaceDir, "working-project");
    mkdirSync(workingPath, { recursive: true });
    writeFileSync(join(workingPath, "brief.md"), "status: approved\n");
    writeFileSync(join(workingPath, "draft.md"), "# Original\n");
    writeFileSync(
      join(workingPath, "working.md"),
      [
        "---",
        "status: working",
        'accepted_revision: "revisions/2026-09-30-structure.md"',
        "---",
        "",
        "# Working",
      ].join("\n"),
    );
    writeFileSync(
      join(workingPath, "editorial-notes.md"),
      "# Editorial Notes\n",
    );

    database.createEditorialProject({
      id: "working-id",
      slug: "working-project",
      title: "Working Project",
      thesis: "Thesis",
      audience: "Readers",
      status: "approved",
      workspacePath: workingPath,
    });

    const humanPath = join(config.workspaceDir, "human-project");
    mkdirSync(humanPath, { recursive: true });
    writeFileSync(join(humanPath, "brief.md"), "status: approved\n");
    writeFileSync(
      join(humanPath, "working.md"),
      "# Human draft\n\nA human-authored paragraph.\n",
    );

    database.createEditorialProject({
      id: "human-id",
      slug: "human-project",
      title: "Human Project",
      thesis: "Thesis",
      audience: "Readers",
      status: "approved",
      workspacePath: humanPath,
    });

    const sectionPath = join(config.workspaceDir, "section-project");
    mkdirSync(sectionPath, { recursive: true });
    writeFileSync(
      join(sectionPath, "brief.md"),
      [
        "---",
        "status: approved",
        "---",
        "",
        "## Outline",
        "",
        "### 1. Opening",
        "",
        "Open the article.",
        "",
        "### 2. Boundary",
        "",
        "Explain the boundary.",
      ].join("\n"),
    );
    writeFileSync(join(sectionPath, "working.md"), "# Section draft\n");

    database.createEditorialProject({
      id: "section-id",
      slug: "section-project",
      title: "Section Project",
      thesis: "Thesis",
      audience: "Readers",
      status: "approved",
      workspacePath: sectionPath,
    });
    database.setEditorialProjectWritingMode(
      "section-project",
      "section_assisted",
    );

    database.close();

    const projects = listProjects(config);
    assert.equal(projects.length, 6);

    const proposed = getProjectStatus(config, "proposed-project");
    assert.equal(proposed.stage, "proposed");
    assert.match(proposed.nextAction, /approve proposed-project/);

    const approved = getProjectStatus(config, "approved-project");
    assert.equal(approved.stage, "approved");
    assert.equal(approved.writingMode, null);
    assert.equal(approved.nextAction, "meldr mode approved-project");
    assert.equal(friendlyNextStep(approved), "Choose writing mode");
    assert.deepEqual(projectActions(approved, false, false)[0], {
      label: "Next · Choose writing mode",
      value: "choose-mode",
      description: "Decide how much writing help you want for this project.",
    });

    const drafted = getProjectStatus(config, "drafted-project");
    assert.equal(drafted.stage, "draft");
    assert.equal(drafted.hasDraft, true);
    assert.equal(drafted.hasWorking, false);
    assert.equal(drafted.writingMode, "ai_first_draft");
    assert.match(drafted.nextAction, /revise drafted-project --pass structure/);

    const working = getProjectStatus(config, "working-project");
    assert.equal(working.stage, "working");
    assert.equal(working.hasWorking, true);
    assert.equal(working.writingMode, "ai_first_draft");
    assert.equal(working.hasEditorialNotes, true);
    assert.match(working.nextAction, /revise working-project --pass voice/);

    const human = getProjectStatus(config, "human-project");
    assert.equal(human.stage, "working");
    assert.equal(human.writingMode, "human");
    assert.match(human.nextAction, /revise human-project --pass structure/);
    assert.equal(
      projectActions(human, false, false)[0]?.value,
      "structure",
    );

    const sectionProject = getProjectStatus(config, "section-project");
    assert.equal(sectionProject.writingMode, "section_assisted");
    assert.match(sectionProject.nextAction, /meldr section section-project/);
    assert.equal(
      projectActions(sectionProject, false, false)[0]?.value,
      "section-assist",
    );

    writeFileSync(
      join(sectionPath, "working.md"),
      "# Section draft\n\n## Opening\n\nOpening body.\n",
    );
    const secondSection = getProjectStatus(config, "section-project");
    assert.match(secondSection.nextAction, /section section-project 2/);

    writeFileSync(
      join(sectionPath, "working.md"),
      "# Section draft\n\n## Opening\n\nOpening body.\n\n## Boundary\n\nBoundary body.\n",
    );
    const readyToReview = getProjectStatus(config, "section-project");
    assert.match(readyToReview.nextAction, /revise section-project --pass structure/);
    assert.equal(
      projectActions(readyToReview, false, false)[0]?.value,
      "structure",
    );

    const modeOptions = writingModeMenuOptions();
    assert.equal(modeOptions[0]?.value, "human");
    assert.match(modeOptions[0]?.label ?? "", /recommended/i);
    assert.deepEqual(
      modeOptions.map((option) => option.value),
      ["human", "section_assisted", "ai_first_draft"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
