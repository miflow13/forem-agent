import { DatabaseSync } from "node:sqlite";
import type { ForemArticle } from "../forem/types.js";

export class AgentDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS research_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        source TEXT NOT NULL,
        query_json TEXT NOT NULL,
        article_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        slug TEXT NOT NULL,
        url TEXT NOT NULL,
        username TEXT NOT NULL,
        published_timestamp TEXT NOT NULL,
        edited_at TEXT,
        comments_count INTEGER NOT NULL,
        public_reactions_count INTEGER NOT NULL,
        positive_reactions_count INTEGER NOT NULL,
        reading_time_minutes REAL NOT NULL,
        tag_list_json TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_articles_published_timestamp
        ON articles(published_timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_articles_username
        ON articles(username);
    `);
  }

  startResearchRun(source: string, query: unknown): number {
    const statement = this.db.prepare(`
      INSERT INTO research_runs (started_at, source, query_json)
      VALUES (?, ?, ?)
    `);

    const result = statement.run(
      new Date().toISOString(),
      source,
      JSON.stringify(query),
    );

    return Number(result.lastInsertRowid);
  }

  finishResearchRun(runId: number, articleCount: number): void {
    this.db.prepare(`
      UPDATE research_runs
      SET completed_at = ?, article_count = ?
      WHERE id = ?
    `).run(new Date().toISOString(), articleCount, runId);
  }

  upsertArticles(articles: ForemArticle[]): void {
    const statement = this.db.prepare(`
      INSERT INTO articles (
        id,
        title,
        description,
        slug,
        url,
        username,
        published_timestamp,
        edited_at,
        comments_count,
        public_reactions_count,
        positive_reactions_count,
        reading_time_minutes,
        tag_list_json,
        captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        slug = excluded.slug,
        url = excluded.url,
        username = excluded.username,
        published_timestamp = excluded.published_timestamp,
        edited_at = excluded.edited_at,
        comments_count = excluded.comments_count,
        public_reactions_count = excluded.public_reactions_count,
        positive_reactions_count = excluded.positive_reactions_count,
        reading_time_minutes = excluded.reading_time_minutes,
        tag_list_json = excluded.tag_list_json,
        captured_at = excluded.captured_at
    `);

    this.db.exec("BEGIN");
    try {
      const capturedAt = new Date().toISOString();
      for (const article of articles) {
        statement.run(
          article.id,
          article.title,
          article.description ?? null,
          article.slug,
          article.url,
          article.user.username,
          article.published_timestamp,
          article.edited_at ?? null,
          article.comments_count,
          article.public_reactions_count,
          article.positive_reactions_count,
          article.reading_time_minutes,
          JSON.stringify(article.tag_list),
          capturedAt,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
