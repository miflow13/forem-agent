import assert from "node:assert/strict";
import {
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
import { acceptRevision } from "../src/commands/accept.js";
import { runRevision } from "../src/commands/revise.js";
import { FakeStructuredTextModel } from "../src/providers/fake-model.js";
import { AgentDatabase } from "../src/storage/database.js";

test("accepted structure becomes the source for the next voice pass", async () => {
  const fixture = createFixture();

  try {
    const originalDraft = readFileSync(fixture.draftPath, "utf8");

    const structureModel = new FakeStructuredTextModel({
      summary: "Structure is tighter.",
      changes: [
        {
          location: "Whole article",
          issue: "Repeated framing",
          change: "Condense the repeated framing",
        },
      ],
      revised_markdown:
        "# Article\n\nSTRUCTURE ACCEPTED ARTICLE\n\n## Author notes to complete\n\n- Legacy author note that must not enter working.md.\n",
    });

    const structure = await runRevision(
      fixture.config,
      fixture.slug,
      "structure",
      structureModel,
    );
    const acceptedStructure = acceptRevision(
      fixture.config,
      fixture.slug,
      basename(structure.outputPath),
    );

    assert.equal(readFileSync(fixture.draftPath, "utf8"), originalDraft);

    const workingAfterStructure = readFileSync(
      acceptedStructure.workingPath,
      "utf8",
    );
    assert.match(workingAfterStructure, /STRUCTURE ACCEPTED ARTICLE/);
    assert.doesNotMatch(workingAfterStructure, /Legacy author note/);

    const notes = readFileSync(
      acceptedStructure.editorialNotesPath,
      "utf8",
    );
    assert.match(notes, /Legacy author note/);

    const voiceModel = new FakeStructuredTextModel({
      summary: "Voice is more direct.",
      changes: [
        {
          location: "Whole article",
          issue: "Generic phrasing",
          change: "Use more direct prose",
        },
      ],
      revised_markdown: "# Article\n\nVOICE ACCEPTED ARTICLE\n",
    });

    const voice = await runRevision(
      fixture.config,
      fixture.slug,
      "voice",
      voiceModel,
    );

    assert.equal(voice.sourceArticle, "working.md");
    const payload = JSON.parse(
      voiceModel.requests[0]?.input ?? "{}",
    ) as { current_article_markdown?: string };
    assert.match(
      payload.current_article_markdown ?? "",
      /STRUCTURE ACCEPTED ARTICLE/,
    );
    assert.doesNotMatch(
      payload.current_article_markdown ?? "",
      /ORIGINAL DRAFT ARTICLE/,
    );

    acceptRevision(
      fixture.config,
      fixture.slug,
      basename(voice.outputPath),
    );

    const finalWorking = readFileSync(
      acceptedStructure.workingPath,
      "utf8",
    );
    assert.match(finalWorking, /VOICE ACCEPTED ARTICLE/);
    assert.doesNotMatch(finalWorking, /STRUCTURE ACCEPTED ARTICLE/);
    assert.equal(readFileSync(fixture.draftPath, "utf8"), originalDraft);
  } finally {
    fixture.cleanup();
  }
});

test("accept rejects a stale proposal after its source changes", async () => {
  const fixture = createFixture();

  try {
    const model = new FakeStructuredTextModel({
      summary: "Proposal",
      changes: [],
      revised_markdown: "# Article\n\nProposed revision.\n",
    });

    const revision = await runRevision(
      fixture.config,
      fixture.slug,
      "structure",
      model,
    );

    writeFileSync(
      fixture.draftPath,
      readFileSync(fixture.draftPath, "utf8") +
        "\nHUMAN EDIT AFTER REVISION\n",
      "utf8",
    );

    assert.throws(
      () =>
        acceptRevision(
          fixture.config,
          fixture.slug,
          basename(revision.outputPath),
        ),
      /Revision is stale/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("claim-check reports cannot be accepted", async () => {
  const fixture = createFixture();

  try {
    const model = new FakeStructuredTextModel({
      summary: "Verify one claim.",
      claims: [
        {
          claim: "Example claim",
          risk: "medium",
          why_verify: "It is factual.",
          suggested_source_type: "Primary documentation",
        },
      ],
    });

    const revision = await runRevision(
      fixture.config,
      fixture.slug,
      "claim-check",
      model,
    );

    assert.throws(
      () =>
        acceptRevision(
          fixture.config,
          fixture.slug,
          basename(revision.outputPath),
        ),
      /Claim-check reports cannot be accepted/,
    );
  } finally {
    fixture.cleanup();
  }
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "forem-agent-accept-"));
  const workspaceRoot = join(root, "articles");
  const slug = "accept-test";
  const id = "accept-project";
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
      "Keep revisions human-approved.",
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
      "# Article",
      "",
      "ORIGINAL DRAFT ARTICLE",
      "",
      "## Author notes to complete",
      "",
      "- Original private author note.",
      "",
    ].join("\n"),
    "utf8",
  );

  const database = new AgentDatabase(config.databasePath);
  database.createEditorialProject({
    id,
    slug,
    title: "Article",
    thesis: "Keep revisions human-approved.",
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
