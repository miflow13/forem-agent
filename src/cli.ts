#!/usr/bin/env node
import { Command, Option } from "commander";
import { ensureHome, loadConfig } from "./config.js";
import { runOpportunities } from "./commands/opportunities.js";
import { runResearch } from "./commands/research.js";

const program = new Command();

program
  .name("forem-agent")
  .description("Local-first editorial intelligence for Forem/DEV")
  .version("0.1.0");

program
  .command("init")
  .description("Create the local Forem Agent workspace and database")
  .action(async () => {
    const config = loadConfig();
    ensureHome(config);

    const { AgentDatabase } = await import("./storage/database.js");
    const database = new AgentDatabase(config.databasePath);
    database.close();

    console.log(`Initialized Forem Agent at ${config.homeDir}`);
  });

program
  .command("research")
  .description("Collect a reproducible sample of public Forem articles")
  .addOption(
    new Option("--pages <number>", "number of feed pages to fetch")
      .default(1)
      .argParser(parsePositiveInt),
  )
  .addOption(
    new Option("--per-page <number>", "articles per page")
      .default(30)
      .argParser(parsePositiveInt),
  )
  .option("--tag <tag>", "filter by tag")
  .option("--username <username>", "filter by author username")
  .addOption(
    new Option("--top-days <number>", "Forem top window in days")
      .argParser(parsePositiveInt),
  )
  .action(async (options) => {
    const config = loadConfig();
    ensureHome(config);

    const result = await runResearch(config, {
      pages: options.pages,
      perPage: options.perPage,
      tag: options.tag,
      username: options.username,
      topDays: options.topDays,
    });

    console.log(
      `Research run #${result.runId} stored ${result.articleCount} unique articles in ${config.databasePath}`,
    );
  });

program
  .command("opportunities")
  .description("Rank tag signals from the latest completed research run")
  .addOption(
    new Option("--limit <number>", "maximum tags to display")
      .default(10)
      .argParser(parsePositiveInt),
  )
  .action((options) => {
    const config = loadConfig();
    ensureHome(config);

    const opportunities = runOpportunities(config, options.limit);

    console.table(
      opportunities.map((item) => ({
        tag: item.tag,
        articles: item.articleCount,
        avg_engagement: Math.round(item.averageEngagement * 10) / 10,
        avg_age_hours: Math.round(item.averageAgeHours * 10) / 10,
        signal_score: item.signalScore,
      })),
    );

    console.log(
      "Signal score is a transparent sample heuristic, not a prediction of article success.",
    );
  });

await program.parseAsync(process.argv);

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, got "${value}"`);
  }
  return parsed;
}
