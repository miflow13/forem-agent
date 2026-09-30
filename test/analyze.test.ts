import assert from "node:assert/strict";
import test from "node:test";
import { analyzeArticle } from "../src/analytics/analyze.js";
import { parseArticleReference } from "../src/commands/analyze.js";
import type { ForemArticle } from "../src/forem/types.js";
import type { StoredResearchArticle } from "../src/storage/database.js";

test("parseArticleReference supports ids, URLs, and username/slug", () => {
  assert.deepEqual(parseArticleReference("123"), { kind: "id", id: 123 });
  assert.deepEqual(
    parseArticleReference("https://dev.to/mikachu/building-meldr-1234"),
    {
      kind: "path",
      username: "mikachu",
      slug: "building-meldr-1234",
    },
  );
  assert.deepEqual(parseArticleReference("mikachu/building-meldr-1234"), {
    kind: "path",
    username: "mikachu",
    slug: "building-meldr-1234",
  });
});

test("analyzeArticle separates community and owner baselines", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const target = article({
    id: 1,
    username: "mikachu",
    publishedTimestamp: "2026-09-29T12:00:00Z",
    reactions: 20,
    comments: 5,
    tags: ["typescript", "devto"],
  });

  const community: StoredResearchArticle[] = [
    stored({
      id: 2,
      username: "other",
      publishedTimestamp: "2026-09-29T12:00:00Z",
      reactions: 10,
      comments: 2,
      tags: ["typescript"],
    }),
    stored({
      id: 3,
      username: "other2",
      publishedTimestamp: "2026-09-29T12:00:00Z",
      reactions: 100,
      comments: 20,
      tags: ["python"],
    }),
  ];

  const owner: StoredResearchArticle[] = [
    stored({
      id: 4,
      username: "mikachu",
      publishedTimestamp: "2026-09-28T12:00:00Z",
      reactions: 12,
      comments: 3,
      tags: ["career"],
    }),
  ];

  const analysis = analyzeArticle(target, community, owner, now);

  assert.equal(analysis.community?.cohortSize, 1);
  assert.equal(analysis.owner?.cohortSize, 1);
  assert.ok((analysis.community?.residualPerDay ?? 0) > 0);
  assert.equal(analysis.relatedArticles.length, 1);
  assert.equal(analysis.relatedArticles[0]?.id, 2);
});

function article(input: {
  id: number;
  username: string;
  publishedTimestamp: string;
  reactions: number;
  comments: number;
  tags: string[];
}): ForemArticle {
  return {
    id: input.id,
    title: `Article ${input.id}`,
    slug: `article-${input.id}`,
    url: `https://dev.to/${input.username}/article-${input.id}`,
    comments_count: input.comments,
    public_reactions_count: input.reactions,
    positive_reactions_count: input.reactions,
    published_timestamp: input.publishedTimestamp,
    reading_time_minutes: 5,
    tag_list: input.tags,
    user: { username: input.username },
  };
}

function stored(input: {
  id: number;
  username: string;
  publishedTimestamp: string;
  reactions: number;
  comments: number;
  tags: string[];
}): StoredResearchArticle {
  return {
    id: input.id,
    title: `Article ${input.id}`,
    url: `https://dev.to/${input.username}/article-${input.id}`,
    username: input.username,
    publishedTimestamp: input.publishedTimestamp,
    commentsCount: input.comments,
    publicReactionsCount: input.reactions,
    positiveReactionsCount: input.reactions,
    readingTimeMinutes: 5,
    tags: input.tags,
  };
}
