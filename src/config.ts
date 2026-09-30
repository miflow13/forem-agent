import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  FOREM_BASE_URL: z.string().url().default("https://dev.to/api"),
  FOREM_API_KEY: z.string().min(1).optional(),
  FOREM_AGENT_HOME: z.string().min(1).optional(),
});

export type AppConfig = {
  foremBaseUrl: string;
  foremApiKey?: string;
  homeDir: string;
  databasePath: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse({
    FOREM_BASE_URL: env.FOREM_BASE_URL,
    FOREM_API_KEY: env.FOREM_API_KEY || undefined,
    FOREM_AGENT_HOME: env.FOREM_AGENT_HOME || undefined,
  });

  const homeDir = resolve(
    parsed.FOREM_AGENT_HOME ?? resolve(process.cwd(), ".forem-agent"),
  );

  return {
    foremBaseUrl: parsed.FOREM_BASE_URL.replace(/\/$/, ""),
    foremApiKey: parsed.FOREM_API_KEY,
    homeDir,
    databasePath: resolve(homeDir, "forem-agent.db"),
  };
}

export function ensureHome(config: AppConfig): void {
  mkdirSync(config.homeDir, { recursive: true });
}

// Exported only for diagnostics/tests; never used as a persistence source.
export function defaultGlobalHome(): string {
  return resolve(homedir(), ".forem-agent");
}
