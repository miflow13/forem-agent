<img width="1983" height="793" alt="ChatGPT Image Sep 30, 2026, 12_34_10 PM" src="https://github.com/user-attachments/assets/352ec936-430d-4742-bdbf-52b7f6c7e616" />

# meldr
A local-first, editing-first technical-writing assistant for Forem/DEV writers.

Meldr is an editor before it is a writer. It helps a human writer research,
structure, review, proofread, and challenge an article while keeping evidence
and decisions inspectable. Optional model assistance can suggest talking
points, help start one section, draft one explicitly selected section, or—only
after a separate confirmation—create an AI first draft. It does not generate a
full article by default and never publishes autonomously. The writer remains
responsible for evidence, first-hand experience, final prose, approval, and
publication.

## V0.1 architecture

- **Forem gateway** — public article/feed reads first; authenticated author
  endpoints use a separate authenticated boundary.
- **SQLite memory** — local research runs, author-history runs, article
  metadata, project state, and append-only metric snapshots.
- **Deterministic analysis** — metrics and opportunity scoring remain
  inspectable before model interpretation.
- **Evidence-bounded model work** — models receive derived evidence,
  limitations, and provenance rather than credentials or hidden state.
- **Markdown workspace** — briefs and human-owned `working.md` files live under
  `./articles` by default and remain ordinary editable files.
- **Human approval gate** — planning creates `status: proposed`; a separate
  `approve` command is required to move a brief to `approved`.
- **Explicit writing mode** — each approved project chooses human drafting,
  section assistance, or a confirmed AI first draft; human drafting is the
  recommended default.
- **Draft-only publishing** — when added, remote writes must always use
  `published: false`; there will be no publish command.

## Current implementation

- typed environment/config validation
- Forem V1 media-type handling
- public Forem article reads without sending the Forem API key
- authenticated author identity and published-history reads
- local SQLite schema with separate public and owner metric snapshots
- `init` command
- `research` command for collecting recent/top article samples
- `opportunities` command with stable `tag:<tag>` references
- `analyze <article-id-or-url>` with community and authenticated-author
  baselines when available
- optional `analyze --interpret` structured model interpretation
- `plan <idea>` or `plan tag:<tag>` to create an editable proposed brief
- `approve <project-id-or-slug>` as the explicit planning approval gate
- persisted, backward-compatible per-project writing modes
- recommended human drafting into `working.md` without a model-generated body
- explicit per-section talking points, starter, or section-draft proposals
- confirmed AI-first drafting from the current approved `brief.md`
- AI-first creation writes an immutable `draft.md` article snapshot plus separate `editorial-notes.md`
- first-run onboarding that explains meldr before asking the writer to choose an AI provider
- OpenAI, Claude/Anthropic, and custom OpenAI-Responses-compatible provider setup
- masked API-key entry, local gitignored `.env` persistence, and a small connection check before entering the app
- beginner-friendly interactive terminal UI with arrow-key navigation, AI/model status, obvious recommended next steps, inline revision acceptance, file previews, and editor launching
- in-app **AI settings** for changing provider, model, or API key later
- polished scripted CLI with progress output, concise errors, `projects`/`status` navigation, and `NO_COLOR` support
- non-destructive `revise` passes for structure, voice, and claim review
- explicit `accept` promotion into `working.md`, with stale-revision protection and revision chaining
- OpenAI Responses adapter with strict JSON output and response storage disabled
- Anthropic Messages adapter using schema-constrained tool output
- fake model adapter for deterministic tests
- GitHub Actions CI

## Requirements

Node.js 22.5+ (the project uses Node's built-in `node:sqlite` module).

## Setup

```bash
npm install
npm run dev -- init
npm run dev
```

The first interactive launch introduces the workflow and asks which AI meldr
should use:

```text
Welcome to meldr: editor before writer
      ↓
Choose OpenAI / Claude / compatible custom provider
      ↓
Choose a model
      ↓
Enter API key with masked input
      ↓
Connection check
      ↓
Main meldr workspace
```

For local development, `npm run dev` opens the TUI. Once built and linked:

```bash
npm run build
npm link
meldr
```

You can rerun provider setup at any time with `meldr setup` or choose
**AI settings** inside the TUI. The old `forem-agent` executable remains as a
compatibility alias.

Local state is written to `.forem-agent/forem-agent.db`. Editable article
projects are written to `./articles` unless `FOREM_AGENT_WORKSPACE` is set.
The generated `.env` is local and gitignored. On filesystems that support
POSIX permissions, meldr restricts it to mode `0600`.

## AI providers

The guided setup currently supports:

- **OpenAI** through the Responses API. The default model is `gpt-5.6`.
- **Claude** through Anthropic's Messages API. The default model is
  `claude-sonnet-5`.
- **Custom OpenAI-compatible** endpoints that implement the Responses API.

Advanced users can skip the wizard and configure `.env` manually. The
provider-neutral variables are:

```bash
MELDR_MODEL_PROVIDER=openai
MELDR_MODEL_API_KEY=...
MELDR_MODEL=gpt-5.6
MELDR_MODEL_BASE_URL=https://api.openai.com/v1
```

Existing `OPENAI_API_KEY` / `OPENAI_MODEL` and
`ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` setups are still recognized when an
explicit `MELDR_MODEL_PROVIDER` is not configured. Process environment
variables keep precedence over values loaded from `.env`.

## Interactive mode

Running `meldr` with no arguments opens the beginner-friendly terminal UI.
You do not need to remember slugs, revision filenames, provider environment
variables, or long command flags.

The header shows the active AI provider/model, and project screens put the
recommended next action first.

The main screen lets you:

- continue the most recent article by title
- browse all projects and their current workflow state
- start a writing project from a plain-English idea
- refresh the local DEV research sample
- explore deterministic tag opportunities
- analyze a DEV article
- change AI provider/model/key without editing configuration files
- open the current brief/article in `$VISUAL`, `$EDITOR`, or VS Code
- choose human, section-assisted, or explicitly confirmed AI-first writing
- run structure, voice/proofreading, and claim reviews
- accept structure/voice proposals without copying timestamped filenames

Arrow keys move, Enter chooses, and `q` goes back or exits. The TUI uses the
same underlying commands and safety invariants as the scripted CLI.

## Analysis

```bash
# Deterministic public comparison only
npm run dev -- analyze 123456

# With FOREM_API_KEY set, your own published post also gets an author baseline
npm run dev -- analyze https://dev.to/username/article-slug

# Optional evidence-bounded model interpretation
npm run dev -- analyze 123456 --interpret

# Machine-readable evidence + interpretation packet
npm run dev -- analyze 123456 --interpret --format json
```

The deterministic analysis uses only observable article metadata. Engagement is
defined transparently as reactions + (comments × 2), then normalized by age
with a one-day floor. Community cohorts come from the latest local research
sample and are explicitly incomplete; no view counts, follower conversion,
private competitor analytics, or success probabilities are inferred.

## Planning workflow

Planning requires a completed research run and a configured model.

```bash
# Start from your own idea
npm run dev -- plan "why local-first AI tools are easier to trust"

# Or start from a tag opportunity shown by the opportunities command
npm run dev -- plan tag:typescript
```

A successful plan creates:

```text
articles/
└── <project-slug>/
    └── brief.md
```

The brief includes the intended reader, problem, thesis, scope, evidence,
competing angles, differentiation, outline, personal-experience placeholders,
claims to verify, title options, up to four tags, and risks/counterarguments.
It starts with `status: proposed`.

Edit the Markdown directly. When the thesis and outline are yours and you are
ready to choose how you will write:

```bash
npm run dev -- approve <project-id-or-slug>
```

Approval changes both the local project record and `brief.md` to
`status: approved`. Approval does not generate article prose. The next step is
always a writing-mode choice.

## Writing modes

Run the interactive interface and choose **Choose writing mode**, or use the
scripted CLI:

```bash
npm run dev -- mode <project-id-or-slug>
```

### Human draft — recommended

```bash
npm run dev -- mode <project-id-or-slug> human
```

Meldr creates and opens `working.md`, then waits for the writer. No article
prose is generated. Structure, voice/proofreading, and claim-review tools run
against the human-authored file.

### Section-assisted

```bash
npm run dev -- mode <project-id-or-slug> section_assisted
npm run dev -- section <project-id-or-slug> 1 --assist talking_points
npm run dev -- section <project-id-or-slug> 1 --assist starter
npm run dev -- section <project-id-or-slug> 1 --assist draft_section
```

Each request targets one approved outline section. Meldr stores the result as a
non-destructive proposal. It enters `working.md` only after explicit acceptance:

```bash
npm run dev -- section-accept <project-id-or-slug> <proposal-file>
```

Acceptance checks the exact SHA-256 digest of `working.md`; intervening human
edits make the proposal stale instead of being overwritten.

### AI first draft — explicit opt-in

```bash
npm run dev -- mode <project-id-or-slug> ai_first_draft --confirm-ai-draft
npm run dev -- draft <project-id-or-slug>
```

The confirmation records an explicit choice for this project only. Meldr does
not remember AI-first as a default for later projects. Drafting reads the
current `brief.md` from disk and calls the model once per outline section. The
result is a starting point for review, not publish-ready prose:

```text
articles/
└── <project-slug>/
    ├── brief.md
    ├── draft.md
    └── editorial-notes.md
```

`draft.md` is the immutable first-generation article snapshot.
Personal-experience placeholders and claims-to-verify live in
`editorial-notes.md`, not in the publishable article body. Meldr refuses to
overwrite either file during draft creation. Existing legacy drafts that still
contain those note sections are migrated non-destructively the next time a
revision runs.

## Editing and review workflow

Reviews are deliberately non-destructive. Human and section-assisted projects
start from `working.md`; AI-first projects initially start from immutable
`draft.md`. After a structure or voice proposal is accepted, future passes read
`working.md`. The current human-owned article is always the source of truth.

```bash
# Tighten pacing, transitions, repetition, and article-level structure
npm run dev -- revise <project-id-or-slug> --pass structure

# Promote the reviewed proposal into working.md
npm run dev -- accept <project-id-or-slug> <revision-file>

# The next pass now reads working.md
npm run dev -- revise <project-id-or-slug> --pass voice

# Promote that proposal too
npm run dev -- accept <project-id-or-slug> <revision-file>

# Identify factual and technical claims that still need source verification
npm run dev -- revise <project-id-or-slug> --pass claim-check
```

Depending on the selected mode, the workspace contains:

```text
articles/
└── <project-slug>/
    ├── brief.md
    ├── draft.md              # AI-first mode only; immutable
    ├── working.md            # human-owned current article
    ├── editorial-notes.md
    └── revisions/
        ├── ...-structure.md
        ├── ...-voice.md
        └── ...-claim-check.md
```

When it exists, `draft.md` is never changed by revision acceptance. `working.md`
is the current human-owned article state and may be edited directly. Each proposal
records the exact source file and SHA-256 digest it reviewed; `accept` refuses
a stale proposal if that source changed afterward.

Structure and voice proposals can be accepted. Claim-check reports cannot:
they are verification checklists, not article rewrites. Claim-check does not
invent sources or claim that a statement was independently verified.

## Navigation

```bash
meldr projects
meldr status <project-id-or-slug>
```

`projects` (alias `ls`) lists project stages and files. `status` (alias
`show`) reports the current stage and suggests the next workflow command.
Long model operations print progress, and expected user errors are concise by
default. Set `MELDR_DEBUG=1` for full stack traces and `NO_COLOR=1` to
disable ANSI styling.

## Planned commands

`push` is next. It will only create or update unpublished Forem drafts and
will include remote timestamp conflict checks.

## Security invariants

- Forem and model API keys stay in process memory and the local gitignored `.env` configuration file.
- Interactive API-key entry is masked.
- The onboarding connection check never places the API key in the prompt body.
- Public Forem requests do not carry the Forem API key.
- API keys are never persisted to SQLite.
- API keys are never sent to model context.
- API keys are never written to briefs, drafts, revision files, or logs.
- OpenAI response persistence is disabled in the OpenAI adapter.
- Claude structured output uses the Anthropic Messages tool boundary; credentials stay in request headers.
- No command may publish an article directly.
- Full-article generation requires explicit per-project AI-first selection and
  confirmation; human drafting remains the recommended first option.
