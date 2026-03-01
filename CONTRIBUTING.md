# Contributing

Thank you for contributing to the Analytics Engineering Skills collection. This guide covers how to add new skills, update existing ones, add tool integrations, and add CLI utilities.

---

## Adding a New Skill

### 1. Name the Skill

Skill directory names must follow the naming convention:

- Lowercase alphanumeric characters and hyphens only
- No consecutive hyphens
- No leading or trailing hyphens
- Must be unique within the `skills/` directory

Good examples: `dbt-project-setup`, `slowly-changing-dimensions`, `funnel-analysis`

Bad examples: `DBT_Setup`, `--funnel`, `my--skill`

### 2. Create the Directory

```bash
mkdir skills/your-skill-name
```

### 3. Create SKILL.md

Every skill requires a `SKILL.md` file with valid YAML frontmatter:

```yaml
---
name: your-skill-name
description: "A concise description of what this skill does. Include trigger phrases users might say, such as 'help me build a staging layer' or 'set up incremental models'. Max 1024 characters."
triggers:
  - "trigger phrase one"
  - "trigger phrase two"
reads_first:
  - data-stack-context
cli_tools:
  - relevant-tool.js
produces:
  - "dbt model SQL"
  - "schema.yml"
validates_with:
  - "dbt compile"
  - "dbt test --select <model>"
---

## Overview

Brief introduction to what this skill helps with.

## Before You Start

List project files to read before beginning (dbt_project.yml, upstream schema.yml, packages.yml, etc.).

## Core Content

How to invoke this skill and what to expect.

## Verify Your Work

Commands to run after implementing to confirm correctness.

## If Something Goes Wrong

3-5 bullet points covering common failure modes and remediation steps.
```

**Frontmatter requirements:**
- `name`: 1-64 characters, must exactly match the directory name (required)
- `description`: 1-1024 characters; include trigger phrases and use cases (required)
- `triggers`: list of phrases an agent should recognize to invoke this skill (recommended)
- `reads_first`: other skills or context files to load before this one (recommended)
- `cli_tools`: CLI tools from `tools/clis/` relevant to this skill (recommended)
- `produces`: list of artifact types this skill outputs (recommended)
- `validates_with`: shell commands to run after skill execution to confirm correctness (recommended)

### 4. Follow Content Guidelines

- Maximum 500 lines per SKILL.md; move lengthy SQL patterns to a `references/` subdirectory within the skill directory
- Use H2 (`##`) and H3 (`###`) headers only — never H1
- Keep paragraphs to 2-4 sentences
- Use bold (`**text**`) for key terms on first use
- Write in direct, second-person tone: "I'll help you..." or "You should..."
- Be opinionated: provide recommended patterns, not just a list of options

### 5. Quality Checklist

Before submitting, verify your skill:

- [ ] References `.claude/data-stack-context.md` and reads it if present
- [ ] Suggests running `data-stack-context` first if context file is absent
- [ ] Is dialect-aware: handles Snowflake, BigQuery, Databricks, Redshift, and DuckDB differences where SQL is generated
- [ ] Treats compute cost as a first-class concern: flags expensive operations, recommends clustering/partitioning, suggests incremental over full refresh
- [ ] Outputs lineage-compatible artifacts where applicable (dbt YAML with descriptions, source freshness checks)
- [ ] Frontmatter `name` matches the directory name exactly
- [ ] Description is under 1024 characters and includes trigger phrases
- [ ] SKILL.md is under 500 lines
- [ ] `triggers` list includes 2+ natural-language phrases that would invoke this skill
- [ ] `reads_first` lists any skills or context files that must be loaded before this skill runs
- [ ] `cli_tools` references any tools from `tools/clis/` that this skill uses
- [ ] `produces` lists the concrete artifacts this skill outputs
- [ ] `validates_with` lists the commands to run after the skill completes to confirm correctness
- [ ] Skill includes a "Before You Start" section listing project files to read
- [ ] Skill includes a "Verify Your Work" section with validation commands
- [ ] Skill includes an "If Something Goes Wrong" section with 3-5 common failure modes

### 6. Register the Skill in VERSIONS.md

Add a row to the Skills table in `VERSIONS.md`:

```markdown
| your-skill-name | 1.0.0 | YYYY-MM-DD | Initial release |
```

---

## Updating an Existing Skill

1. Make your changes to the relevant `SKILL.md` (and any `references/` files).
2. Bump the version in `VERSIONS.md` following semantic versioning:
   - **Patch** (`1.0.x`): typo fixes, clarifications, minor SQL corrections
   - **Minor** (`1.x.0`): new sections, new dialect support, new examples
   - **Major** (`x.0.0`): breaking changes to the skill's approach or output format
3. Update the `Last Updated` date in `VERSIONS.md` to today's date (`YYYY-MM-DD`).
4. Update the `Notes` field with a brief summary of what changed.

---

## Adding a Tool Integration Guide

Tool integration guides live in `tools/integrations/<tool-name>/`.

### Format Requirements

Each integration guide must include:

```
tools/integrations/<tool-name>/
  README.md       # Overview, authentication, and getting started
  api.md          # API reference or key endpoints used by skills
  examples/       # Example requests and responses (optional)
```

**README.md requirements:**
- Tool name and version compatibility
- Authentication method (API key, OAuth, service account, etc.)
- Environment variable names for credentials
- At least one end-to-end usage example
- Link to official documentation

**api.md requirements:**
- Document only the endpoints or features used by skills in this repo
- Include request/response examples
- Note rate limits or quota constraints
- Note any dialect or platform-specific behavior

After adding the guide, register the tool in the Tool Integrations table in `VERSIONS.md`.

---

## Adding a CLI Tool

CLI tools live in `tools/clis/`. Each CLI must meet these requirements:

- **Zero external dependencies**: use only Node.js built-in modules
- **Single file**: one `.js` file per CLI tool
- **Argument parsing**: use `process.argv` directly or a hand-rolled parser — no `commander`, `yargs`, or similar
- **No build step**: must run directly with `node tool-name.js`
- **Self-documenting**: running with `--help` or `-h` prints usage

### File Template

```javascript
#!/usr/bin/env node
'use strict';

/**
 * tool-name.js — one-line description of what this tool does
 *
 * Usage: node tool-name.js [options]
 *
 * Options:
 *   --option  Description of option
 *   -h, --help  Show this help message
 */

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node tool-name.js [options]\n\nOptions:\n  --option  Description\n  -h, --help  Show this help`);
  process.exit(0);
}

// Implementation here
```

After adding the CLI, document it in the `tools/clis/README.md` (create it if it doesn't exist).

---

## Pull Request Guidelines

### Branch Naming

```
feature/skill-name          # New skill
fix/issue-description       # Bug fix or correction
docs/what-was-updated       # Documentation-only change
```

### Commit Messages

Use Conventional Commits format:

```
feat: add cohort-analysis skill
fix: incremental-models Redshift DISTKEY example
docs: update data-contracts SKILL.md with v2 contract format
```

### PR Description Template

```markdown
## What does this PR do?
<!-- One paragraph summary -->

## Type of change
- [ ] New skill
- [ ] Skill update
- [ ] New tool integration
- [ ] New CLI tool
- [ ] Documentation fix

## Checklist
- [ ] Skill name matches directory name and VERSIONS.md entry
- [ ] VERSIONS.md updated with new version and date
- [ ] Skill references data-stack-context
- [ ] Dialect-aware SQL (if applicable)
- [ ] Cost considerations addressed (if applicable)
- [ ] Lineage-compatible artifacts (if applicable)
- [ ] SKILL.md is under 500 lines
```

---

## Questions

Open an issue or start a discussion if you're unsure how to classify a skill, which category it belongs in, or whether a tool integration is in scope.
