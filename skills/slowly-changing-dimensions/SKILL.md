---
name: slowly-changing-dimensions
description: "Design and implement SCD Type 1, 2, and 3 patterns in dbt using snapshots. Use when you need to track how customer attributes change over time, see what a record looked like last month, implement dbt snapshots, or someone says 'we lost the old value when it changed'. Also fires for 'track historical changes', 'dbt snapshot', 'customer history', 'what was the status last quarter', 'dimension history', or 'attribute changed and we lost the old one'. Use this whenever you need to preserve historical state of dimension attributes. For data modeling patterns, see data-modeling. For incremental processing, see incremental-models. For upstream staging models, see staging-layer."
triggers:
  - "SCD"
  - "slowly changing dimension"
  - "history tracking"
  - "type 2 SCD"
  - "dbt snapshot"
  - "track changes"
  - "customer history"
  - "attribute history"
  - "we lost the old value"
  - "what was the status last quarter"
  - "dimension history"
  - "track historical changes"
  - "preserve old values"
reads_first:
  - data-stack-context
  - staging-layer
consumes:
  - "staging-layer: stg_ model SQL"
cli_tools:
  - model-stats.js
produces:
  - "dbt snapshot SQL"
  - "schema.yml"
validates_with:
  - "dbt snapshot"
  - "dbt test --select snapshots"
---

# Slowly Changing Dimensions

I'll help you design and implement the right SCD pattern for tracking how dimension attributes change over time.

## Before You Start

Before writing snapshot SQL, confirm two things in the upstream staging model:
- The `unique_key` column is non-null and stable (not reassigned by the source)
- The `updated_at` column exists and is actually updated on record changes (verify with a quick row count check)

Also check the `snapshots/` directory for existing snapshot definitions to avoid naming conflicts.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: warehouse type, dbt version, whether the source has `updated_at` timestamps.

## Choose the Right SCD Type

| Type | What it does | Use when |
|------|-------------|----------|
| **Type 0** | Never update — keep original value | Immutable attributes (birth date, signup source) |
| **Type 1** | Overwrite with latest value | Corrections, non-historical attributes (email, phone) |
| **Type 2** | Add new row with validity window | Must query "what was true at a point in time" |
| **Type 3** | Add previous value column | Track one change (current vs. prior) |
| **Type 4** | History in separate table | Source table stays simple, history is separate |

**Decision guide:**
- "We just need the current value" → Type 1 (default)
- "What segment was this customer in when they bought?" → Type 2
- "What was the customer's previous plan?" → Type 3
- "We never want to modify the source table" → Type 4 (rare)

---

## Type 1 — Overwrite (Default)

```sql
-- dim_customers.sql (Type 1 — just a staging reference)
-- Simply the latest version of each customer record

select
    {{ dbt_utils.generate_surrogate_key(['customer_id']) }} as customer_key,
    customer_id,
    customer_name,
    email,
    customer_segment,
    country,
    updated_at

from {{ ref('stg_crm__customers') }}
```

No snapshot needed. The staging model pulls the current state.

---

## Type 2 — History Rows (Most Common)

### Step 1: Create a Snapshot

```sql
-- snapshots/snapshot_customers.sql
{% snapshot snapshot_customers %}

{{
    config(
        target_schema='snapshots',
        strategy='timestamp',
        unique_key='customer_id',
        updated_at='updated_at',
        -- OR: strategy='check', check_cols=['customer_segment', 'plan_type']
    )
}}

select
    customer_id,
    customer_name,
    email,
    customer_segment,
    plan_type,
    updated_at

from {{ source('crm', 'customers') }}

{% endsnapshot %}
```

Run snapshots separately: `dbt snapshot`

### Strategy Options

**`timestamp` strategy** — use when source has a reliable `updated_at`:
```sql
strategy='timestamp',
unique_key='customer_id',
updated_at='updated_at'
```

**`check` strategy** — use when no `updated_at` exists, check specific columns for changes:
```sql
strategy='check',
unique_key='customer_id',
check_cols=['customer_segment', 'plan_type', 'country']
-- OR: check_cols='all'  -- check every column
```

### Step 2: Build the SCD2 Dimension

```sql
-- models/marts/core/dim_customers_history.sql
-- SCD Type 2: one row per customer per validity period

with snapshot as (

    select * from {{ ref('snapshot_customers') }}

),

final as (

    select
        -- Surrogate key: unique per customer + time period
        {{ dbt_utils.generate_surrogate_key(['customer_id', 'dbt_scd_id']) }}
            as customer_key,

        -- Natural key
        customer_id,

        -- Tracked attributes
        customer_name,
        email,
        customer_segment,
        plan_type,

        -- Validity window (from dbt snapshots)
        dbt_valid_from as valid_from,
        dbt_valid_to as valid_to,

        -- Convenience flags
        (dbt_valid_to is null) as is_current,
        dbt_updated_at as snapshot_updated_at

    from snapshot

)

select * from final
```

### Step 3: Join SCD2 to Facts

**Point-in-time join** — match the dimension at the time of the fact event:

```sql
-- In your mart or intermediate model
select
    o.order_id,
    o.ordered_at,
    o.order_amount,
    -- Customer segment AT THE TIME OF THE ORDER (not current segment)
    c.customer_segment as customer_segment_at_order,
    c.plan_type as plan_at_order

from {{ ref('fct_orders') }} o
left join {{ ref('dim_customers_history') }} c
    on o.customer_id = c.customer_id
    and o.ordered_at >= c.valid_from
    and (o.ordered_at < c.valid_to or c.valid_to is null)
```

### Warehouse-Specific Point-in-Time Join Optimization

**Snowflake** — ASOF JOIN (most efficient for point-in-time):
```sql
select
    o.order_id,
    o.ordered_at,
    c.customer_segment as segment_at_order

from {{ ref('fct_orders') }} o
asof join {{ ref('dim_customers_history') }} c
    match_condition (o.ordered_at >= c.valid_from)
    using (customer_id)
```

**BigQuery** — Avoid BETWEEN on large tables; use a sorted nested approach or the standard join above.

---

## Type 3 — Previous Value Column

```sql
-- dim_customers_type3.sql
-- Tracks only one historical change (current + previous)

with customers as (
    select * from {{ ref('snapshot_customers') }}
),

with_previous as (

    select
        customer_id,
        customer_segment as current_segment,
        -- Previous segment (most recent prior row)
        lag(customer_segment) over (
            partition by customer_id
            order by dbt_valid_from
        ) as previous_segment,
        dbt_valid_from as segment_changed_at,
        (dbt_valid_to is null) as is_current

    from customers

)

select * from with_previous
where is_current
```

---

## Snapshot Troubleshooting

**Snapshots not detecting changes?**
```sql
-- Check if updated_at is actually updating in the source
select customer_id, updated_at, count(*)
from {{ source('crm', 'customers') }}
group by 1, 2
having count(*) > 1  -- Duplicate updated_at = snapshot won't detect changes
```

**Too many snapshot rows?**
```sql
-- Check snapshot size
select
    count(*) as total_rows,
    count(distinct customer_id) as distinct_customers,
    count(case when dbt_valid_to is null then 1 end) as current_rows,
    min(dbt_valid_from) as earliest_change,
    max(dbt_valid_from) as latest_change
from {{ ref('snapshot_customers') }}
```

**Invalidate and rebuild snapshot** (destructive — only when needed):
```bash
dbt snapshot --full-refresh --select snapshot_customers
```

## Testing SCD2 Models

```yaml
models:
  - name: dim_customers_history
    columns:
      - name: customer_key
        data_tests:
          - unique
          - not_null
    # Row-level: each validity window must be well-formed
    data_tests:
      - dbt_utils.expression_is_true:
          name: no_overlapping_windows
          expression: "valid_from < valid_to or valid_to is null"
```

For the "exactly one current row per customer" check, use a **singular test** (model-level YAML expressions can't express cross-row grouping):

```sql
-- tests/assert_scd2_one_current_per_customer.sql
-- Fails if any customer_id has more than one current row

select
    customer_id,
    count(*) as current_row_count
from {{ ref('dim_customers_history') }}
where is_current
group by customer_id
having count(*) > 1
```

Run it with: `dbt test --select dim_customers_history`

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

After writing the snapshot, run it and test the output:

```bash
dbt snapshot
dbt test --select snapshots
```

Then spot-check the validity window population with a sample query:

```sql
SELECT customer_id, dbt_valid_from, dbt_valid_to, is_current
FROM snapshots.snapshot_customers
ORDER BY customer_id, dbt_valid_from
LIMIT 50;
```

Confirm `dbt_valid_to` is non-null on historical rows and null on current rows.

## If Something Goes Wrong

- **All rows show as new on every run**: The `unique_key` is wrong or null — every run looks like a new record. Check that the column has no nulls and matches the primary key of the source.
- **`dbt_valid_to` is never set**: Changes aren't being detected. For `timestamp` strategy, confirm `updated_at` actually changes in the source when records change. For `check` strategy, verify `check_cols` includes the columns that change.
- **Duplicate active records**: Multiple rows with `dbt_valid_to IS NULL` for the same entity. The `unique_key` has a collision — check if the source deduplicates properly before the snapshot runs.

## Performance Considerations

- **Snapshots run separately** from `dbt run` — schedule them first in your DAG
- **Snapshot tables grow over time** — monitor row counts; archive old history if needed
- **Point-in-time joins are expensive** — consider materializing the join result as a fact
- **BigQuery**: Avoid point-in-time joins on non-partitioned snapshot tables — partition by `valid_from`
