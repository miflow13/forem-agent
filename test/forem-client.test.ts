import assert from "node:assert/strict";
import test from "node:test";
import { ForemClient } from "../src/forem/client.js";

test("ForemClient builds article query and keeps auth at the HTTP boundary", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;

  const fakeFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);

    return new Response(
      JSON.stringify([
        {
          id: 42,
          title: "Example",
          slug: "example",
          url: "https://dev.to/example/example",
          comments_count: 2,
          public_reactions_count: 9,
          positive_reactions_count: 9,
          published_timestamp: "2026-09-30T10:00:00Z",
          reading_time_minutes: 4,
          tag_list: ["typescript"],
          user: { username: "example" }
        }
      ]),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      },
    );
  };

  const client = new ForemClient("https://dev.to/api", "secret-value", fakeFetch);
  const result = await client.listArticles({
    page: 2,
    perPage: 20,
    tag: "typescript",
    topDays: 7,
  });

  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/api/articles");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "20");
  assert.equal(url.searchParams.get("tag"), "typescript");
  assert.equal(url.searchParams.get("top"), "7");
  assert.equal(requestedHeaders?.get("api-key"), "secret-value");
  assert.equal(result[0]?.id, 42);
});
