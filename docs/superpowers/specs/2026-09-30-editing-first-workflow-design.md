# Editing-First Writing Workflow

## Intent

Meldr is an editor before it is a writer. Its default path helps a technical
writer research, structure, review, proofread, and challenge their own work.
Generating prose is always an explicit choice: once for AI-first drafting or
separately for each section in section-assisted mode. Meldr never treats model
output as publish-ready and never publishes autonomously.

## Writing modes

An approved project must choose one of three project-scoped writing modes:

- `human` (recommended and highlighted first): create `working.md` with article
  frontmatter and the brief's first title, open it for the writer, and make
  structure review the next action. No model prose is generated.
- `section_assisted`: create `working.md` and guide the writer through the
  approved outline. For each section, the writer may write it, request talking
  points, request a starting passage, request a complete section draft, or
  skip. Any generated content is a proposal and enters `working.md` only after
  explicit acceptance. Existing `working.md` content is never overwritten.
- `ai_first_draft`: display a publish-readiness warning, require confirmation,
  generate immutable `draft.md`, and continue through the existing revision
  workflow. This selection is stored only for the project and is never used as
  the default for another project.

The CLI may retain `draft` as the explicit AI-first command for compatibility,
but it must select or require `ai_first_draft`; merely approving a brief cannot
lead directly to generation.

## Persistence and compatibility

SQLite `editorial_projects` gains a nullable `writing_mode` column with values
`human`, `section_assisted`, or `ai_first_draft`. The migration uses an additive
column check so existing databases remain readable.

Legacy projects infer display/runtime mode without rewriting history:

- a project with `draft.md` infers `ai_first_draft`;
- a project with `working.md` but no `draft.md` infers `human`;
- an approved project with neither file has no selected mode and must choose;
- proposed projects do not need a mode yet.

Explicit selection is persisted. Changing a selected mode after article files
exist is rejected to avoid ambiguous ownership.

## File ownership and transitions

```text
approved brief
    |
    +-- choose human ----------> working.md (human-owned)
    |                               |
    |                               +--> review proposals --> explicit accept
    |
    +-- choose section-assisted -> working.md (incremental, human-owned)
    |                               |
    |                               +--> per-section proposal --> explicit accept
    |
    +-- confirm AI first draft -> draft.md (immutable snapshot)
                                    |
                                    +--> review proposals --> working.md
```

`editorial-notes.md` remains separate. Structure and voice reviews remain
non-destructive proposals protected by source SHA-256. Claim check remains a
report that cannot be accepted. Human and section-assisted projects can run
reviews directly from `working.md`; AI-first projects retain the existing
`draft.md` fallback. No flow silently overwrites either article file.

Section proposals are stored under `revisions/` with their source SHA-256 and
section heading. Acceptance verifies the current `working.md` digest before
appending the accepted section, preventing stale proposals from overwriting or
interleaving with human edits.

## Interface and copy

First-run onboarding and help explicitly say that meldr edits before it writes,
supports research/structure/review/proofreading/claim challenge, and generates
a full draft only through explicit opt-in.

After brief approval, the recommended action is `Choose writing mode`, with
`Human draft / bring my own draft` selected first and marked recommended. The
main menu uses `Start a writing project`. Project details and CLI status show
the effective writing mode.

## Verification

Automated coverage must prove:

- additive migration and legacy mode inference;
- human is first/recommended and creates `working.md` without model calls;
- AI-first requires explicit selection/confirmation and preserves immutable
  `draft.md` behavior;
- section generation occurs only after a specific per-section action and
  acceptance rejects stale proposals;
- next actions transition from approval to mode choice and then into the
  appropriate editing/review flow;
- existing revision, acceptance, provider onboarding, and key-storage tests
  remain green.

Run the full test suite, TypeScript typecheck, and production build before push.
