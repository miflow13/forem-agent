import assert from "node:assert/strict";
import test from "node:test";
import { ForemClient } from "../src/forem/client.js";

test("public Forem requests use V1 media type without leaking the API key", async () => {
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
      { status: 200 },
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
  assert.equal(
    requestedHeaders?.get("accept"),
    "application/vnd.forem.api-v1+json",
  );
  assert.equal(requestedHeaders?.get("api-key"), null);
  assert.equal(result[0]?.id, 42);
});

test("authenticated author requests attach the API key only at the HTTP boundary", async () => {
  let requestedHeaders: Headers | undefined;

  const fakeFetch: typeof fetch = async (_input, init) => {
    requestedHeaders = new Headers(init?.headers);

    return new Response(
      JSON.stringify({
        id: 7,
        username: "mikachu",
        name: "Mika",
      }),
      { status: 200 },
    );
  };

  const client = new ForemClient("https://dev.to/api", "secret-value", fakeFetch);
  const me = await client.getMe();

  assert.equal(me.username, "mikachu");
  assert.equal(requestedHeaders?.get("api-key"), "secret-value");
});

test("authenticated author requests fail before network access without an API key", async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };

  const client = new ForemClient("https://dev.to/api", undefined, fakeFetch);

  await assert.rejects(() => client.getMe(), /requires FOREM_API_KEY/);
  assert.equal(called, false);
});
