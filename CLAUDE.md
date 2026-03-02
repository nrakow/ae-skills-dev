# Guidelines for AI Agents

<!-- This file mirrors AGENTS.md for Claude Code compatibility. Update both files when making changes. -->

## Repository Overview
This repository contains Agent Skills for analytics engineering workflows. Skills cover the full analytics engineering lifecycle: data modeling, transformation, testing, orchestration, governance, and BI.

## Directory Structure
- `skills/` - Agent capabilities with SKILL.md files
- `tools/integrations/` - Per-tool API guides and platform docs
- `tools/clis/` - Zero-dependency Node.js scripts for analytics tools

## Foundational Skill: data-stack-context
All skills MUST check for `.claude/data-stack-context.md` before asking diagnostic questions. This file captures:
- Warehouse (Snowflake / BigQuery / Databricks / Redshift / DuckDB)
- Transformation tool (dbt Core / dbt Cloud, version)
- Orchestrator (Airflow / Dagster / Prefect / none)
- BI layer (Looker / Metabase / Lightdash / Tableau / none)
- Observability tool (Elementary / Monte Carlo / Soda / none)
- Data catalog (OpenMetadata / Atlan / dbt docs)
- Environments (dev / staging / prod)
- Team size and maturity
- Compliance requirements (GDPR / CCPA / HIPAA / none)

If this file exists, read it before asking the user questions. If it doesn't exist, suggest running the `data-stack-context` skill first.
**Staleness check**: if the context file exists, compare the documented warehouse/dbt version against what you find in `dbt_project.yml` and `packages.yml`. If they diverge (e.g., context says dbt 1.7 but packages.yml shows dbt-core 1.9), flag this and offer to update the context file before proceeding.

## Skill Requirements

### Naming Convention
- Directory name: lowercase, alphanumeric, hyphens only
- No consecutive hyphens, no leading/trailing hyphens
- Examples: `dbt-project-setup`, `slowly-changing-dimensions`, `funnel-analysis`

### SKILL.md Structure

Every skill uses YAML frontmatter with the following fields:

```yaml
---
name: skill-name        # 1-64 chars, must match directory name
description: "..."      # 1-1024 chars, include trigger phrases and use cases
triggers:               # phrases an agent should recognize to invoke this skill
  - "trigger phrase one"
  - "trigger phrase two"
reads_first:            # other skills or context files to load before this skill
  - data-stack-context
  - other-skill-name
consumes:               # artifacts expected from reads_first skills (for precondition checks)
  - "other-skill-name: artifact description"
cli_tools:              # CLI tools from tools/clis/ this skill uses
  - tool-name.js
produces:               # artifacts this skill outputs
  - "dbt model SQL"
  - "schema.yml"
min_dbt_version: "x.y.z"  # minimum dbt version required; omit if no hard constraint
validates_with:         # commands to run after the skill completes
  - "dbt compile"
  - "dbt test --select <model>"
---
```

`name` and `description` are required. All other fields are optional but strongly recommended for agent routing and context loading.

**`consumes`**: List artifacts this skill expects upstream skills to have already produced. Use "skill-name: artifact-description" format. Agents should verify these artifacts exist before invoking the skill.

**`min_dbt_version`**: Set this for skills that use features gated to a specific dbt release (e.g., unit tests require 1.8+, enforced contracts require 1.5+). If the user's version is lower, surface a clear error before attempting to generate incompatible code.

### Content Section Ordering

Every skill body must follow this section order:

1. **H1 title** — skill name
2. **Brief intro** — one sentence ("I'll help you...")
3. **## Before You Start** — file checks, prerequisite scanning, CLI pre-flight commands
4. **## Check Context First** — read `.claude/data-stack-context.md`; ask only for information not already present
5. **Main content sections** — H2/H3 headers; conceptual frameworks, step-by-step guides, code examples
6. **## Verify Your Work** — validation commands with hard-gate language
7. **## If Something Goes Wrong** — troubleshooting section

Do not place "Check Context First" before "Before You Start". The pre-flight checks in "Before You Start" inform what questions to skip in "Check Context First".

### Human Required Callout

When a skill step cannot be completed by an agent (warehouse credentials, production role grants, approvals, sending notifications), use this callout:

```
> **Human required:** [Describe the action and why Claude cannot perform it.]
```

Place the callout inline within the step that requires human action. Do not skip the step — continue generating the surrounding configuration so the human knows exactly what to configure.

### Hard-Gate Validation

The "## Verify Your Work" section of every skill MUST begin with:

```
**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.
```

This ensures agents do not surface partial or broken output before confirming the skill's artifacts are valid.

### Content Guidelines
- Max 500 lines (move detailed SQL patterns to `references/` subdirectory)
- Use H2 (##) and H3 (###) headers only
- Keep paragraphs to 2-4 sentences
- Use bold (**text**) for key terms
- Direct, second-person tone ("I'll help you...")
- Include concrete examples, SQL snippets, and YAML configs
- Be opinionated — provide frameworks, not just options

### Dialect Awareness
Skills that generate SQL MUST handle warehouse dialect differences:
- **Snowflake**: QUALIFY, FLATTEN, ARRAY_AGG, semi-structured data, warehouse sizing
- **BigQuery**: PARTITION BY DATE(), STRUCT/ARRAY, slot reservations, nested records
- **Databricks**: Delta Lake, Unity Catalog, OPTIMIZE/ZORDER, photon engine
- **Redshift**: DISTKEY/SORTKEY, COPY command, spectrum, WLM queues
- **DuckDB**: local file support, ATTACH, Parquet/CSV direct query

### Cost Awareness
Analytics skills must treat compute cost as a first-class concern:
- Flag expensive operations (full table scans, cross joins, large sorts)
- Recommend clustering/partitioning for large tables
- Distinguish storage vs. compute tradeoffs
- Suggest incremental strategies over full refreshes where appropriate

### Lineage Compatibility
Skills that design or refactor models should output lineage-compatible artifacts:
- dbt YAML with descriptions and column-level docs
- Source definitions with freshness checks
- OpenLineage-compatible event annotations where relevant

## Skill Routing

When a user request matches a skill's `triggers`, load that skill. Load skills listed in `reads_first` before executing the target skill. Never ask the user diagnostic questions that are already answered in `.claude/data-stack-context.md`.

For fast skill selection, consult `skills/index.json` — a machine-readable index of all skills with their `name`, `description`, `triggers`, `reads_first`, `consumes`, `produces`, and `min_dbt_version` fields. When multiple skills have overlapping triggers, use `reads_first` and `consumes` relationships to determine the most specific match.

When a skill declares `min_dbt_version`, check the user's dbt version (from `data-stack-context.md` or `packages.yml`) before executing. If the version is too low, explain which features are unavailable and offer an alternative approach before generating any code.

### Workflow Skills

For multi-step workflows, use these composite skills that sequence individual skills:

| User Intent | Workflow Skill |
|---|---|
| Start a brand new analytics project | `new-project-setup` |
| Onboard a new data source | `new-source-onboarding` |
| Build a new mart or reporting model | `new-mart-build` |
| Investigate a data incident or alert | `data-incident-response` |
| Safely retire a model, column, or source | `model-deprecation` |

### Skill Completion

After every skill execution:
1. Run **every** command listed in `validates_with` to confirm the output compiles and tests pass. **Do not present the skill's output as complete until all commands pass without error.**
2. If a `validates_with` command fails, consult the skill's "If Something Goes Wrong" section before asking the user.
3. Reference `cli_tools` to surface available utilities the user can run for further analysis.

## Update Checking
- Agents should fetch VERSIONS.md once per session on first skill use
- Notify users only if 2+ skills have updates or a major version bump occurs
- Notifications should be non-blocking

## Git Workflow
- Conventional Commits: `feat: add skill-name`, `fix: skill-name`, `docs: update skill-name`
- Branch naming: `feature/skill-name`, `fix/issue-description`
