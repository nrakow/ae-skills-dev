# BigQuery Integration Guide

## Key SQL Patterns

### Partitioning (required for large tables)
```sql
-- Date partition
{{ config(
    partition_by={"field": "event_date", "data_type": "date", "granularity": "day"},
    cluster_by=["user_id", "event_type"]
) }}

-- Timestamp partition
{{ config(
    partition_by={"field": "created_at", "data_type": "timestamp", "granularity": "day"}
) }}

-- Integer range partition
{{ config(
    partition_by={"field": "user_id", "data_type": "int64", "range": {"start": 0, "end": 1000000, "interval": 10000}}
) }}
```

### STRUCT and ARRAY types
```sql
-- Access STRUCT fields
select
    user.name as user_name,
    user.email as user_email,
    address.city as city
from users;

-- Unnest ARRAY
select
    user_id,
    tag
from users,
unnest(tags) as tag;

-- Unnest with offset
select user_id, tag, pos
from users,
unnest(tags) as tag with offset as pos;

-- Create STRUCT
select struct(user_id, email, created_at) as user_struct from users;
```

### Approximate aggregations (cheap)
```sql
-- Much cheaper than COUNT(DISTINCT) on large tables
select approx_count_distinct(user_id) as unique_users
from events;

-- Approximate quantiles
select approx_quantiles(revenue_usd, 100)[offset(50)] as p50
from orders;

-- Approximate top-N
select approx_top_sum(product_id, revenue_usd, 10) as top_products
from orders;
```

### Date/Time functions
```sql
date_trunc(created_at, month)
date_add(current_date(), interval 7 day)
date_diff(end_date, start_date, day)
timestamp_sub(current_timestamp(), interval 3 hour)
format_date('%Y-%m', event_date)
parse_date('%Y%m%d', date_string)
```

### Window functions (no QUALIFY — use subquery)
```sql
-- No QUALIFY in BigQuery — use subquery
select * from (
    select *,
        row_number() over (partition by customer_id order by created_at desc) as rn
    from orders
) where rn = 1;
```

### Cost management
```sql
-- Estimate bytes before running
-- Add LIMIT 0 or use dry run API

-- Set per-query limit (prevents runaway queries)
-- In client: set maximumBytesBilled = 10000000000  -- 10GB

-- Use cached results (identical queries are free for 24 hours)
-- Avoid non-deterministic functions in cached queries (CURRENT_DATE, RAND)

-- Approximate functions are much cheaper
select approx_count_distinct(user_id) from events  -- vs COUNT(DISTINCT) which is very expensive
```

## dbt Configuration
```yaml
# profiles.yml
my_project:
  outputs:
    prod:
      type: bigquery
      method: service-account
      project: "{{ env_var('GCP_PROJECT') }}"
      keyfile: "{{ env_var('GOOGLE_APPLICATION_CREDENTIALS') }}"
      dataset: prod
      threads: 16
      timeout_seconds: 600
      location: US
      job_execution_timeout_seconds: 600
      job_retries: 3
```

## IAM Roles
```
roles/bigquery.dataViewer    — read tables (BI tools, analysts)
roles/bigquery.dataEditor    — read + write tables (dbt transformer)
roles/bigquery.jobUser       — run queries (required for all users)
roles/bigquery.admin         — full control (avoid; use editor + jobUser)
```

## Performance Tips
- Always partition large tables (> 1GB) on a date column
- Cluster by the next most common filter column after partition
- Use `_PARTITIONTIME` if no good date column exists
- Enable `require_partition_filter: True` to prevent full scans
- BigQuery auto-caches results for 24 hours — identical queries are free
- Use INFORMATION_SCHEMA.JOBS to find expensive queries
