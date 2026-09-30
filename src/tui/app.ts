import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { modelStatusLabel, type AppConfig } from "../config.js";
import { acceptRevision } from "../commands/accept.js";
import { runAnalyze } from "../commands/analyze.js";
import { runDraft } from "../commands/draft.js";
import { runOpportunities } from "../commands/opportunities.js";
import { approvePlan, runPlan } from "../commands/plan.js";
import {
  getProjectStatus,
  listProjects,
  type ProjectSummary,
} from "../commands/projects.js";
import { runResearch } from "../commands/research.js";
import { runRevision } from "../commands/revise.js";
import {
  acceptSectionAssistance,
  runSectionAssistance,
  type SectionAssistanceType,
} from "../commands/section-assist.js";
import { selectWritingMode } from "../commands/writing-mode.js";
import { parseRevisionProposal } from "../editorial/reviser.js";
import { sha256 } from "../editorial/article-files.js";
import { parseDraftBrief } from "../editorial/drafter.js";
import type { WritingMode } from "../storage/database.js";
import {
  clearScreen,
  confirm,
  pause,
  promptText,
  selectMenu,
} from "./menu.js";
import {
  ensureFirstRunOnboarding,
  runAiSettings,
} from "./onboarding.js";
import {
  bullet,
  divider,
  info,
  keyValue,
  section,
  style,
  success,
  warn,
} from "../ui/terminal.js";

type MainAction =
  | "continue"
  | "projects"
  | "new"
  | "research"
  | "opportunities"
  | "analyze"
  | "settings"
  | "help"
  | "exit";

type ProjectAction =
  | "approve"
  | "choose-mode"
  | "draft"
  | "section-assist"
  | "structure"
  | "voice"
  | "claim-check"
  | "claim-report"
  | "accept-latest"
  | "preview"
  | "edit"
  | "notes"
  | "details"
  | "back";

export async function runInteractive(initialConfig: AppConfig): Promise<void> {
  const onboarded = await ensureFirstRunOnboarding(initialConfig);
  if (!onboarded) return;

  let config = onboarded;

  while (true) {
    const projects = listProjects(config);
    const recent = projects[0] ?? null;
    const recentClaimReport = recent
      ? latestCurrentClaimReport(recent)
      : null;

    const action = await selectMenu<MainAction>({
      title: "What would you like to do?",
      subtitle: recent
        ? `Most recent: ${recent.project.title}`
        : "No editorial projects yet.",
      status: modelStatusLabel(config),
      options: [
        ...(recent
          ? [
              {
                label: `Continue “${recent.project.title}”`,
                value: "continue" as const,
                description: `Next · ${friendlyNextStep(
                  recent,
                  recentClaimReport !== null,
                )}`,
              },
            ]
          : []),
        {
          label: "Start a writing project",
          value: "new",
          description: "Turn a plain-English idea into an editable writing brief.",
        },
        {
          label: "Projects",
          value: "projects",
          description: "Browse articles by title and workflow stage.",
        },
        {
          label: "Explore writing opportunities",
          value: "opportunities",
          description: "Browse deterministic signals from your latest DEV sample.",
        },
        {
          label: "Analyze a DEV article",
          value: "analyze",
          description: "Compare a public article against your local sample.",
        },
        {
          label: "Refresh DEV research",
          value: "research",
          description: "Collect a fresh public Forem/DEV sample.",
        },
        {
          label: "AI settings",
          value: "settings",
          description: "Change provider, model, or API key.",
        },
        {
          label: "Help",
          value: "help",
          description: "See how meldr's workflow works.",
        },
        { label: "Exit", value: "exit" },
      ],
      hint: "↑↓ move   Enter choose   q exit",
    });

    if (!action || action === "exit") {
      clearScreen();
      return;
    }

    if (action === "continue" && recent) {
      await projectScreen(config, recent.project.slug);
      continue;
    }

    if (action === "projects") {
      await projectsScreen(config);
      continue;
    }

    if (action === "new") {
      await startArticleFlow(config);
      continue;
    }

    if (action === "research") {
      await researchFlow(config);
      continue;
    }

    if (action === "opportunities") {
      await opportunitiesFlow(config);
      continue;
    }

    if (action === "analyze") {
      await analyzeFlow(config);
      continue;
    }

    if (action === "settings") {
      config = await runAiSettings(config);
      continue;
    }

    if (action === "help") {
      showHelp();
      await pause();
    }
  }
}

async function projectsScreen(config: AppConfig): Promise<void> {
  while (true) {
    const projects = listProjects(config);

    if (projects.length === 0) {
      clearScreen();
      warn("No projects yet.");
      console.log("");
      console.log("Start with “Start a writing project” from the main menu.");
      await pause();
      return;
    }

    const chosen = await selectMenu<string>({
      title: "Projects",
      subtitle: "Choose an article. You never need to type its slug here.",
      status: modelStatusLabel(config),
      options: projects.map((item) => ({
        label: item.project.title,
        value: item.project.slug,
        description: `${friendlyStage(item)} · ${friendlyNextStep(
          item,
          latestCurrentClaimReport(item) !== null,
        )}`,
      })),
      canGoBack: true,
    });

    if (!chosen) return;
    await projectScreen(config, chosen);
  }
}

async function projectScreen(
  config: AppConfig,
  projectReference: string,
): Promise<void> {
  while (true) {
    const project = getProjectStatus(config, projectReference);
    const latest = latestAcceptableRevision(project);
    const claimReport = latestCurrentClaimReport(project);

    const options = projectActions(
      project,
      latest !== null,
      claimReport !== null,
    );
    const action = await selectMenu<ProjectAction>({
      title: project.project.title,
      subtitle: `${friendlyStage(project)} · Next: ${friendlyNextStep(
        project,
        claimReport !== null,
      )}`,
      status: modelStatusLabel(config),
      options,
      canGoBack: true,
      hint: "↑↓ move   Enter choose   q back",
    });

    if (!action || action === "back") return;

    if (action === "approve") {
      if (
        await confirm(
          "Approve this brief and choose how you want to write from it?",
        )
      ) {
        const approved = approvePlan(config, project.project.slug);
        clearScreen();
        success("Brief approved");
        keyValue("Project", approved.slug);
        console.log("");
        console.log(
          style.dim(
            "You can still edit brief.md. Next, choose whether you will write, work section by section, or explicitly request an AI first draft.",
          ),
        );
        await pause();
      }
      continue;
    }

    if (action === "choose-mode") {
      await chooseWritingModeFlow(config, project);
      continue;
    }

    if (action === "draft") {
      await draftFlow(config, project);
      continue;
    }

    if (action === "section-assist") {
      await sectionAssistedFlow(config, project);
      continue;
    }

    if (
      action === "structure" ||
      action === "voice" ||
      action === "claim-check"
    ) {
      await revisionFlow(config, project, action);
      continue;
    }

    if (action === "accept-latest" && latest) {
      await acceptFlow(config, project, latest);
      continue;
    }

    if (action === "claim-report" && claimReport) {
      clearScreen();
      section("Latest claim report");
      showClaimReportCompact(claimReport);
      await pause();
      continue;
    }

    if (action === "preview") {
      showArticlePreview(project);
      await pause();
      continue;
    }

    if (action === "edit") {
      openCurrentFile(project);
      await pause();
      continue;
    }

    if (action === "notes") {
      showNotesPreview(project);
      await pause();
      continue;
    }

    if (action === "details") {
      showProjectDetails(project);
      await pause();
    }
  }
}

export function projectActions(
  project: ProjectSummary,
  hasPendingRevision: boolean,
  hasCurrentClaimReport: boolean,
): Array<{
  label: string;
  value: ProjectAction;
  description?: string;
}> {
  const actions: Array<{
    label: string;
    value: ProjectAction;
    description?: string;
  }> = [];
  const hasArticle = project.hasDraft || project.hasWorking;
  const hasReviewableArticle =
    project.hasDraft || (project.hasWorking && project.hasArticleContent);

  if (project.stage === "proposed") {
    actions.push({
      label: "Next · Approve brief",
      value: "approve",
      description: "Mark the edited brief ready for a writing-mode choice.",
    });
  } else if (project.stage === "approved") {
    actions.push(
      project.writingMode === "ai_first_draft"
        ? {
            label: "Next · Generate confirmed AI first draft",
            value: "draft",
            description: "Create the immutable starting snapshot you explicitly selected.",
          }
        : {
            label: "Next · Choose writing mode",
            value: "choose-mode",
            description: "Decide how much writing help you want for this project.",
          },
    );
  } else if (project.stage === "draft") {
    actions.push({
      label: "Next · Review article structure",
      value: "structure",
      description: "Find repetition, pacing, and organization problems.",
    });
  } else if (project.stage === "working") {
    if (
      project.writingMode === "section_assisted" &&
      project.acceptedPass === null &&
      project.nextSectionNumber !== null
    ) {
      actions.push({
        label: "Next · Write section by section",
        value: "section-assist",
        description: "Choose what help, if any, you want for one section.",
      });
    } else if (
      project.writingMode === "human" &&
      !project.hasArticleContent
    ) {
      actions.push({
        label: "Next · Write in working.md",
        value: "edit",
        description: "Meldr will wait for your prose before offering article review.",
      });
    } else if (project.acceptedPass === "structure") {
      actions.push({
        label: "Next · Review writing voice",
        value: "voice",
        description: "Tighten rhythm, clarity, and generic AI phrasing.",
      });
    } else if (project.acceptedPass === "voice") {
      if (hasCurrentClaimReport) {
        actions.push({
          label: "Next · Review claim report",
          value: "claim-report",
          description: "Review the verification targets for the current article.",
        });
      } else {
        actions.push({
          label: "Next · Check claims to verify",
          value: "claim-check",
          description: "Identify factual claims that need source verification.",
        });
      }
    } else {
      actions.push({
        label: "Next · Review article structure",
        value: "structure",
      });
    }
  }

  if (hasPendingRevision) {
    actions.push({
      label: "Accept latest pending revision",
      value: "accept-latest",
      description: "Promote the newest still-valid structure/voice proposal.",
    });
  }

  actions.push({
    label: hasArticle ? "Open current article in editor" : "Open brief in editor",
    value: "edit",
    description: "Uses $VISUAL, $EDITOR, or VS Code when available.",
  });

  if (hasReviewableArticle) {
    actions.push({
      label: "Preview current article",
      value: "preview",
      description: project.hasWorking
        ? "Preview working.md, your current accepted article."
        : "Preview the original generated draft.",
    });
  }

  if (project.hasEditorialNotes) {
    actions.push({
      label: "View editorial notes",
      value: "notes",
      description: "Author placeholders and verification work kept out of the article.",
    });
  }

  if (hasReviewableArticle) {
    actions.push(
      {
        label: "Run structure review again",
        value: "structure",
      },
      {
        label: "Run voice review",
        value: "voice",
      },
      {
        label: "Run claim check",
        value: "claim-check",
      },
    );
  }

  actions.push({
    label: "Project details",
    value: "details",
    description: "Show file locations and workflow state.",
  });
  actions.push({ label: "Back", value: "back" });

  return dedupeActions(actions);
}

export function writingModeMenuOptions(): Array<{
  label: string;
  value: WritingMode;
  description: string;
}> {
  return [
    {
      label: "Human draft / bring my own draft (RECOMMENDED)",
      value: "human",
      description: "Write in working.md, then use meldr for structure, voice, proofreading, and claim review.",
    },
    {
      label: "Write with meldr section by section",
      value: "section_assisted",
      description: "Choose assistance separately for each section; no prose is generated automatically.",
    },
    {
      label: "Generate an AI first draft",
      value: "ai_first_draft",
      description: "Explicit opt-in. The result is a starting point, not publish-ready prose.",
    },
  ];
}

async function chooseWritingModeFlow(
  config: AppConfig,
  project: ProjectSummary,
): Promise<void> {
  const writingMode = await selectMenu<WritingMode>({
    title: "Choose writing mode",
    subtitle: "Meldr is an editor before it is a writer.",
    body: [
      "Human drafting is recommended. Meldr can research, structure, review, proofread, and challenge your work without writing it for you.",
      "Full-article generation happens only when you explicitly choose and confirm that mode.",
    ],
    options: writingModeMenuOptions(),
    canGoBack: true,
  });
  if (!writingMode) return;

  let confirmedAiFirstDraft = false;
  if (writingMode === "ai_first_draft") {
    confirmedAiFirstDraft = await confirm(
      "Generate a full AI first draft? It is only a starting point and must be reviewed before publication.",
    );
    if (!confirmedAiFirstDraft) return;
  }

  const result = selectWritingMode(
    config,
    project.project.slug,
    writingMode,
    { confirmAiFirstDraft: confirmedAiFirstDraft },
  );

  if (writingMode === "ai_first_draft") {
    await draftFlow(
      config,
      getProjectStatus(config, project.project.slug),
      true,
    );
    return;
  }

  clearScreen();
  success(
    writingMode === "human"
      ? "Human writing workspace ready"
      : "Section-assisted workspace ready",
  );
  keyValue("Article", result.workingPath ?? "not created");
  keyValue("Mode", writingModeLabel(writingMode));
  console.log("");
  console.log(
    style.dim(
      "working.md is yours. Meldr will not replace it without an explicit accepted proposal.",
    ),
  );
  if (result.workingPath) openPathInEditor(result.workingPath);
  await pause();
}

async function sectionAssistedFlow(
  config: AppConfig,
  project: ProjectSummary,
): Promise<void> {
  const brief = parseDraftBrief(readFileSync(project.briefPath, "utf8"));
  const sectionNumber = await selectMenu<number>({
    title: "Choose a section",
    subtitle: "Nothing is generated until you choose a help action.",
    options: brief.outline.map((item, index) => ({
      label: `${index + 1}. ${item.heading}`,
      value: index + 1,
      description: item.intent,
    })),
    canGoBack: true,
  });
  if (!sectionNumber) return;

  type SectionChoice = SectionAssistanceType | "write" | "skip";
  const choice = await selectMenu<SectionChoice>({
    title: brief.outline[sectionNumber - 1]?.heading ?? "Section",
    subtitle: "You decide whether meldr writes any prose for this section.",
    options: [
      {
        label: "I'll write this section",
        value: "write",
        description: "Open working.md and keep authorship fully yours.",
      },
      {
        label: "Suggest talking points",
        value: "talking_points",
        description: "Generate concise ideas, not finished section prose.",
      },
      {
        label: "Help me start it",
        value: "starter",
        description: "Generate a short opening passage for review.",
      },
      {
        label: "Draft this section from my approved brief",
        value: "draft_section",
        description: "Generate one complete section proposal for review.",
      },
      {
        label: "Skip for now",
        value: "skip",
      },
    ],
    canGoBack: true,
  });
  if (!choice || choice === "skip") return;
  if (choice === "write") {
    openPathInEditor(project.workingPath);
    await pause();
    return;
  }

  clearScreen();
  section("Creating section proposal");
  info("Using only the approved brief and this section's evidence…");
  const result = await runSectionAssistance(
    config,
    project.project.slug,
    sectionNumber,
    choice,
  );
  console.log("");
  printPreview(readFileSync(result.proposalPath, "utf8"), 42);
  console.log("");

  if (await confirm("Accept this proposal into working.md?")) {
    const accepted = acceptSectionAssistance(
      config,
      project.project.slug,
      basename(result.proposalPath),
    );
    success(`Accepted section · ${accepted.sectionHeading}`);
    keyValue("Article", accepted.workingPath);
  } else {
    console.log(
      style.dim(
        "Proposal kept in revisions/. working.md was not changed.",
      ),
    );
  }
  await pause();
}

async function draftFlow(
  config: AppConfig,
  project: ProjectSummary,
  confirmed = false,
): Promise<void> {
  if (
    !confirmed &&
    !(await confirm(
      "Generate an AI first draft now? It is a starting point, not publish-ready prose.",
    ))
  ) {
    return;
  }

  clearScreen();
  section("Generating draft");
  console.log(style.dim(project.project.title));
  console.log("");

  const result = await runDraft(
    config,
    project.project.slug,
    undefined,
    (event) => {
      if (event.phase === "section-start") {
        info(
          `[${event.index}/${event.total}] ${event.heading}`,
        );
      }
    },
  );

  console.log("");
  success(`Draft complete · ${result.sectionCount} sections`);
  keyValue("Article", result.draftPath);
  keyValue("Notes", result.editorialNotesPath);
  await pause();
}

async function revisionFlow(
  config: AppConfig,
  project: ProjectSummary,
  pass: "structure" | "voice" | "claim-check",
): Promise<void> {
  clearScreen();
  section(
    pass === "claim-check"
      ? "Checking claims"
      : `${titleCase(pass)} review`,
  );
  console.log(style.dim(project.project.title));
  console.log("");
  info(
    pass === "claim-check"
      ? "Identifying claims that still need source verification…"
      : `Reviewing ${project.hasWorking ? "working.md" : "draft.md"}…`,
  );

  const result = await runRevision(
    config,
    project.project.slug,
    pass,
  );

  console.log("");
  success(
    pass === "claim-check"
      ? "Claim report created"
      : `${titleCase(pass)} proposal created`,
  );
  console.log("");
  console.log(result.summary);

  if (pass === "claim-check") {
    showClaimReportCompact(result.outputPath);
    await pause();
    return;
  }

  showRevisionChangeReport(result.outputPath);

  console.log("");
  const acceptNow = await confirm(
    "Accept this proposal as the current working article?",
  );

  if (acceptNow) {
    const accepted = acceptRevision(
      config,
      project.project.slug,
      basename(result.outputPath),
    );
    console.log("");
    success(`Accepted ${accepted.pass} revision`);
    keyValue("Current article", accepted.workingPath);
  } else {
    console.log("");
    console.log(
      style.dim(
        "Proposal kept in revisions/. Your current article was not changed.",
      ),
    );
  }

  await pause();
}

async function acceptFlow(
  config: AppConfig,
  project: ProjectSummary,
  revisionPath: string,
): Promise<void> {
  clearScreen();
  section("Pending revision");
  showRevisionChangeReport(revisionPath);
  console.log("");

  if (
    !(await confirm(
      "Accept this proposal as the current working article?",
    ))
  ) {
    return;
  }

  const accepted = acceptRevision(
    config,
    project.project.slug,
    basename(revisionPath),
  );

  console.log("");
  success(`Accepted ${accepted.pass} revision`);
  keyValue("Current article", accepted.workingPath);
  await pause();
}

async function startArticleFlow(config: AppConfig): Promise<void> {
  clearScreen();
  section("Start a writing project");
  console.log(
    style.dim(
      "Describe what you want to write about. A sentence is enough.",
    ),
  );
  console.log("");

  const idea = await promptText("Article idea:");
  if (!idea) return;

  clearScreen();
  section("Creating editorial brief");
  info("Using your latest research sample and bounded model planning…");

  try {
    const result = await runPlan(config, idea);
    console.log("");
    success("Brief created");
    console.log(style.bold(result.project.title));
    keyValue("Brief", result.workspace.briefPath);
    console.log("");
    console.log(
      style.dim(
        "Review/edit brief.md before approving it. Approval leads to a writing-mode choice; it does not generate an article.",
      ),
    );

    if (await confirm("Open the brief in your editor now?")) {
      openPathInEditor(result.workspace.briefPath);
    }
  } catch (error) {
    warn(errorMessage(error));
    console.log("");
    console.log(
      style.dim(
        "If you have not researched DEV yet, choose “Refresh DEV research” from the main menu first.",
      ),
    );
  }

  await pause();
}

async function researchFlow(config: AppConfig): Promise<void> {
  clearScreen();
  section("Refresh DEV research");
  console.log(
    "Meldr will collect two public feed pages (up to 60 articles) for your local research sample.",
  );
  console.log("");

  if (!(await confirm("Continue?", true))) return;

  clearScreen();
  section("Refreshing DEV research");
  info("Collecting public Forem articles…");

  const result = await runResearch(config, {
    pages: 2,
    perPage: 30,
  });

  console.log("");
  success(
    `Stored ${result.articleCount} unique articles in research run #${result.runId}`,
  );
  console.log(
    style.dim(
      "This sample powers opportunities, planning, and community comparisons.",
    ),
  );
  await pause();
}

async function opportunitiesFlow(config: AppConfig): Promise<void> {
  const opportunities = runOpportunities(config, 10);

  if (opportunities.length === 0) {
    clearScreen();
    warn("No opportunity signals are available yet.");
    console.log("");
    console.log("Refresh DEV research first.");
    await pause();
    return;
  }

  const tag = await selectMenu<string>({
    title: "Writing opportunities",
    subtitle: "Signals from your latest local research sample, not success predictions.",
    options: opportunities.map((item) => ({
      label: `#${item.tag}`,
      value: item.tag,
      description: `${item.articleCount} articles · avg engagement ${round(item.averageEngagement)} · signal ${item.signalScore}`,
    })),
    canGoBack: true,
  });

  if (!tag) return;

  if (
    !(await confirm(
      `Create an editorial brief around #${tag}?`,
    ))
  ) {
    return;
  }

  clearScreen();
  section(`Planning from #${tag}`);
  info("Building a brief from the sampled evidence…");

  const result = await runPlan(config, `tag:${tag}`);
  console.log("");
  success("Brief created");
  console.log(style.bold(result.project.title));
  keyValue("Brief", result.workspace.briefPath);
  await pause();
}

async function analyzeFlow(config: AppConfig): Promise<void> {
  clearScreen();
  section("Analyze a DEV article");
  const reference = await promptText("Paste a DEV URL or article ID:");
  if (!reference) return;

  clearScreen();
  section("Analyzing article");
  info("Building deterministic comparison from your local sample…");

  try {
    const result = await runAnalyze(config, reference);
    const { analysis } = result;

    console.log("");
    console.log(style.bold(analysis.article.title));
    console.log(style.dim(`@${analysis.article.author}`));
    divider();
    keyValue("Reactions", analysis.article.reactions);
    keyValue("Comments", analysis.article.comments);
    keyValue("Engagement/day", analysis.article.engagementPerDay);

    if (analysis.community) {
      keyValue(
        "Community median",
        analysis.community.medianEngagementPerDay,
      );
      keyValue(
        "Residual/day",
        analysis.community.residualPerDay,
      );
    }

    if (analysis.relatedArticles.length > 0) {
      section("Related");
      for (const article of analysis.relatedArticles.slice(0, 4)) {
        bullet(article.title);
      }
    }
  } catch (error) {
    warn(errorMessage(error));
  }

  await pause();
}

function openCurrentFile(project: ProjectSummary): void {
  clearScreen();
  const path = project.hasWorking
    ? project.workingPath
    : project.hasDraft
      ? project.draftPath
      : project.briefPath;

  section("Open in editor");
  openPathInEditor(path);
}

function openPathInEditor(path: string): void {
  const editor =
    process.env.VISUAL ??
    process.env.EDITOR ??
    "code";

  const result = spawnSync(editor, [path], {
    stdio: "inherit",
  });

  if (result.error) {
    warn(`Could not launch ${editor}.`);
    console.log("");
    console.log("Open this file manually:");
    console.log(path);
    return;
  }

  if (result.status && result.status !== 0) {
    warn(`${editor} exited with status ${result.status}.`);
    console.log(path);
    return;
  }

  success(`Opened ${path}`);
}

function showArticlePreview(project: ProjectSummary): void {
  clearScreen();
  const path = project.hasWorking
    ? project.workingPath
    : project.draftPath;

  section(project.hasWorking ? "Current working article" : "Original draft");
  console.log(style.dim(path));
  console.log("");

  const markdown = readFileSync(path, "utf8");
  printPreview(markdown, 42);
}

function showNotesPreview(project: ProjectSummary): void {
  clearScreen();
  section("Editorial notes");
  console.log(style.dim(project.editorialNotesPath));
  console.log("");

  const markdown = readFileSync(project.editorialNotesPath, "utf8");
  printPreview(markdown, 50);
}

function showProjectDetails(project: ProjectSummary): void {
  clearScreen();
  section(project.project.title);
  keyValue("Stage", friendlyStage(project));
  keyValue("Writing mode", writingModeLabel(project.writingMode));
  keyValue("Brief", project.briefPath);
  keyValue("Draft", project.hasDraft ? project.draftPath : "not created");
  keyValue(
    "Working",
    project.hasWorking ? project.workingPath : "not accepted yet",
  );
  keyValue(
    "Notes",
    project.hasEditorialNotes
      ? project.editorialNotesPath
      : "not created",
  );
  console.log("");
  console.log(style.bold("Recommended next step"));
  console.log(friendlyNextStep(project));
}

function showRevisionChangeReport(path: string): void {
  const markdown = readFileSync(path, "utf8");
  const beforeArticle = markdown.split("\n## Proposed article\n")[0] ?? markdown;
  const lines = beforeArticle
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("---"))
    .filter((line) => !/^(revision_pass|source_article|source_sha256|model|created_at):/.test(line));

  section("Proposed changes");
  console.log(
    lines
      .slice(lines.findIndex((line) => line.trim() === "## Summary") + 1)
      .join("\n")
      .trim(),
  );
}

function showClaimReportCompact(path: string): void {
  const markdown = readFileSync(path, "utf8");
  const lines = markdown.split(/\r?\n/);
  const claims: Array<{ title: string; risk: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index]?.match(/^###\s+\d+\.\s+(.+)$/);
    if (!heading) continue;

    const risk = lines
      .slice(index + 1, index + 5)
      .find((line) => line.startsWith("- Risk:"))
      ?.replace("- Risk:", "")
      .trim();

    claims.push({
      title: heading[1] ?? "Claim",
      risk: risk ?? "unknown",
    });
  }

  section(`Claims to verify · ${claims.length}`);
  for (const claim of claims.slice(0, 10)) {
    const risk =
      claim.risk === "high"
        ? style.yellow(claim.risk)
        : style.dim(claim.risk);
    console.log(`• [${risk}] ${claim.title}`);
  }

  if (claims.length > 10) {
    console.log(
      style.dim(`…and ${claims.length - 10} more in the report.`),
    );
  }

  console.log("");
  console.log(style.dim(`Full report: ${path}`));
}

function latestCurrentClaimReport(
  project: ProjectSummary,
): string | null {
  if (!project.hasDraft && !project.hasWorking) return null;

  const revisionsDir = resolve(
    project.project.workspacePath,
    "revisions",
  );
  if (!existsSync(revisionsDir)) return null;

  const currentSource = project.hasWorking
    ? project.workingPath
    : project.draftPath;
  if (!existsSync(currentSource)) return null;

  const sourceName = project.hasWorking ? "working.md" : "draft.md";
  const sourceHash = sha256(readFileSync(currentSource, "utf8"));

  const candidates = readdirSync(revisionsDir)
    .filter((name) => name.endsWith("-claim-check.md"))
    .sort()
    .reverse();

  for (const name of candidates) {
    const path = resolve(revisionsDir, name);
    const markdown = readFileSync(path, "utf8");
    const reportSource = markdown.match(
      /^source_article:\s*["']?([^"'\r\n]+)["']?$/m,
    )?.[1];
    const reportHash = markdown.match(
      /^source_sha256:\s*([a-f0-9]{64})$/m,
    )?.[1];

    if (reportSource === sourceName && reportHash === sourceHash) {
      return path;
    }
  }

  return null;
}

function latestAcceptableRevision(
  project: ProjectSummary,
): string | null {
  const revisionsDir = resolve(
    project.project.workspacePath,
    "revisions",
  );

  if (!existsSync(revisionsDir)) return null;

  const currentSource = project.hasWorking
    ? project.workingPath
    : project.draftPath;

  if (!existsSync(currentSource)) return null;

  const sourceHash = sha256(readFileSync(currentSource, "utf8"));
  const sourceName = project.hasWorking ? "working.md" : "draft.md";

  const candidates = readdirSync(revisionsDir)
    .filter(
      (name) =>
        name.endsWith("-structure.md") ||
        name.endsWith("-voice.md"),
    )
    .sort()
    .reverse();

  for (const name of candidates) {
    const path = resolve(revisionsDir, name);
    try {
      const parsed = parseRevisionProposal(
        readFileSync(path, "utf8"),
      );
      if (
        parsed.sourceArticle === sourceName &&
        parsed.sourceSha256 === sourceHash
      ) {
        return path;
      }
    } catch {
      // Ignore legacy or malformed proposals in the beginner-facing TUI.
    }
  }

  return null;
}

export function friendlyStage(project: ProjectSummary): string {
  if (project.stage === "proposed") return "Brief ready for review";
  if (project.stage === "approved") return "Writing mode not chosen";
  if (project.stage === "draft") return "Draft ready for structure review";
  if (
    project.stage === "working" &&
    project.writingMode === "section_assisted" &&
    project.acceptedPass === null &&
    project.nextSectionNumber !== null
  ) {
    return "Writing section by section";
  }
  if (
    project.stage === "working" &&
    project.writingMode === "human" &&
    !project.hasArticleContent
  ) {
    return "Waiting for your draft";
  }
  if (
    project.stage === "working" &&
    project.acceptedPass === "structure"
  ) {
    return "Structure accepted";
  }
  if (
    project.stage === "working" &&
    project.acceptedPass === "voice"
  ) {
    return "Voice accepted";
  }
  if (project.stage === "working") return "Working article";
  return project.stage;
}

export function friendlyNextStep(
  project: ProjectSummary,
  hasCurrentClaimReport = false,
): string {
  if (project.stage === "proposed") return "Review and approve the brief";
  if (project.stage === "approved") {
    return project.writingMode === "ai_first_draft"
      ? "Generate the confirmed AI first draft"
      : "Choose writing mode";
  }
  if (project.stage === "draft") return "Review article structure";
  if (
    project.stage === "working" &&
    project.writingMode === "section_assisted" &&
    project.acceptedPass === null &&
    project.nextSectionNumber !== null
  ) {
    return `Write section ${project.nextSectionNumber}`;
  }
  if (
    project.stage === "working" &&
    project.writingMode === "human" &&
    !project.hasArticleContent
  ) {
    return "Write your draft in working.md";
  }
  if (
    project.stage === "working" &&
    project.acceptedPass === "structure"
  ) {
    return "Review writing voice";
  }
  if (
    project.stage === "working" &&
    project.acceptedPass === "voice"
  ) {
    return hasCurrentClaimReport
      ? "Review the current claim report"
      : "Check claims that need verification";
  }
  return "Review the current article";
}

function showHelp(): void {
  clearScreen();
  section("How meldr works");
  console.log(
    [
      "You do not need to memorize commands in interactive mode.",
      "Meldr is an editor before it is a writer: it helps research, structure, review, proofread, and challenge your work.",
      "It generates a full article only when you explicitly choose and confirm AI first draft mode.",
      "",
      "Typical article flow:",
      "",
      "  Research DEV",
      "      ↓",
      "  Create/edit brief",
      "      ↓",
      "  Approve brief",
      "      ↓",
      "  Choose writing mode",
      "      ↓",
      "  Write it yourself (recommended) / work section by section / confirm AI first draft",
      "      ↓",
      "  Structure review → accept",
      "      ↓",
      "  Voice review → accept",
      "      ↓",
      "  Claim check",
      "",
      "When AI-first mode is chosen, meldr keeps the original draft immutable.",
      "For every mode, the accepted working article,",
      "editorial notes, and revision history as separate files.",
      "",
      "Arrow keys move. Enter chooses. q goes back.",
      "AI settings can switch between OpenAI, Claude, and compatible custom providers.",
      "The regular command-line interface still works for automation.",
    ].join("\n"),
  );
}

function writingModeLabel(writingMode: WritingMode | null): string {
  if (writingMode === "human") return "Human draft";
  if (writingMode === "section_assisted") return "Section-assisted";
  if (writingMode === "ai_first_draft") return "AI first draft";
  return "Not chosen";
}

function printPreview(markdown: string, maxLines: number): void {
  const lines = markdown.split(/\r?\n/);
  const visible = lines.slice(0, maxLines);
  console.log(visible.join("\n"));
  if (lines.length > maxLines) {
    console.log("");
    console.log(
      style.dim(`… ${lines.length - maxLines} more lines`),
    );
  }
}

function dedupeActions<T extends { value: string }>(actions: T[]): T[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.value)) return false;
    seen.add(action.value);
    return true;
  });
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
