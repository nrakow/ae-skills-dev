---
name: model-deprecation
description: "Safely retire dbt models, columns, or sources without breaking downstream consumers. Use when removing a model that has active consumers, renaming a mart column, sunsetting a source, or cleaning up legacy models. Triggers: 'deprecate a model', 'remove a model', 'rename a column', 'sunset a source', 'retire a model', 'delete a mart', 'clean up old models', 'remove a column'."
triggers:
  - "deprecate a model"
  - "remove a model"
  - "rename a column"
  - "sunset a source"
  - "retire a model"
  - "delete a mart"
  - "clean up old models"
  - "remove a column"
reads_first:
  - data-stack-context
  - data-lineage
consumes:
  - "data-lineage: downstream dependency map for the model or column being deprecated"
cli_tools:
  - manifest-lineage.js
  - manifest-parse.js
  - lineage-export.js
produces:
  - "deprecation notice in schema.yml meta"
  - "migration guide (inline YAML description)"
  - "updated schema.yml removing deprecated artifacts"
validates_with:
  - "dbt compile"
  - "dbt test --select <successor_model>"
  - "node tools/clis/manifest-lineage.js --manifest target/manifest.json --model <deprecated_model>"
---

# Model Deprecation

I'll help you retire a dbt model, column, or source safely — with proper consumer notification, a migration window, and a clean removal that doesn't break downstream jobs or dashboards.

## Before You Start

Run the lineage tool immediately to understand what will break if the model or column disappears without warning:

```bash
node tools/clis/manifest-lineage.js --manifest target/manifest.json --model <model_name>
node tools/clis/lineage-export.js --manifest target/manifest.json --output lineage.json
```

- Read the output and list every downstream model, BI dashboard exposure, and reverse ETL sync that depends on the artifact being deprecated.
- Check `models/` for any `ref('<model_name>')` calls that will break if the model is removed.
- Check `exposures:` blocks in `schema.yml` files for dashboards that query this model directly.
- Identify the team or individual who owns each downstream consumer — they must be notified.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: BI tool (to find dashboard consumers), team size and maturity (affects notification timeline), dbt version.

## Deprecation Decision Matrix

Not all retirements are the same. Choose the right path:

| Scenario | Path |
|----------|------|
| Model has no downstream consumers | Safe delete — remove SQL, YAML, and schema entries immediately |
| Model has consumers who can migrate | Soft deprecation → migration window → hard removal |
| Column being replaced by a renamed column | Dual-publish (old + new column), then remove old after migration |
| Source being replaced by a new connector | New staging model first, migrate downstream refs, then remove old source |
| Model being renamed (not removed) | Keep old model as a `select * from {{ ref('new_model') }}` alias during migration |

## Step 1: Check for Active Consumers

Before marking anything deprecated, confirm the blast radius:

```bash
# Find all models that ref() the target model
node tools/clis/manifest-lineage.js \
  --manifest target/manifest.json \
  --model <model_name>

# Export full lineage graph to identify BI consumers
node tools/clis/lineage-export.js \
  --manifest target/manifest.json \
  --format dot \
  --output lineage.dot
```

If the downstream list is empty, proceed directly to Step 4 (Hard Removal).

If consumers exist, follow Steps 2–4.

## Step 2: Mark as Deprecated in YAML

Add a deprecation notice to the model's `schema.yml`. Do not remove any SQL or tests yet.

```yaml
models:
  - name: fct_orders_legacy
    description: |
      **DEPRECATED** as of 2026-Q1. Use `fct_orders` instead.

      **Migration deadline**: 2026-06-01. After this date, this model will be removed.

      **What changed**: This model was replaced by `fct_orders`, which has improved
      grain clarity and includes the `net_revenue_usd` column that was missing here.

      **Migration guide**: Replace `ref('fct_orders_legacy')` with `ref('fct_orders')`.
      Column mapping:
        - `order_amount` → `gross_revenue_usd`
        - `net_amount` → `net_revenue_usd`
    config:
      meta:
        deprecated: true
        deprecated_since: "2026-01-15"
        remove_after: "2026-06-01"
        successor: "fct_orders"
        deprecation_owner: "analytics-team@company.com"
```

### Column-Level Deprecation

```yaml
columns:
  - name: old_customer_segment    # being replaced by customer_tier
    description: |
      **DEPRECATED** as of 2026-Q1. Use `customer_tier` instead.
      Will be removed after 2026-06-01.
    config:
      meta:
        deprecated: true
        successor_column: "customer_tier"
```

## Step 3: Notify Consumers

> **Human required:** Send deprecation notices to downstream consumers. Claude can draft the message but cannot send Slack messages, emails, or GitHub issues. Provide the blast radius list from Step 1 to the relevant teams.

Draft notification message:

```
Subject: [Action Required] Deprecation of fct_orders_legacy by 2026-06-01

The fct_orders_legacy model is being retired on 2026-06-01.

Affected downstream models/dashboards:
- [List from manifest-lineage.js output]

Migration: Replace ref('fct_orders_legacy') with ref('fct_orders').
Column mapping: old_column → new_column

Questions: Contact analytics-team@company.com
```

Set a calendar reminder to check migration status 2 weeks before the removal date.

## Step 4: Hard Removal

Only remove SQL and YAML entries after confirming zero active refs in the dbt project and all notified consumers have confirmed migration.

```bash
# Confirm no remaining refs before deletion
grep -r "ref('fct_orders_legacy')" models/
grep -r "fct_orders_legacy" models/

# If both return nothing, safe to remove:
# 1. Delete models/marts/<domain>/fct_orders_legacy.sql
# 2. Remove the model entry from its schema.yml
# 3. Remove any tests referencing the model
# 4. Run dbt compile to confirm no broken refs
```

### Removing a Source

```yaml
# Before removing from sources.yml:
# 1. Confirm no stg_ models reference this source()
grep -r "source('old_source'" models/

# 2. Check if any freshness jobs reference it
# 3. Only then remove the source declaration
```

## Step 5: Alias Pattern (Rename Without Breaking)

When renaming a model, keep the old name as a pass-through alias during the migration window:

```sql
-- models/marts/core/fct_orders_legacy.sql
-- DEPRECATED: alias for fct_orders. Remove after 2026-06-01.
-- Migration: update all ref('fct_orders_legacy') to ref('fct_orders')

{{ config(
    meta={
        "deprecated": true,
        "remove_after": "2026-06-01"
    }
) }}

select * from {{ ref('fct_orders') }}
```

This allows CI to pass and downstream models to work while consumers migrate at their own pace.

## Step 6: Post-Removal Validation

After hard removal, run the full project build to catch any missed references:

```bash
dbt compile
dbt build --select state:modified+
node tools/clis/manifest-parse.js --manifest target/manifest.json
```

Verify the removed model no longer appears in the manifest:

```bash
node tools/clis/manifest-parse.js --manifest target/manifest.json | grep fct_orders_legacy
# Should return nothing
```

## Deprecation Timeline Template

| Week | Action |
|------|--------|
| Week 0 | Add `deprecated: true` to schema.yml; send notification to consumers |
| Week 2 | Check migration progress; follow up with stragglers |
| Week 4 | Final warning to unmigrated consumers |
| Week 6 (removal date) | Hard remove SQL and YAML; run full build |
| Week 7 | Confirm dashboards and downstream jobs are healthy |

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

**Before announcing deprecation (Steps 1–3):**
- Run `dbt compile` to confirm the deprecated model still compiles (do not remove it yet).
- Run `node tools/clis/manifest-lineage.js --manifest target/manifest.json --model <deprecated_model>` and confirm the downstream consumer list is complete.

**After hard removal (Steps 4–6):**
- Run `dbt compile` to confirm no remaining `ref()` calls point to the removed model.
- Run `dbt test --select <successor_model>` to confirm the successor model's tests pass.
- Run `node tools/clis/manifest-parse.js --manifest target/manifest.json` and confirm the removed model does not appear in the manifest.
- Confirm the removal PR passes CI before merging.

## If Something Goes Wrong

- **`dbt compile` fails after hard removal**: A model still references the removed artifact via `ref()`. Run `grep -r "ref('<deprecated_model>')" models/` to find it, and update the reference.
- **Downstream dashboard is broken after removal**: The exposure YAML was not updated. Search for the old model name in any `exposures:` blocks across all YAML files.
- **Consumer team missed the migration deadline**: Restore the alias pattern (Step 5) to buy more time, then extend the removal deadline by 4 weeks.
- **Source removal breaks freshness checks**: A `dbt source freshness` job still targets the removed source. Update the CI job or orchestrator configuration to remove the stale freshness check.
- **Model appears in manifest after deletion**: `dbt compile` or `dbt parse` has not been run since deletion. Run `dbt parse` to regenerate `target/manifest.json`.
