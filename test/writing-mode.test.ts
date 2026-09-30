import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  appendFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { selectWritingMode } from "../src/commands/writing-mode.js";
import { getProjectStatus } from "../src/commands/projects.js";
import { AgentDatabase } from "../src/storage/database.js";

test("human writing mode creates an author-owned working file without a draft", () => {
  const fixture = createFixture();

  try {
    const result = selectWritingMode(
      fixture.config,
      fixture.slug,
      "human",
    );

    assert.equal(result.writingMode, "human");
    assert.equal(existsSync(result.workingPath), true);
    assert.equal(existsSync(join(fixture.workspacePath, "draft.md")), false);

    const working = readFileSync(result.workingPath, "utf8");
    assert.match(working, /status: working/);
    assert.match(working, /writing_mode: human/);
    assert.match(working, /# Author-Owned Title/);
    assert.doesNotMatch(working, /generated/i);

    const waiting = getProjectStatus(fixture.config, fixture.slug);
    assert.match(waiting.nextAction, /write in working\.md/i);
    assert.doesNotMatch(waiting.nextAction, /revise/);

    appendFileSync(
      result.workingPath!,
      "The author's first paragraph.\n",
      "utf8",
    );
    assert.match(
      getProjectStatus(fixture.config, fixture.slug).nextAction,
      /revise .* --pass structure/,
    );

    const database = new AgentDatabase(fixture.config.databasePath);
    assert.equal(
      database.findEditorialProject(fixture.slug)?.writingMode,
      "human",
    );
    database.close();
  } finally {
    fixture.cleanup();
  }
});

test("writing mode selection refuses to overwrite an existing article", () => {
  const fixture = createFixture();

  try {
    const workingPath = join(fixture.workspacePath, "working.md");
    writeFileSync(workingPath, "# Existing human work\n", "utf8");

    assert.throws(
      () => selectWritingMode(fixture.config, fixture.slug, "human"),
      /Refusing to overwrite existing article content/,
    );
    assert.equal(
      readFileSync(workingPath, "utf8"),
      "# Existing human work\n",
    );

    const database = new AgentDatabase(fixture.config.databasePath);
    assert.equal(
      database.findEditorialProject(fixture.slug)?.writingMode,
      null,
    );
    database.close();
  } finally {
    fixture.cleanup();
  }
});

test("AI-first mode is explicit project state and does not generate by selection", () => {
  const fixture = createFixture();

  try {
    assert.throws(
      () =>
        selectWritingMode(
          fixture.config,
          fixture.slug,
          "ai_first_draft",
        ),
      /confirmation is required/i,
    );

    const result = selectWritingMode(
      fixture.config,
      fixture.slug,
      "ai_first_draft",
      { confirmAiFirstDraft: true },
    );

    assert.equal(result.writingMode, "ai_first_draft");
    assert.equal(existsSync(join(fixture.workspacePath, "draft.md")), false);
    assert.equal(existsSync(join(fixture.workspacePath, "working.md")), false);
  } finally {
    fixture.cleanup();
  }
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "meldr-writing-mode-"));
  const workspaceRoot = join(root, "articles");
  const slug = "editing-first";
  const id = "editing-first-id";
  const workspacePath = join(workspaceRoot, slug);
  mkdirSync(workspacePath, { recursive: true });

  const config: AppConfig = {
    foremBaseUrl: "https://dev.to/api",
    homeDir: root,
    databasePath: join(root, "forem-agent.db"),
    workspaceDir: workspaceRoot,
    modelProvider: "openai",
    modelApiKey: "fake-key",
    modelName: "fake-model",
    modelBaseUrl: "https://api.openai.com/v1",
  };

  const database = new AgentDatabase(config.databasePath);
  database.createEditorialProject({
    id,
    slug,
    title: "Database Title",
    thesis: "Thesis",
    audience: "Readers",
    status: "approved",
    workspacePath,
  });
  database.close();

  writeFileSync(join(workspacePath, "brief.md"), minimalBrief(id, slug));

  return {
    config,
    slug,
    workspacePath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function minimalBrief(projectId: string, slug: string): string {
  return `---
project_id: ${projectId}
slug: ${slug}
status: approved
---

# Editorial Brief

## Outline

### 1. Opening

Explain the real problem.

Evidence to use:
- Approved evidence only.

## Personal-experience placeholders

- Add the author's real experience.

## Technical claims to verify

- Verify API behavior.

## Title options

1. Author-Owned Title
`;
}
