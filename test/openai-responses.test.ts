import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { OpenAIResponsesModel } from "../src/providers/openai-responses.js";

test("OpenAIResponsesModel sends strict structured output with store disabled", async () => {
  let requestUrl = "";
  let requestHeaders: Headers | undefined;
  let requestBody: Record<string, unknown> | undefined;

  const fakeFetch: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

    return new Response(
      JSON.stringify({
        model: "test-model",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ summary: "Grounded." }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  };

  const model = new OpenAIResponsesModel(
    "test-key",
    "test-model",
    "https://api.openai.com/v1",
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

  assert.equal(requestUrl, "https://api.openai.com/v1/responses");
  assert.equal(
    requestHeaders?.get("authorization"),
    "Bearer test-key",
  );
  assert.equal(requestBody?.store, false);
  assert.deepEqual(
    (requestBody?.text as {
      format: { type: string; strict: boolean };
    }).format,
    {
      type: "json_schema",
      name: "test_schema",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["summary"],
        properties: { summary: { type: "string" } },
      },
      strict: true,
    },
  );
  assert.equal(result.data.summary, "Grounded.");
});
