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

## Skill Requirements

### Naming Convention
- Directory name: lowercase, alphanumeric, hyphens only
- No consecutive hyphens, no leading/trailing hyphens
- Examples: `dbt-project-setup`, `slowly-changing-dimensions`, `funnel-analysis`

### SKILL.md Structure
---
name: skill-name        # 1-64 chars, must match directory name
description: "..."      # 1-1024 chars, include trigger phrases and use cases
---

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

## Update Checking
- Agents should fetch VERSIONS.md once per session on first skill use
- Notify users only if 2+ skills have updates or a major version bump occurs
- Notifications should be non-blocking

## Git Workflow
- Conventional Commits: `feat: add skill-name`, `fix: skill-name`, `docs: update skill-name`
- Branch naming: `feature/skill-name`, `fix/issue-description`
