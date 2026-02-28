# Databricks Integration Guide

## Delta Lake Patterns

### Table creation
```sql
-- Create managed Delta table
CREATE TABLE IF NOT EXISTS analytics.marts.fct_orders (
    order_id STRING NOT NULL,
    customer_id STRING,
    ordered_at TIMESTAMP,
    net_revenue_usd DECIMAL(12,2)
)
USING DELTA
PARTITIONED BY (date(ordered_at))
TBLPROPERTIES (
    'delta.autoOptimize.optimizeWrite' = 'true',
    'delta.autoOptimize.autoCompact' = 'true'
);
```

### OPTIMIZE and ZORDER
```sql
-- Compact small files (run after bulk writes)
OPTIMIZE analytics.marts.fct_events;

-- ZORDER collocates related data (improves filter performance)
OPTIMIZE analytics.marts.fct_events
ZORDER BY (user_id, event_type);

-- Schedule OPTIMIZE via Databricks Jobs (daily or after large writes)
```

### VACUUM (clean old snapshots)
```sql
-- Default: 7-day retention
VACUUM analytics.marts.fct_events RETAIN 168 HOURS;

-- Check what would be deleted (dry run)
VACUUM analytics.marts.fct_events RETAIN 168 HOURS DRY RUN;
```

### Time travel
```sql
-- Query historical version
SELECT * FROM analytics.marts.fct_events VERSION AS OF 5;
SELECT * FROM analytics.marts.fct_events TIMESTAMP AS OF '2024-01-15';

-- Restore to previous version
RESTORE TABLE analytics.marts.fct_events TO VERSION AS OF 5;
```

### Unity Catalog
```sql
-- Three-level namespace: catalog.schema.table
SELECT * FROM main.analytics.fct_orders;

-- Grant permissions
GRANT SELECT ON TABLE main.analytics.fct_orders TO GROUP analysts;
GRANT MODIFY ON SCHEMA main.analytics TO USER dbt_service_account@company.com;

-- Create catalog and schema
CREATE CATALOG IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS analytics.marts;
```

### Bloom filters
```sql
-- Create bloom filter for non-partition filter columns
CREATE BLOOMFILTER INDEX ON TABLE fct_events
FOR COLUMNS (user_id OPTIONS (fpp = 0.1));
```

## dbt Configuration
```yaml
# profiles.yml
my_project:
  outputs:
    prod:
      type: databricks
      catalog: analytics          # Unity Catalog catalog
      schema: marts
      host: "{{ env_var('DATABRICKS_HOST') }}"
      http_path: "{{ env_var('DATABRICKS_HTTP_PATH') }}"
      token: "{{ env_var('DATABRICKS_TOKEN') }}"
      threads: 8
```

```sql
-- dbt model config
{{ config(
    materialized='incremental',
    incremental_strategy='merge',
    unique_key='event_id',
    file_format='delta',
    partition_by=['event_date'],
    post_hook="OPTIMIZE {{ this }} ZORDER BY (user_id, event_type)"
) }}
```

## Key Differences from Other Warehouses
- No QUALIFY — use subquery with WHERE rn = 1
- Delta format required for MERGE (not Parquet tables)
- OPTIMIZE needed to maintain performance after writes
- Unity Catalog uses `catalog.schema.table` (3-level namespace)
- Photon engine: opt in per cluster; accelerates SQL queries
- Structured Streaming: use for real-time ingestion to Delta tables
