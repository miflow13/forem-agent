import type { AppConfig } from "../config.js";
import { OpenAIResponsesModel } from "./openai-responses.js";
import type { StructuredTextModel } from "./structured-text-model.js";

export function createConfiguredModel(
  config: AppConfig,
): StructuredTextModel | null {
  if (!config.openaiApiKey) return null;

  return new OpenAIResponsesModel(
    config.openaiApiKey,
    config.openaiModel,
    config.openaiBaseUrl,
  );
}
