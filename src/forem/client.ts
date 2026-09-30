import { z } from "zod";
import {
  foremArticleListSchema,
  foremArticleSchema,
  foremUserSchema,
  type ForemArticle,
  type ForemUser,
} from "./types.js";

const FOREM_V1_ACCEPT = "application/vnd.forem.api-v1+json";

export type ArticleQuery = {
  page?: number;
  perPage?: number;
  tag?: string;
  username?: string;
  topDays?: number;
};

export type AuthenticatedArticleQuery = {
  page?: number;
  perPage?: number;
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

    return this.get(url, foremArticleListSchema, false);
  }

  async listMyPublishedArticles(
    query: AuthenticatedArticleQuery = {},
  ): Promise<ForemArticle[]> {
    const url = new URL(`${this.baseUrl}/articles/me/published`);

    if (query.page) url.searchParams.set("page", String(query.page));
    if (query.perPage) url.searchParams.set("per_page", String(query.perPage));

    return this.get(url, foremArticleListSchema, true);
  }

  async getMe(): Promise<ForemUser> {
    return this.get(
      new URL(`${this.baseUrl}/users/me`),
      foremUserSchema,
      true,
    );
  }

  async getArticleById(id: number): Promise<ForemArticle> {
    return this.get(
      new URL(`${this.baseUrl}/articles/${id}`),
      foremArticleSchema,
      false,
    );
  }

  async getArticleByPath(
    username: string,
    slug: string,
  ): Promise<ForemArticle> {
    return this.get(
      new URL(
        `${this.baseUrl}/articles/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`,
      ),
      foremArticleSchema,
      false,
    );
  }

  private async get<T>(
    url: URL,
    schema: z.ZodType<T>,
    authenticated: boolean,
  ): Promise<T> {
    const headers = new Headers({ Accept: FOREM_V1_ACCEPT });

    if (authenticated) {
      if (!this.apiKey) {
        throw new Error(
          "This Forem endpoint requires FOREM_API_KEY, but no API key is configured.",
        );
      }
      headers.set("api-key", this.apiKey);
    }

    const response = await this.fetchImpl(url, { headers });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Forem request failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 240)}` : ""}`,
      );
    }

    return schema.parse(await response.json());
  }
}
