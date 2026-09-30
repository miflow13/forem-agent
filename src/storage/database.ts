import { DatabaseSync } from "node:sqlite";
import type { ForemArticle } from "../forem/types.js";

export type StoredResearchArticle = {
  id: number;
  title: string;
  url: string;
  username: string;
  publishedTimestamp: string;
  commentsCount: number;
  publicReactionsCount: number;
  positiveReactionsCount: number;
  readingTimeMinutes: number;
  tags: string[];
};

export class AgentDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON;");
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

      CREATE TABLE IF NOT EXISTS owner_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        username TEXT NOT NULL,
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

      CREATE TABLE IF NOT EXISTS article_snapshots (
        run_id INTEGER NOT NULL,
        article_id INTEGER NOT NULL,
        comments_count INTEGER NOT NULL,
        public_reactions_count INTEGER NOT NULL,
        positive_reactions_count INTEGER NOT NULL,
        reading_time_minutes REAL NOT NULL,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (run_id, article_id),
        FOREIGN KEY (run_id) REFERENCES research_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS owner_article_snapshots (
        run_id INTEGER NOT NULL,
        article_id INTEGER NOT NULL,
        comments_count INTEGER NOT NULL,
        public_reactions_count INTEGER NOT NULL,
        positive_reactions_count INTEGER NOT NULL,
        reading_time_minutes REAL NOT NULL,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (run_id, article_id),
        FOREIGN KEY (run_id) REFERENCES owner_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_articles_published_timestamp
        ON articles(published_timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_articles_username
        ON articles(username);

      CREATE INDEX IF NOT EXISTS idx_article_snapshots_article_id
        ON article_snapshots(article_id);

      CREATE INDEX IF NOT EXISTS idx_owner_article_snapshots_article_id
        ON owner_article_snapshots(article_id);
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

  startOwnerRun(username: string): number {
    const result = this.db.prepare(`
      INSERT INTO owner_runs (started_at, username)
      VALUES (?, ?)
    `).run(new Date().toISOString(), username);

    return Number(result.lastInsertRowid);
  }

  finishOwnerRun(runId: number, articleCount: number): void {
    this.db.prepare(`
      UPDATE owner_runs
      SET completed_at = ?, article_count = ?
      WHERE id = ?
    `).run(new Date().toISOString(), articleCount, runId);
  }

  saveResearchArticles(runId: number, articles: ForemArticle[]): void {
    this.saveArticlesWithSnapshots(
      "article_snapshots",
      runId,
      articles,
    );
  }

  saveOwnerArticles(runId: number, articles: ForemArticle[]): void {
    this.saveArticlesWithSnapshots(
      "owner_article_snapshots",
      runId,
      articles,
    );
  }

  listLatestResearchArticles(): StoredResearchArticle[] {
    return this.listLatestSnapshotArticles(
      "article_snapshots",
      "research_runs",
    );
  }

  listLatestOwnerArticles(): StoredResearchArticle[] {
    return this.listLatestSnapshotArticles(
      "owner_article_snapshots",
      "owner_runs",
    );
  }

  private saveArticlesWithSnapshots(
    snapshotTable: "article_snapshots" | "owner_article_snapshots",
    runId: number,
    articles: ForemArticle[],
  ): void {
    const upsertArticle = this.db.prepare(`
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

    const insertSnapshot = this.db.prepare(`
      INSERT INTO ${snapshotTable} (
        run_id,
        article_id,
        comments_count,
        public_reactions_count,
        positive_reactions_count,
        reading_time_minutes,
        captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, article_id) DO UPDATE SET
        comments_count = excluded.comments_count,
        public_reactions_count = excluded.public_reactions_count,
        positive_reactions_count = excluded.positive_reactions_count,
        reading_time_minutes = excluded.reading_time_minutes,
        captured_at = excluded.captured_at
    `);

    this.db.exec("BEGIN");
    try {
      const capturedAt = new Date().toISOString();

      for (const article of articles) {
        upsertArticle.run(
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

        insertSnapshot.run(
          runId,
          article.id,
          article.comments_count,
          article.public_reactions_count,
          article.positive_reactions_count,
          article.reading_time_minutes,
          capturedAt,
        );
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private listLatestSnapshotArticles(
    snapshotTable: "article_snapshots" | "owner_article_snapshots",
    runTable: "research_runs" | "owner_runs",
  ): StoredResearchArticle[] {
    const rows = this.db.prepare(`
      SELECT
        a.id,
        a.title,
        a.url,
        a.username,
        a.published_timestamp,
        a.tag_list_json,
        s.comments_count,
        s.public_reactions_count,
        s.positive_reactions_count,
        s.reading_time_minutes
      FROM ${snapshotTable} s
      JOIN articles a ON a.id = s.article_id
      WHERE s.run_id = (
        SELECT id
        FROM ${runTable}
        WHERE completed_at IS NOT NULL
        ORDER BY id DESC
        LIMIT 1
      )
      ORDER BY a.published_timestamp DESC
    `).all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row.id),
      title: String(row.title),
      url: String(row.url),
      username: String(row.username),
      publishedTimestamp: String(row.published_timestamp),
      commentsCount: Number(row.comments_count),
      publicReactionsCount: Number(row.public_reactions_count),
      positiveReactionsCount: Number(row.positive_reactions_count),
      readingTimeMinutes: Number(row.reading_time_minutes),
      tags: JSON.parse(String(row.tag_list_json)) as string[],
    }));
  }
}
