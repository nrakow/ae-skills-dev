---
name: ingestion-strategy
description: "Design and implement a data ingestion strategy for moving data from sources into the warehouse using tools like Fivetran, Airbyte, or custom pipelines. Use when selecting an ingestion tool, setting up a new connector, or evaluating ingestion approaches. Triggers: 'ingest data', 'data ingestion', 'load data', 'Fivetran', 'Airbyte', 'connector setup', 'ELT pipeline', 'data loading', 'source connector'."
triggers:
  - "ingest data"
  - "data ingestion"
  - "load data"
  - "Fivetran"
  - "Airbyte"
  - "connector setup"
  - "ELT pipeline"
reads_first:
  - data-stack-context
cli_tools:
  - source-freshness.js
produces:
  - "ingestion tool configuration"
  - "dbt sources.yml"
validates_with:
  - "dbt source freshness"
  - "node tools/clis/source-freshness.js --results target/sources.json"
---

# Ingestion Strategy

I'll help you choose the right ingestion tool and configure it correctly for your data sources and warehouse.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: warehouse type, current ingestion tools, budget constraints.

## Before You Start

- Run `node tools/clis/source-freshness.js` to check current source freshness status before adding new sources.
- Read the relevant integration guide in `tools/integrations/` for your tool (e.g., `fivetran.md` or `airbyte.md`).
- Check `models/staging/` to see if a `sources.yml` already exists for the target source — avoid duplicating source definitions.
- Confirm the warehouse destination credentials and schema naming convention before configuring a new connector.

## ELT vs ETL

**Modern analytics engineering uses ELT** (Extract-Load-Transform):

```
ETL (old): Source → Transform → Load to warehouse
ELT (new): Source → Load raw → Transform in warehouse with dbt
```

**Why ELT:**
- Warehouse compute is cheap and powerful
- Raw data preserved for re-transformation
- No transformation bottleneck before loading
- dbt handles transformation with version control and testing

---

## Tool Selection Matrix

| Scenario | Best choice |
|----------|------------|
| Standard SaaS connectors (Salesforce, Stripe, Shopify) | Fivetran or Airbyte Cloud |
| Budget-constrained; standard sources | Airbyte (OSS, self-hosted) |
| Need custom connector | Airbyte (custom connector SDK) or custom Python |
| CDC (Change Data Capture) from Postgres/MySQL | Fivetran, Airbyte, Debezium |
| S3/GCS files → warehouse | dbt seeds (small), or native COPY (large) |
| Real-time streaming | Kafka + Confluent, or warehouse-native streaming |
| Internal databases | Airbyte or custom Python + dbt |

---

## Fivetran

### Configuration Best Practices

```yaml
# Fivetran connector settings (via UI or Terraform)
# terraform/fivetran.tf
resource "fivetran_connector" "salesforce" {
  group_id = var.fivetran_group_id
  service   = "salesforce"

  config {
    schema          = "salesforce"
    username        = var.salesforce_username
    password        = var.salesforce_password
    security_token  = var.salesforce_security_token
    is_sandbox      = false
  }

  schedule_type = "AUTO"  # or MANUAL, SCHEDULE

  # Sync frequency
  sync_frequency  = 360   # Every 6 hours (in minutes)
  paused          = false
  pause_after_trial = false
}
```

### Schema Management

```sql
-- Fivetran adds metadata columns to every table:
-- _fivetran_synced: UTC timestamp of last sync
-- _fivetran_deleted: boolean, soft-delete flag
-- _fivetran_id: row-level identifier

-- In your staging model:
select * from {{ source('salesforce', 'account') }}
where not coalesce(_fivetran_deleted, false)  -- filter deleted records
```

### Sync Scheduling Guidelines

| Source type | Recommended frequency |
|------------|----------------------|
| CRM (Salesforce, HubSpot) | Every 6 hours |
| Payments (Stripe) | Every 1 hour |
| Ads (Google Ads, Facebook) | Every 6-24 hours |
| Product DB | Every 15-60 minutes |
| Support (Zendesk) | Every 6 hours |

---

## Airbyte

### Self-Hosted Setup (Docker)

```yaml
# docker-compose.yml (Airbyte)
version: "3.7"
services:
  airbyte-server:
    image: airbyte/server:latest
    ports:
      - "8001:8001"
    environment:
      - DATABASE_URL=postgresql://airbyte:password@db:5432/airbyte
      - LOG_LEVEL=INFO

  # Add Airbyte components: webapp, worker, scheduler, db
  # Full docker-compose: https://docs.airbyte.com/quickstart
```

### Airbyte API / Python SDK

```python
# Configure a connection programmatically
import airbyte as ab

client = ab.get_client(api_key="your-api-key")

# Create source
source = client.sources.create(
    name="Salesforce Production",
    definition_id="b117307c-14b6-4b80-bafa-ccba22d14c6e",  # Salesforce connector
    workspace_id="your-workspace-id",
    config={
        "client_id": "...",
        "client_secret": "...",
        "refresh_token": "...",
        "start_date": "2022-01-01T00:00:00Z",
        "stream_slice_step": "P30D"
    }
)

# Create destination (Snowflake)
destination = client.destinations.create(
    name="Snowflake Analytics",
    definition_id="424892c4-daac-4491-b35d-c6688ba547ba",
    workspace_id="your-workspace-id",
    config={
        "host": "xxx.snowflakecomputing.com",
        "database": "RAW",
        "schema": "airbyte",
        "username": "airbyte_user",
        "password": "...",
        "warehouse": "LOADING",
        "role": "LOADER"
    }
)
```

### Airbyte Column Naming

```sql
-- Airbyte uses slightly different metadata columns:
-- _airbyte_raw_id: unique row identifier
-- _airbyte_extracted_at: when data was extracted
-- _airbyte_meta: JSON metadata including changes

-- Deduplication pattern for Airbyte:
with source as (
    select *,
        row_number() over (
            partition by id
            order by _airbyte_extracted_at desc
        ) as rn
    from {{ source('salesforce', 'account') }}
)
select * from source where rn = 1
```

---

## Custom Ingestion (Python)

When no connector exists:

```python
# custom_ingestion/salesforce_custom.py
# Pattern: extract → stage to S3/GCS → COPY INTO warehouse

import boto3
import pandas as pd
import snowflake.connector
from datetime import datetime, timezone

def extract_from_api(since: datetime) -> pd.DataFrame:
    """Extract records updated since last run"""
    response = requests.get(
        "https://api.example.com/records",
        params={"updated_after": since.isoformat()},
        headers={"Authorization": f"Bearer {API_KEY}"},
    )
    return pd.DataFrame(response.json()["records"])

def load_to_stage(df: pd.DataFrame, s3_bucket: str, key: str):
    """Write to S3 as Parquet for efficient COPY INTO"""
    s3 = boto3.client("s3")
    buffer = df.to_parquet(index=False)
    s3.put_object(Bucket=s3_bucket, Key=key, Body=buffer)

def copy_into_snowflake(s3_path: str, table: str):
    """COPY INTO Snowflake from S3 stage"""
    conn = snowflake.connector.connect(
        account=SNOWFLAKE_ACCOUNT,
        user=SNOWFLAKE_USER,
        private_key=PRIVATE_KEY,
        database="RAW",
        schema="custom",
        warehouse="LOADING"
    )
    conn.execute(f"""
        COPY INTO {table}
        FROM @my_s3_stage/{s3_path}
        FILE_FORMAT = (TYPE = 'PARQUET')
        MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE
        ON_ERROR = ABORT_STATEMENT
    """)

def run_ingestion(watermark_table: str):
    """Main ingestion function"""
    # Read high-watermark from warehouse
    last_run = get_high_watermark(watermark_table)

    df = extract_from_api(since=last_run)
    if df.empty:
        return

    # Add ingestion metadata
    df["_ingested_at"] = datetime.now(timezone.utc)
    df["_source"] = "example_api"

    # Stage and load
    s3_key = f"raw/example/{datetime.utcnow().isoformat()}.parquet"
    load_to_stage(df, S3_BUCKET, s3_key)
    copy_into_snowflake(s3_key, "raw.custom.example_records")

    # Update high-watermark
    update_high_watermark(watermark_table, df["updated_at"].max())
```

---

## Warehouse Loading Best Practices

### Snowflake
```sql
-- COPY INTO with error handling
COPY INTO raw.salesforce.account
FROM @my_stage/salesforce/account/
FILE_FORMAT = (TYPE = 'JSON' STRIP_OUTER_ARRAY = TRUE)
ON_ERROR = 'SKIP_FILE'  -- or ABORT_STATEMENT for strictness
PURGE = FALSE           -- keep staged files for debugging
FORCE = FALSE;          -- don't reload already-loaded files
```

### BigQuery
```sql
-- Load job via bq CLI
bq load \
  --source_format=PARQUET \
  --replace \
  raw_dataset.salesforce_account \
  gs://my-bucket/salesforce/account/*.parquet

-- Or via Python: bigquery.LoadJobConfig
```

---

## Monitoring Ingestion

```yaml
# dbt source freshness (most important monitor)
sources:
  - name: salesforce
    loaded_at_field: _fivetran_synced
    freshness:
      warn_after: {count: 24, period: hour}
      error_after: {count: 48, period: hour}
```

```python
# Custom: check row count growth
# Alert if today's count is 0 (ingestion stopped)
SELECT
    date_trunc('day', _fivetran_synced) as sync_date,
    count(*) as rows_synced
FROM raw.salesforce.account
WHERE _fivetran_synced >= current_date - 7
GROUP BY 1
ORDER BY 1 DESC
```

## Verify Your Work

- After configuring ingestion, run `dbt source freshness` to confirm the source is reporting as fresh.
- Verify `loaded_at_field` is populated with recent timestamps by querying the raw table directly.
- Run `node tools/clis/source-freshness.js` again after the first connector sync to confirm the source appears as fresh.

## If Something Goes Wrong

- **Source shows as stale**: Check the connector sync schedule in Fivetran/Airbyte; verify `loaded_at_field` in `sources.yml` matches the actual column name populated by the connector (e.g., `_fivetran_synced` vs `_airbyte_extracted_at`).
- **Schema drift**: Enable schema change alerts in Fivetran or Airbyte — these notify you when upstream columns are added, removed, or renamed.
- **Incremental load missing rows**: Check the connector's cursor field configuration — the cursor must point to a column that monotonically increases with new records (e.g., `updated_at`, not `created_at`).
