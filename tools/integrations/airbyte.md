# Airbyte Integration Guide

## Metadata Columns

Airbyte adds these to every synced table:

| Column | Type | Description |
|--------|------|-------------|
| `_airbyte_raw_id` | VARCHAR | Unique row identifier |
| `_airbyte_extracted_at` | TIMESTAMP | When Airbyte extracted this row |
| `_airbyte_meta` | VARIANT/JSON | Metadata including changes and errors |

### Deduplication pattern (for streams without CDC)
```sql
with source as (
    select *,
        row_number() over (
            partition by id                          -- natural key
            order by _airbyte_extracted_at desc      -- latest extraction
        ) as rn
    from {{ source('salesforce', 'account') }}
),
renamed as (
    select * from source where rn = 1
)
```

### Source freshness
```yaml
sources:
  - name: salesforce
    loaded_at_field: _airbyte_extracted_at
    freshness:
      warn_after: {count: 24, period: hour}
      error_after: {count: 48, period: hour}
```

## Sync Modes

| Mode | What it does | Use when |
|------|-------------|---------|
| Full Refresh - Overwrite | Replace all data on each sync | Small tables, no history needed |
| Full Refresh - Append | Append every sync (no dedup) | Audit trail of all syncs |
| Incremental - Append | Append new records only | Large tables, append-only source |
| Incremental - Deduped History | Upsert with history | Mutable source, want current state |

## Python SDK (airbyte-lib)

```python
import airbyte as ab

# Create and run a local connection (no Airbyte server needed)
source = ab.get_source(
    "source-salesforce",
    config={
        "client_id": "...",
        "client_secret": "...",
        "refresh_token": "...",
        "start_date": "2022-01-01T00:00:00Z"
    }
)

# Read to cache (DuckDB by default)
cache = ab.get_default_cache()
result = source.read(cache=cache, streams=["Account", "Opportunity"])

# Read to Pandas
account_df = result["Account"].to_pandas()

# Or: read directly to a destination
destination = ab.get_destination(
    "destination-snowflake",
    config={
        "host": "xxx.snowflakecomputing.com",
        "database": "RAW",
        "schema": "airbyte",
        "username": "airbyte_user",
        "password": "..."
    }
)
source.read(destination=destination)
```

## Custom Connector (Python CDK)

```python
# For sources not in Airbyte's catalog
from airbyte_cdk.sources import AbstractSource
from airbyte_cdk.models import SyncMode

class CustomApiSource(AbstractSource):
    def check_connection(self, logger, config):
        try:
            response = requests.get(config["api_url"], headers={"Authorization": f"Bearer {config['api_key']}"})
            return response.status_code == 200, None
        except Exception as e:
            return False, str(e)

    def streams(self, config):
        return [CustomStream(config)]

class CustomStream(HttpStream):
    primary_key = "id"
    url_base = "https://api.example.com/"

    def path(self, **kwargs):
        return "records"

    def parse_response(self, response, **kwargs):
        yield from response.json()["data"]
```

## Monitoring

```bash
# Airbyte UI: localhost:8000 (self-hosted)
# Check connection status, sync history, logs

# Via API
curl -X GET "https://api.airbyte.com/v1/connections/{connectionId}" \
  -H "Authorization: Bearer $AIRBYTE_API_KEY"

# Trigger manual sync
curl -X POST "https://api.airbyte.com/v1/jobs" \
  -H "Authorization: Bearer $AIRBYTE_API_KEY" \
  -d '{"connectionId": "xxx", "jobType": "sync"}'
```
