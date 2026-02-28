# dbt Cloud Integration Guide

## Jobs Configuration

### Production Job
```yaml
# dbt Cloud job settings (via UI or API)
job_name: "Production - Nightly"
commands:
  - dbt deps
  - dbt source freshness
  - dbt build --select state:modified+ --defer --state ./last_successful_run
schedule:
  cron: "0 4 * * *"    # 4am UTC
environment: Production
generate_docs: true
run_timeout_seconds: 3600
```

### CI Job (Slim CI)
```yaml
job_name: "CI - Pull Request"
commands:
  - dbt deps
  - dbt build --select state:modified+ --defer --state ./target
triggers:
  pull_request: true     # Triggers on every PR
environment: CI          # Uses CI credentials
```

## Environments

```yaml
# Production environment
name: Production
dbt_version: "1.8.x"
custom_env_variables:
  DBT_TARGET: prod
credential: production_snowflake_creds

# CI environment
name: CI
dbt_version: "1.8.x"
custom_env_variables:
  DBT_TARGET: ci
  DBT_SCHEMA_OVERRIDE: "ci_{{pr_number}}"
credential: ci_snowflake_creds
```

## dbt Cloud API

```python
# Trigger a job via API
import requests

API_KEY = "your-api-key"
ACCOUNT_ID = "12345"
JOB_ID = "67890"

response = requests.post(
    f"https://cloud.getdbt.com/api/v2/accounts/{ACCOUNT_ID}/jobs/{JOB_ID}/run/",
    headers={"Authorization": f"Token {API_KEY}"},
    json={"cause": "Triggered by upstream pipeline"}
)
run_id = response.json()["data"]["id"]

# Poll run status
status_response = requests.get(
    f"https://cloud.getdbt.com/api/v2/accounts/{ACCOUNT_ID}/runs/{run_id}/",
    headers={"Authorization": f"Token {API_KEY}"}
)
print(status_response.json()["data"]["status_humanized"])
```

## dbt Semantic Layer

```yaml
# Enable in dbt Cloud (dbt Cloud Developer+ tier)
# Configure via semantic_models + metrics in model YAML

# Query via JDBC endpoint
host: semantic-layer.cloud.getdbt.com
port: 443
database: your_semantic_layer_db
user: service_token

# Or via Python SDK
from dbtsl import SemanticLayerClient

client = SemanticLayerClient(
    environment_id=12345,
    auth_token="your-service-token",
    host="semantic-layer.cloud.getdbt.com"
)

with client.session():
    result = client.query(
        metrics=["revenue", "order_count"],
        group_by=["metric_time__month", "customer_segment"]
    )
```

## Webhooks

```python
# Receive dbt Cloud job completion webhooks
from flask import Flask, request
import hmac, hashlib

app = Flask(__name__)

@app.route('/webhook/dbt-cloud', methods=['POST'])
def handle_dbt_webhook():
    # Verify webhook signature
    secret = "your-webhook-secret"
    signature = request.headers.get('Authorization')
    computed = hmac.new(secret.encode(), request.data, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(f"Bearer {computed}", signature):
        return "Unauthorized", 401

    payload = request.json
    if payload["data"]["runStatus"] == "Success":
        trigger_downstream_pipeline()

    return "OK", 200
```

## Artifacts

dbt Cloud automatically stores:
- `manifest.json` — model metadata, dependencies
- `catalog.json` — warehouse schema info
- `run_results.json` — test and run results
- `sources.json` — source freshness

Download via API for state-based CI:
```bash
curl -H "Authorization: Token $DBT_CLOUD_API_KEY" \
  "https://cloud.getdbt.com/api/v2/accounts/$ACCOUNT_ID/runs/latest/artifacts/manifest.json" \
  -o prod-artifacts/manifest.json
```
