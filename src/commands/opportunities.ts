import type { AppConfig } from "../config.js";
import { rankTagOpportunities, type TagOpportunity } from "../analytics/opportunities.js";
import { AgentDatabase } from "../storage/database.js";

export function runOpportunities(
  config: AppConfig,
  limit: number,
): TagOpportunity[] {
  const database = new AgentDatabase(config.databasePath);

  try {
    const articles = database.listLatestResearchArticles();
    if (articles.length === 0) {
      throw new Error(
        "No completed research data found. Run \"meldr research\" first.",
      );
    }

    return rankTagOpportunities(articles).slice(0, limit);
  } finally {
    database.close();
  }
}
