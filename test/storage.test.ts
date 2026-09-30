import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { ForemArticle } from "../src/forem/types.js";
import { AgentDatabase } from "../src/storage/database.js";

test("AgentDatabase preserves one metric snapshot per research run", () => {
  const directory = mkdtempSync(join(tmpdir(), "forem-agent-"));
  const databasePath = join(directory, "test.db");

  try {
    const database = new AgentDatabase(databasePath);

    const firstRun = database.startResearchRun("test", {});
    database.saveResearchArticles(firstRun, [article(5)]);
    database.finishResearchRun(firstRun, 1);

    const secondRun = database.startResearchRun("test", {});
    database.saveResearchArticles(secondRun, [article(11)]);
    database.finishResearchRun(secondRun, 1);

    const latest = database.listLatestResearchArticles();
    assert.equal(latest.length, 1);
    assert.equal(latest[0]?.publicReactionsCount, 11);

    database.close();

    const raw = new DatabaseSync(databasePath);
    const row = raw
      .prepare("SELECT COUNT(*) AS count FROM article_snapshots WHERE article_id = ?")
      .get(101) as { count: number };
    raw.close();

    assert.equal(Number(row.count), 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("AgentDatabase keeps owner metric snapshots separate from public research", () => {
  const directory = mkdtempSync(join(tmpdir(), "forem-agent-owner-"));
  const databasePath = join(directory, "test.db");

  try {
    const database = new AgentDatabase(databasePath);

    const publicRun = database.startResearchRun("test", {});
    database.saveResearchArticles(publicRun, [article(5)]);
    database.finishResearchRun(publicRun, 1);

    const ownerRun = database.startOwnerRun("example");
    database.saveOwnerArticles(ownerRun, [article(17)]);
    database.finishOwnerRun(ownerRun, 1);

    assert.equal(
      database.listLatestResearchArticles()[0]?.publicReactionsCount,
      5,
    );
    assert.equal(
      database.listLatestOwnerArticles()[0]?.publicReactionsCount,
      17,
    );

    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function article(reactions: number): ForemArticle {
  return {
    id: 101,
    title: "Stored article",
    slug: "stored-article",
    url: "https://dev.to/example/stored-article",
    comments_count: 2,
    public_reactions_count: reactions,
    positive_reactions_count: reactions,
    published_timestamp: "2026-09-30T10:00:00Z",
    reading_time_minutes: 5,
    tag_list: ["typescript"],
    user: { username: "example" },
  };
}
