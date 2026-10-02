import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
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

// meldr state and secrets live in one per-user directory, never in the
// directory meldr happens to be run from. MELDR_HOME must be set in the
// process environment; setting it inside config.env has no effect on where
// config.env itself is read from.
export function resolveMeldrHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir(),
): string {
  const explicit = env.MELDR_HOME || env.FOREM_AGENT_HOME;
  if (explicit) return resolve(explicit);

  // The XDG spec says relative XDG_CONFIG_HOME values must be ignored.
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : resolve(userHome, ".config");
  return resolve(base, "meldr");
}

export function userConfigPath(homeDir: string): string {
  return resolve(homeDir, "config.env");
}

export function loadUserConfig(
  envPath: string = userConfigPath(resolveMeldrHome()),
): boolean {
  if (!existsSync(envPath)) return false;
  loadEnvFile(envPath);
  return true;
}

// Older versions kept state in ./.forem-agent and AI settings in ./.env.
// Both are no longer read; point the writer at them instead of silently
// starting over.
export function legacyLocalStateNotices(
  cwd: string,
  homeDir: string,
): string[] {
  const notices: string[] = [];
  const legacyHome = resolve(cwd, ".forem-agent");

  // Keep reporting until the old database is moved: the first command run
  // creates a new, empty database in homeDir, so "new home has no database"
  // would hide this notice after a single run.
  if (
    legacyHome !== homeDir &&
    existsSync(resolve(legacyHome, "forem-agent.db"))
  ) {
    notices.push(
      `Found projects from an older meldr in ${legacyHome}. meldr now keeps state in ${homeDir}. Move that folder's contents there, or set MELDR_HOME=${legacyHome}.`,
    );
  }

  const legacyEnv = resolve(cwd, ".env");
  if (
    !existsSync(userConfigPath(homeDir)) &&
    fileMentionsMeldrSettings(legacyEnv)
  ) {
    notices.push(
      `Found meldr AI settings in ${legacyEnv}. meldr no longer reads .env from the current directory. Run "meldr setup" to save them to ${userConfigPath(homeDir)}, then remove them from ${legacyEnv}.`,
    );
  }

  return notices;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse({
    FOREM_BASE_URL: env.FOREM_BASE_URL,
    FOREM_API_KEY: env.FOREM_API_KEY || undefined,
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

  const homeDir = resolveMeldrHome(env);

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

// Only the private state directory is created eagerly. The article
// workspace is created when a project is first written, so running meldr in
// an arbitrary directory does not leave an empty articles/ folder behind.
export function ensureHome(config: AppConfig): void {
  mkdirSync(config.homeDir, { recursive: true, mode: 0o700 });
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

// Best effort: an unreadable .env in someone else's project must never stop
// meldr from starting.
function fileMentionsMeldrSettings(path: string): boolean {
  try {
    return /^MELDR_MODEL_/m.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
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
