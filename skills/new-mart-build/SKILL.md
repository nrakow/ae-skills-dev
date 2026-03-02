---
name: new-mart-build
description: "End-to-end workflow for building a new mart (fact or dimension table) from existing staging models through testing, metrics definition, and BI exposure. Sequences: data-modeling, marts-design, data-quality-testing, dbt-unit-testing, metrics-layer, dashboard-design. Triggers: 'build a new mart', 'create a fact table', 'new dimension table', 'new reporting model', 'build fct_', 'build dim_', 'new business domain model'."
triggers:
  - "build a new mart"
  - "create a fact table"
  - "new dimension table"
  - "new reporting model"
  - "build fct_"
  - "build dim_"
  - "new business domain"
reads_first:
  - data-stack-context
  - staging-layer
cli_tools:
  - manifest-parse.js
  - manifest-lineage.js
  - manifest-coverage.js
produces:
  - "fct_ or dim_ model SQL"
  - "intermediate model SQL (if needed)"
  - "schema.yml with tests"
  - "metrics.yml"
  - "dashboard specification"
validates_with:
  - "dbt compile"
  - "dbt test --select <model>,test_type:unit"
  - "dbt build --select <model>+"
  - "dbt test --select <model>"
---

## When to Use This Workflow

Use `new-mart-build` when adding a new fact or dimension table that will serve reporting or a BI dashboard. Staging models for the relevant sources should already exist. If they don't, run `new-source-onboarding` first.

## Before You Start

Read `.claude/data-stack-context.md` for warehouse and dbt version. Then run:
```bash
node tools/clis/manifest-parse.js --manifest target/manifest.json   # see available refs
node tools/clis/manifest-lineage.js --manifest target/manifest.json --model <upstream_stg_model>
```
This shows what staging models exist and what's upstream of your new mart.

---

## Phase 1: Design the Model

**Skill**: `data-modeling`

Plan the grain, dimensions, and measures before writing SQL.

**What to do:**
1. Invoke the `data-modeling` skill.
2. Define the grain of the fact table (one row = one what?).
3. List the dimension tables it will join.
4. Identify the key measures.
5. Decide if intermediate models are needed for complex business logic.

**Phase complete when**: Grain, dimensions, and measures are documented and agreed upon.

---

## Phase 2: Build the Mart

**Skill**: `marts-design`

Write the actual SQL for the mart model.

**What to do:**
1. Invoke the `marts-design` skill.
2. Write intermediate models first if needed (int_ prefix, ephemeral materialization).
3. Write the final fct_ or dim_ model with proper column naming and documentation stubs.
4. Run `dbt compile` to confirm no ref() errors.

**Phase complete when**: `dbt compile` passes and the model SQL is complete.

---

## Phase 3: Add Tests

**Skill**: `data-quality-testing`

Add comprehensive tests before promoting to production.

**What to do:**
1. Run `node tools/clis/manifest-coverage.js --manifest target/manifest.json` to baseline coverage.
2. Invoke the `data-quality-testing` skill.
3. Add uniqueness, not_null, relationships, accepted_values, and range tests.
4. Add row count anomaly tests if Elementary is in the stack.
5. Run `dbt test --select <model>`.

**Phase complete when**: `dbt test --select <model>` passes with zero failures.

---

## Phase 4: Write Unit Tests

**Skill**: `dbt-unit-testing`

Validate the SQL transformation logic in the mart with mocked inputs before running against live data. Unit tests run without a warehouse connection and catch logic bugs before CI.

**What to do:**
1. Invoke the `dbt-unit-testing` skill (requires dbt 1.8+; skip this phase if on an older version).
2. Write at least one unit test covering the mart's primary transformation logic (the `CASE` statement, aggregation, or join that defines the mart's value).
3. Write a unit test for each edge case: null inputs, zero denominators, boundary dates.
4. Run `dbt test --select <model>,test_type:unit` to confirm all unit tests pass locally.

**Phase complete when**: All unit tests pass with `dbt test --select <model>,test_type:unit` and cover the primary business logic.

---

## Phase 5: Define Metrics

**Skill**: `metrics-layer`

Register the key measures from this mart in the semantic layer.

**What to do:**
1. Invoke the `metrics-layer` skill.
2. Write `semantic_models.yml` and `metrics.yml` for the mart.
3. Run `mf validate-configs` (if MetricFlow is available).

**Phase complete when**: The mart's primary measures are registered as metrics in the semantic layer.

---

## Phase 6: Design the Dashboard

**Skill**: `dashboard-design`

Specify the dashboard that will consume this mart.

**What to do:**
1. Invoke the `dashboard-design` skill.
2. Define the primary metrics, dimensions, and filters for the dashboard.
3. Write a `dbt/exposures.yml` entry to register the dashboard as a downstream consumer.

**Phase complete when**: An exposure is registered in dbt and the dashboard spec is documented.

---

## Final Verification

```bash
dbt compile
dbt test --select <model>,test_type:unit
dbt build --select <model>+
dbt test --select <model>
node tools/clis/manifest-coverage.js --manifest target/manifest.json
```

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

- Run `dbt compile` to confirm the mart and any intermediate models compile without ref() errors or missing column references.
- Run `dbt test --select <model>,test_type:unit` to confirm unit tests covering the mart's business logic all pass (skip if dbt version < 1.8).
- Run `dbt build --select <model>+` to build the mart and all downstream models, confirming no test failures in the full dependency chain.
- Run `dbt test --select <model>` to confirm uniqueness, not_null, relationships, and any range or accepted_values tests all pass.
- Run `node tools/clis/manifest-coverage.js --manifest target/manifest.json` to confirm the new mart meets the minimum test coverage threshold.
- If MetricFlow is in the stack, run `mf validate-configs` to confirm the semantic model and metrics definitions are valid.

## If Something Goes Wrong

- **`dbt compile` fails with missing ref()**: the upstream staging model doesn't exist yet. Run `new-source-onboarding` first.
- **Fan-out / duplicate rows in fact table**: check join cardinality. Add `dbt_utils.unique_combination_of_columns` test and investigate the join key.
- **`mf validate-configs` fails**: ensure `semantic_model` references the exact node name from the dbt manifest. Run `manifest-parse.js` to confirm.
- **Tests fail after full refresh**: incremental logic may be wrong. Run `dbt build --select <model> --full-refresh` to rebuild from scratch and compare row counts.
