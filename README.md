# forem-agent
meldr

A local-first editorial intelligence CLI for Forem/DEV writers.

The goal is not to auto-publish AI-written articles. The agent gathers public
Forem signals, stores reproducible research locally, runs deterministic
analysis, and can optionally ask a model to interpret bounded evidence or build
an editable editorial brief. The writer keeps control of thesis, direction,
revision, approval, and publication.

## V0.1 architecture

- **Forem gateway** — public article/feed reads first; authenticated author
  endpoints use a separate authenticated boundary.
- **SQLite memory** — local research runs, author-history runs, article
  metadata, project state, and append-only metric snapshots.
- **Deterministic analysis** — metrics and opportunity scoring remain
  inspectable before model interpretation.
- **Evidence-bounded model work** — models receive derived evidence,
  limitations, and provenance rather than credentials or hidden state.
- **Markdown workspace** — proposed briefs and future drafts live under
  `./articles` by default and remain ordinary editable files.
- **Human approval gate** — planning creates `status: proposed`; a separate
  `approve` command is required to move a brief to `approved`.
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
- `draft <project-id-or-slug>` for section-by-section generation from the current approved `brief.md`
- draft creation refuses to overwrite an existing human-editable `draft.md`
- OpenAI Responses adapter with strict JSON output and response storage disabled
- fake model adapter for deterministic tests
- GitHub Actions CI

## Requirements

Node.js 22.5+ (the project uses Node's built-in `node:sqlite` module).

## Setup

```bash
npm install
cp .env.example .env
npm run dev -- init
npm run dev -- research --pages 2 --per-page 30
npm run dev -- opportunities
```

Local state is written to `.forem-agent/forem-agent.db`. Editable article
projects are written to `./articles` unless `FOREM_AGENT_WORKSPACE` is set.

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
ready to draft:

```bash
npm run dev -- approve <project-id-or-slug>
```

Approval changes both the local project record and `brief.md` to
`status: approved`.

## Drafting workflow

Drafting reads the current `brief.md` from disk, so edits made after planning
and before drafting remain authoritative.

```bash
npm run dev -- draft <project-id-or-slug>
```

The model is called once per outline section rather than generating the whole
article in one pass. The result is written to:

```text
articles/
└── <project-slug>/
    ├── brief.md
    └── draft.md
```

Personal-experience placeholders and claims-to-verify are carried into the
draft as visible author notes instead of being invented or silently resolved
by the model. If `draft.md` already exists, meldr refuses to overwrite it.

## Planned commands

`revise` and `push` are next. Revision passes will preserve human edits,
and `push` will only create or update unpublished Forem drafts with remote
timestamp conflict checks.

## Security invariants

- Forem and model API keys stay in process environment variables.
- Public Forem requests do not carry the Forem API key.
- API keys are never persisted to SQLite.
- API keys are never sent to model context.
- API keys are never written to generated files or logs.
- Model response persistence is disabled in the OpenAI adapter.
- No command may publish an article directly.
