---
name: incremental-models
description: "Implement incremental dbt models with appropriate strategies per warehouse. Use when full table refreshes are too slow or expensive, processing event streams, or implementing efficient large-table updates. Triggers: 'incremental model', 'dbt incremental', 'append only', 'upsert', 'merge strategy', 'avoid full refresh', 'large table dbt'."
---

# Incremental Models

I'll help you implement dbt incremental models that process only new/changed data instead of rebuilding entire tables, with the right strategy for your warehouse.

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

## Common Mistakes

- **No lookback window** — misses late-arriving data; always buffer
- **`WHERE` on non-indexed column** — full scan defeats the purpose; filter on partitioned/clustered column
- **Missing `unique_key`** — without it, dbt defaults to `append` and creates duplicates on reruns
- **`on_schema_change='ignore'`** — new source columns silently disappear from your mart
- **Not testing after incremental** — row count drops are invisible without monitoring
