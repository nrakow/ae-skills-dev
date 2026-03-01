---
name: staging-layer
description: "Build dbt staging models from raw sources with strict DAG discovery, naming conventions, and warehouse-aware cleaning logic. Use when users ask for stg_ models, source standardization, or first-layer transformations. Triggers: 'build staging model', 'clean raw table', 'create stg model'."
---

# 🧠 Context & Prerequisites
Staging models are the contract between raw ingestion and downstream marts. Your goal is to standardize shape, naming, and types while preserving source fidelity and lineage. Keep staging transformations lightweight, deterministic, and reusable. Avoid embedding business logic that belongs in marts.

# 🔍 Step 1: Context Gathering (MANDATORY)
Before writing SQL, inspect stack context and DAG usage.

```bash
[ -f .claude/data-stack-context.md ] && sed -n '1,220p' .claude/data-stack-context.md
sed -n '1,260p' dbt_project.yml
rg -n "source\(" models/
rg -n "ref\('stg_" models/ tests/ exposures/
rg -n "staging|stg_" models/
```

Then capture:
1. Warehouse dialect and typing nuances.
2. Raw source table(s) and freshness/testing requirements.
3. Existing downstream dependencies on `stg_` outputs.
4. Required naming conventions for columns and models.
5. Cost-sensitive constraints (partition pruning, selective projection, incremental landing if needed).

If `.claude/data-stack-context.md` is absent, instruct the user to run `/data-stack-context` first.

# 🛠️ Step 2: Execution Rules & Syntax
Implement staging models with these rules:

1. **Model pattern**
   - Model name: `stg_<source>__<entity>`.
   - CTE flow: `source_data` -> `renamed` -> `typed` -> `final`.
2. **Transformation scope**
   - Allowed: renaming, casting, null normalization, dedupe keys, light JSON flattening, timestamp normalization.
   - Not allowed: business KPI logic, attribution, cross-domain joins unless required for source integrity.
3. **Naming + docs**
   - Normalize columns to `snake_case`.
   - Keep semantic names stable and explicit.
   - Add dbt YAML model + column descriptions and source freshness/tests.
4. **Cost controls**
   - Select only needed columns.
   - Avoid repeated expensive parsing expressions by staging once.
   - For very large raw tables, ensure partition/date filters are compatible with ingestion strategy.

- **Warehouse Specifics:**
  - **Snowflake:** Use `TRY_TO_*` casts and `QUALIFY` for deterministic dedupe.
  - **BigQuery:** Use `SAFE_CAST`, leverage partition filters, and handle nested fields with `UNNEST` carefully.
  - **Databricks:** Use Delta-friendly typing and avoid unnecessary shuffles in staging joins.
  - **Redshift:** Be explicit with casts, and avoid patterns that trigger broad redistribution.
  - **DuckDB:** Use DuckDB-native type casts and file-query compatibility where raw data is file-based.

# ✅ Step 3: Validation Phase (MANDATORY CLI COMMANDS)
Run all checks and fix/retry until green.

```bash
# Replace selectors/paths
dbt compile --select <stg_model>
dbt test --select <stg_model>

# Source-level checks when source YAML changed
dbt source freshness --select <source_name>

# SQL style check when available
sqlfluff lint models/path/to/<stg_model>.sql
```

Recommended expanded check for dependency safety:

```bash
dbt build --select <stg_model>+
```

Completion criteria:
- Model compiles.
- Model tests pass.
- Source freshness check passes or expected SLA exceptions are documented.
- Lint passes.

# 🚨 Common Pitfalls (Self-Correction Guardrails)
- Do not skip downstream dependency discovery before renaming columns.
- Do not embed mart-level business rules in staging models.
- Do not cast blindly; use warehouse-safe cast patterns and handle invalid values explicitly.
- Do not use `select *` in final staging output.
- Do not complete the task without compile + test + (when relevant) freshness checks.
