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
import { runRevision } from "../src/commands/revise.js";
import { FakeStructuredTextModel } from "../src/providers/fake-model.js";
import { AgentDatabase } from "../src/storage/database.js";

test("structure revision creates a proposal without modifying draft.md", async () => {
  const fixture = createFixture();

  try {
    const originalDraft = readFileSync(fixture.draftPath, "utf8");
    const model = new FakeStructuredTextModel({
      summary: "Tighten repeated framing and improve transitions.",
      changes: [
        {
          location: "Opening",
          issue: "The thesis is repeated.",
          change: "State it once and move into the example faster.",
        },
      ],
      revised_markdown:
        "# Human-edited title\n\nA tighter proposed article that preserves the author's direction.",
    });

    const result = await runRevision(
      fixture.config,
      fixture.slug,
      "structure",
      model,
    );

    assert.equal(existsSync(result.outputPath), true);
    assert.equal(readFileSync(fixture.draftPath, "utf8"), originalDraft);
    assert.match(
      model.requests[0]?.input ?? "",
      /MANUAL DRAFT EDIT THAT MUST BE THE SOURCE OF TRUTH/,
    );

    const proposal = readFileSync(result.outputPath, "utf8");
    assert.match(proposal, /non-destructive proposal/i);
    assert.match(proposal, /Tighten repeated framing/);
    assert.match(proposal, /A tighter proposed article/);
  } finally {
    fixture.cleanup();
  }
});

test("claim-check produces a verification report without claiming verification", async () => {
  const fixture = createFixture();

  try {
    const model = new FakeStructuredTextModel({
      summary: "Two technical claims deserve primary-source verification.",
      claims: [
        {
          claim: "System prompts reliably prevent prompt injection.",
          risk: "high",
          why_verify: "The wording overstates a model-behavior guarantee.",
          suggested_source_type: "Primary model vendor documentation and security guidance",
        },
      ],
    });

    const result = await runRevision(
      fixture.config,
      fixture.slug,
      "claim-check",
      model,
    );

    const report = readFileSync(result.outputPath, "utf8");
    assert.match(report, /identifies claims to verify/i);
    assert.match(report, /does not independently verify/i);
    assert.match(report, /System prompts reliably prevent prompt injection/);
    assert.doesNotMatch(report, /verified as true/i);
  } finally {
    fixture.cleanup();
  }
});

test("revision requires an existing draft", async () => {
  const fixture = createFixture();

  try {
    rmSync(fixture.draftPath);
    const model = new FakeStructuredTextModel({
      summary: "Unused",
      changes: [],
      revised_markdown: "Unused",
    });

    await assert.rejects(
      () => runRevision(fixture.config, fixture.slug, "voice", model),
      /has no draft yet/,
    );
    assert.equal(model.requests.length, 0);
  } finally {
    fixture.cleanup();
  }
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "forem-agent-revise-"));
  const workspaceRoot = join(root, "articles");
  const slug = "revision-test";
  const id = "revision-project";
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

  const briefPath = join(workspacePath, "brief.md");
  const draftPath = join(workspacePath, "draft.md");

  writeFileSync(
    briefPath,
    [
      "---",
      `project_id: ${id}`,
      `slug: ${slug}`,
      "status: approved",
      "---",
      "",
      "# Editorial Brief",
      "",
      "## Thesis",
      "",
      "Keep model interpretation bounded by observable evidence.",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    draftPath,
    [
      "---",
      `project_id: ${id}`,
      `slug: ${slug}`,
      "status: draft",
      "---",
      "",
      "# Human-edited title",
      "",
      "MANUAL DRAFT EDIT THAT MUST BE THE SOURCE OF TRUTH",
      "",
      "The same thesis appears again later and may need structural tightening.",
    ].join("\n"),
    "utf8",
  );

  const database = new AgentDatabase(config.databasePath);
  database.createEditorialProject({
    id,
    slug,
    title: "Old database title",
    thesis: "Old database thesis",
    audience: "Developers",
    status: "approved",
    workspacePath,
  });
  database.close();

  return {
    config,
    slug,
    draftPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
