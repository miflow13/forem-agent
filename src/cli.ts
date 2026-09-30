#!/usr/bin/env node
import { Command, Option } from "commander";
import { ensureHome, loadConfig, loadProjectEnv } from "./config.js";
import { runAnalyze } from "./commands/analyze.js";
import { runDraft } from "./commands/draft.js";
import { runOpportunities } from "./commands/opportunities.js";
import { approvePlan, runPlan } from "./commands/plan.js";
import { getProjectStatus, listProjects } from "./commands/projects.js";
import { runResearch } from "./commands/research.js";
import { runRevision } from "./commands/revise.js";
import { interpretArticleAnalysis } from "./editorial/interpreter.js";
import { revisionPasses } from "./editorial/reviser.js";
import { createConfiguredModel } from "./providers/configured-model.js";
import {
  brand,
  bullet,
  command,
  divider,
  fail,
  info,
  keyValue,
  section,
  statusLabel,
  style,
  success,
  truncate,
  warn,
} from "./ui/terminal.js";

loadProjectEnv();

const program = new Command();

program
  .name("forem-agent")
  .description("meldr — local-first editorial intelligence for Forem / DEV")
  .version("0.1.0")
  .showHelpAfterError()
  .addHelpText(
    "after",
    [
      "",
      "Workflow:",
      "  research → opportunities → plan → approve → draft → revise",
      "",
      "Navigation:",
      "  forem-agent projects        list editorial projects",
      "  forem-agent status <slug>   show one project's state and next step",
      "  forem-agent revise <slug> --pass structure|voice|claim-check",
      "",
      "Set MELDR_DEBUG=1 to show full stack traces for errors.",
    ].join("\n"),
  );

program
  .command("init")
  .description("Create the local meldr workspace and database")
  .action(async () => {
    const config = loadConfig();
    ensureHome(config);

    const { AgentDatabase } = await import("./storage/database.js");
    const database = new AgentDatabase(config.databasePath);
    database.close();

    brand();
    success("Workspace initialized");
    keyValue("State", config.homeDir);
    keyValue("Articles", config.workspaceDir);
    section("Next");
    info(command("forem-agent research --pages 2 --per-page 30"));
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

    info(
      `Collecting Forem sample (${options.pages} page${options.pages === 1 ? "" : "s"} × up to ${options.perPage})…`,
    );

    const result = await runResearch(config, {
      pages: options.pages,
      perPage: options.perPage,
      tag: options.tag,
      username: options.username,
      topDays: options.topDays,
    });

    success(
      `Research run #${result.runId} stored ${result.articleCount} unique articles`,
    );
    keyValue("Database", config.databasePath);
    section("Next");
    info(command("forem-agent opportunities"));
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

    section("Opportunities");
    if (opportunities.length === 0) {
      warn("No opportunity signals found in the latest research sample.");
      return;
    }

    const tagWidth = Math.min(
      24,
      Math.max(8, ...opportunities.map((item) => item.tag.length)),
    );

    console.log(
      style.dim(
        `${"#".padEnd(4)}${"tag".padEnd(tagWidth + 2)}${"sample".padEnd(9)}${"avg eng".padEnd(10)}${"age".padEnd(10)}signal`,
      ),
    );

    opportunities.forEach((item, index) => {
      const avgEngagement =
        Math.round(item.averageEngagement * 10) / 10;
      const avgAge = Math.round(item.averageAgeHours * 10) / 10;
      console.log(
        `${String(index + 1).padEnd(4)}${truncate(item.tag, tagWidth).padEnd(tagWidth + 2)}${String(item.articleCount).padEnd(9)}${String(avgEngagement).padEnd(10)}${`${avgAge}h`.padEnd(10)}${item.signalScore}`,
      );
    });

    divider();
    console.log(
      style.dim(
        "Signal score is a sample heuristic, not a prediction of article success.",
      ),
    );
    const first = opportunities[0];
    if (first) {
      section("Try one");
      info(command(`forem-agent plan tag:${first.tag}`));
    }
  });

program
  .command("analyze <article>")
  .description("Analyze a public article against the local research sample")
  .addOption(
    new Option("--format <format>", "output format")
      .choices(["table", "json"])
      .default("table"),
  )
  .option(
    "--interpret",
    "ask the configured model to interpret the deterministic evidence packet",
  )
  .action(async (article, options) => {
    const config = loadConfig();
    ensureHome(config);

    if (options.format !== "json") {
      info("Fetching article and building deterministic comparison…");
    }

    const result = await runAnalyze(config, article);
    let interpreted:
      | Awaited<ReturnType<typeof interpretArticleAnalysis>>
      | null = null;

    if (options.interpret) {
      const model = createConfiguredModel(config);
      if (!model) {
        throw new Error(
          "Model interpretation requires OPENAI_API_KEY. Deterministic analysis does not.",
        );
      }

      if (options.format !== "json") {
        info(`Interpreting evidence with ${config.openaiModel}…`);
      }

      interpreted = await interpretArticleAnalysis(
        model,
        result.analysis,
      );
    }

    if (options.format === "json") {
      console.log(
        JSON.stringify(
          {
            ...result,
            interpretation: interpreted,
          },
          null,
          2,
        ),
      );
      return;
    }

    const { analysis } = result;

    section("Article");
    console.log(style.bold(analysis.article.title));
    console.log(style.dim(`@${analysis.article.author}`));
    console.log(style.dim(analysis.article.url));
    console.log("");
    keyValue("Age", `${analysis.article.ageHours} hours`);
    keyValue("Reactions", analysis.article.reactions);
    keyValue("Comments", analysis.article.comments);
    keyValue("Engagement", analysis.article.engagement);
    keyValue("Per day", analysis.article.engagementPerDay);

    section("Community baseline");
    if (analysis.community) {
      keyValue("Cohort", `${analysis.community.cohortSize} articles`);
      keyValue("Median/day", analysis.community.medianEngagementPerDay);
      keyValue("Target/day", analysis.community.targetEngagementPerDay);
      keyValue("Residual/day", analysis.community.residualPerDay);
    } else {
      warn("Unavailable for the current local research sample.");
    }

    section("Author baseline");
    if (analysis.owner) {
      keyValue("Cohort", `${analysis.owner.cohortSize} articles`);
      keyValue("Median/day", analysis.owner.medianEngagementPerDay);
      keyValue("Target/day", analysis.owner.targetEngagementPerDay);
      keyValue("Residual/day", analysis.owner.residualPerDay);
    } else {
      console.log(
        style.dim(`Unavailable (${result.ownerAnalyticsStatus})`),
      );
    }

    if (result.ownerAnalyticsMessage) {
      console.log(style.dim(result.ownerAnalyticsMessage));
    }

    if (analysis.relatedArticles.length > 0) {
      section("Related articles");
      for (const related of analysis.relatedArticles) {
        bullet(
          `${related.title} ${style.dim(`[${related.sharedTags.join(", ")}]`)}`,
        );
        console.log(`    ${style.dim(related.url)}`);
      }
    }

    if (interpreted) {
      section(`Model interpretation · ${interpreted.model}`);
      console.log(interpreted.interpretation.summary);
      printStringList(
        "Observations",
        interpreted.interpretation.observations,
      );
      printStringList(
        "Possible explanations",
        interpreted.interpretation.possible_explanations,
      );
      printStringList(
        "Editorial lessons",
        interpreted.interpretation.editorial_lessons,
      );
      printStringList(
        "Cautions",
        interpreted.interpretation.cautions,
      );
    }

    section("Limitations");
    for (const limitation of analysis.limitations) {
      bullet(limitation);
    }
  });

program
  .command("plan <idea>")
  .description(
    'Create a proposed editorial brief from an idea or "tag:<tag>" reference',
  )
  .action(async (idea) => {
    const config = loadConfig();
    ensureHome(config);

    info(`Building an evidence-bounded brief with ${config.openaiModel}…`);
    const result = await runPlan(config, idea);

    success("Editorial brief created");
    keyValue("Project", result.project.slug);
    keyValue("Status", "proposed");
    keyValue("Model", result.model);
    keyValue("Brief", result.workspace.briefPath);

    section("Next");
    info("Review and edit brief.md. When the direction is yours:");
    console.log(`  ${command(`forem-agent approve ${result.project.slug}`)}`);
  });

program
  .command("approve <project>")
  .description("Approve a proposed editorial brief")
  .action((project) => {
    const config = loadConfig();
    ensureHome(config);

    const approved = approvePlan(config, project);
    success(`Approved ${approved.slug}`);
    keyValue("Workspace", approved.workspacePath);

    section("Next");
    info(command(`forem-agent draft ${approved.slug}`));
  });

program
  .command("draft <project>")
  .description("Generate draft.md section-by-section from an approved brief")
  .action(async (project) => {
    const config = loadConfig();
    ensureHome(config);

    info("Reading the approved brief from disk…");
    const drafted = await runDraft(
      config,
      project,
      undefined,
      (event) => {
        if (event.phase !== "section-start") return;
        info(
          `[${event.index}/${event.total}] Drafting ${event.heading}…`,
        );
      },
    );

    success(`Draft complete · ${drafted.sectionCount} sections`);
    keyValue("Project", drafted.slug);
    keyValue("Model", drafted.model);
    keyValue("Draft", drafted.draftPath);

    section("Next");
    info("Edit draft.md directly. Meldr will not overwrite it.");
    console.log(
      style.dim(
        "Structure, claim-check, and voice revision passes are the next workflow slice.",
      ),
    );
  });

program
  .command("revise <project>")
  .description("Create a non-destructive revision proposal for an existing draft")
  .addOption(
    new Option("--pass <pass>", "revision pass")
      .choices([...revisionPasses])
      .makeOptionMandatory(),
  )
  .action(async (project, options) => {
    const config = loadConfig();
    ensureHome(config);

    const pass = options.pass as (typeof revisionPasses)[number];
    if (pass === "claim-check") {
      info("Reviewing the draft for claims that still need source verification…");
    } else {
      info(`Running ${pass} revision pass with ${config.openaiModel}…`);
    }

    const result = await runRevision(config, project, pass);

    success(`${pass} revision proposal created`);
    keyValue("Project", result.slug);
    keyValue("Model", result.model);
    keyValue("Output", result.outputPath);

    section("Summary");
    console.log(result.summary);

    section("Safety");
    console.log(
      style.dim(
        "draft.md was not modified. Review the proposal before applying any changes.",
      ),
    );
  });

program
  .command("projects")
  .alias("ls")
  .description("List editorial projects and their current workflow stage")
  .action(() => {
    const config = loadConfig();
    ensureHome(config);

    const projects = listProjects(config);
    section("Projects");

    if (projects.length === 0) {
      warn("No editorial projects yet.");
      info(command('forem-agent plan "your article idea"'));
      return;
    }

    const width = Math.max(24, Math.min(56, (process.stdout.columns ?? 100) - 28));
    console.log(
      style.dim(
        `${"state".padEnd(12)}${"project".padEnd(width + 2)}files`,
      ),
    );

    for (const item of projects) {
      const files = [
        item.hasBrief ? "brief" : "no-brief",
        item.hasDraft ? "draft" : null,
      ]
        .filter(Boolean)
        .join(" + ");

      console.log(
        `${statusLabel(item.stage.padEnd(12))}${truncate(item.project.slug, width).padEnd(width + 2)}${files}`,
      );
    }

    section("Inspect");
    info(command("forem-agent status <project-slug>"));
  });

program
  .command("status <project>")
  .alias("show")
  .description("Show a project's files, stage, and next action")
  .action((project) => {
    const config = loadConfig();
    ensureHome(config);

    const item = getProjectStatus(config, project);

    section("Project");
    console.log(style.bold(item.project.title));
    keyValue("Slug", item.project.slug);
    keyValue("Stage", statusLabel(item.stage));
    keyValue("Brief", item.hasBrief ? item.briefPath : "missing");
    keyValue("Draft", item.hasDraft ? item.draftPath : "not created");
    keyValue("Updated", item.project.updatedAt);

    section("Next");
    if (item.nextAction.startsWith("forem-agent ")) {
      info(command(item.nextAction));
    } else {
      info(item.nextAction);
    }
  });

if (process.argv.length <= 2) {
  brand();
  program.outputHelp();
} else {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    console.error("");
    fail(message);

    if (message.includes("OPENAI_API_KEY")) {
      console.error(
        style.dim(
          "Add OPENAI_API_KEY to .env (not .env.example), then retry.",
        ),
      );
    }

    if (process.env.MELDR_DEBUG === "1") {
      console.error("");
      console.error(error);
    } else {
      console.error(
        style.dim("Set MELDR_DEBUG=1 to show the full stack trace."),
      );
    }

    process.exitCode = 1;
  }
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, got "${value}"`);
  }
  return parsed;
}

function printStringList(title: string, values: string[]): void {
  if (values.length === 0) return;
  console.log("");
  console.log(style.bold(title));
  for (const value of values) bullet(value);
}
