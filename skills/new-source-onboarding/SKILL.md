---
name: new-source-onboarding
description: "End-to-end workflow for onboarding a new data source from ingestion configuration through staging, testing, documentation, and lineage registration. Sequences: ingestion-strategy, staging-layer, data-quality-testing, data-catalog, data-lineage. Triggers: 'add a new source', 'new data source', 'onboard a connector', 'new connector', 'add Fivetran connector', 'add Airbyte source', 'ingest new data'."
triggers:
  - "add a new source"
  - "new data source"
  - "onboard a connector"
  - "new connector"
  - "add Fivetran connector"
  - "add Airbyte source"
  - "ingest new data"
reads_first:
  - data-stack-context
cli_tools:
  - schema-introspect.js
  - source-freshness.js
produces:
  - "ingestion connector configuration"
  - "sources.yml"
  - "stg_ model SQL"
  - "schema.yml with tests"
  - "catalog documentation"
validates_with:
  - "dbt source freshness"
  - "dbt compile"
  - "dbt test --select staging"
---

## When to Use This Workflow

Use `new-source-onboarding` when adding a net-new data source to the warehouse. This covers picking an ingestion tool, writing staging models, adding tests, documenting the source, and registering lineage. Skip phases that don't apply (e.g., if ingestion is already configured by another team).

## Before You Start

Read `.claude/data-stack-context.md` for ingestion tool, warehouse, and dbt version. Then check what raw schemas already exist by running:
```bash
node tools/clis/schema-introspect.js --help
```

---

## Phase 1: Configure Ingestion

**Skill**: `ingestion-strategy`

Choose and configure the ingestion tool to land raw data in the warehouse.

**What to do:**
1. Invoke the `ingestion-strategy` skill.
2. Select the appropriate tool (Fivetran, Airbyte, or custom) based on the source type.
3. Configure the connector and confirm the raw data lands in the expected schema.

**Phase complete when**: Raw data is visible in the warehouse and `dbt source freshness` can reach it.

---

## Phase 2: Build the Staging Layer

**Skill**: `staging-layer`

Write a clean `stg_<source>__<object>.sql` model for each raw table being onboarded.

**What to do:**
1. Run `node tools/clis/schema-introspect.js` to enumerate raw table columns.
2. Invoke the `staging-layer` skill.
3. Write one staging model per source table: rename columns, cast types, filter deleted records.
4. Write `sources.yml` with freshness checks.
5. Run `dbt compile && dbt source freshness`.

**Phase complete when**: All staging models compile and source freshness reports green.

---

## Phase 3: Add Data Quality Tests

**Skill**: `data-quality-testing`

Add the minimum required tests to every staging model.

**What to do:**
1. Invoke the `data-quality-testing` skill.
2. Add `unique` + `not_null` on all primary keys.
3. Add `relationships` tests for foreign keys where the upstream staging model exists.
4. Add `accepted_values` for categorical columns.
5. Run `node tools/clis/manifest-coverage.js --manifest target/manifest.json` to confirm coverage.

**Phase complete when**: `dbt test --select staging` passes with zero failures.

---

## Phase 4: Document the Source

**Skill**: `data-catalog`

Add descriptions to every column and model so the source is discoverable.

**What to do:**
1. Invoke the `data-catalog` skill.
2. Add `description` fields to all columns in `schema.yml`.
3. Add a model-level description explaining the source system and data grain.
4. Run `dbt docs generate` to confirm documentation builds.

**Phase complete when**: `dbt docs generate` succeeds and the source is visible in dbt docs.

---

## Phase 5: Register Lineage

**Skill**: `data-lineage`

Ensure the new source is visible in the lineage graph.

**What to do:**
1. Run `node tools/clis/lineage-export.js --manifest target/manifest.json --format dot` to confirm the staging models appear.
2. Invoke the `data-lineage` skill if OpenLineage or a catalog integration needs to be updated.
3. Verify no circular dependencies were introduced.

**Phase complete when**: Lineage export shows the new staging models as leaf nodes with no circular dependencies.

---

## Final Verification

```bash
dbt source freshness
dbt compile
dbt test --select staging
dbt docs generate
node tools/clis/source-freshness.js --results target/sources.json
```

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

- Run `dbt source freshness` and confirm all newly onboarded sources report green — no warn or error freshness violations.
- Run `dbt compile` to confirm all staging models compile without missing column references or ref() errors.
- Run `dbt test --select staging` to confirm all primary key, not_null, and relationships tests pass with zero failures.
- Run `dbt docs generate` to confirm documentation builds successfully and the new source is visible in the docs site.
- Run `node tools/clis/source-freshness.js --results target/sources.json` to verify freshness results match expectations from the raw warehouse schema.

## If Something Goes Wrong

- **Source freshness fails**: check `loaded_at_field` in `sources.yml` matches an actual timestamp column in the raw table.
- **Staging model compile error**: usually a column reference that doesn't exist in the raw schema. Re-run `schema-introspect.js` to get the current column list.
- **Test failures on primary key**: the source may have duplicates upstream — add a `dbt_utils.unique_combination_of_columns` test instead and document the issue.
- **dbt docs generate fails**: a column description may contain special characters. Check schema.yml for unescaped quotes or colons.
