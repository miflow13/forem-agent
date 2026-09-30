import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { loadConfig, loadProjectEnv } from "../src/config.js";

test("project .env populates model configuration", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "forem-agent-config-"));
  const envPath = resolve(directory, ".env");
  const previousApiKey = process.env.OPENAI_API_KEY;

  try {
    delete process.env.OPENAI_API_KEY;
    writeFileSync(envPath, "OPENAI_API_KEY=test-key-from-dotenv\n");

    assert.equal(loadProjectEnv(envPath), true);
    assert.equal(loadConfig().openaiApiKey, "test-key-from-dotenv");
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
    assert.equal(loadConfig().openaiApiKey, "existing-process-key");
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
