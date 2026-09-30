import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { AnthropicMessagesModel } from "../src/providers/anthropic-messages.js";

test("AnthropicMessagesModel forces schema-constrained tool output", async () => {
  let requestUrl = "";
  let requestHeaders: Headers | undefined;
  let requestBody: Record<string, unknown> | undefined;

  const fakeFetch: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

    return new Response(
      JSON.stringify({
        model: "claude-sonnet-5",
        content: [
          {
            type: "tool_use",
            name: "submit_result",
            input: { summary: "Grounded." },
          },
        ],
      }),
      { status: 200 },
    );
  };

  const model = new AnthropicMessagesModel(
    "test-anthropic-key",
    "claude-sonnet-5",
    "https://api.anthropic.com/v1",
    fakeFetch,
  );

  const schema = z.object({ summary: z.string() });
  const result = await model.generate({
    instructions: "Use evidence only.",
    input: "{}",
    schemaName: "test_schema",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: { summary: { type: "string" } },
    },
    parse: (value) => schema.parse(value),
  });

  assert.equal(requestUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(
    requestHeaders?.get("x-api-key"),
    "test-anthropic-key",
  );
  assert.equal(
    requestHeaders?.get("anthropic-version"),
    "2023-06-01",
  );

  assert.deepEqual(requestBody?.tool_choice, {
    type: "tool",
    name: "submit_result",
  });

  const tools = requestBody?.tools as Array<{
    name: string;
    input_schema: Record<string, unknown>;
  }>;

  assert.equal(tools[0]?.name, "submit_result");
  assert.deepEqual(tools[0]?.input_schema, {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: { summary: { type: "string" } },
  });

  assert.equal(
    JSON.stringify(requestBody).includes("test-anthropic-key"),
    false,
  );
  assert.equal(result.data.summary, "Grounded.");
  assert.equal(result.model, "claude-sonnet-5");
});
