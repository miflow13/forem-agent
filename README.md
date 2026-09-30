# forem-agent

A local-first editorial intelligence CLI for Forem/DEV writers.

The goal is not to auto-publish AI-written articles. The agent gathers public
Forem signals, stores reproducible research locally, runs deterministic
analysis, and later lets an LLM help interpret that evidence while the writer
keeps control of thesis, direction, revision, and publication.

## V0.1 architecture

- **Forem gateway** — public article/feed reads first; authenticated endpoints
  are added behind a separate boundary.
- **SQLite memory** — local research snapshots and article metadata.
- **Deterministic analysis** — metrics and opportunity scoring should be
  inspectable before model interpretation is added.
- **Provider-agnostic LLM boundary** — no provider is coupled to the core.
- **Markdown workspace** — plans and drafts remain ordinary files.
- **Draft-only publishing** — when added, remote writes must always use
  `published: false`; there will be no publish command.

## Current implementation

The first foundation slice includes:

- typed environment/config validation
- public Forem article reader
- local SQLite schema and upserts
- `init` command
- `research` command for collecting recent/top article samples

## Requirements

Node.js 22.5+ (the project uses Node's built-in `node:sqlite` module).

## Setup

```bash
npm install
cp .env.example .env
npm run dev -- init
npm run dev -- research --pages 2 --per-page 30
```

Research data is written to `.forem-agent/forem-agent.db` by default.

### Research examples

```bash
# Recent DEV articles
npm run dev -- research

# Narrow the feed by tag
npm run dev -- research --tag typescript

# Include Forem's top-window query
npm run dev -- research --top-days 7
```

## Planned commands

`opportunities`, `analyze`, `plan`, `draft`, `revise`, and `push`
will build on the research/storage foundation. `push` will only create or
update unpublished drafts and will include remote timestamp conflict checks.

## Security invariants

- API keys stay in process environment variables.
- API keys are never persisted to SQLite.
- API keys are never sent to model context.
- API keys are never written to generated files or logs.
- No command may publish an article directly.
