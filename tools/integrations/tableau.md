# Tableau Integration Guide

## Overview
Tableau is an enterprise BI platform offering rich interactive visualizations. It connects to warehouses via native drivers and supports published data sources, Tableau Prep for ETL, and Tableau Server/Cloud for sharing.

## Connection Setup

### Tableau → Snowflake
```
Server: myorg.snowflakecomputing.com
Database: ANALYTICS
Warehouse: TABLEAU_WH
Role: TABLEAU_ROLE
Authentication: Username and Password (or SSO)
```

Recommended warehouse config for Tableau:
```sql
-- Dedicated Tableau warehouse (auto-suspend to control cost)
CREATE WAREHOUSE TABLEAU_WH
  WAREHOUSE_SIZE = 'MEDIUM'
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE;

CREATE ROLE TABLEAU_ROLE;
GRANT USAGE ON WAREHOUSE TABLEAU_WH TO ROLE TABLEAU_ROLE;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE TABLEAU_ROLE;
GRANT USAGE ON SCHEMA ANALYTICS.MARTS TO ROLE TABLEAU_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA ANALYTICS.MARTS TO ROLE TABLEAU_ROLE;
GRANT SELECT ON FUTURE TABLES IN SCHEMA ANALYTICS.MARTS TO ROLE TABLEAU_ROLE;
```

### Tableau → BigQuery
```
Project: my-gcp-project
Dataset: marts
Billing Project: my-gcp-project
Authentication: Service Account (JSON key)
```

### Tableau → Databricks
```
Server Hostname: <workspace>.azuredatabricks.net
HTTP Path: /sql/1.0/warehouses/<id>
Port: 443
Authentication: Personal Access Token
```

## Published Data Sources

Published Data Sources (PDS) in Tableau Server/Cloud allow centralized, reusable connections — similar to a semantic layer.

Best practice: publish one PDS per dbt mart:

```
Published Data Sources:
├── "Orders & Revenue" → fct_orders + dim_customers (joined)
├── "Marketing Attribution" → fct_attribution + dim_campaigns
├── "Finance KPIs" → fct_revenue + dim_accounts
└── "Product Usage" → fct_events + dim_users
```

### Creating a PDS via tabcmd
```bash
# Publish a workbook's data source to Tableau Server
tabcmd publish "revenue_datasource.tdsx" \
  --server https://tableau.company.com \
  --username admin \
  --password secret \
  --project "Data Team" \
  --overwrite
```

## Tableau REST API

```python
import tableauserverclient as TSC

# Authenticate
server = TSC.Server("https://tableau.company.com", use_server_version=True)
tableau_auth = TSC.TableauAuth("admin", "password", site_id="MySite")

with server.auth.sign_in(tableau_auth):
    # List all workbooks
    all_workbooks, pagination_item = server.workbooks.get()
    for wb in all_workbooks:
        print(f"{wb.name}: {wb.project_name}")

    # Trigger a datasource refresh
    datasource = server.datasources.get_by_id("datasource-uuid")
    refresh_job = server.datasources.refresh(datasource)

    # Download workbook
    filepath = server.workbooks.download("workbook-uuid", filepath="/tmp/")

    # Publish workbook
    new_workbook = TSC.WorkbookItem(project_id="project-uuid")
    new_workbook = server.workbooks.publish(
        new_workbook,
        "path/to/workbook.twbx",
        TSC.Server.PublishMode.Overwrite
    )
```

## Hyper Extract API (Performance)

For very large datasets, use Tableau Hyper extracts instead of live connections:

```python
from tableauhyperapi import HyperProcess, Connection, TableDefinition, \
    SqlType, Telemetry, Inserter, CreateMode, TableName

with HyperProcess(telemetry=Telemetry.DO_NOT_SEND_USAGE_DATA_TO_TABLEAU) as hyper:
    with Connection(
        hyper.endpoint,
        "orders.hyper",
        CreateMode.CREATE_AND_REPLACE
    ) as connection:
        # Define schema
        orders_table = TableDefinition(
            table_name=TableName("Extract", "orders"),
            columns=[
                TableDefinition.Column("order_id", SqlType.big_int()),
                TableDefinition.Column("revenue", SqlType.double()),
                TableDefinition.Column("created_at", SqlType.timestamp()),
                TableDefinition.Column("status", SqlType.text()),
            ]
        )
        connection.catalog.create_schema("Extract")
        connection.catalog.create_table(orders_table)

        # Insert data from warehouse query result
        with Inserter(connection, orders_table) as inserter:
            for row in warehouse_rows:
                inserter.add_row([row.order_id, row.revenue, row.created_at, row.status])
            inserter.execute()
```

## Tableau Prep (ETL)

Tableau Prep Builder creates `.tfl` flow files. For dbt-first teams, minimize Prep usage — do transformations in dbt, expose clean marts to Tableau.

Acceptable Prep use cases:
- Pivoting data for Tableau-specific visualization needs
- Combining data sources that aren't in the warehouse
- Ad-hoc analyst data prep (not production pipelines)

## Row-Level Security

### Option 1: User Filter (Tableau-side)
```
1. Connect to dim_regions table
2. Create a User Filter: [Region] = USERNAME()
3. Apply as Data Source Filter
```

### Option 2: Warehouse-side RLS (preferred for dbt teams)
```sql
-- Snowflake: Row Access Policy
CREATE OR REPLACE ROW ACCESS POLICY rls.tableau_region_policy
AS (region VARCHAR) RETURNS BOOLEAN ->
  CURRENT_ROLE() = 'ADMIN'
  OR EXISTS (
    SELECT 1 FROM analytics.user_region_access
    WHERE username = CURRENT_USER()
    AND region = region
  );

ALTER TABLE analytics.fct_orders
  ADD ROW ACCESS POLICY rls.tableau_region_policy ON (region);
```

## Performance Optimization

```sql
-- For Snowflake: create materialized views for Tableau aggregations
CREATE OR REPLACE MATERIALIZED VIEW analytics.mv_orders_daily AS
SELECT
    DATE_TRUNC('day', created_at) AS order_date,
    status,
    region,
    SUM(revenue) AS total_revenue,
    COUNT(*) AS order_count
FROM analytics.fct_orders
GROUP BY 1, 2, 3;
```

Tableau extract refresh schedule (tabcmd):
```bash
# Schedule via Tableau Server REST API
tabcmd refreshextracts --datasource "Orders & Revenue" \
  --server https://tableau.company.com \
  --username admin
```

## Tableau ↔ dbt Metadata Sync

Use `dbt-tableau` or custom scripts to sync column descriptions:

```python
import yaml, tableauserverclient as TSC

# Read dbt catalog.json
with open("target/catalog.json") as f:
    catalog = json.load(f)

model_descriptions = {
    col_name: col_meta.get("description", "")
    for col_name, col_meta in catalog["nodes"]["model.my_project.fct_orders"]["columns"].items()
}

# Update Tableau datasource field descriptions via REST API
with server.auth.sign_in(tableau_auth):
    datasource = server.datasources.get_by_id("ds-uuid")
    # Field-level metadata update requires Tableau Metadata API (GraphQL)
```

## Common Issues

| Issue | Cause | Fix |
|---|---|---|
| Slow dashboard load | Live connection with large joins | Switch to extract or use dbt mart with pre-joins |
| "Query Banding" errors | Snowflake query tag limit | Set `QUERY_TAG` to shorter string |
| Extract refresh fails | Schema changed in warehouse | Re-map fields in Tableau Desktop |
| Context filter slows all queries | Applied to wrong field | Move filter to data source level |
| Cross-database joins slow | Joining two live connections | Consolidate into one warehouse model |
