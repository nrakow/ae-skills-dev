---
name: incremental-models
description: "Implement and refactor dbt incremental models with deterministic keys, bounded processing windows, and warehouse-specific strategies. Use when users ask for incrementalization, merge strategy selection, or safe backfills. Triggers: 'make this incremental', 'dbt incremental model', 'incremental strategy'."
---

# 🧠 Context & Prerequisites
Incremental models are correctness-sensitive and cost-sensitive. You must preserve deterministic outputs while reducing compute by processing only new or changed data. Every incremental design must define unique keys, late-arriving-data policy, and backfill behavior. Never choose strategy by preference alone; tie it to warehouse and data shape.

# 🔍 Step 1: Context Gathering (MANDATORY)
Before coding, gather stack and lineage context from the repo.

```bash
[ -f .claude/data-stack-context.md ] && sed -n '1,220p' .claude/data-stack-context.md
sed -n '1,260p' dbt_project.yml
rg -n "materialized\s*[:=]\s*'?(incremental|table|view)" models/ dbt_project.yml
rg -n "unique_key|incremental_strategy|is_incremental\(" models/
rg -n "ref\('<target_model>'\)|source\(" models/ tests/ exposures/
```

Then document:
1. Warehouse and supported incremental strategies.
2. Target model grain and deterministic `unique_key`.
3. Watermark/event-time column and late-arriving policy.
4. Upstream and downstream dependencies impacted by incremental behavior.
5. Backfill and recovery strategy (full refresh, partition replay, or microbatch window).

If context file is missing, direct the user to run `/data-stack-context` first.

# 🛠️ Step 2: Execution Rules & Syntax
Use this strict build sequence:

1. **Define incremental contract**
   - State grain, `unique_key`, watermark column, and update semantics.
   - Explicitly define late-arrival window (e.g., 3 days lookback).
2. **Implement deterministic SQL**
   - Structure CTEs and isolate incremental filter logic.
   - Use `is_incremental()` blocks for bounded scans only.
   - Ensure filters are idempotent and do not drop valid updates.
3. **Apply dbt config deliberately**
   - Set `materialized='incremental'`.
   - Set `unique_key` (single or composite deterministic key).
   - Set strategy compatible with warehouse and volume profile.
4. **Add testing + docs artifacts**
   - Add YAML docs and tests for key columns.
   - Add tests for duplicate keys and null key violations.
   - Add targeted tests for late-arriving update behavior if feasible.

- **Warehouse Specifics:**
  - **Snowflake:** Prefer `merge` when updates are common; tune clustering for pruning and watch warehouse size for backfills.
  - **BigQuery:** Use partition-aware incremental filters and `insert_overwrite` for partition replacement when appropriate.
  - **Databricks:** Use Delta `merge` + partition strategy; optimize with `OPTIMIZE/ZORDER` for heavy read paths.
  - **Redshift:** Favor append-only patterns when possible; design sort/distribution to minimize merge overhead.
  - **DuckDB:** Favor append or partition-rebuild strategies compatible with local execution constraints.

# ✅ Step 3: Validation Phase (MANDATORY CLI COMMANDS)
Do not finish until these pass; on failure, fix and rerun.

```bash
# Replace selector/path
dbt compile --select <incremental_model>
dbt test --select <incremental_model>

# Style gate
sqlfluff lint models/path/to/<incremental_model>.sql
```

For incremental safety, run at least one expanded integration check:

```bash
# Build target and dependents
dbt build --select <incremental_model>+

# Optional: validate full refresh compatibility
dbt run --full-refresh --select <incremental_model>
```

Completion criteria:
- Incremental model compiles.
- Tests pass for key and model invariants.
- Lint passes.
- Incremental run path and recovery path are both validated.

# 🚨 Common Pitfalls (Self-Correction Guardrails)
- Do not use non-deterministic or unstable `unique_key` definitions.
- Do not leave `is_incremental()` filters unbounded; this defeats cost control.
- Do not ignore late-arriving records; include explicit lookback or merge logic.
- Do not assume one strategy fits all warehouses.
- Do not ship without validating both normal incremental execution and recovery/full-refresh behavior.
