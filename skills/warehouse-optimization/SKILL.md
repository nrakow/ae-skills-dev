---
name: warehouse-optimization
description: "Optimize warehouse performance and cost through clustering, partitioning, materialization strategies, and query tuning. Use when queries are slow, compute costs are high, or a model needs to be optimized for production scale. Triggers: 'optimize warehouse', 'query performance', 'slow queries', 'clustering', 'partitioning', 'cost optimization', 'warehouse cost', 'query tuning', 'performance tuning'."
triggers:
  - "optimize warehouse"
  - "query performance"
  - "slow queries"
  - "clustering"
  - "partitioning"
  - "cost optimization"
  - "performance tuning"
reads_first:
  - data-stack-context
cli_tools:
  - cost-estimate.js
  - model-stats.js
produces:
  - "optimization recommendations"
  - "ALTER TABLE or cluster_by config SQL"
  - "updated dbt model config"
validates_with:
  - "node tools/clis/cost-estimate.js --help"
  - "node tools/clis/model-stats.js --manifest target/manifest.json"
---

# Warehouse Optimization

I'll help you reduce costs and improve query performance through appropriate clustering, partitioning, materialization strategies, and query rewrites.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: warehouse type, data volume, cost constraints, slowest queries.

Before optimizing, run `node tools/clis/model-stats.js --manifest target/manifest.json` to see row counts and materialization types, and `node tools/clis/cost-estimate.js --help` to estimate the cost impact of changes.

## Before You Start

- Run `node tools/clis/cost-estimate.js --help` to identify the most expensive queries before making any changes.
- Run `node tools/clis/model-stats.js --manifest target/manifest.json` to find the largest tables by row count and bytes.
- Read the warehouse-specific integration guide in `tools/integrations/` for your warehouse type.
- Record baseline query execution times and costs before optimizing so you can measure improvement.

## Diagnostic First: Find the Expensive Queries

Before optimizing, measure what's actually slow or expensive.

### Snowflake Query History

```sql
-- Top 10 most expensive queries (last 7 days)
select
    query_text,
    user_name,
    warehouse_name,
    total_elapsed_time / 1000 as elapsed_seconds,
    bytes_scanned / 1e9 as gb_scanned,
    partitions_scanned,
    partitions_total,
    100 * partitions_scanned / nullif(partitions_total, 0) as pct_partitions_scanned
from snowflake.account_usage.query_history
where start_time >= current_timestamp - interval '7 days'
  and query_type = 'SELECT'
  and total_elapsed_time > 10000  -- > 10 seconds
order by bytes_scanned desc
limit 10;
```

### BigQuery Cost Analysis

```sql
-- BigQuery: top tables by bytes billed (last 30 days)
SELECT
    destination_table.table_id,
    SUM(total_bytes_billed) / 1e12 AS total_tb_billed,
    SUM(total_bytes_billed) / 1e12 * 5 AS estimated_cost_usd,  -- $5/TB on-demand
    COUNT(*) AS query_count
FROM `region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND statement_type = 'SELECT'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 20
```

---

## Snowflake Optimization

### Clustering Keys

```sql
-- When to cluster:
-- Table > 100GB AND common filter/join column with high cardinality

-- Check current clustering effectiveness
select system$clustering_information('analytics.marts.fct_events', '(event_date)');

-- Add clustering
alter table fct_events cluster by (event_date::date);

-- Enable automatic clustering (for > 500GB tables with frequent scans)
alter table fct_events enable automatic clustering;

-- In dbt:
{{ config(
    materialized='table',
    cluster_by=['event_date', 'user_id']  -- up to 4 columns
) }}
```

**Clustering key selection:**
- Use the most common filter column (usually a date)
- Add a high-cardinality join column as second key
- Don't cluster on boolean or low-cardinality columns
- Verify: `partitions_scanned / partitions_total < 0.2` for good clustering

### Warehouse Sizing

```sql
-- Right-size warehouses by query type
-- Use INFORMATION_SCHEMA to find per-warehouse cost

select
    warehouse_name,
    sum(credits_used) as total_credits,
    sum(credits_used) * 2 as estimated_cost_usd,  -- $2/credit enterprise
    count(*) as query_count,
    avg(total_elapsed_time) / 1000 as avg_seconds
from snowflake.account_usage.query_history
where start_time >= current_date - 30
group by 1
order by 2 desc;
```

**Warehouse strategy:**
- `LOADING` warehouse: X-Small or Small — bulk COPY INTO ops
- `TRANSFORMING` warehouse: Medium or Large — dbt builds
- `REPORTING` warehouse: X-Small or Small — BI tool queries (auto-suspend in 60s)
- `ANALYST` warehouse: Small — ad-hoc queries

```sql
-- Configure auto-suspend and auto-resume
alter warehouse REPORTING set
    auto_suspend = 60     -- suspend after 1 minute of inactivity
    auto_resume = true    -- resume automatically on query
    min_cluster_count = 1
    max_cluster_count = 3  -- Multi-cluster for concurrent BI users
    scaling_policy = 'ECONOMY';
```

### Query Rewrites

```sql
-- ❌ Expensive: non-SARGable filter (function on column)
where year(created_at) = 2024
-- ✅ Cheaper: range filter allows partition pruning
where created_at >= '2024-01-01' and created_at < '2025-01-01'

-- ❌ Expensive: SELECT * on large table
select * from fct_events
-- ✅ Select only needed columns
select event_id, user_id, event_type, event_date from fct_events

-- ❌ Expensive: DISTINCT on large table without filter
select distinct user_id from fct_events
-- ✅ Use COUNT(DISTINCT) only at aggregation time, or pre-aggregate
select date_trunc('day', event_date), approx_count_distinct(user_id)
from fct_events group by 1

-- ❌ Expensive: JOIN on expression
join dim_customers on lower(o.email) = lower(c.email)
-- ✅ Normalize in staging, join on indexed column
join dim_customers on o.normalized_email = c.normalized_email
```

---

## BigQuery Optimization

### Partitioning

```sql
-- Always partition large tables
{{ config(
    partition_by={
        "field": "event_date",      -- use a date column
        "data_type": "date",
        "granularity": "day"        -- day | month | year
    },
    require_partition_filter=True   -- Force callers to filter on partition
) }}

-- Partition by ingestion time (when no good date column exists)
{{ config(
    partition_by={
        "field": "_PARTITIONTIME",
        "data_type": "timestamp",
        "granularity": "day"
    }
) }}
```

### Clustering

```sql
-- Cluster in addition to partitioning for better scan efficiency
{{ config(
    partition_by={"field": "event_date", "data_type": "date"},
    cluster_by=["user_id", "event_type"]  -- up to 4 columns
) }}
```

### BigQuery Cost Controls

```sql
-- Set per-query byte limit (prevents runaway queries)
-- In connection settings or via API:
-- maximumBytesBilled = 10_000_000_000  -- 10GB limit

-- Use approximate aggregates for analytics
select approx_count_distinct(user_id) from fct_events  -- Much cheaper than COUNT(DISTINCT)
select approx_quantiles(revenue_usd, 100)[offset(50)] as p50_revenue from fct_orders

-- Enable query cache (free for repeated identical queries)
-- Default: enabled. Only disabled with CURRENT_TIMESTAMP() in query
```

---

## Databricks (Delta Lake) Optimization

```sql
-- OPTIMIZE: compact small files (run after bulk writes)
OPTIMIZE analytics.marts.fct_events
ZORDER BY (user_id, event_type)  -- Collocate related data

-- VACUUM: remove old Delta versions (default: 7-day retention)
VACUUM analytics.marts.fct_events RETAIN 168 HOURS

-- Auto-optimize (Delta Lake feature)
ALTER TABLE fct_events SET TBLPROPERTIES (
    'delta.autoOptimize.optimizeWrite' = 'true',
    'delta.autoOptimize.autoCompact' = 'true'
)

-- Bloom filter index for non-date filters
CREATE BLOOMFILTER INDEX ON TABLE fct_events FOR COLUMNS (user_id OPTIONS (fpp=0.1))
```

---

## Redshift Optimization

```sql
-- Choose distribution style
{{ config(
    dist='customer_id',    -- DISTKEY: use join/group-by column most used in queries
    -- dist='all'           -- DISTSTYLE ALL: for small dimension tables (< 5M rows)
    -- dist='even'          -- DISTSTYLE EVEN: for staging or unknown access patterns
    sort=['created_at'],   -- SORTKEY: most common filter column
) }}

-- Vacuum and analyze after bulk loads
VACUUM DELETE ONLY analytics.fct_orders;
ANALYZE analytics.fct_orders;

-- Check table health
SELECT table_name, pct_used, unsorted, stats_off
FROM svv_table_info
WHERE schema = 'marts'
ORDER BY pct_used DESC;
```

---

## DuckDB Optimization

DuckDB is columnar and vectorized by default — it's fast out of the box, but a few patterns matter at scale.

```sql
-- Check database size and table stats
PRAGMA database_size;
PRAGMA storage_info('fct_events');

-- EXPLAIN ANALYZE to see actual row counts and execution plan
EXPLAIN ANALYZE
SELECT user_id, count(*) FROM fct_events WHERE event_date >= '2024-01-01' GROUP BY 1;

-- Memory limit (important for large dbt runs)
SET memory_limit = '8GB';
SET threads = 4;  -- match to available CPU cores

-- Parallel reads from Parquet (extremely fast)
SELECT * FROM read_parquet('s3://my-bucket/events/*.parquet', hive_partitioning=true)
WHERE event_date >= '2024-01-01';
```

**DuckDB-specific tips:**
- No cluster/partition concept — focus on column projection and filter pushdown
- Use `COPY` for bulk loads, not `INSERT`
- Native SQL is faster than Python UDFs for heavy transforms

---

## Snowflake Dynamic Tables

Dynamic Tables replace scheduled tasks + incremental models for near-real-time use cases. They refresh automatically with a configurable lag target.

```sql
-- Create a Dynamic Table with a 5-minute lag target
CREATE OR REPLACE DYNAMIC TABLE analytics.marts.fct_orders_live
    TARGET_LAG = '5 minutes'
    WAREHOUSE = TRANSFORMING
AS
SELECT
    o.order_id,
    o.customer_id,
    c.customer_segment,
    o.order_amount,
    o.created_at
FROM raw.orders o
JOIN analytics.staging.stg_customers c ON o.customer_id = c.customer_id;
```

**In dbt** (dbt-snowflake 1.6+):

```sql
{{ config(
    materialized='dynamic_table',
    target_lag='5 minutes',
    snowflake_warehouse='TRANSFORMING'
) }}
```

| | Dynamic Tables | Incremental |
|---|---|---|
| Latency | Minutes | Hours (scheduled) |
| Cost control | Less predictable | Predictable |
| Complex transforms | Limited | Full dbt support |
| Late-arriving data | Automatic | Manual lookback |

---

## BigQuery Materialized Views

BigQuery Materialized Views pre-compute and cache aggregation results, refreshing automatically when base tables change.

```sql
CREATE MATERIALIZED VIEW analytics.marts.mv_daily_revenue
OPTIONS (enable_refresh = true, refresh_interval_minutes = 60)
AS
SELECT
    DATE(ordered_at) as order_date,
    customer_segment,
    SUM(net_revenue) as total_revenue,
    COUNT(*) as order_count
FROM analytics.marts.fct_orders
GROUP BY 1, 2;
```

In dbt (BigQuery adapter):

```sql
{{ config(
    materialized='materialized_view',
    enable_refresh=true,
    refresh_interval_minutes=60
) }}
```

Use MVs for stable rollup-heavy BI queries. Use incremental models when you need dbt tests, docs, and full DAG lineage.

---

## dbt Materialization Strategy

```yaml
# dbt_project.yml — set materializations by layer

models:
  my_project:
    staging:
      +materialized: view          # Views are free to query
    intermediate:
      +materialized: ephemeral     # No table created; inlined into final query
    marts:
      +materialized: table         # Materialize marts for performance
      core:
        fct_events:                # Override: large event table — incremental
          +materialized: incremental
          +incremental_strategy: merge
```

**Materialization cost comparison:**

| Materialization | Storage cost | Query cost | Rebuild cost |
|----------------|-------------|-----------|-------------|
| View | None | High (re-runs query) | None |
| Ephemeral | None | High (inlined) | None |
| Table | Medium | Low (pre-computed) | High (full rebuild) |
| Incremental | Medium | Low | Low (processes new data only) |

---

## Cost Alerting

```python
# Snowflake: alert if daily spend exceeds threshold
# (via Snowflake Resource Monitor)

CREATE RESOURCE MONITOR daily_budget
WITH CREDIT_QUOTA = 100  -- 100 credits/day limit
TRIGGERS
    ON 75 PERCENT DO NOTIFY  -- Send email at 75%
    ON 100 PERCENT DO SUSPEND  -- Suspend at 100%
    ON 110 PERCENT DO SUSPEND_IMMEDIATE;

ALTER WAREHOUSE TRANSFORMING SET RESOURCE_MONITOR = daily_budget;
```

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

- Re-run `node tools/clis/cost-estimate.js --help` after applying optimizations to measure improvement against the baseline.
- Re-run `node tools/clis/model-stats.js --manifest target/manifest.json` to confirm table sizes and scan efficiency improved.
- For Snowflake: check `partitions_scanned / partitions_total` in query history — good clustering should bring this below 0.2.

## If Something Goes Wrong

- **Clustering not reducing scan cost**: Verify the `WHERE` clause in expensive queries actually filters on the clustered column — clustering only helps when the filter column matches the cluster key.
- **Partition pruning not working**: Check that the filter is on the raw partition column, not a computed value (e.g., `WHERE event_date >= '2024-01-01'` works; `WHERE DATE(event_timestamp) >= '2024-01-01'` may not prune).
- **Cost increased after change**: A view may have been converted to a table — check the model's `materialized` config; tables incur storage costs and rebuild costs that views avoid.
