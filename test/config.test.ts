import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  loadConfig,
  loadProjectEnv,
  modelStatusLabel,
} from "../src/config.js";

test("project .env populates legacy OpenAI configuration", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "forem-agent-config-"));
  const envPath = resolve(directory, ".env");
  const previousApiKey = process.env.OPENAI_API_KEY;

  try {
    delete process.env.OPENAI_API_KEY;
    writeFileSync(envPath, "OPENAI_API_KEY=test-key-from-dotenv\n");

    assert.equal(loadProjectEnv(envPath), true);

    const config = loadConfig();
    assert.equal(config.modelProvider, "openai");
    assert.equal(config.modelApiKey, "test-key-from-dotenv");
    assert.equal(config.modelName, "gpt-5.6");
    assert.equal(config.modelBaseUrl, "https://api.openai.com/v1");
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("existing process environment takes precedence over .env", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "forem-agent-config-"));
  const envPath = resolve(directory, ".env");
  const previousApiKey = process.env.OPENAI_API_KEY;

  try {
    process.env.OPENAI_API_KEY = "existing-process-key";
    writeFileSync(envPath, "OPENAI_API_KEY=file-key\n");

    loadProjectEnv(envPath);
    assert.equal(loadConfig().modelApiKey, "existing-process-key");
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Anthropic configuration is inferred from standard environment variables", () => {
  const config = loadConfig({
    ANTHROPIC_API_KEY: "anthropic-key",
    ANTHROPIC_MODEL: "claude-sonnet-5",
  });

  assert.equal(config.modelProvider, "anthropic");
  assert.equal(config.modelApiKey, "anthropic-key");
  assert.equal(config.modelName, "claude-sonnet-5");
  assert.equal(config.modelBaseUrl, "https://api.anthropic.com/v1");
  assert.equal(
    modelStatusLabel(config),
    "Claude · claude-sonnet-5",
  );
});

test("explicit meldr provider settings override provider-specific fallback", () => {
  const config = loadConfig({
    MELDR_MODEL_PROVIDER: "anthropic",
    MELDR_MODEL_API_KEY: "meldr-key",
    MELDR_MODEL: "claude-opus-5",
    MELDR_MODEL_BASE_URL: "https://api.anthropic.com/v1/",
    OPENAI_API_KEY: "legacy-openai-key",
  });

  assert.equal(config.modelProvider, "anthropic");
  assert.equal(config.modelApiKey, "meldr-key");
  assert.equal(config.modelName, "claude-opus-5");
  assert.equal(config.modelBaseUrl, "https://api.anthropic.com/v1");
});
