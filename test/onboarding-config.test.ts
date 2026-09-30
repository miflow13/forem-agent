import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { loadConfig, loadProjectEnv } from "../src/config.js";
import {
  saveModelSetup,
  upsertEnvValues,
} from "../src/tui/onboarding.js";

test("upsertEnvValues preserves unrelated settings and replaces AI keys once", () => {
  const source = [
    "FOREM_BASE_URL=https://dev.to/api",
    "MELDR_MODEL_PROVIDER=openai",
    "MELDR_MODEL_API_KEY=old-key",
    "MELDR_MODEL=old-model",
    "",
  ].join("\n");

  const updated = upsertEnvValues(source, {
    MELDR_MODEL_PROVIDER: "anthropic",
    MELDR_MODEL_API_KEY: "new-key",
    MELDR_MODEL: "claude-sonnet-5",
    MELDR_MODEL_BASE_URL: "https://api.anthropic.com/v1",
  });

  assert.match(updated, /FOREM_BASE_URL=https:\/\/dev\.to\/api/);
  assert.match(updated, /MELDR_MODEL_PROVIDER="anthropic"/);
  assert.match(updated, /MELDR_MODEL_API_KEY="new-key"/);
  assert.match(updated, /MELDR_MODEL="claude-sonnet-5"/);
  assert.match(
    updated,
    /MELDR_MODEL_BASE_URL="https:\/\/api\.anthropic\.com\/v1"/,
  );
  assert.equal(
    (updated.match(/^MELDR_MODEL_PROVIDER=/gm) ?? []).length,
    1,
  );
  assert.doesNotMatch(updated, /old-key|old-model/);
});

test("saveModelSetup writes local config without logging or touching unrelated values", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "meldr-onboarding-"));
  const envPath = resolve(directory, ".env");

  const previous = {
    provider: process.env.MELDR_MODEL_PROVIDER,
    apiKey: process.env.MELDR_MODEL_API_KEY,
    model: process.env.MELDR_MODEL,
    baseUrl: process.env.MELDR_MODEL_BASE_URL,
  };

  try {
    writeFileSync(
      envPath,
      "FOREM_API_KEY=forem-test-key\nCUSTOM_SETTING=keep-me\n",
      "utf8",
    );

    saveModelSetup(envPath, {
      provider: "openai",
      apiKey: "secret-model-key",
      model: "gpt-5.6",
      baseUrl: "https://api.openai.com/v1/",
    });

    const saved = readFileSync(envPath, "utf8");
    assert.match(saved, /FOREM_API_KEY=forem-test-key/);
    assert.match(saved, /CUSTOM_SETTING=keep-me/);
    assert.match(saved, /MELDR_MODEL_PROVIDER="openai"/);
    assert.match(saved, /MELDR_MODEL_API_KEY="secret-model-key"/);
    assert.match(saved, /MELDR_MODEL="gpt-5.6"/);
    assert.match(
      saved,
      /MELDR_MODEL_BASE_URL="https:\/\/api\.openai\.com\/v1"/,
    );

    if (process.platform !== "win32") {
      assert.equal(statSync(envPath).mode & 0o777, 0o600);
    }

    delete process.env.MELDR_MODEL_PROVIDER;
    delete process.env.MELDR_MODEL_API_KEY;
    delete process.env.MELDR_MODEL;
    delete process.env.MELDR_MODEL_BASE_URL;

    assert.equal(loadProjectEnv(envPath), true);
    const reloaded = loadConfig();
    assert.equal(reloaded.modelProvider, "openai");
    assert.equal(reloaded.modelApiKey, "secret-model-key");
    assert.equal(reloaded.modelName, "gpt-5.6");
    assert.equal(reloaded.modelBaseUrl, "https://api.openai.com/v1");
  } finally {
    restore("MELDR_MODEL_PROVIDER", previous.provider);
    restore("MELDR_MODEL_API_KEY", previous.apiKey);
    restore("MELDR_MODEL", previous.model);
    restore("MELDR_MODEL_BASE_URL", previous.baseUrl);
    rmSync(directory, { recursive: true, force: true });
  }
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
