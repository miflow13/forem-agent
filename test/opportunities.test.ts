import assert from "node:assert/strict";
import test from "node:test";
import { rankTagOpportunities } from "../src/analytics/opportunities.js";
import type { StoredResearchArticle } from "../src/storage/database.js";

test("rankTagOpportunities favors repeated, fresh, engaged signals", () => {
  const now = new Date("2026-09-30T12:00:00Z");

  const articles: StoredResearchArticle[] = [
    article({
      id: 1,
      publishedTimestamp: "2026-09-30T10:00:00Z",
      tags: ["typescript", "webdev"],
      reactions: 30,
      comments: 8,
    }),
    article({
      id: 2,
      publishedTimestamp: "2026-09-30T08:00:00Z",
      tags: ["typescript"],
      reactions: 20,
      comments: 5,
    }),
    article({
      id: 3,
      publishedTimestamp: "2026-09-28T12:00:00Z",
      tags: ["python"],
      reactions: 28,
      comments: 4,
    }),
    article({
      id: 4,
      publishedTimestamp: "2026-09-30T11:00:00Z",
      tags: ["career"],
      reactions: 2,
      comments: 0,
    }),
  ];

  const ranked = rankTagOpportunities(articles, now);

  assert.equal(ranked[0]?.tag, "typescript");
  assert.ok(ranked.every((item) => item.signalScore >= 0 && item.signalScore <= 1));
});

function article(input: {
  id: number;
  publishedTimestamp: string;
  tags: string[];
  reactions: number;
  comments: number;
}): StoredResearchArticle {
  return {
    id: input.id,
    title: `Article ${input.id}`,
    url: `https://dev.to/example/article-${input.id}`,
    username: "example",
    publishedTimestamp: input.publishedTimestamp,
    commentsCount: input.comments,
    publicReactionsCount: input.reactions,
    positiveReactionsCount: input.reactions,
    readingTimeMinutes: 5,
    tags: input.tags,
  };
}
