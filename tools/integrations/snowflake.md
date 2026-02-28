# Snowflake Integration Guide

## Key SQL Patterns

### QUALIFY (Snowflake-specific filter on window functions)
```sql
-- Without QUALIFY (verbose)
select * from (
    select *, row_number() over (partition by customer_id order by created_at desc) as rn
    from orders
) where rn = 1;

-- With QUALIFY (clean)
select * from orders
qualify row_number() over (partition by customer_id order by created_at desc) = 1;
```

### FLATTEN (unnest arrays/objects)
```sql
-- Flatten an array column
select
    u.user_id,
    f.value::string as tag
from users u,
lateral flatten(input => u.tags) f;

-- Flatten nested JSON
select
    event_id,
    f.key,
    f.value
from events,
lateral flatten(input => properties) f;
```

### Semi-structured data
```sql
-- Access JSON fields
select
    payload:user_id::string as user_id,
    payload:event_name::string as event_name,
    payload:properties:amount::float as amount
from raw_events;

-- Filter on JSON field
where payload:event_type::string = 'purchase'
```

### Date/Time functions
```sql
dateadd(day, -7, current_date)
datediff('day', start_date, end_date)
date_trunc('month', created_at)
last_day(current_date, 'month')
convert_timezone('America/New_York', 'UTC', created_at)
```

### Warehouse management
```sql
-- Create warehouse with auto-suspend
create warehouse transforming
    warehouse_size = 'medium'
    auto_suspend = 60        -- seconds
    auto_resume = true
    initially_suspended = true;

-- Scale up for heavy workload
alter warehouse transforming set warehouse_size = 'large';
alter warehouse transforming set warehouse_size = 'medium';  -- scale back down
```

### Clustering
```sql
-- Check if clustering helps
select system$clustering_information('fct_events', '(event_date)');

-- Add cluster key
alter table fct_events cluster by (event_date::date, user_id);

-- Enable automatic clustering (tables > 500GB)
alter table fct_events enable automatic clustering;
```

### COPY INTO (bulk load)
```sql
copy into raw.salesforce.account
from @my_s3_stage/salesforce/account/
file_format = (type = 'parquet')
match_by_column_name = case_insensitive
on_error = 'abort_statement'
purge = false;
```

### Resource monitors
```sql
create resource monitor prod_monitor
    with credit_quota = 200
    triggers
        on 75 percent do notify
        on 100 percent do suspend
        on 110 percent do suspend_immediate;
```

## dbt Configuration
```yaml
# profiles.yml
my_project:
  outputs:
    prod:
      type: snowflake
      account: "{{ env_var('SNOWFLAKE_ACCOUNT') }}"
      user: "{{ env_var('SNOWFLAKE_USER') }}"
      private_key: "{{ env_var('SNOWFLAKE_PRIVATE_KEY') }}"
      role: TRANSFORMER
      database: ANALYTICS
      warehouse: TRANSFORMING
      schema: PROD
      threads: 16
```

```sql
-- dbt model config
{{ config(
    materialized='incremental',
    unique_key='event_id',
    incremental_strategy='merge',
    cluster_by=['event_date'],
    on_schema_change='append_new_columns'
) }}
```

## Cost Optimization
- Use `WAREHOUSE_SIZE=XSMALL` for BI queries (auto-suspend 60s)
- Use `WAREHOUSE_SIZE=LARGE` for dbt full rebuilds (suspend immediately after)
- Enable result cache: queries return cached results for 24 hours (free)
- Use clustering on date column for time-series tables > 100GB
- Use `COPY INTO` for bulk loads (not INSERT SELECT)
