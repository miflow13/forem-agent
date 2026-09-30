import assert from "node:assert/strict";
import test from "node:test";
import type { ArticleAnalysis } from "../src/analytics/analyze.js";
import { interpretArticleAnalysis } from "../src/editorial/interpreter.js";
import { FakeStructuredTextModel } from "../src/providers/fake-model.js";

test("interpreter sends only the bounded analysis evidence packet", async () => {
  const model = new FakeStructuredTextModel({
    summary: "The article is above the local cohort heuristic.",
    observations: ["The residual is positive."],
    possible_explanations: [
      "The shared topic may have matched current reader interest.",
    ],
    editorial_lessons: ["Keep the technical angle specific."],
    cautions: ["The cohort is incomplete."],
  });

  const analysis: ArticleAnalysis = {
    article: {
      id: 1,
      title: "Example",
      url: "https://dev.to/example/example",
      author: "example",
      ageHours: 24,
      reactions: 10,
      comments: 2,
      engagement: 14,
      engagementPerDay: 14,
      tags: ["typescript"],
    },
    community: {
      cohortSize: 5,
      medianEngagementPerDay: 8,
      targetEngagementPerDay: 14,
      residualPerDay: 6,
    },
    owner: null,
    relatedArticles: [],
    limitations: ["No view counts are available."],
  };

  const result = await interpretArticleAnalysis(model, analysis);

  assert.equal(result.model, "fake-model");
  assert.equal(result.interpretation.observations.length, 1);
  assert.equal(model.requests.length, 1);

  const input = model.requests[0]?.input ?? "";
  assert.match(input, /article_analysis_v1/);
  assert.match(input, /No view counts are available/);
  assert.doesNotMatch(input, /FOREM_API_KEY|OPENAI_API_KEY|test-key/i);
});
