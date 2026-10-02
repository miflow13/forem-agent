import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  ensureHome,
  legacyLocalStateNotices,
  loadConfig,
  loadUserConfig,
  modelStatusLabel,
  resolveMeldrHome,
  userConfigPath,
} from "../src/config.js";

test("user config file populates legacy OpenAI configuration", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "forem-agent-config-"));
  const envPath = resolve(directory, ".env");
  const previousApiKey = process.env.OPENAI_API_KEY;

  try {
    delete process.env.OPENAI_API_KEY;
    writeFileSync(envPath, "OPENAI_API_KEY=test-key-from-dotenv\n");

    assert.equal(loadUserConfig(envPath), true);

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

test("existing process environment takes precedence over the config file", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "forem-agent-config-"));
  const envPath = resolve(directory, ".env");
  const previousApiKey = process.env.OPENAI_API_KEY;

  try {
    process.env.OPENAI_API_KEY = "existing-process-key";
    writeFileSync(envPath, "OPENAI_API_KEY=file-key\n");

    loadUserConfig(envPath);
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

test("meldr home is per-user and never derived from the working directory", () => {
  const userHome = "/home/writer";

  assert.equal(
    resolveMeldrHome({}, userHome),
    resolve(userHome, ".config", "meldr"),
  );
  assert.equal(
    resolveMeldrHome({ XDG_CONFIG_HOME: "/xdg" }, userHome),
    resolve("/xdg", "meldr"),
  );
  assert.equal(
    resolveMeldrHome({ XDG_CONFIG_HOME: "relative/xdg" }, userHome),
    resolve(userHome, ".config", "meldr"),
    "relative XDG_CONFIG_HOME is ignored per the XDG spec",
  );
  assert.equal(
    resolveMeldrHome(
      { FOREM_AGENT_HOME: "/legacy", XDG_CONFIG_HOME: "/xdg" },
      userHome,
    ),
    resolve("/legacy"),
  );
  assert.equal(
    resolveMeldrHome(
      { MELDR_HOME: "/explicit", FOREM_AGENT_HOME: "/legacy" },
      userHome,
    ),
    resolve("/explicit"),
  );
});

test("loadConfig keeps the database and config file under meldr home", () => {
  const config = loadConfig({ MELDR_HOME: "/state/meldr" });

  assert.equal(config.homeDir, resolve("/state/meldr"));
  assert.equal(
    config.databasePath,
    resolve("/state/meldr", "forem-agent.db"),
  );
  assert.equal(
    userConfigPath(config.homeDir),
    resolve("/state/meldr", "config.env"),
  );
});

test("ensureHome creates a private home without creating the article workspace", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "meldr-home-"));

  try {
    const config = loadConfig({
      MELDR_HOME: resolve(directory, "home"),
      FOREM_AGENT_WORKSPACE: resolve(directory, "articles"),
    });

    ensureHome(config);

    assert.equal(existsSync(config.homeDir), true);
    assert.equal(existsSync(config.workspaceDir), false);
    if (process.platform !== "win32") {
      assert.equal(statSync(config.homeDir).mode & 0o777, 0o700);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy working-directory state is reported, not silently read", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "meldr-legacy-"));
  const cwd = resolve(directory, "repo");
  const home = resolve(directory, "home");

  try {
    mkdirSync(resolve(cwd, ".forem-agent"), { recursive: true });
    mkdirSync(home, { recursive: true });

    assert.deepEqual(legacyLocalStateNotices(cwd, home), []);

    writeFileSync(resolve(cwd, ".forem-agent", "forem-agent.db"), "");
    writeFileSync(
      resolve(cwd, ".env"),
      'MELDR_MODEL_PROVIDER="openai"\nMELDR_MODEL_API_KEY="secret"\n',
    );

    const notices = legacyLocalStateNotices(cwd, home);
    assert.equal(notices.length, 2);
    assert.match(notices[0] ?? "", /MELDR_HOME=/);
    assert.match(notices[1] ?? "", /meldr setup/);
    assert.doesNotMatch(notices.join("\n"), /secret/);

    // Pointing MELDR_HOME at the legacy folder is a valid way to keep using it.
    assert.equal(
      legacyLocalStateNotices(cwd, resolve(cwd, ".forem-agent")).length,
      1,
    );

    // A new, empty database in home must not hide the projects notice.
    writeFileSync(resolve(home, "forem-agent.db"), "");
    assert.equal(legacyLocalStateNotices(cwd, home).length, 2);

    // Once migrated, the notices disappear.
    rmSync(resolve(cwd, ".forem-agent", "forem-agent.db"));
    writeFileSync(userConfigPath(home), "");
    assert.deepEqual(legacyLocalStateNotices(cwd, home), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an unreadable .env in the working directory does not stop meldr", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "meldr-unreadable-"));

  try {
    // A directory named .env makes readFileSync throw EISDIR on every platform.
    mkdirSync(resolve(directory, ".env"));
    assert.deepEqual(
      legacyLocalStateNotices(directory, resolve(directory, "home")),
      [],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an unrelated project .env does not trigger a meldr notice", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "meldr-unrelated-"));

  try {
    writeFileSync(
      resolve(directory, ".env"),
      "OPENAI_API_KEY=someone-elses-project-key\n",
    );
    assert.deepEqual(
      legacyLocalStateNotices(directory, resolve(directory, "home")),
      [],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
