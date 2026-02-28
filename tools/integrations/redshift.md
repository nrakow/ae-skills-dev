# Redshift Integration Guide

## Distribution and Sort Keys

```sql
-- Choose DISTKEY based on join column
-- Choose SORTKEY based on WHERE/ORDER BY column

CREATE TABLE fct_orders (
    order_id VARCHAR(36) NOT NULL,
    customer_id VARCHAR(36),
    ordered_at TIMESTAMP,
    net_revenue_usd DECIMAL(12,2)
)
DISTKEY(customer_id)      -- Most common join column
SORTKEY(ordered_at);      -- Most common filter column

-- DISTSTYLE ALL: for small dimension tables (< 5M rows)
CREATE TABLE dim_products (...)
DISTSTYLE ALL;

-- DISTSTYLE EVEN: for staging or unknown access patterns
CREATE TABLE stg_events (...)
DISTSTYLE EVEN;
```

## dbt Configuration
```yaml
# profiles.yml
my_project:
  outputs:
    prod:
      type: redshift
      host: "{{ env_var('REDSHIFT_HOST') }}"
      user: "{{ env_var('REDSHIFT_USER') }}"
      password: "{{ env_var('REDSHIFT_PASSWORD') }}"
      database: analytics
      schema: marts
      port: 5439
      threads: 8
```

```sql
{{ config(
    materialized='table',
    dist='customer_id',
    sort=['ordered_at'],
    sort_type='compound'  -- compound or interleaved
) }}
```

## COPY Command (bulk load from S3)
```sql
COPY raw.salesforce.account
FROM 's3://my-bucket/salesforce/account/'
IAM_ROLE 'arn:aws:iam::123456789:role/RedshiftS3Access'
FORMAT AS PARQUET;

-- CSV with options
COPY raw.events
FROM 's3://my-bucket/events/'
IAM_ROLE '...'
FORMAT AS CSV
IGNOREHEADER 1
TIMEFORMAT 'YYYY-MM-DD HH:MI:SS'
BLANKSASNULL
EMPTYASNULL;
```

## VACUUM and ANALYZE
```sql
-- After bulk deletes/updates (VACUUM reclaims space, re-sorts)
VACUUM DELETE ONLY analytics.fct_orders;
VACUUM SORT ONLY analytics.fct_orders;
VACUUM FULL analytics.fct_orders;   -- Most thorough; takes longest

-- ANALYZE updates query planner statistics
ANALYZE analytics.fct_orders;

-- Check table health
SELECT table_name, pct_used, unsorted, stats_off
FROM svv_table_info
WHERE schema = 'marts'
ORDER BY pct_used DESC;
```

## WLM (Workload Management)
```sql
-- Route queries to appropriate queues via labels
SET query_group TO 'reporting';   -- BI tool queries
SET query_group TO 'etl';         -- dbt transformations
SET query_group TO 'analyst';     -- Ad-hoc queries
```

## Key Redshift-Specific SQL
```sql
-- No QUALIFY — use subquery
-- DATEADD / DATEDIFF
DATEADD(day, -7, GETDATE())
DATEDIFF(day, start_date, end_date)

-- AT TIME ZONE
CONVERT_TIMEZONE('EST', 'UTC', created_at)

-- APPROXIMATE COUNT DISTINCT (HyperLogLog)
APPROXIMATE COUNT(DISTINCT user_id)

-- Redshift Spectrum (query S3 directly)
CREATE EXTERNAL SCHEMA spectrum FROM DATA CATALOG
DATABASE 'my_glue_db'
IAM_ROLE 'arn:aws:iam::...'
CREATE EXTERNAL DATABASE IF NOT EXISTS;

SELECT * FROM spectrum.events WHERE event_date = '2024-01-15';
```

## Performance Tips
- Run `VACUUM` weekly on tables with frequent updates/deletes
- Run `ANALYZE` after bulk loads
- Use `DISTKEY` on the highest-cardinality join column
- Avoid cross-joins and large sorts without SORTKEY
- Use `APPROXIMATE COUNT(DISTINCT)` for cardinality estimates
- Prefer `delete+insert` over `merge` in dbt (Redshift MERGE is slow)
