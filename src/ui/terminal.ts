const useColor =
  Boolean(process.stdout.isTTY) &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb";

const code = (open: number, close: number) => (value: string): string =>
  useColor ? `\u001b[${open}m${value}\u001b[${close}m` : value;

export const style = {
  bold: code(1, 22),
  dim: code(2, 22),
  cyan: code(36, 39),
  green: code(32, 39),
  yellow: code(33, 39),
  red: code(31, 39),
  magenta: code(35, 39),
};

const MELDR_MARK = [
  "╭╲ ╱╮",
  "│ ╳ │",
  "╰╱ ╲╯",
];

export function renderBrand(width = process.stdout.columns ?? 80): void {
  if (width < 36) {
    console.log(style.bold(style.magenta("⟦╳⟧ meldr")));
    console.log(style.dim("editorial copilot"));
    return;
  }

  console.log(
    `${style.magenta(MELDR_MARK[0] ?? "")}  ${style.bold(style.magenta("meldr"))}`,
  );
  console.log(
    `${style.magenta(MELDR_MARK[1] ?? "")}  ${style.dim("editorial copilot")}`,
  );
  console.log(
    `${style.magenta(MELDR_MARK[2] ?? "")}  ${style.dim("for Forem / DEV")}`,
  );
}

export function brand(): void {
  renderBrand();
  console.log("");
}

export function section(title: string): void {
  console.log("");
  console.log(style.bold(style.cyan(title)));
}

export function success(message: string): void {
  console.log(`${style.green("✓")} ${message}`);
}

export function info(message: string): void {
  console.log(`${style.cyan("→")} ${message}`);
}

export function warn(message: string): void {
  console.log(`${style.yellow("!")} ${message}`);
}

export function fail(message: string): void {
  console.error(`${style.red("✗")} ${message}`);
}

export function keyValue(label: string, value: string | number): void {
  console.log(`${style.dim(label.padEnd(13))} ${value}`);
}

export function bullet(value: string): void {
  console.log(`  • ${value}`);
}

export function command(value: string): string {
  return style.cyan(value);
}

export function divider(): void {
  console.log(style.dim("─".repeat(Math.min(process.stdout.columns ?? 72, 88))));
}

export function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return "…";
  return `${value.slice(0, width - 1)}…`;
}

export function statusLabel(status: string): string {
  if (status === "approved") return style.green(status);
  if (status === "proposed") return style.yellow(status);
  if (status === "draft") return style.cyan(status);
  if (status === "working") return style.magenta(status);
  return status;
}
