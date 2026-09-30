import type { AppConfig } from "../config.js";
import { isModelConfigured, modelStatusLabel } from "../config.js";
import { AnthropicMessagesModel } from "./anthropic-messages.js";
import { OpenAIResponsesModel } from "./openai-responses.js";
import type { StructuredTextModel } from "./structured-text-model.js";

export function createConfiguredModel(
  config: AppConfig,
): StructuredTextModel | null {
  if (!isModelConfigured(config)) return null;

  if (config.modelProvider === "anthropic") {
    return new AnthropicMessagesModel(
      config.modelApiKey!,
      config.modelName!,
      config.modelBaseUrl!,
    );
  }

  if (
    config.modelProvider === "openai" ||
    config.modelProvider === "openai-compatible"
  ) {
    return new OpenAIResponsesModel(
      config.modelApiKey!,
      config.modelName!,
      config.modelBaseUrl!,
    );
  }

  return null;
}

export function configuredModelLabel(config: AppConfig): string {
  return modelStatusLabel(config);
}

export async function verifyConfiguredModel(
  config: AppConfig,
): Promise<string> {
  const model = createConfiguredModel(config);
  if (!model) {
    throw new Error(
      "No AI provider is configured. Run meldr and complete AI setup first.",
    );
  }

  const result = await model.generate({
    instructions:
      "This is a connection check. Return the requested structured value only.",
    input: "Confirm the model connection by returning ok=true.",
    schemaName: "meldr_connection_check",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: {
        ok: { type: "boolean", const: true },
      },
    },
    parse: (value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        (value as { ok?: unknown }).ok !== true
      ) {
        throw new Error("Model connection check returned an unexpected result.");
      }
      return { ok: true };
    },
  });

  return result.model;
}
