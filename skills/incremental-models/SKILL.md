---
name: incremental-models
description: "Implement incremental dbt models with appropriate strategies per warehouse. Use when full table refreshes are too slow or expensive, processing event streams, or implementing efficient large-table updates. Triggers: 'incremental model', 'dbt incremental', 'append only', 'upsert', 'merge strategy', 'avoid full refresh', 'large table dbt'."
triggers:
  - "incremental model"
  - "large table"
  - "event stream"
  - "append-only"
  - "incremental strategy"
  - "microbatch"
reads_first:
  - data-stack-context
  - staging-layer
consumes:
  - "staging-layer: stg_ model SQL"
cli_tools:
  - model-stats.js
  - manifest-coverage.js
produces:
  - "incremental dbt SQL"
  - "schema.yml"
validates_with:
  - "dbt compile"
  - "dbt build --select <model>"
  - "dbt build --select <model> --full-refresh"
---

# Incremental Models

I'll help you implement dbt incremental models that process only new/changed data instead of rebuilding entire tables, with the right strategy for your warehouse.

## Before You Start

Check whether the table is actually large enough to warrant incremental before building it:

```bash
node tools/clis/model-stats.js --manifest target/manifest.json
```

Also read the upstream staging model to confirm the timestamp column you plan to filter on actually exists and is non-null.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: warehouse type, data volume, update pattern (append-only vs. updates/deletes).

## When to Use Incremental Models

| Situation | Use Incremental? |
|-----------|----------------|
| Table < 1M rows | ❌ Full refresh is fine |
| Events/logs (append-only) | ✅ Yes — `append` strategy |
| Source has updates but no deletes | ✅ Yes — `merge` or `insert_overwrite` |
| Source has deletes | ⚠️ Yes, but handle carefully |
| Late-arriving data is common | ⚠️ Use lookback window |
| History tracking required | Consider snapshots instead |

## Core Pattern

```sql
{{ config(
    materialized='incremental',
    unique_key='event_id',
    incremental_strategy='merge',  -- see warehouse-specific options below
    on_schema_change='append_new_columns'
) }}

with events as (

    select * from {{ source('product', 'events') }}

    {% if is_incremental() %}
    -- Only process events newer than the latest in the target table
    -- Add a lookback buffer to catch late-arriving events
    where event_timestamp >= (
        select dateadd(hour, -3, max(event_timestamp))  -- Snowflake
        -- select timestamp_sub(max(event_timestamp), interval 3 hour)  -- BigQuery
        -- select max(event_timestamp) - interval '3 hours'              -- Redshift
        from {{ this }}
    )
    {% endif %}

)

select
    event_id,
    user_id,
    event_type,
    event_timestamp,
    properties,
    processed_at

from events
```

## Strategies by Warehouse

### Snowflake

```sql
{{ config(
    materialized='incremental',
    unique_key='event_id',
    incremental_strategy='merge',           -- default, use for upserts
    -- incremental_strategy='delete+insert', -- for complex merge conditions
    cluster_by=['event_date'],
    on_schema_change='append_new_columns'
) }}
```

**Snowflake strategies:**
- `merge` — MERGE statement; best for upserts (most common)
- `delete+insert` — delete matching rows then insert; good for partition-based updates
- `append` — INSERT only; for append-only event streams with no late updates

### BigQuery

```sql
{{ config(
    materialized='incremental',
    unique_key='event_id',
    incremental_strategy='insert_overwrite',  -- partition-based; efficient for BQ
    partition_by={
        "field": "event_date",
        "data_type": "date",
        "granularity": "day"
    },
    cluster_by=["user_id", "event_type"],
    on_schema_change='append_new_columns'
) }}
```

**BigQuery strategies:**
- `insert_overwrite` — replaces entire partitions; most efficient for large tables
- `merge` — BigQuery MERGE; more precise but costs more
- `append` — INSERT only (no deduplication)

For `insert_overwrite`, BigQuery replaces all partitions touched by the query — make sure your `WHERE` clause maps cleanly to partition boundaries.

### Databricks (Delta Lake)

```sql
{{ config(
    materialized='incremental',
    unique_key='event_id',
    incremental_strategy='merge',
    file_format='delta',
    partition_by=['event_date'],
    post_hook="OPTIMIZE {{ this }} ZORDER BY (user_id, event_type)"
) }}
```

**Databricks strategies:**
- `append` — Delta append; fastest
- `merge` — Delta MERGE; handles upserts + deletes
- `insert_overwrite` — replaces partitions

### Redshift

```sql
{{ config(
    materialized='incremental',
    unique_key='event_id',
    incremental_strategy='delete+insert',  -- most efficient for Redshift
    dist='user_id',
    sort=['event_timestamp'],
    on_schema_change='append_new_columns'
) }}
```

**Redshift strategies:**
- `append` — INSERT; for append-only
- `delete+insert` — preferred over MERGE (Redshift MERGE is slow)

### DuckDB

```sql
{{ config(
    materialized='incremental',
    unique_key='event_id',
    incremental_strategy='merge'
) }}
```

## Handling Late-Arriving Data

Always use a lookback window — never assume data arrives in perfect order:

```sql
{% if is_incremental() %}
where event_timestamp >= (
    select
        -- 3-hour buffer for near-real-time; 24 hours for daily batch
        max(event_timestamp) - interval '3 hours'
    from {{ this }}
)
{% endif %}
```

**Lookback window sizing:**

| Pipeline latency | Recommended buffer |
|------------------|--------------------|
| Real-time (< 5 min) | 1-3 hours |
| Near-real-time (< 1 hour) | 3-6 hours |
| Daily batch | 24-48 hours |
| Weekly batch | 7 days |

## Handling Schema Changes

```sql
{{ config(
    on_schema_change='append_new_columns'
    -- Options:
    -- 'ignore'               — default, ignores new columns (dangerous)
    -- 'fail'                 — fail if schema changes
    -- 'append_new_columns'   — add new columns, keep old ones
    -- 'sync_all_columns'     — add new, remove dropped (full sync of schema)
) }}
```

Use `append_new_columns` as default. Use `sync_all_columns` during planned migrations.

## Composite Unique Keys

For models without a single unique column:

```sql
{{ config(
    unique_key=['user_id', 'event_date', 'event_type']
) }}

-- Or use a surrogate key approach:
{{ config(unique_key='event_surrogate_key') }}

select
    {{ dbt_utils.generate_surrogate_key(['user_id', 'event_date', 'event_type']) }}
        as event_surrogate_key,
    user_id,
    event_date,
    event_type,
    count(*) as event_count

from {{ source('product', 'events') }}
{% if is_incremental() %}
where event_date >= (select max(event_date) - 1 from {{ this }})
{% endif %}
group by 1, 2, 3, 4
```

## Full Refresh Strategy

Plan for `--full-refresh` runs:
- Schedule monthly or after source schema changes
- Mark expensive models with `full_refresh: false` to protect them:

```sql
{{ config(
    materialized='incremental',
    full_refresh=false  -- Prevent accidental full refresh on huge tables
) }}
```

Override protection when needed: `dbt build --full-refresh --select fct_events`

## Testing Incremental Models

```bash
# Run incremental (default)
dbt run --select fct_events

# Force full rebuild
dbt run --full-refresh --select fct_events

# Validate row counts didn't drop unexpectedly
dbt test --select fct_events
```

Add a row count anomaly test (Elementary or custom):

```yaml
models:
  - name: fct_events
    config:
      elementary:
        anomaly_sensitivity: 3
    columns:
      - name: event_id
        data_tests:
          - unique
          - not_null
    data_tests:
      - elementary.volume_anomalies:
          timestamp_column: event_timestamp
          time_bucket:
            period: hour
            count: 1
```

## Microbatch Strategy (dbt 1.9+)

`microbatch` is a first-class incremental strategy that processes data in small time-bucketed batches automatically. It replaces manual `is_incremental()` lookback patterns for time-series data.

```sql
{{ config(
    materialized='incremental',
    incremental_strategy='microbatch',
    event_time='event_timestamp',   -- column that marks when the event occurred
    begin='2024-01-01',             -- earliest date to process on full refresh
    batch_size='day',               -- day | month | year
    lookback=3                      -- reprocess last N batches to catch late arrivals
) }}

select
    event_id,
    user_id,
    event_type,
    event_timestamp
from {{ source('product', 'events') }}
-- No manual is_incremental() filter needed — dbt injects it per batch
```

**When microbatch wins over manual `is_incremental()`:**
- Source data is append-only by day/week/month
- You want per-batch retry on failure (failed batches re-run automatically)
- Backfill specific date ranges: `dbt run --select fct_events --event-time-start 2024-06-01 --event-time-end 2024-06-30`

**When to stick with manual `is_incremental()`:**
- Source has random updates (no reliable `event_time`)
- Complex merge logic across multiple keys
- Composite unique keys required

## Deterministic Unique Keys

For merge-based models, unique keys must be **stable and non-nullable**:

| Key type | Status | Why |
|----------|--------|-----|
| `event_id` | ✅ Good | Stable, assigned at source |
| `order_id + line_number` | ✅ Good | Composite, deterministic |
| `event_timestamp` | ❌ Bad | Timestamps collide; updates break merge |
| `row_number()` | ❌ Bad | Changes on full refresh |
| `{{ dbt_utils.generate_surrogate_key([...]) }}` | ✅ Good | Deterministic hash |

## Schema Change Handling

Use `on_schema_change: fail` for production models — silent schema drift corrupts incrementals:

```sql
{{ config(
    materialized='incremental',
    unique_key='event_id',
    on_schema_change='fail'   -- Require explicit migration, not silent append
) }}
```

During planned migrations only: switch to `sync_all_columns`, migrate, then revert to `fail`.

## Backfill Protocol

When reprocessing historical data:

1. **Identify affected partitions** — determine which date range needs reprocessing
2. **Run scoped full refresh** — for microbatch: `dbt run --select fct_events --event-time-start 2024-01-01 --event-time-end 2024-03-31`; for manual: `dbt run --full-refresh --select fct_events`
3. **Validate row counts** — compare before/after against source
4. **Rebuild downstream models** — anything that depends on the backfilled model
5. **Re-run BI extracts** — dashboards may have cached stale data

Never silently partial-backfill. Always cascade through the DAG.

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

Run the incremental build first, then force a full refresh and compare row counts:

```bash
dbt build --select <model>
dbt build --select <model> --full-refresh
```

If the row counts differ significantly after full refresh, the lookback window is too short — extend it by 2x and re-test. The full-refresh count is the ground truth.

## If Something Goes Wrong

- **Row count drops after incremental run**: The lookback window is too short and late-arriving events are being missed. Extend the lookback buffer (e.g., from 3 hours to 6 hours) and run a full refresh to confirm.
- **Duplicate rows**: The `unique_key` is wrong or null-able. Confirm the key is stable and non-nullable; use `dbt_utils.generate_surrogate_key()` if no single natural key exists.
- **Schema drift error**: A new column appeared in the source and `on_schema_change='fail'` is set. Switch temporarily to `append_new_columns`, run the incremental, then revert to `fail` and update the model to include the new column explicitly.
- **Merge conflicts on Redshift**: Redshift MERGE is slow and lock-prone on large tables. Switch `incremental_strategy` to `delete+insert` which is more efficient for Redshift.

## Common Mistakes

- **No lookback window** — misses late-arriving data; always buffer
- **Timestamp as sole unique key** — timestamps collide; use business keys
- **`WHERE` on non-indexed column** — full scan defeats the purpose; filter on partitioned/clustered column
- **Missing `unique_key`** — without it, dbt defaults to `append` and creates duplicates on reruns
- **`on_schema_change='ignore'`** — new source columns silently disappear from your mart
- **Not testing after incremental** — row count drops are invisible without monitoring
- **Partial backfills** — backfilling the source but not downstream marts creates permanent inconsistency
