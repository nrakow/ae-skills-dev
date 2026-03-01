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

```markdown
---
name: your-skill-name
description: "Action-oriented description. Include trigger phrases and concrete use-cases."
---

# 🧠 Context & Prerequisites
[Brief concept context in <=5 lines]

# 🔍 Step 1: Context Gathering (MANDATORY)
[Required commands to inspect `.claude/data-stack-context.md`, `dbt_project.yml`, and DAG dependencies before writing SQL]

# 🛠️ Step 2: Execution Rules & Syntax
[Strict implementation rules and output format]
- **Warehouse Specifics:** [Snowflake / BigQuery / Databricks / Redshift / DuckDB differences]

# ✅ Step 3: Validation Phase (MANDATORY CLI COMMANDS)
[Exact commands. Agent must fix failures and rerun until passing before final response]

# 🚨 Common Pitfalls (Self-Correction Guardrails)
- [2-5 explicit failure modes to prevent]
```

**Frontmatter requirements:**
- `name`: 1-64 characters, must exactly match the directory name
- `description`: 1-1024 characters; include trigger phrases and use cases

### 4. Mandatory Execution Contract for All Skills

All skills that create or modify models **must** enforce this behavior:

1. **DAG-aware first pass (mandatory):**
   - Read `.claude/data-stack-context.md` if present.
   - Inspect `dbt_project.yml` model routing before edits.
   - Discover upstream and downstream dependencies using terminal commands before writing SQL.
2. **Dialect lock (mandatory):**
   - Select SQL syntax based on the target warehouse.
   - Do not output generic SQL when warehouse-specific optimized syntax exists.
3. **Autonomous validation loop (mandatory):**
   - Run required commands.
   - If any command fails, fix the issue, rerun, and repeat until pass.
   - Do not present final output as complete while checks are failing.

### 5. Reusable DAG Discovery Checklist (Copy Into Modeling Skills)

```bash
# Required context and DAG discovery
[ -f .claude/data-stack-context.md ] && sed -n '1,200p' .claude/data-stack-context.md
sed -n '1,240p' dbt_project.yml
rg -n "source\(|ref\(" models/ macros/ seeds/

# Optional if target model path/name is known
rg -n "ref\('<target_model>'\)" models/ tests/ exposures/
rg -n "source\('<source_name>'" models/
```

### 6. Validation Command Matrix (Copy and Scope Per Skill)

```bash
# Minimum required for SQL/model edits
dbt compile --select <target_selector>
dbt test --select <target_selector>

# Required when SQL files are modified (if sqlfluff configured)
sqlfluff lint models/path/to/<target>.sql

# Optional integration gate for larger changes
dbt build --select <target_selector>
```

Use scoped selectors (model name, path, tag) to control cost and runtime. For warehouse-heavy models, prefer narrow selectors first, then broader builds.

### 7. Follow Content Guidelines

- Maximum 500 lines per SKILL.md; move lengthy SQL patterns to a `references/` subdirectory within the skill directory
- Use H2 (`##`) and H3 (`###`) headers only where possible; reserve stronger headings only when required by the standard template
- Keep paragraphs to 2-4 sentences
- Use bold (`**text**`) for key terms on first use
- Write in direct, second-person tone: "I'll help you..." or "You should..."
- Be opinionated: provide recommended patterns, not just a list of options

### 8. Quality Checklist

Before submitting, verify your skill:

- [ ] Uses the standardized 5-section architecture
- [ ] References `.claude/data-stack-context.md` and reads it if present
- [ ] Suggests running `data-stack-context` first if context file is absent
- [ ] Includes explicit DAG discovery commands before SQL authoring
- [ ] Is dialect-aware: handles Snowflake, BigQuery, Databricks, Redshift, and DuckDB differences where SQL is generated
- [ ] Treats compute cost as a first-class concern: flags expensive operations, recommends clustering/partitioning, suggests incremental over full refresh
- [ ] Includes mandatory CLI validation commands and rerun-on-fail behavior
- [ ] Outputs lineage-compatible artifacts where applicable (dbt YAML with descriptions, source freshness checks)
- [ ] Frontmatter `name` matches the directory name exactly
- [ ] Description is under 1024 characters and includes trigger phrases
- [ ] SKILL.md is under 500 lines

### 9. Register the Skill in VERSIONS.md

Add or update the row in the Skills table in `VERSIONS.md`:

```markdown
| your-skill-name | 1.1.0 | YYYY-MM-DD | Migrated to standardized template with mandatory DAG + validation workflow |
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
- [ ] Standardized 5-section SKILL architecture used (if skill change)
- [ ] VERSIONS.md updated with new version and date
- [ ] Skill references data-stack-context
- [ ] DAG discovery instructions included for model changes
- [ ] Dialect-aware SQL (if applicable)
- [ ] Cost considerations addressed (if applicable)
- [ ] Mandatory validation loop commands included
- [ ] Lineage-compatible artifacts (if applicable)
- [ ] SKILL.md is under 500 lines
```

---

## Questions

Open an issue or start a discussion if you're unsure how to classify a skill, which category it belongs in, or whether a tool integration is in scope.
