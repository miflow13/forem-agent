import { foremArticleListSchema, type ForemArticle } from "./types.js";

export type ArticleQuery = {
  page?: number;
  perPage?: number;
  tag?: string;
  username?: string;
  topDays?: number;
};

export class ForemClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listArticles(query: ArticleQuery = {}): Promise<ForemArticle[]> {
    const url = new URL(`${this.baseUrl}/articles`);

    if (query.page) url.searchParams.set("page", String(query.page));
    if (query.perPage) url.searchParams.set("per_page", String(query.perPage));
    if (query.tag) url.searchParams.set("tag", query.tag);
    if (query.username) url.searchParams.set("username", query.username);
    if (query.topDays) url.searchParams.set("top", String(query.topDays));

    const headers = new Headers({ Accept: "application/json" });
    if (this.apiKey) headers.set("api-key", this.apiKey);

    const response = await this.fetchImpl(url, { headers });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Forem request failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 240)}` : ""}`,
      );
    }

    return foremArticleListSchema.parse(await response.json());
  }
}
