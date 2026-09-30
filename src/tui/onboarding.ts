import {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  isModelConfigured,
  loadConfig,
  modelProviderLabel,
  modelStatusLabel,
  type AppConfig,
  type ModelProvider,
} from "../config.js";
import { verifyConfiguredModel } from "../providers/configured-model.js";
import {
  clearScreen,
  confirm,
  pause,
  promptSecret,
  promptText,
  selectMenu,
} from "./menu.js";
import {
  keyValue,
  renderBrand,
  section,
  style,
  success,
  warn,
} from "../ui/terminal.js";

export type ModelSetup = {
  provider: ModelProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
};

type WelcomeAction = "continue" | "change" | "setup" | "exit";
type ProviderAction = ModelProvider | "back";
type KeyAction = "keep" | "replace";

export async function ensureFirstRunOnboarding(
  initialConfig: AppConfig,
): Promise<AppConfig | null> {
  const markerPath = onboardingMarkerPath(initialConfig);
  const configured = isModelConfigured(initialConfig);

  if (existsSync(markerPath) && configured) {
    return initialConfig;
  }

  const action = await selectMenu<WelcomeAction>({
    title: "Welcome to meldr",
    subtitle: "A local-first, editing-first assistant for technical writers.",
    status: configured ? modelStatusLabel(initialConfig) : "AI not configured",
    body: [
      "Meldr is an editor before it is a writer: use it to research, structure, review, proofread, and challenge your work.",
      "It will not generate a full article unless you explicitly choose and confirm AI first draft mode for that project.",
      "Research and measurements stay inspectable before AI interpretation.",
      "Your writing stays local, revisions are proposals, and meldr never publishes for you.",
      configured
        ? "An existing AI configuration was detected."
        : "First, choose the AI provider you want meldr to use.",
    ],
    options: configured
      ? [
          {
            label: "Continue with current AI",
            value: "continue",
            description: modelStatusLabel(initialConfig),
          },
          {
            label: "Choose a different AI",
            value: "change",
            description: "OpenAI, Claude, or an OpenAI-Responses-compatible provider.",
          },
          { label: "Exit", value: "exit" },
        ]
      : [
          {
            label: "Set up my AI",
            value: "setup",
            description: "Your API key will be entered with masked input.",
          },
          { label: "Exit", value: "exit" },
        ],
    hint: "↑↓ move   Enter choose   q exit",
  });

  if (!action || action === "exit") {
    clearScreen();
    return null;
  }

  if (action === "continue") {
    writeOnboardingMarker(initialConfig);
    return initialConfig;
  }

  const configuredResult = await configureModelInteractive(initialConfig);
  if (!isModelConfigured(configuredResult)) {
    clearScreen();
    return null;
  }

  writeOnboardingMarker(configuredResult);
  return configuredResult;
}

export async function runAiSettings(
  config: AppConfig,
): Promise<AppConfig> {
  return configureModelInteractive(config);
}

export function saveModelSetup(
  envPath: string,
  setup: ModelSetup,
): void {
  const values: Record<string, string> = {
    MELDR_MODEL_PROVIDER: setup.provider,
    MELDR_MODEL_API_KEY: setup.apiKey,
    MELDR_MODEL: setup.model,
    MELDR_MODEL_BASE_URL: setup.baseUrl.replace(/\/$/, ""),
  };

  const existing = existsSync(envPath)
    ? readFileSync(envPath, "utf8")
    : "";

  const updated = upsertEnvValues(existing, values);
  writeFileSync(envPath, updated, {
    encoding: "utf8",
    mode: 0o600,
  });

  try {
    chmodSync(envPath, 0o600);
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

export function upsertEnvValues(
  source: string,
  values: Record<string, string>,
): string {
  const keys = new Set(Object.keys(values));
  const seen = new Set<string>();
  const lines = source ? source.split(/\r?\n/) : [];
  const output: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)\s*=/);
    const key = match?.[1];

    if (!key || !keys.has(key)) {
      output.push(line);
      continue;
    }

    if (seen.has(key)) continue;

    output.push(`${key}=${quoteEnv(values[key] ?? "")}`);
    seen.add(key);
  }

  const missing = Object.keys(values).filter((key) => !seen.has(key));
  if (missing.length > 0) {
    while (output.length > 0 && output.at(-1) === "") output.pop();

    if (output.length > 0) output.push("");
    output.push("# meldr AI configuration");
    for (const key of missing) {
      output.push(`${key}=${quoteEnv(values[key] ?? "")}`);
    }
  }

  return output.join("\n").trimEnd() + "\n";
}

async function configureModelInteractive(
  currentConfig: AppConfig,
): Promise<AppConfig> {
  let config = currentConfig;

  while (true) {
    const provider = await chooseProvider(config);
    if (!provider) return config;

    const details = await chooseProviderDetails(provider);
    if (!details) continue;

    const apiKey = await chooseApiKey(config, provider);
    if (!apiKey) continue;

    const setup: ModelSetup = {
      provider,
      apiKey,
      model: details.model,
      baseUrl: details.baseUrl,
    };

    const candidate: AppConfig = {
      ...config,
      modelProvider: provider,
      modelApiKey: apiKey,
      modelName: details.model,
      modelBaseUrl: details.baseUrl.replace(/\/$/, ""),
    };

    clearScreen();
    renderBrand();
    section("Checking your AI connection");
    keyValue("Provider", modelProviderLabel(provider));
    keyValue("Model", details.model);
    console.log("");
    console.log(style.dim("Your API key is not displayed or included in the test prompt."));
    console.log("");

    let verifiedModel: string | null = null;
    let verificationError: string | null = null;

    try {
      verifiedModel = await verifyConfiguredModel(candidate);
    } catch (error) {
      verificationError =
        error instanceof Error ? error.message : String(error);
    }

    if (verifiedModel) {
      success(`Connected · ${verifiedModel}`);
    } else {
      warn("Connection check failed.");
      console.log(style.dim(safeErrorMessage(verificationError ?? "Unknown error")));
    }

    const shouldSave = verifiedModel
      ? true
      : await confirm("Save these settings anyway?");

    if (!shouldSave) {
      const retry = await confirm("Try AI setup again?", true);
      if (retry) continue;
      return config;
    }

    const envPath = resolve(process.cwd(), ".env");
    saveModelSetup(envPath, setup);
    config = loadConfig();

    console.log("");
    success("AI settings saved");
    keyValue("Provider", modelProviderLabel(config.modelProvider));
    keyValue("Model", config.modelName ?? "not configured");
    console.log(
      style.dim(
        `Saved to ${envPath}. The file is gitignored and permissions are restricted where supported.`,
      ),
    );
    console.log("");

    await pause();
    return config;
  }
}

async function chooseProvider(
  config: AppConfig,
): Promise<ModelProvider | null> {
  const value = await selectMenu<ProviderAction>({
    title: "Choose your AI",
    subtitle: "You can change this later from AI settings.",
    status: modelStatusLabel(config),
    options: [
      {
        label: "OpenAI",
        value: "openai",
        description: "Uses the OpenAI Responses API.",
      },
      {
        label: "Claude",
        value: "anthropic",
        description: "Uses Anthropic's Messages API.",
      },
      {
        label: "Custom OpenAI-compatible",
        value: "openai-compatible",
        description: "For providers that implement the OpenAI Responses API.",
      },
      { label: "Back", value: "back" },
    ],
    canGoBack: true,
  });

  if (!value || value === "back") return null;
  return value;
}

async function chooseProviderDetails(
  provider: ModelProvider,
): Promise<{ model: string; baseUrl: string } | null> {
  if (provider === "openai") {
    const model = await selectMenu<string>({
      title: "Choose an OpenAI model",
      subtitle: "Pick a default or enter another model ID.",
      options: [
        {
          label: "GPT-5.6",
          value: "gpt-5.6",
          description: "Flagship default for complex writing and reasoning.",
        },
        {
          label: "GPT-5.6 Terra",
          value: "gpt-5.6-terra",
          description: "Balanced capability and cost.",
        },
        {
          label: "GPT-5.6 Luna",
          value: "gpt-5.6-luna",
          description: "Lower-cost option for lighter workloads.",
        },
        {
          label: "Enter another model ID",
          value: "__custom__",
        },
      ],
      canGoBack: true,
    });

    if (!model) return null;
    const selected =
      model === "__custom__"
        ? await promptText("OpenAI model ID:")
        : model;
    if (!selected) return null;

    return {
      model: selected,
      baseUrl: "https://api.openai.com/v1",
    };
  }

  if (provider === "anthropic") {
    const model = await selectMenu<string>({
      title: "Choose a Claude model",
      subtitle: "Pick a default or enter another Anthropic model ID.",
      options: [
        {
          label: "Claude Sonnet 5",
          value: "claude-sonnet-5",
          description: "Recommended default for strong writing and reasoning.",
        },
        {
          label: "Claude Opus 5",
          value: "claude-opus-5",
          description: "Higher-capability option for demanding work.",
        },
        {
          label: "Enter another model ID",
          value: "__custom__",
        },
      ],
      canGoBack: true,
    });

    if (!model) return null;
    const selected =
      model === "__custom__"
        ? await promptText("Anthropic model ID:")
        : model;
    if (!selected) return null;

    return {
      model: selected,
      baseUrl: "https://api.anthropic.com/v1",
    };
  }

  clearScreen();
  renderBrand();
  section("Custom OpenAI-compatible provider");
  console.log(
    style.dim(
      "This path expects an API that implements the OpenAI Responses API.",
    ),
  );
  console.log("");

  const baseUrl = await promptText("Base URL (for example https://host.example/v1):");
  if (!baseUrl) return null;

  try {
    new URL(baseUrl);
  } catch {
    warn("That is not a valid URL.");
    await pause();
    return null;
  }

  const model = await promptText("Model ID:");
  if (!model) return null;

  return {
    model,
    baseUrl,
  };
}

async function chooseApiKey(
  config: AppConfig,
  provider: ModelProvider,
): Promise<string | null> {
  if (
    config.modelProvider === provider &&
    config.modelApiKey
  ) {
    const action = await selectMenu<KeyAction>({
      title: "API key",
      subtitle: "A key is already configured for this provider.",
      options: [
        {
          label: "Keep existing API key",
          value: "keep",
          description: "The current key will not be displayed.",
        },
        {
          label: "Enter a different API key",
          value: "replace",
        },
      ],
      canGoBack: true,
    });

    if (!action) return null;
    if (action === "keep") return config.modelApiKey;
  }

  clearScreen();
  renderBrand();
  section(`${modelProviderLabel(provider)} API key`);
  console.log(
    style.dim(
      "Input is masked. meldr saves the key only in the local .env file.",
    ),
  );
  console.log("");

  return promptSecret("API key:");
}

function onboardingMarkerPath(config: AppConfig): string {
  return resolve(config.homeDir, "onboarding-v1");
}

function writeOnboardingMarker(config: AppConfig): void {
  writeFileSync(
    onboardingMarkerPath(config),
    JSON.stringify(
      {
        version: 1,
        provider: config.modelProvider,
        model: config.modelName,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function quoteEnv(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error("Environment values cannot contain newlines.");
  }
  return JSON.stringify(value);
}

function safeErrorMessage(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(api[_ -]?key["']?\s*[:=]\s*)[^\s,}]+/gi, "$1[redacted]")
    .slice(0, 320);
}
