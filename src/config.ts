import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { z } from "zod";

export const modelProviders = [
  "openai",
  "anthropic",
  "openai-compatible",
] as const;

export type ModelProvider = (typeof modelProviders)[number];

const envSchema = z.object({
  FOREM_BASE_URL: z.string().url().default("https://dev.to/api"),
  FOREM_API_KEY: z.string().min(1).optional(),
  FOREM_AGENT_HOME: z.string().min(1).optional(),
  FOREM_AGENT_WORKSPACE: z.string().min(1).optional(),

  MELDR_MODEL_PROVIDER: z.enum(modelProviders).optional(),
  MELDR_MODEL_API_KEY: z.string().min(1).optional(),
  MELDR_MODEL: z.string().min(1).optional(),
  MELDR_MODEL_BASE_URL: z.string().url().optional(),

  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.6"),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5"),
  ANTHROPIC_BASE_URL: z.string().url().default("https://api.anthropic.com/v1"),
});

export type AppConfig = {
  foremBaseUrl: string;
  foremApiKey?: string;
  homeDir: string;
  databasePath: string;
  workspaceDir: string;
  modelProvider: ModelProvider | null;
  modelApiKey?: string;
  modelName?: string;
  modelBaseUrl?: string;
};

export function loadProjectEnv(
  envPath: string = resolve(process.cwd(), ".env"),
): boolean {
  if (!existsSync(envPath)) return false;
  loadEnvFile(envPath);
  return true;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse({
    FOREM_BASE_URL: env.FOREM_BASE_URL,
    FOREM_API_KEY: env.FOREM_API_KEY || undefined,
    FOREM_AGENT_HOME: env.FOREM_AGENT_HOME || undefined,
    FOREM_AGENT_WORKSPACE: env.FOREM_AGENT_WORKSPACE || undefined,

    MELDR_MODEL_PROVIDER: env.MELDR_MODEL_PROVIDER || undefined,
    MELDR_MODEL_API_KEY: env.MELDR_MODEL_API_KEY || undefined,
    MELDR_MODEL: env.MELDR_MODEL || undefined,
    MELDR_MODEL_BASE_URL: env.MELDR_MODEL_BASE_URL || undefined,

    OPENAI_API_KEY: env.OPENAI_API_KEY || undefined,
    OPENAI_MODEL: env.OPENAI_MODEL,
    OPENAI_BASE_URL: env.OPENAI_BASE_URL,

    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || undefined,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
  });

  const homeDir = resolve(
    parsed.FOREM_AGENT_HOME ?? resolve(process.cwd(), ".forem-agent"),
  );

  const provider = resolveProvider(parsed);
  const model = resolveModelSettings(parsed, provider);

  return {
    foremBaseUrl: parsed.FOREM_BASE_URL.replace(/\/$/, ""),
    foremApiKey: parsed.FOREM_API_KEY,
    homeDir,
    databasePath: resolve(homeDir, "forem-agent.db"),
    workspaceDir: resolve(
      parsed.FOREM_AGENT_WORKSPACE ?? resolve(process.cwd(), "articles"),
    ),
    modelProvider: provider,
    modelApiKey: model.apiKey,
    modelName: model.name,
    modelBaseUrl: model.baseUrl,
  };
}

export function ensureHome(config: AppConfig): void {
  mkdirSync(config.homeDir, { recursive: true });
  mkdirSync(config.workspaceDir, { recursive: true });
}

export function isModelConfigured(config: AppConfig): boolean {
  return Boolean(
    config.modelProvider &&
      config.modelApiKey &&
      config.modelName &&
      config.modelBaseUrl,
  );
}

export function modelProviderLabel(
  provider: ModelProvider | null,
): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Claude";
  if (provider === "openai-compatible") return "Custom";
  return "Not configured";
}

export function modelStatusLabel(config: AppConfig): string {
  if (!isModelConfigured(config)) return "AI not configured";
  return `${modelProviderLabel(config.modelProvider)} · ${config.modelName}`;
}

// Exported only for diagnostics/tests; never used as a persistence source.
export function defaultGlobalHome(): string {
  return resolve(homedir(), ".forem-agent");
}

type ParsedEnv = z.infer<typeof envSchema>;

function resolveProvider(parsed: ParsedEnv): ModelProvider | null {
  if (parsed.MELDR_MODEL_PROVIDER) {
    return parsed.MELDR_MODEL_PROVIDER;
  }

  // Backward compatibility for existing installations.
  if (parsed.OPENAI_API_KEY) return "openai";
  if (parsed.ANTHROPIC_API_KEY) return "anthropic";

  return null;
}

function resolveModelSettings(
  parsed: ParsedEnv,
  provider: ModelProvider | null,
): {
  apiKey?: string;
  name?: string;
  baseUrl?: string;
} {
  if (provider === "openai") {
    return {
      apiKey: parsed.MELDR_MODEL_API_KEY ?? parsed.OPENAI_API_KEY,
      name: parsed.MELDR_MODEL ?? parsed.OPENAI_MODEL,
      baseUrl: (
        parsed.MELDR_MODEL_BASE_URL ?? parsed.OPENAI_BASE_URL
      ).replace(/\/$/, ""),
    };
  }

  if (provider === "anthropic") {
    return {
      apiKey: parsed.MELDR_MODEL_API_KEY ?? parsed.ANTHROPIC_API_KEY,
      name: parsed.MELDR_MODEL ?? parsed.ANTHROPIC_MODEL,
      baseUrl: (
        parsed.MELDR_MODEL_BASE_URL ?? parsed.ANTHROPIC_BASE_URL
      ).replace(/\/$/, ""),
    };
  }

  if (provider === "openai-compatible") {
    return {
      apiKey: parsed.MELDR_MODEL_API_KEY,
      name: parsed.MELDR_MODEL,
      baseUrl: parsed.MELDR_MODEL_BASE_URL?.replace(/\/$/, ""),
    };
  }

  return {};
}
