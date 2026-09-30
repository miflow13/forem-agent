import { z } from "zod";
import type {
  StructuredOutputRequest,
  StructuredOutputResult,
  StructuredTextModel,
} from "./structured-text-model.js";

const responseSchema = z.object({
  model: z.string().optional(),
  output: z.array(
    z.object({
      type: z.string(),
      content: z.array(
        z.object({
          type: z.string(),
          text: z.string().optional(),
        }).passthrough(),
      ).optional(),
    }).passthrough(),
  ).default([]),
});

export class OpenAIResponsesModel implements StructuredTextModel {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://api.openai.com/v1",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generate<T>(
    request: StructuredOutputRequest<T>,
  ): Promise<StructuredOutputResult<T>> {
    const response = await this.fetchImpl(
      new URL(`${this.baseUrl.replace(/\/$/, "")}/responses`),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          instructions: request.instructions,
          input: request.input,
          text: {
            format: {
              type: "json_schema",
              name: request.schemaName,
              schema: request.jsonSchema,
              strict: true,
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenAI Responses request failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 240)}` : ""}`,
      );
    }

    const parsed = responseSchema.parse(await response.json());
    const text = findOutputText(parsed.output);

    if (!text) {
      throw new Error("OpenAI Responses API returned no output_text content.");
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `Model returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      data: request.parse(json),
      model: parsed.model ?? this.model,
    };
  }
}

function findOutputText(
  output: z.infer<typeof responseSchema>["output"],
): string | null {
  for (const item of output) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) {
        return content.text;
      }
    }
  }

  return null;
}
