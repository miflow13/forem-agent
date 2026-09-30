import type { AppConfig } from "../config.js";
import { analyzeArticle, type ArticleAnalysis } from "../analytics/analyze.js";
import { ForemClient } from "../forem/client.js";
import { AgentDatabase } from "../storage/database.js";

const OWNER_HISTORY_PAGE_SIZE = 100;
const OWNER_HISTORY_MAX_PAGES = 10;

export type AnalyzeResult = {
  analysis: ArticleAnalysis;
  ownerAnalyticsStatus:
    | "available"
    | "not-authenticated"
    | "not-owner"
    | "auth-error";
  ownerAnalyticsMessage?: string;
};

export async function runAnalyze(
  config: AppConfig,
  reference: string,
): Promise<AnalyzeResult> {
  const client = new ForemClient(config.foremBaseUrl, config.foremApiKey);
  const database = new AgentDatabase(config.databasePath);

  try {
    const target = await resolveArticle(client, reference);
    const communityArticles = database.listLatestResearchArticles();

    let ownerArticles = null;
    let ownerAnalyticsStatus: AnalyzeResult["ownerAnalyticsStatus"] =
      "not-authenticated";
    let ownerAnalyticsMessage: string | undefined;

    if (config.foremApiKey) {
      try {
        const me = await client.getMe();

        if (me.username === target.user.username) {
          const history = await fetchOwnerHistory(client);
          const runId = database.startOwnerRun(me.username);
          database.saveOwnerArticles(runId, history);
          database.finishOwnerRun(runId, history.length);
          ownerArticles = database.listLatestOwnerArticles();
          ownerAnalyticsStatus = "available";
        } else {
          ownerAnalyticsStatus = "not-owner";
        }
      } catch (error) {
        ownerAnalyticsStatus = "auth-error";
        ownerAnalyticsMessage =
          error instanceof Error ? error.message : String(error);
      }
    }

    return {
      analysis: analyzeArticle(
        target,
        communityArticles,
        ownerArticles,
      ),
      ownerAnalyticsStatus,
      ownerAnalyticsMessage,
    };
  } finally {
    database.close();
  }
}

export function parseArticleReference(
  reference: string,
):
  | { kind: "id"; id: number }
  | { kind: "path"; username: string; slug: string } {
  if (/^\d+$/.test(reference)) {
    return { kind: "id", id: Number(reference) };
  }

  let pathname = reference;

  try {
    pathname = new URL(reference).pathname;
  } catch {
    // Support username/slug as a convenient non-URL form.
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(
      'Article reference must be a numeric id, an article URL, or "username/slug".',
    );
  }

  const username = parts.at(-2);
  const slug = parts.at(-1);

  if (!username || !slug) {
    throw new Error("Could not parse article username and slug.");
  }

  return { kind: "path", username, slug };
}

async function resolveArticle(
  client: ForemClient,
  reference: string,
) {
  const parsed = parseArticleReference(reference);

  return parsed.kind === "id"
    ? client.getArticleById(parsed.id)
    : client.getArticleByPath(parsed.username, parsed.slug);
}

async function fetchOwnerHistory(
  client: ForemClient,
) {
  const articles = new Map<
    number,
    Awaited<ReturnType<typeof client.listMyPublishedArticles>>[number]
  >();

  for (let page = 1; page <= OWNER_HISTORY_MAX_PAGES; page += 1) {
    const batch = await client.listMyPublishedArticles({
      page,
      perPage: OWNER_HISTORY_PAGE_SIZE,
    });

    for (const article of batch) articles.set(article.id, article);

    if (batch.length < OWNER_HISTORY_PAGE_SIZE) break;
  }

  return [...articles.values()];
}
