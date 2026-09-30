import readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { renderBrand, style, truncate } from "../ui/terminal.js";

export type MenuOption<T> = {
  label: string;
  value: T;
  description?: string;
  disabled?: boolean;
};

export async function selectMenu<T>(inputOptions: {
  title: string;
  subtitle?: string;
  options: Array<MenuOption<T>>;
  canGoBack?: boolean;
  hint?: string;
}): Promise<T | null> {
  ensureInteractiveTerminal();

  let selected = Math.max(
    0,
    inputOptions.options.findIndex((option) => !option.disabled),
  );

  while (true) {
    renderMenu(inputOptions, selected);
    const key = await readKey();

    if (key.ctrl && key.name === "c") return null;
    if (key.name === "q") return null;
    if (inputOptions.canGoBack && key.name === "escape") {
      return null;
    }

    if (key.name === "up" || key.name === "k") {
      selected = moveSelection(inputOptions.options, selected, -1);
      continue;
    }

    if (key.name === "down" || key.name === "j") {
      selected = moveSelection(inputOptions.options, selected, 1);
      continue;
    }

    if (key.name === "return" || key.name === "enter") {
      const option = inputOptions.options[selected];
      if (option && !option.disabled) return option.value;
    }
  }
}

export async function promptText(
  question: string,
  options?: { allowEmpty?: boolean },
): Promise<string | null> {
  ensureInteractiveTerminal();
  restoreCookedMode();

  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = (await rl.question(`${question} `)).trim();
      if (answer || options?.allowEmpty) return answer;
      console.log(style.dim("Please enter a value, or Ctrl+C to cancel."));
    }
  } catch (error) {
    if (isAbortLike(error)) return null;
    throw error;
  } finally {
    rl.close();
  }
}

export async function confirm(
  question: string,
  defaultYes = false,
): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await promptText(`${question} ${suffix}`, {
    allowEmpty: true,
  });
  if (answer === null) return false;
  if (!answer) return defaultYes;
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

export async function pause(message = "Press Enter to continue"): Promise<void> {
  await promptText(message, { allowEmpty: true });
}

export function clearScreen(): void {
  if (output.isTTY) {
    output.write("\u001b[2J\u001b[H");
  }
}

function renderMenu<T>(
  inputOptions: {
    title: string;
    subtitle?: string;
    options: Array<MenuOption<T>>;
    canGoBack?: boolean;
    hint?: string;
  },
  selected: number,
): void {
  clearScreen();

  const width = Math.max(
    42,
    Math.min(output.columns ?? 80, 96),
  );

  renderBrand(width);
  console.log(style.dim("─".repeat(Math.min(width, 72))));
  console.log("");
  console.log(style.bold(inputOptions.title));

  if (inputOptions.subtitle) {
    console.log(style.dim(inputOptions.subtitle));
  }

  console.log("");

  const labelWidth = Math.max(24, width - 8);

  inputOptions.options.forEach((option, index) => {
    const marker = index === selected ? style.cyan("›") : " ";
    const label = truncate(option.label, labelWidth);
    const renderedLabel = option.disabled
      ? style.dim(label)
      : index === selected
        ? style.bold(label)
        : label;

    console.log(`${marker} ${renderedLabel}`);

    if (option.description && index === selected) {
      console.log(`  ${style.dim(truncate(option.description, labelWidth))}`);
    }
  });

  console.log("");
  console.log(
    style.dim(
      inputOptions.hint ??
        `↑/↓ navigate  Enter select${inputOptions.canGoBack ? "  q back" : "  q exit"}`,
    ),
  );
}

function moveSelection<T>(
  options: Array<MenuOption<T>>,
  current: number,
  direction: 1 | -1,
): number {
  if (options.length === 0) return current;

  let candidate = current;
  for (let count = 0; count < options.length; count += 1) {
    candidate =
      (candidate + direction + options.length) %
      options.length;
    if (!options[candidate]?.disabled) return candidate;
  }

  return current;
}

function readKey(): Promise<readline.Key> {
  return new Promise((resolve) => {
    readline.emitKeypressEvents(input);
    input.setRawMode?.(true);
    input.resume();

    const handler = (_sequence: string, key: readline.Key) => {
      cleanup();
      resolve(key);
    };

    const cleanup = () => {
      input.off("keypress", handler);
      input.setRawMode?.(false);
      input.pause();
    };

    input.once("keypress", handler);
  });
}

function ensureInteractiveTerminal(): void {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      "Interactive meldr requires a TTY. Use the regular CLI commands for scripts or redirected input.",
    );
  }
}

function restoreCookedMode(): void {
  input.setRawMode?.(false);
  input.resume();
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.includes("SIGINT"))
  );
}
