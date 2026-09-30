import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { approvePlan, runPlan } from "../src/commands/plan.js";
import type { ForemArticle } from "../src/forem/types.js";
import { FakeStructuredTextModel } from "../src/providers/fake-model.js";
import { AgentDatabase } from "../src/storage/database.js";

test("plan writes a proposed Markdown brief and requires explicit approval", async () => {
  const root = mkdtempSync(join(tmpdir(), "forem-agent-plan-"));
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
    seedResearch(config.databasePath);

    const model = new FakeStructuredTextModel({
      intended_reader: "TypeScript developers building CLI tools",
      reader_problem: "They need a practical pattern for local-first editorial tooling.",
      thesis: "A small deterministic core makes AI-assisted editorial tools easier to trust.",
      covers: ["Evidence packets", "Local persistence", "Human approval gates"],
      does_not_cover: ["Autonomous publishing"],
      evidence_summary: ["Recent TypeScript articles appear in the local research sample."],
      competing_angles: ["A generic tutorial on calling an LLM"],
      differentiation: "Focus on inspectable evidence and explicit human control.",
      outline: [
        {
          heading: "Start with evidence",
          intent: "Explain why research precedes generation.",
          evidence: ["Use the locally stored TypeScript article sample."],
        },
        {
          heading: "Keep analysis deterministic",
          intent: "Separate measurements from interpretation.",
          evidence: ["Show local reactions/comments as observable inputs."],
        },
        {
          heading: "Add the model last",
          intent: "Show the model consuming a bounded packet.",
          evidence: ["Reference the human approval gate."],
        },
      ],
      personal_experience_placeholders: [
        "Author: add a real example of when an AI writing workflow felt hard to trust.",
      ],
      technical_claims_to_verify: [
        "Verify any API behavior against primary documentation before publication.",
      ],
      title_options: ["Build the Evidence Layer Before the AI Writer"],
      tags: ["typescript", "ai", "devtools"],
      risks_and_counterarguments: [
        "A deterministic core can add implementation overhead for tiny tools.",
      ],
    });

    const planned = await runPlan(config, "tag:typescript", model);

    assert.equal(planned.project.status, "proposed");
    assert.equal(planned.project.slug, "build-the-evidence-layer-before-the-ai-writer");
    assert.ok(existsSync(planned.workspace.briefPath));

    const proposed = readFileSync(planned.workspace.briefPath, "utf8");
    assert.match(proposed, /status: proposed/);
    assert.match(proposed, /# Editorial Brief/);
    assert.match(proposed, /Personal-experience placeholders/);
    assert.match(proposed, /Author: add a real example/);

    const requestInput = model.requests[0]?.input ?? "";
    assert.match(requestInput, /editorial_plan_v1/);
    assert.match(requestInput, /Recent TypeScript Patterns/);
    assert.doesNotMatch(
      requestInput,
      /FOREM_API_KEY|OPENAI_API_KEY|api[-_ ]?key/i,
    );

    const approved = approvePlan(config, planned.project.slug);
    assert.equal(approved.status, "approved");

    const approvedMarkdown = readFileSync(planned.workspace.briefPath, "utf8");
    assert.match(approvedMarkdown, /status: approved/);
    assert.doesNotMatch(approvedMarkdown, /status: proposed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function seedResearch(databasePath: string): void {
  const database = new AgentDatabase(databasePath);
  const runId = database.startResearchRun("test", { tag: "typescript" });
  database.saveResearchArticles(runId, [
    article({
      id: 1,
      title: "Recent TypeScript Patterns",
      tags: ["typescript", "webdev"],
      reactions: 18,
      comments: 4,
    }),
    article({
      id: 2,
      title: "Python Packaging Notes",
      tags: ["python"],
      reactions: 8,
      comments: 2,
    }),
  ]);
  database.finishResearchRun(runId, 2);
  database.close();
}

function article(input: {
  id: number;
  title: string;
  tags: string[];
  reactions: number;
  comments: number;
}): ForemArticle {
  return {
    id: input.id,
    title: input.title,
    slug: `article-${input.id}`,
    url: `https://dev.to/example/article-${input.id}`,
    comments_count: input.comments,
    public_reactions_count: input.reactions,
    positive_reactions_count: input.reactions,
    published_timestamp: "2026-09-30T10:00:00Z",
    reading_time_minutes: 5,
    tag_list: input.tags,
    user: { username: "example" },
  };
}
