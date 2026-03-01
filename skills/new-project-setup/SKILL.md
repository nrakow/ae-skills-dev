---
name: new-project-setup
description: "End-to-end setup for a new analytics engineering project from blank slate to production-ready dbt project. Sequences: data-stack-context, dbt-project-setup, sql-style-guide, data-modeling, data-quality-testing, dbt-ci-cd. Triggers: 'new analytics project', 'start analytics engineering', 'set up from scratch', 'brand new dbt project', 'analytics engineering setup', 'bootstrap analytics'."
triggers:
  - "new analytics project"
  - "start analytics engineering"
  - "set up from scratch"
  - "brand new dbt project"
  - "bootstrap analytics"
reads_first: []
cli_tools: []
produces:
  - "complete dbt project structure"
  - ".claude/data-stack-context.md"
  - "CI/CD pipeline"
  - "SQL style guide"
  - "initial testing strategy"
validates_with:
  - "dbt debug"
  - "dbt parse"
  - "dbt build"
---

## When to Use This Workflow

Use `new-project-setup` when starting an analytics engineering project from zero: no dbt project exists yet, you're onboarding a new team, or you're rebuilding a project from scratch. If a dbt project already exists, use individual skills instead of this workflow.

## Overview

This workflow sequences six skills in order. Each phase builds on the previous one. Complete each phase before moving to the next.

---

## Phase 1: Capture Stack Context

**Skill**: `data-stack-context`

Before writing any code, capture the team's full analytics stack. This file drives all subsequent skill decisions.

**What to do:**
1. Check if `.claude/data-stack-context.md` already exists. If it does, skip to Phase 2.
2. Invoke the `data-stack-context` skill.
3. Use Path A (auto-draft) if `dbt_project.yml` or `profiles.yml` already exist. Use Path B (conversational) if starting from zero.
4. Confirm the context file is written to `.claude/data-stack-context.md`.

**Phase complete when**: `.claude/data-stack-context.md` exists and covers warehouse, dbt version, orchestrator, and BI layer.

---

## Phase 2: Scaffold the dbt Project

**Skill**: `dbt-project-setup`

Set up the project structure, profiles, packages, and schema naming conventions.

**What to do:**
1. Invoke the `dbt-project-setup` skill.
2. Generate `dbt_project.yml`, `profiles.yml`, `packages.yml`, and the `generate_schema_name` macro.
3. Run `dbt deps && dbt debug` to confirm connectivity.

**Phase complete when**: `dbt debug` passes and `dbt parse` returns no errors.

---

## Phase 3: Establish SQL Style Guide

**Skill**: `sql-style-guide`

Lock in formatting and naming standards before writing any models — it's much harder to enforce retroactively.

**What to do:**
1. Invoke the `sql-style-guide` skill.
2. Generate a `.sqlfluff` config tailored to the team's warehouse dialect.
3. Document key conventions (CTE naming, column aliasing, join style).

**Phase complete when**: `.sqlfluff` config exists and `sqlfluff lint` runs without configuration errors.

---

## Phase 4: Design the Data Model Architecture

**Skill**: `data-modeling`

Plan the layer structure and identify initial domains before writing the first model.

**What to do:**
1. Invoke the `data-modeling` skill.
2. Identify 2-3 initial data domains (e.g., customers, orders, events).
3. Sketch the staging → intermediate → mart flow for each domain.
4. Run `node tools/clis/schema-introspect.js` if source schemas are already accessible.

**Phase complete when**: An entity-relationship sketch and initial model list exist for the first domain.

---

## Phase 5: Set Up Testing Strategy

**Skill**: `data-quality-testing`

Establish the testing standard before writing models — define what "good" means.

**What to do:**
1. Invoke the `data-quality-testing` skill.
2. Define the minimum test set per model tier (staging, intermediate, marts).
3. Add Elementary or Soda if the stack includes an observability tool.

**Phase complete when**: Testing standards are documented and at least one example `schema.yml` with tests is written.

---

## Phase 6: Configure CI/CD

**Skill**: `dbt-ci-cd`

Automate testing and deployment so the project is production-ready from day one.

**What to do:**
1. Invoke the `dbt-ci-cd` skill.
2. Set up a CI workflow that runs `dbt build --select state:modified+` on PRs.
3. Configure production job scheduling in dbt Cloud or the orchestrator.

**Phase complete when**: A CI pipeline exists and a test PR triggers a dbt build automatically.

---

## Final Verification

```bash
dbt debug        # Confirm warehouse connectivity
dbt parse        # Confirm no compilation errors
dbt deps         # Confirm packages installed
sqlfluff lint models/   # Confirm style rules enforced
```

## Verify Your Work

- Run `dbt debug` to confirm warehouse connectivity and that `profiles.yml` is correctly configured for your target environment.
- Run `dbt parse` to confirm no compilation errors exist across all model paths defined in `dbt_project.yml`.
- Run `dbt deps` to confirm all packages in `packages.yml` resolved and installed without version conflicts.
- Run `sqlfluff lint models/` to confirm the `.sqlfluff` config is valid and style rules are enforced without configuration errors.
- Open a test PR and confirm the CI pipeline triggers automatically and runs `dbt build --select state:modified+`.

## If Something Goes Wrong

- **`dbt debug` fails**: check `profiles.yml` path and warehouse credentials. Ensure env vars are set for the correct target.
- **`dbt parse` fails**: usually a missing `ref()` or misconfigured model path in `dbt_project.yml`. Check `model-paths` setting.
- **`dbt deps` fails**: check `packages.yml` for version conflicts. Run `dbt deps --upgrade` to resolve.
- **CI never triggers**: confirm the workflow file is in `.github/workflows/` and the branch protection rule runs the check.
