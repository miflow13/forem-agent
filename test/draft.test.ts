import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { runDraft } from "../src/commands/draft.js";
import { FakeStructuredTextModel } from "../src/providers/fake-model.js";
import { AgentDatabase } from "../src/storage/database.js";

test("draft rejects projects that have not been approved", async () => {
  const fixture = createProjectFixture("proposed");

  try {
    const model = new FakeStructuredTextModel({ markdown: "Unused." });

    await assert.rejects(
      () => runDraft(fixture.config, fixture.slug, model),
      /not "approved"/,
    );
    assert.equal(model.requests.length, 0);
    assert.equal(existsSync(join(fixture.workspacePath, "draft.md")), false);
  } finally {
    fixture.cleanup();
  }
});

test("draft writes publishable article and editorial notes separately", async () => {
  const fixture = createProjectFixture("approved");

  try {
    writeFileSync(
      join(fixture.workspacePath, "brief.md"),
      approvedBrief(fixture.id, fixture.slug),
      "utf8",
    );

    const model = new FakeStructuredTextModel({
      markdown: "Generated body from the approved brief.",
    });

    const result = await runDraft(fixture.config, fixture.slug, model);

    assert.equal(result.sectionCount, 2);
    assert.equal(model.requests.length, 2);
    assert.match(
      model.requests[0]?.input ?? "",
      /MANUALLY EDITED THESIS AFTER APPROVAL/,
    );
    assert.match(
      model.requests[1]?.input ?? "",
      /Second section intent edited by the author/,
    );

    const draft = readFileSync(result.draftPath, "utf8");
    assert.match(draft, /# Manually Edited Working Title/);
    assert.match(draft, /## Start with the actual failure/);
    assert.match(draft, /## Explain the boundary/);
    assert.match(draft, /Generated body from the approved brief/);
    assert.doesNotMatch(draft, /Author notes to complete/);
    assert.doesNotMatch(draft, /Claims to verify before publishing/);

    const notes = readFileSync(result.editorialNotesPath, "utf8");
    assert.match(notes, /# Editorial Notes/);
    assert.match(
      notes,
      /Author: add the real story about debugging the first failed API call\./,
    );
    assert.match(
      notes,
      /Verify the exact API behavior against primary documentation\./,
    );

    await assert.rejects(
      () => runDraft(fixture.config, fixture.slug, model),
      /Refusing to overwrite human-editable content/,
    );

    assert.equal(
      readFileSync(result.draftPath, "utf8"),
      draft,
      "existing draft must remain byte-for-byte unchanged",
    );
    assert.equal(
      readFileSync(result.editorialNotesPath, "utf8"),
      notes,
      "existing editorial notes must remain byte-for-byte unchanged",
    );
  } finally {
    fixture.cleanup();
  }
});

function createProjectFixture(status: "proposed" | "approved") {
  const root = mkdtempSync(join(tmpdir(), "forem-agent-draft-"));
  const workspaceRoot = join(root, "articles");
  const slug = `draft-test-${status}`;
  const id = `project-${status}`;
  const workspacePath = join(workspaceRoot, slug);
  mkdirSync(workspacePath, { recursive: true });

  const config: AppConfig = {
    foremBaseUrl: "https://dev.to/api",
    homeDir: root,
    databasePath: join(root, "forem-agent.db"),
    workspaceDir: workspaceRoot,
    openaiModel: "fake-model",
    openaiBaseUrl: "https://api.openai.com/v1",
  };

  const database = new AgentDatabase(config.databasePath);
  database.createEditorialProject({
    id,
    slug,
    title: "Database title that should not control the draft",
    thesis: "Database thesis that should not control the draft",
    audience: "Database audience",
    status,
    workspacePath,
  });
  database.close();

  if (status === "proposed") {
    writeFileSync(
      join(workspacePath, "brief.md"),
      approvedBrief(id, slug).replace("status: approved", "status: proposed"),
      "utf8",
    );
  }

  return {
    root,
    id,
    slug,
    workspacePath,
    config,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function approvedBrief(projectId: string, slug: string): string {
  return `---
project_id: ${projectId}
slug: ${slug}
status: approved
model: fake-planner
source_reference: "manual-test"
---

# Editorial Brief

## Intended reader

Developers building evidence-bounded writing tools.

## Reader problem

They need model assistance without surrendering editorial control.

## Thesis

MANUALLY EDITED THESIS AFTER APPROVAL

## What this article covers

- Deterministic evidence
- Human approval

## What this article does not cover

- Autonomous publishing

## Evidence

- A real API integration failure revealed an incorrect schema assumption.

## Competing angles

- A generic LLM wrapper tutorial

## Differentiation

Use the author's actual debugging workflow.

## Outline

### 1. Start with the actual failure

Open with the concrete integration failure and what it exposed.

Evidence to use:
- The single-article API returned a different tag shape.

### 2. Explain the boundary

Second section intent edited by the author.

Evidence to use:
- Measurements stay deterministic.
- The model interprets bounded evidence.

## Personal-experience placeholders

- Author: add the real story about debugging the first failed API call.

## Technical claims to verify

- Verify the exact API behavior against primary documentation.

## Title options

1. Manually Edited Working Title

## Suggested tags

#ai #typescript

## Risks and counterarguments

- Section-by-section generation may need a later continuity pass.

> Edit this file directly. Drafting is enabled only after explicit approval.
`;
}
