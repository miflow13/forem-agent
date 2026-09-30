# Editing-First Writing Workflow Implementation Plan

**Goal:** Make human-authored editing the default project workflow while
keeping section and full-draft generation behind explicit, persisted choices.

**Architecture:** A nullable project writing mode drives one project-summary
state resolver. Small command services own mode selection, human workspace
creation, and section proposal acceptance. Existing draft/revision/acceptance
services retain file ownership and SHA protections.

**Tech stack:** TypeScript, Node `node:sqlite`, Node test runner, Markdown
workspaces, dependency-free terminal UI.

**Spec:** `docs/superpowers/specs/2026-09-30-editing-first-workflow-design.md`

## Global constraints

- Preserve OpenAI, Anthropic, custom Responses-compatible onboarding and secure
  key handling.
- Never overwrite `draft.md` or human edits in `working.md`.
- Keep claim checks report-only and publication manual.
- Existing projects and databases must keep working.

## Review focus

- Legacy database without `writing_mode` migrates without losing projects.
- Legacy files infer a safe effective mode while an untouched approved project
  requires selection.
- Direct `draft` invocation cannot bypass explicit AI-first opt-in.
- Section proposal acceptance fails after any intervening human edit.
- Blank/new human workspaces remain reviewable without requiring `draft.md`.

### Task 1: Persist and resolve writing mode

**Files:**
- Modify: `src/storage/database.ts`
- Modify: `src/commands/projects.ts`
- Test: `test/storage.test.ts`
- Test: `test/projects.test.ts`

- [ ] Add failing tests for additive migration, setting mode, legacy inference,
  and the approved `Choose writing mode` next action.
- [ ] Add the nullable column, `WritingMode` type, setter, mapping, and effective
  mode resolver.
- [ ] Run the focused storage/project tests and confirm green.

### Task 2: Add explicit human and AI-first entry points

**Files:**
- Create: `src/commands/writing-mode.ts`
- Modify: `src/commands/draft.ts`
- Modify: `src/editorial/article-files.ts`
- Test: `test/writing-mode.test.ts`
- Test: `test/draft.test.ts`

- [ ] Add failing tests that human selection creates `working.md` without a
  model, refuses overwrites, and direct draft generation requires explicit
  `ai_first_draft` selection.
- [ ] Implement mode selection and human-owned working-file rendering.
- [ ] Enforce AI-first mode in the existing immutable draft command.
- [ ] Run focused tests and confirm green.

### Task 3: Gate section assistance per section

**Files:**
- Create: `src/commands/section-assist.ts`
- Modify: `src/editorial/drafter.ts`
- Modify: `src/editorial/article-files.ts`
- Test: `test/section-assist.test.ts`

- [ ] Add failing tests for talking-point/start/full-section actions, no model
  call before an explicit action, proposal-only generation, acceptance, and
  stale-source rejection.
- [ ] Implement one-section generation and SHA-bound proposal acceptance that
  appends without replacing existing `working.md` content.
- [ ] Run the focused tests and confirm green.

### Task 4: Route CLI and TUI through mode selection

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/tui/app.ts`
- Test: `test/projects.test.ts`
- Test: add focused exported-copy/action tests if needed.

- [ ] Add failing assertions for labels, ordering, confirmations, status mode,
  and next-action transitions.
- [ ] Add `mode` and section-assist CLI commands, an editing-first TUI choice,
  AI-first confirmation, section menus, project mode details, and editor launch.
- [ ] Preserve provider setup and existing command aliases.

### Task 5: Align public documentation and verify

**Files:**
- Modify: `README.md`
- Modify: onboarding/help copy in `src/tui/onboarding.ts` and `src/tui/app.ts`

- [ ] Update product language and diagrams to lead with human drafting and
  optional model assistance without inventing case-study content.
- [ ] Run full tests, typecheck, production build, and inspect the final diff.
- [ ] Commit, push `feat/editing-first-workflow`, open a follow-up PR referencing
  merged PR #2, and leave it unmerged.
