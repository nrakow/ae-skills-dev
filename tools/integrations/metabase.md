# Metabase Integration Guide

## Overview
Metabase is an open-source BI tool emphasizing self-service analytics. It connects directly to your warehouse and lets non-technical users explore data with a GUI query builder (Questions), while supporting SQL for advanced users.

## Connection Setup

### Metabase → Snowflake
```json
{
  "engine": "snowflake",
  "name": "Production Analytics",
  "details": {
    "account": "myorg.us-east-1",
    "user": "METABASE_USER",
    "password": "****",
    "warehouse": "METABASE_WH",
    "db": "ANALYTICS",
    "role": "METABASE_ROLE",
    "schema-filters-type": "inclusion",
    "schema-filters-patterns": "marts,reporting"
  }
}
```

### Metabase → BigQuery
```json
{
  "engine": "bigquery",
  "details": {
    "project-id": "my-gcp-project",
    "dataset-filters-type": "inclusion",
    "dataset-filters-patterns": "marts,reporting",
    "service-account-json": "{...}"
  }
}
```

### Metabase → Databricks
```json
{
  "engine": "databricks",
  "details": {
    "host": "<workspace>.azuredatabricks.net",
    "http-path": "/sql/1.0/warehouses/<id>",
    "password": "dapi...",
    "catalog": "main",
    "schema": "marts"
  }
}
```

## Embedding dbt Metadata in Metabase

Use dbt-metabase to sync column descriptions, metrics, and field types:

```bash
pip install dbt-metabase

dbt-metabase models \
  --dbt-manifest-path target/manifest.json \
  --dbt-database analytics \
  --metabase-host http://localhost:3000 \
  --metabase-user admin@company.com \
  --metabase-password secret \
  --metabase-database "Production Analytics" \
  --dbt-schema marts
```

dbt YAML that drives Metabase field metadata:

```yaml
# models/marts/fct_orders.yml
models:
  - name: fct_orders
    description: "One row per order. Source of truth for order-level reporting."
    meta:
      metabase.points_of_interest: "Use for revenue and order volume metrics"
      metabase.caveats: "Excludes test orders (is_test_order = false)"
    columns:
      - name: order_id
        description: "Unique order identifier"
        tests: [unique, not_null]
      - name: status
        description: "Order status: pending, processing, shipped, delivered, cancelled"
        meta:
          metabase.semantic_type: "type/Category"
      - name: revenue
        description: "Order revenue in USD"
        meta:
          metabase.semantic_type: "type/Currency"
          metabase.currency: "USD"
      - name: customer_email
        meta:
          metabase.semantic_type: "type/Email"
          metabase.visibility_type: "sensitive"
      - name: created_at
        meta:
          metabase.semantic_type: "type/CreationTimestamp"
```

## Table and Field Metadata

Key semantic types for auto-detection of field behavior:

| Semantic Type | Metabase behavior |
|---|---|
| `type/PK` | Primary key — used for drill-through |
| `type/FK` | Foreign key — enables automatic joins |
| `type/Name` | Shown in entity previews |
| `type/Currency` | Formatted as money |
| `type/Email` | Clickable email link |
| `type/URL` | Clickable hyperlink |
| `type/Category` | Shown as filter dropdown |
| `type/CreationTimestamp` | Default date filter |
| `type/Latitude` / `type/Longitude` | Enables map charts |

## Metabase API (for automation)

```python
import requests

BASE_URL = "http://localhost:3000/api"

# Authenticate
session = requests.post(f"{BASE_URL}/session", json={
    "username": "admin@company.com",
    "password": "secret"
}).json()
TOKEN = session["id"]
HEADERS = {"X-Metabase-Session": TOKEN}

# List all databases
databases = requests.get(f"{BASE_URL}/database", headers=HEADERS).json()

# Trigger metadata sync for a database
requests.post(f"{BASE_URL}/database/1/sync_schema", headers=HEADERS)

# Run a card (saved question) and get results
result = requests.post(f"{BASE_URL}/card/42/query", headers=HEADERS).json()
rows = result["data"]["rows"]
cols = [col["name"] for col in result["data"]["cols"]]

# Create a collection
collection = requests.post(f"{BASE_URL}/collection", headers=HEADERS, json={
    "name": "Revenue Dashboards",
    "color": "#509EE3",
    "parent_id": None
}).json()

# Export a dashboard as PDF (Enterprise)
pdf = requests.post(f"{BASE_URL}/dashboard/5/export", headers=HEADERS,
    params={"format": "pdf"})
```

## Metabase Questions (SQL)

```sql
-- Parameterized question using Metabase variables
SELECT
    DATE_TRUNC('month', created_at) AS month,
    status,
    COUNT(*) AS order_count,
    SUM(revenue) AS total_revenue
FROM analytics.fct_orders
WHERE
    created_at >= {{start_date}}
    AND created_at < {{end_date}}
    [[AND status = {{status}}]]
GROUP BY 1, 2
ORDER BY 1
```

Variables in Metabase SQL:
- `{{variable}}` — required text/number/date variable
- `[[AND field = {{variable}}]]` — optional clause (omitted if variable not set)
- `{{#snippet: name}}` — SQL snippet reference

## Permissions Model

```
Groups (Admin > People > Groups):
├── All Users (default)
│   └── Data: No self-service (restricted)
├── Analysts
│   ├── Data: Unrestricted (can write SQL)
│   └── Collections: Curated Content (view/edit)
├── Business Users
│   ├── Data: Granular > schema-level permissions
│   └── Collections: Company Dashboards (view only)
└── Finance
    ├── Data: finance schema only
    └── Row-level: revenue_view (filtered by region)
```

Table-level permissions in Metabase:
- **Unrestricted**: Full access, can write SQL
- **No self-service**: Can only see curated content
- **Granular**: Schema/table level control

## Performance Tips

- Expose only mart-layer tables (not staging/intermediate)
- Create database views or dbt `+materialized: table` for slow queries
- Use Metabase caching (Admin > Caching) for dashboards with heavy queries:
  ```
  Default TTL: 24 hours
  Minimum TTL: 1 hour
  ```
- Set `schema-filters-patterns` to include only marts/reporting schemas
- Create `_metabase_metrics` views with pre-aggregated data for high-traffic dashboards

## Metabase Models (v0.46+)

Create Metabase models from dbt models for semantic consistency:

```sql
-- Metabase model: "Active Customers"
SELECT
    customer_id,
    name,
    email,
    segment,
    lifetime_value,
    last_order_date
FROM analytics.dim_customers
WHERE is_active = true
```

Models in Metabase can be:
- Saved as reusable data sources
- Used by non-technical users in GUI Questions
- Annotated with column descriptions and semantic types

## Alerting

```python
# Create alert via API (trigger when metric crosses threshold)
alert = requests.post(f"{BASE_URL}/alert", headers=HEADERS, json={
    "alert_condition": "goal_above",
    "alert_above_goal": 10000,
    "card": {"id": 42},
    "channels": [{
        "channel_type": "slack",
        "schedule_type": "hourly",
        "details": {"channel": "#data-alerts"}
    }]
})
```
