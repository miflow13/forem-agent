import { z } from "zod";
import type {
  StructuredOutputRequest,
  StructuredOutputResult,
  StructuredTextModel,
} from "./structured-text-model.js";

const responseSchema = z.object({
  model: z.string().optional(),
  content: z
    .array(
      z
        .object({
          type: z.string(),
          name: z.string().optional(),
          input: z.unknown().optional(),
          text: z.string().optional(),
        })
        .passthrough(),
    )
    .default([]),
});

export class AnthropicMessagesModel implements StructuredTextModel {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://api.anthropic.com/v1",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generate<T>(
    request: StructuredOutputRequest<T>,
  ): Promise<StructuredOutputResult<T>> {
    const response = await this.fetchImpl(
      new URL(`${this.baseUrl.replace(/\/$/, "")}/messages`),
      {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 16_384,
          system: [
            request.instructions,
            "",
            "Return the final answer by calling the submit_result tool exactly once.",
            "Do not include the result as prose outside the tool call.",
          ].join("\n"),
          messages: [
            {
              role: "user",
              content: request.input,
            },
          ],
          tools: [
            {
              name: "submit_result",
              description: `Return the final ${request.schemaName} structured result.`,
              input_schema: request.jsonSchema,
            },
          ],
          tool_choice: {
            type: "tool",
            name: "submit_result",
          },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Anthropic Messages request failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 240)}` : ""}`,
      );
    }

    const parsed = responseSchema.parse(await response.json());
    const toolUse = parsed.content.find(
      (item) =>
        item.type === "tool_use" &&
        item.name === "submit_result" &&
        item.input !== undefined,
    );

    if (!toolUse) {
      throw new Error(
        "Anthropic Messages API returned no submit_result tool call.",
      );
    }

    return {
      data: request.parse(toolUse.input),
      model: parsed.model ?? this.model,
    };
  }
}
