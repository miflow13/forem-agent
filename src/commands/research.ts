import type { AppConfig } from "../config.js";
import { ForemClient } from "../forem/client.js";
import { AgentDatabase } from "../storage/database.js";

export type ResearchOptions = {
  pages: number;
  perPage: number;
  tag?: string;
  username?: string;
  topDays?: number;
};

export async function runResearch(
  config: AppConfig,
  options: ResearchOptions,
): Promise<{ runId: number; articleCount: number }> {
  const client = new ForemClient(config.foremBaseUrl, config.foremApiKey);
  const database = new AgentDatabase(config.databasePath);

  const query = {
    pages: options.pages,
    perPage: options.perPage,
    tag: options.tag,
    username: options.username,
    topDays: options.topDays,
  };

  const runId = database.startResearchRun("forem/articles", query);

  try {
    const seen = new Map<number, Awaited<ReturnType<typeof client.listArticles>>[number]>();

    for (let page = 1; page <= options.pages; page += 1) {
      const articles = await client.listArticles({
        page,
        perPage: options.perPage,
        tag: options.tag,
        username: options.username,
        topDays: options.topDays,
      });

      for (const article of articles) seen.set(article.id, article);
      if (articles.length < options.perPage) break;
    }

    const articles = [...seen.values()];
    database.upsertArticles(articles);
    database.finishResearchRun(runId, articles.length);

    return { runId, articleCount: articles.length };
  } finally {
    database.close();
  }
}
