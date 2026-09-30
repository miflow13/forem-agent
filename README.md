# forem-agent
meldr

A local-first editorial intelligence CLI for Forem/DEV writers.

The goal is not to auto-publish AI-written articles. The agent gathers public
Forem signals, stores reproducible research locally, runs deterministic
analysis, and later lets an LLM help interpret that evidence while the writer
keeps control of thesis, direction, revision, and publication.

## V0.1 architecture

- **Forem gateway** — public article/feed reads first; authenticated author
  endpoints use a separate authenticated boundary.
- **SQLite memory** — local research runs, author-history runs, article
  metadata, and append-only metric snapshots.
- **Deterministic analysis** — metrics and opportunity scoring are inspectable
  before model interpretation is added.
- **Provider-agnostic LLM boundary** — no provider is coupled to the core.
- **Markdown workspace** — plans and drafts remain ordinary files.
- **Draft-only publishing** — when added, remote writes must always use
  `published: false`; there will be no publish command.

## Current implementation

The foundation now includes:

- typed environment/config validation
- Forem V1 media-type handling
- public Forem article reader that does not send the API key on public requests
- authenticated author identity and published-history reads
- local SQLite schema with separate public and owner metric snapshots
- `init` command
- `research` command for collecting recent/top article samples
- `opportunities` command with transparent deterministic tag signals
- `analyze <article-id-or-url>` with community and authenticated-author
  baselines when available
- tests and GitHub Actions CI

## Requirements

Node.js 22.5+ (the project uses Node's built-in `node:sqlite` module).

## Setup

```bash
npm install
cp .env.example .env
npm run dev -- init
npm run dev -- research --pages 2 --per-page 30
npm run dev -- opportunities
npm run dev -- analyze https://dev.to/username/article-slug
```

Research data is written to `.forem-agent/forem-agent.db` by default.

### Analyze examples

```bash
# Public comparison only when no API key is configured
npm run dev -- analyze 123456

# With FOREM_API_KEY set, your own published post also gets an author baseline
npm run dev -- analyze https://dev.to/username/article-slug

# Machine-readable evidence packet
npm run dev -- analyze 123456 --format json
```

The current analysis uses only observable article metadata. Engagement is
defined transparently as reactions + (comments × 2), then normalized by age
with a one-day floor. Community cohorts come from the latest local research
sample and are explicitly incomplete; no view counts, follower conversion,
private competitor analytics, or success probabilities are inferred.

## Planned commands

`plan`, `draft`, `revise`, and `push` will build on the
research/storage/analysis foundation. The next layer is evidence-bounded LLM
interpretation: the model will receive derived evidence, not secrets, and will
not be allowed to invent measurements. `push` will only create or update
unpublished drafts and will include remote timestamp conflict checks.

## Security invariants

- API keys stay in process environment variables.
- Public Forem requests do not carry the API key.
- API keys are never persisted to SQLite.
- API keys are never sent to model context.
- API keys are never written to generated files or logs.
- No command may publish an article directly.
