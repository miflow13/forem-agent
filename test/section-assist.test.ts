import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import {
  acceptSectionAssistance,
  runSectionAssistance,
  type SectionAssistanceType,
} from "../src/commands/section-assist.js";
import { selectWritingMode } from "../src/commands/writing-mode.js";
import { FakeStructuredTextModel } from "../src/providers/fake-model.js";
import { AgentDatabase } from "../src/storage/database.js";

test("section assistance makes no model request until a specific help action", async () => {
  const fixture = createFixture();

  try {
    const model = new FakeStructuredTextModel({ markdown: "Unused." });
    selectWritingMode(
      fixture.config,
      fixture.slug,
      "section_assisted",
    );

    assert.equal(model.requests.length, 0);
    assert.equal(existsSync(join(fixture.workspacePath, "working.md")), true);
    assert.equal(existsSync(join(fixture.workspacePath, "draft.md")), false);
  } finally {
    fixture.cleanup();
  }
});

test("each explicit section help action creates a proposal without editing working.md", async () => {
  const fixture = createFixture();

  try {
    const selected = selectWritingMode(
      fixture.config,
      fixture.slug,
      "section_assisted",
    );
    const before = readFileSync(selected.workingPath!, "utf8");
    const actions: SectionAssistanceType[] = [
      "talking_points",
      "starter",
      "draft_section",
    ];

    for (const action of actions) {
      const model = new FakeStructuredTextModel({
        markdown: `Proposed ${action} content.`,
      });
      const result = await runSectionAssistance(
        fixture.config,
        fixture.slug,
        1,
        action,
        model,
      );

      assert.equal(model.requests.length, 1);
      assert.equal(result.assistanceType, action);
      assert.equal(result.sectionHeading, "Opening");
      assert.equal(readFileSync(selected.workingPath!, "utf8"), before);

      const proposal = readFileSync(result.proposalPath, "utf8");
      assert.match(proposal, new RegExp(`assistance_type: ${action}`));
      assert.match(proposal, new RegExp(`Proposed ${action} content`));
      assert.match(proposal, /source_article: working\.md/);
      assert.match(proposal, /source_sha256: [a-f0-9]{64}/);
    }
  } finally {
    fixture.cleanup();
  }
});

test("accepting section assistance appends content and rejects stale proposals", async () => {
  const fixture = createFixture();

  try {
    const selected = selectWritingMode(
      fixture.config,
      fixture.slug,
      "section_assisted",
    );
    const firstModel = new FakeStructuredTextModel({
      markdown: "Accepted opening prose from approved evidence.",
    });
    const first = await runSectionAssistance(
      fixture.config,
      fixture.slug,
      1,
      "draft_section",
      firstModel,
    );

    acceptSectionAssistance(
      fixture.config,
      fixture.slug,
      basename(first.proposalPath),
    );
    const accepted = readFileSync(selected.workingPath!, "utf8");
    assert.match(accepted, /# Author-Owned Title/);
    assert.match(accepted, /## Opening/);
    assert.match(accepted, /Accepted opening prose from approved evidence\./);

    const secondModel = new FakeStructuredTextModel({
      markdown: "Proposed second section.",
    });
    const second = await runSectionAssistance(
      fixture.config,
      fixture.slug,
      2,
      "draft_section",
      secondModel,
    );
    appendFileSync(selected.workingPath!, "\nHuman edit after proposal.\n", "utf8");

    assert.throws(
      () =>
        acceptSectionAssistance(
          fixture.config,
          fixture.slug,
          basename(second.proposalPath),
        ),
      /stale because working\.md changed/,
    );
    assert.doesNotMatch(
      readFileSync(selected.workingPath!, "utf8"),
      /Proposed second section/,
    );
  } finally {
    fixture.cleanup();
  }
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "meldr-section-assist-"));
  const workspaceRoot = join(root, "articles");
  const slug = "section-project";
  const id = "section-project-id";
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

  writeFileSync(join(workspacePath, "brief.md"), brief(id, slug), "utf8");

  return {
    config,
    slug,
    workspacePath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function brief(projectId: string, slug: string): string {
  return `---
project_id: ${projectId}
slug: ${slug}
status: approved
---

# Editorial Brief

## Thesis

Human judgment owns the article.

## Outline

### 1. Opening

Explain the concrete problem.

Evidence to use:
- Approved evidence only.

### 2. Boundary

Explain the editing boundary.

Evidence to use:
- No autonomous publishing.

## Personal-experience placeholders

- Add the author's real experience.

## Technical claims to verify

- Verify API behavior.

## Title options

1. Author-Owned Title
`;
}
