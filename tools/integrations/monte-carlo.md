# Monte Carlo Integration Guide

## Overview
Monte Carlo is an enterprise data observability platform providing end-to-end data reliability monitoring across pipelines, warehouses, BI tools, and ETL. It uses ML-based anomaly detection and full data lineage to detect and triage data incidents.

## Architecture

```
Data Sources → Monte Carlo Collector → Monte Carlo Platform
     │                                        │
  Warehouse                           ┌───────┴────────┐
  dbt Cloud                           │  Monitors       │
  Airflow/Dagster                     │  Lineage        │
  Looker/Tableau                      │  Incidents      │
  Fivetran/Airbyte                    │  Notifications  │
                                      └────────────────-┘
```

## Connection Setup

### Monte Carlo → Snowflake

```sql
-- Create Monte Carlo service account
CREATE USER MONTE_CARLO_USER
  PASSWORD = '****'
  DEFAULT_ROLE = MONTE_CARLO_ROLE;

CREATE ROLE MONTE_CARLO_ROLE;
GRANT ROLE MONTE_CARLO_ROLE TO USER MONTE_CARLO_USER;

-- Permissions needed
GRANT USAGE ON WAREHOUSE ANALYTICS_WH TO ROLE MONTE_CARLO_ROLE;
GRANT MONITOR ON WAREHOUSE ANALYTICS_WH TO ROLE MONTE_CARLO_ROLE;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE MONTE_CARLO_ROLE;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE MONTE_CARLO_ROLE;
GRANT SELECT ON ALL TABLES IN DATABASE ANALYTICS TO ROLE MONTE_CARLO_ROLE;
GRANT SELECT ON FUTURE TABLES IN DATABASE ANALYTICS TO ROLE MONTE_CARLO_ROLE;
-- For query history access:
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE MONTE_CARLO_ROLE;
```

### Monte Carlo → BigQuery
```bash
# Service account permissions needed:
# - roles/bigquery.dataViewer
# - roles/bigquery.jobUser
# - roles/bigquery.metadataViewer
# - roles/monitoring.viewer (for job metrics)
```

## Monte Carlo CLI

```bash
pip install montecarlodata

# Authenticate
montecarlo configure --mcd-id <id> --mcd-token <token>

# Test connection
montecarlo validate snowflake-connection \
  --account myorg.us-east-1 \
  --username MONTE_CARLO_USER \
  --password "****" \
  --database ANALYTICS

# List monitored tables
montecarlo monitors list

# Trigger manual metadata collection
montecarlo metadata trigger-collection
```

## dbt Integration

Monte Carlo pulls dbt artifacts to enrich lineage and test results:

### dbt Cloud Integration
```python
# In Monte Carlo UI: Integrations > dbt Cloud
# Provide:
# - dbt Cloud API token
# - Account ID
# - Project ID(s)
# - Job ID(s) to pull artifacts from
```

### dbt Core Integration (push artifacts)
```bash
# After dbt run/test, push artifacts to Monte Carlo
pip install montecarlodata

montecarlo integrations upload-dbt-manifest \
  --manifest target/manifest.json \
  --project my_project

montecarlo integrations upload-dbt-run-results \
  --run-results target/run_results.json \
  --project my_project
```

GitHub Actions CI workflow:
```yaml
- name: Run dbt
  run: dbt build --target prod

- name: Push artifacts to Monte Carlo
  run: |
    pip install montecarlodata
    montecarlo integrations upload-dbt-manifest \
      --manifest target/manifest.json \
      --project ${{ env.DBT_PROJECT_NAME }}
    montecarlo integrations upload-dbt-run-results \
      --run-results target/run_results.json \
      --project ${{ env.DBT_PROJECT_NAME }}
  env:
    MCD_DEFAULT_API_ID: ${{ secrets.MCD_API_ID }}
    MCD_DEFAULT_API_TOKEN: ${{ secrets.MCD_API_TOKEN }}
```

## Monitors

Monte Carlo monitors are configured in the UI or via API/YAML:

### Monitor Types

| Monitor | What it detects |
|---|---|
| Freshness | Table not updated within SLA window |
| Volume | Row count anomalies (spikes, drops, zero rows) |
| Field Health | Null rate, uniqueness, distribution changes |
| Schema Changes | Column additions, removals, type changes |
| Custom SQL | User-defined business logic checks |
| Dimension Tracking | Breakdowns by dimension values |

### Custom SQL Monitor

```sql
-- Revenue reconciliation monitor
SELECT
    ABS(
        SUM(CASE WHEN source = 'stripe' THEN amount END) -
        SUM(CASE WHEN source = 'warehouse' THEN revenue END)
    ) / NULLIF(SUM(CASE WHEN source = 'stripe' THEN amount END), 0)
FROM (
    SELECT 'stripe' AS source, amount, NULL AS revenue
    FROM raw.stripe_payments
    WHERE DATE(created) = CURRENT_DATE - 1
    UNION ALL
    SELECT 'warehouse', NULL, revenue
    FROM analytics.fct_orders
    WHERE DATE(created_at) = CURRENT_DATE - 1
) t
HAVING ABS(...) > 0.01  -- alert if > 1% discrepancy
```

### Monitor Configuration via API

```python
import requests

MC_API = "https://api.getmontecarlo.com/graphql"
HEADERS = {"x-mcd-id": MCD_ID, "x-mcd-token": MCD_TOKEN}

# Create a freshness monitor
query = """
mutation CreateFreshnessMonitor($input: CreateOrUpdateFreshnessMonitorInput!) {
  createOrUpdateFreshnessMonitor(input: $input) {
    monitor {
      uuid
      name
    }
  }
}
"""

variables = {
    "input": {
        "fullTableId": "my-project:analytics.fct_orders",
        "scheduleConfig": {
            "scheduleType": "LOOSE",
            "intervalMinutes": 60
        },
        "alertCondition": {
            "comparator": "GT",
            "threshold": 120  # alert if > 120 minutes stale
        }
    }
}

response = requests.post(MC_API, json={"query": query, "variables": variables},
    headers=HEADERS)
```

## Incidents and Notifications

### Slack Notifications

Monte Carlo sends rich Slack alerts with:
- Table name and affected columns
- Incident timeline chart
- Lineage impact (upstream/downstream)
- Links to investigate in Monte Carlo UI

Configure in UI: Settings > Notifications > Slack

### PagerDuty / Webhook Integration

```python
# Webhook receiver example
from flask import Flask, request

app = Flask(__name__)

@app.route("/monte-carlo-webhook", methods=["POST"])
def handle_incident():
    data = request.json
    incident_type = data["type"]  # "anomaly_detected", "incident_resolved"
    table = data["full_table_id"]
    severity = data["priority"]   # "P1", "P2", "P3"

    if incident_type == "anomaly_detected" and severity == "P1":
        trigger_pagerduty_alert(table, data["description"])

    return {"status": "ok"}, 200
```

## Lineage

Monte Carlo auto-builds lineage by:
1. Parsing query logs from the warehouse (Snowflake `QUERY_HISTORY`, BigQuery `INFORMATION_SCHEMA.JOBS`)
2. Reading dbt `manifest.json` for model-to-model lineage
3. Connecting BI tool metadata (Looker explores, Tableau workbooks)

```
Raw Tables → Staging → Intermediate → Marts → Looker Explores → Dashboards
    ↑               ↑                    ↑
 Fivetran         dbt                 Tableau
```

Lineage features:
- **Impact analysis**: "Which dashboards are affected if fct_orders breaks?"
- **Root cause**: "This dashboard broke — trace back to the failing source"
- **Column lineage**: Field-level lineage (where does `revenue` come from?)

## Cost and Incident SLA Reporting

```sql
-- Approximate: query Monte Carlo's own tables if using self-hosted
-- Or use the Monte Carlo API for incident reporting

import requests

# Get all incidents in last 30 days
query = """
query {
  getIncidents(filters: {
    startTime: "2024-01-01T00:00:00Z"
    endTime: "2024-01-31T23:59:59Z"
  }) {
    incidents {
      id
      status
      severity
      affectedTables { fullTableId }
      createdTime
      resolvedTime
    }
  }
}
"""
```
