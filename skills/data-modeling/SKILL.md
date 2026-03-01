---
name: data-modeling
description: "Design dimensional models, ERDs, and dbt-ready analytics schemas with strict grain, DAG checks, and warehouse-specific SQL. Use when users ask to model marts, define fact/dimension tables, or choose star vs snowflake patterns. Triggers: 'design schema', 'model this data', 'define grain', 'build fact table'."
---

# 🧠 Context & Prerequisites
You are designing analytics models that sit inside a dependency graph, not standalone SQL scripts. You must lock grain first, then map upstream dependencies, then pick warehouse-specific syntax. Default to maintainable star schemas unless explicit constraints require alternatives. Always produce lineage-compatible dbt artifacts (SQL + YAML + tests).

# 🔍 Step 1: Context Gathering (MANDATORY)
Before writing any model SQL, run these commands in the repo and summarize findings.

```bash
[ -f .claude/data-stack-context.md ] && sed -n '1,220p' .claude/data-stack-context.md
sed -n '1,260p' dbt_project.yml
rg -n "source\(|ref\(" models/ macros/ seeds/
rg -n "(fct_|dim_|mart_)" models/
```

Then define explicitly:
1. **Warehouse + dialect** from `.claude/data-stack-context.md`. If missing, instruct the user to run `/data-stack-context` before SQL generation.
2. **Business process + grain** (one row per what).
3. **Upstream dependencies** (raw sources/staging models).
4. **Downstream consumers** (marts, tests, dashboards, exposures).
5. **Cost risks** (full scans, wide joins, unbounded windows, large sorts).

You are forbidden from generating SQL until these five items are documented.

# 🛠️ Step 2: Execution Rules & Syntax
Use this execution order every time:

1. **Design contract first**
   - Declare model grain in one sentence.
   - List primary key/surrogate key strategy.
   - Identify additive vs semi-additive metrics.
2. **Build model SQL**
   - Use explicit CTE stages (`source`, `cleaned`, `enriched`, `final`).
   - Use `{{ ref() }}` and `{{ source() }}` only; never hardcode production schemas.
   - Add cost controls (date filters for incremental windows, selective columns, avoid `select *` in final model).
3. **Create lineage-compatible YAML**
   - Add model description and column descriptions.
   - Add `not_null` and `unique` tests for model key columns.
   - Add relationship tests for key foreign keys.
4. **Document tradeoffs**
   - Explain why chosen schema pattern is preferred and what was rejected.

- **Warehouse Specifics:**
  - **Snowflake:** Prefer `QUALIFY` for window filtering, `CLUSTER BY` on high-selectivity filter columns, and semi-structured helpers (`FLATTEN`) when needed.
  - **BigQuery:** Use `PARTITION BY DATE(<timestamp>)` for large facts, `CLUSTER BY` join/filter columns, and native `STRUCT/ARRAY` handling.
  - **Databricks:** Use Delta configs, partition thoughtfully, and add `OPTIMIZE ... ZORDER BY (...)` where justified.
  - **Redshift:** Set `DISTKEY/SORTKEY` based on dominant join/filter paths; avoid data redistribution-heavy joins.
  - **DuckDB:** Favor local-file-aware patterns and avoid warehouse-specific DDL not supported by DuckDB.

# ✅ Step 3: Validation Phase (MANDATORY CLI COMMANDS)
You must not mark the task complete until all relevant commands pass. If any fail, fix code and rerun.

```bash
# Replace selectors/paths with the target model
dbt compile --select <model_name_or_path>
dbt test --select <model_name_or_path>

# Run when SQL files were edited and sqlfluff is configured
sqlfluff lint models/path/to/<model_file>.sql
```

For broad changes, run:

```bash
dbt build --select <model_name_or_path>+
```

Completion criteria:
- Compilation passes with no SQL/Jinja errors.
- Tests pass for key constraints and relationships.
- Lint passes (or explicit, justified suppressions are documented).

# 🚨 Common Pitfalls (Self-Correction Guardrails)
- Do not write model SQL before identifying upstream `ref()`/`source()` dependencies.
- Do not mix warehouse dialects (for example, Snowflake syntax inside BigQuery models).
- Do not leave grain ambiguous; if grain is unclear, pause and resolve before coding.
- Do not ship model changes without YAML docs and key tests.
- Do not run only `dbt run`; compile and test are mandatory minimum gates.
