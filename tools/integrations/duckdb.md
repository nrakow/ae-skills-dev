# DuckDB Integration Guide

## Key Patterns

### Direct file queries (no ingestion needed)
```sql
-- Query CSV directly
SELECT * FROM read_csv_auto('data/orders.csv');

-- Query Parquet
SELECT * FROM read_parquet('s3://my-bucket/events/*.parquet');
SELECT * FROM read_parquet('data/**/*.parquet', union_by_name=true);

-- Query JSON
SELECT * FROM read_json_auto('data/events.jsonl');

-- Multiple files with glob
SELECT filename, * FROM read_csv('data/*.csv', filename=true);
```

### ATTACH (connect to other databases)
```sql
-- Attach SQLite
ATTACH 'local.db' AS sqlite_db (TYPE sqlite);
SELECT * FROM sqlite_db.orders;

-- Attach another DuckDB
ATTACH 'analytics.duckdb' AS analytics;

-- Attach S3 (via httpfs extension)
INSTALL httpfs;
LOAD httpfs;
SET s3_region='us-east-1';
SET s3_access_key_id='...';
SET s3_secret_access_key='...';
SELECT * FROM 's3://my-bucket/data.parquet';
```

### Efficient aggregations
```sql
-- DuckDB is columnar — aggregations are very fast
-- No index needed for analytics queries

-- Approximate COUNT DISTINCT (HyperLogLog)
SELECT approx_count_distinct(user_id) FROM events;

-- String aggregation
SELECT customer_id, string_agg(product_name, ', ') FROM orders GROUP BY 1;

-- Array aggregation
SELECT customer_id, array_agg(product_id ORDER BY ordered_at) FROM orders GROUP BY 1;
```

### Python integration
```python
import duckdb

# In-memory (for scripts, notebooks, dbt with duckdb adapter)
conn = duckdb.connect()

# File-backed (persistent)
conn = duckdb.connect('analytics.duckdb')

# Query Pandas DataFrame directly
import pandas as pd
df = pd.read_csv('orders.csv')
result = conn.execute("SELECT customer_id, sum(amount) FROM df GROUP BY 1").fetchdf()

# Query Polars (zero-copy)
import polars as pl
df = pl.read_parquet('events.parquet')
result = conn.execute("SELECT * FROM df WHERE event_type = 'purchase'").pl()
```

## dbt Configuration
```yaml
# profiles.yml
my_project:
  outputs:
    dev:
      type: duckdb
      path: 'analytics.duckdb'   # file path or ':memory:'
      threads: 4
      extensions:
        - httpfs
        - json
```

## MotherDuck (DuckDB Cloud)
```python
import duckdb

# Connect to MotherDuck
conn = duckdb.connect('md:my_database?motherduck_token=...')

# Hybrid execution: local + cloud
conn.execute("SET motherduck_enabled = true")
SELECT * FROM my_database.fct_orders LIMIT 100;
```

## When to Use DuckDB
- **Local development**: analysts querying CSV/Parquet without a warehouse
- **dbt dev profile**: fast local testing without cloud warehouse costs
- **Python data pipelines**: embedded analytics engine
- **Data exploration**: query files directly before deciding on ingestion
- **MotherDuck**: small-to-medium warehousing without Snowflake/BigQuery overhead

## Performance Tips
- DuckDB uses vectorized execution — no indexes needed
- Parquet files are ideal (columnar, compressed, push-down filtering)
- Use `PRAGMA threads=N` to control parallelism
- For very large files: use `read_parquet` with `hive_partitioning=true`
