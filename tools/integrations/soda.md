# Soda Integration Guide

## Overview
Soda is a data quality platform with an expressive YAML-based checks DSL (SodaCL). It runs checks directly against your warehouse and integrates with dbt, Airflow, and CI/CD pipelines.

## Installation

```bash
# Core + warehouse adapter
pip install soda-core soda-core-snowflake
# or: soda-core-bigquery, soda-core-databricks, soda-core-redshift, soda-core-duckdb

# With dbt integration
pip install soda-core-dbt
```

## Connection Setup

```yaml
# ~/.soda/configuration.yml
data_sources:
  production:
    type: snowflake
    account: myorg.us-east-1
    username: SODA_USER
    password: ${SNOWFLAKE_PASSWORD}
    database: ANALYTICS
    warehouse: SODA_WH
    role: SODA_ROLE
    schema: marts

  bigquery_prod:
    type: bigquery
    account_info_json_path: /secrets/bigquery-sa.json
    auth_scopes:
      - https://www.googleapis.com/auth/bigquery
    project_id: my-gcp-project
    dataset: marts

  databricks_prod:
    type: databricks
    host: <workspace>.azuredatabricks.net
    http_path: /sql/1.0/warehouses/<id>
    token: ${DATABRICKS_TOKEN}
    catalog: main
    schema: marts
```

## SodaCL Checks

### Basic Checks

```yaml
# checks/fct_orders.yml
checks for fct_orders:

  # Row count
  - row_count > 0
  - row_count between 1000 and 10000000

  # Freshness
  - freshness(created_at) < 24h

  # Null checks
  - missing_count(order_id) = 0
  - missing_percent(revenue) < 0.01

  # Uniqueness
  - duplicate_count(order_id) = 0

  # Value validity
  - invalid_count(status) = 0:
      valid values: [pending, processing, shipped, delivered, cancelled]

  # Range checks
  - min(revenue) >= 0
  - max(revenue) < 1000000

  # Custom SQL
  - failed rows:
      name: Revenue matches line items
      fail query: |
        SELECT o.order_id
        FROM fct_orders o
        LEFT JOIN fct_order_items oi ON o.order_id = oi.order_id
        GROUP BY o.order_id, o.revenue
        HAVING o.revenue != SUM(COALESCE(oi.line_revenue, 0))
```

### Anomaly Detection (Soda Cloud)

```yaml
checks for fct_orders:
  - anomaly score for row_count < default
  - anomaly score for avg(revenue) < default
  - anomaly detection for freshness(created_at)
```

### Schema Checks

```yaml
checks for fct_orders:
  - schema:
      name: Schema matches expected
      warn:
        when forbidden column present:
          - ssn
          - credit_card_number
      fail:
        when required column missing:
          - order_id
          - revenue
          - created_at
          - customer_id
        when wrong column type:
          order_id: bigint
          revenue: float
          created_at: timestamp_tz
```

### Cross-Table Reconciliation

```yaml
checks for fct_orders:
  - row_count same as raw_orders

checks for fct_orders:
  - sum(revenue) same as staging_orders [revenue]:
      percent: 5  # allow 5% variance
```

### Partitioned Checks (for large tables)

```yaml
filter fct_orders [daily]:
  where: DATE(created_at) = DATE_TRUNC('day', CURRENT_TIMESTAMP - INTERVAL '1 day')

checks for fct_orders [daily]:
  - row_count > 0
  - freshness(created_at) < 2h
  - missing_count(revenue) = 0
```

## Running Soda

```bash
# Run all checks for a data source
soda scan -d production -c ~/.soda/configuration.yml checks/

# Run specific check file
soda scan -d production -c config.yml checks/fct_orders.yml

# Run with variables
soda scan -d production -c config.yml checks/fct_orders.yml \
  -v DATE=2024-01-15

# Test configuration
soda test-connection -d production -c config.yml

# Scan with Soda Cloud reporting
soda scan -d production -c config.yml checks/ \
  --soda-cloud-api-key ${SODA_CLOUD_KEY}
```

## dbt Integration

```yaml
# packages.yml
packages:
  - package: dbt-labs/dbt_utils
    version: [">=1.0.0"]
```

```bash
# Run Soda checks on dbt models after dbt build
dbt build && soda scan -d production -c config.yml checks/
```

Soda + dbt in CI:
```yaml
# .github/workflows/data-quality.yml
- name: Build dbt models
  run: dbt build --target prod

- name: Run Soda checks
  run: |
    soda scan \
      --data-source production \
      --configuration .soda/configuration.yml \
      checks/
  env:
    SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}
    SODA_CLOUD_KEY: ${{ secrets.SODA_CLOUD_KEY }}
```

## Airflow Integration

```python
from airflow import DAG
from airflow.operators.bash import BashOperator
from datetime import datetime

with DAG("data_quality_checks", start_date=datetime(2024, 1, 1), schedule_interval="@daily") as dag:

    dbt_build = BashOperator(
        task_id="dbt_build",
        bash_command="dbt build --target prod"
    )

    soda_scan = BashOperator(
        task_id="soda_scan",
        bash_command="""
            soda scan \
              --data-source production \
              --configuration /opt/soda/configuration.yml \
              /opt/soda/checks/
        """,
        env={"SNOWFLAKE_PASSWORD": "{{ var.value.snowflake_password }}"}
    )

    dbt_build >> soda_scan
```

Or using the Soda Airflow operator:
```python
from soda.airflow import SodaScanOperator

soda_check = SodaScanOperator(
    task_id="soda_scan_orders",
    dag=dag,
    data_sources=[{
        "data_source_name": "production",
        "connection_configuration_path": "/opt/soda/config.yml"
    }],
    check_suffix="orders",
    scan_name="daily_orders_check",
    configuration_yaml_file="/opt/soda/configuration.yml",
    check_yaml_files=["/opt/soda/checks/fct_orders.yml"]
)
```

## Programmatic API

```python
from soda.scan import Scan

scan = Scan()
scan.set_scan_definition_name("orders_quality_check")
scan.set_data_source_name("production")
scan.add_configuration_yaml_file(file_path="config.yml")
scan.add_sodacl_yaml_str("""
checks for fct_orders:
  - row_count > 0
  - freshness(created_at) < 24h
  - missing_count(order_id) = 0
""")

exit_code = scan.execute()
print(scan.get_scan_results())

if exit_code != 0:
    raise Exception(f"Soda scan failed: {scan.get_error_logs()}")
```

## Alert Routing

```yaml
# configuration.yml
soda_cloud:
  api_key_id: ${SODA_CLOUD_API_KEY_ID}
  api_key_secret: ${SODA_CLOUD_API_KEY_SECRET}
  host: cloud.soda.io

# Notifications configured in Soda Cloud UI:
# - Slack channels per data source or check
# - Email alerts for specific owners
# - PagerDuty for P1 checks
```

## SodaCL Reference

| Check | Syntax example |
|---|---|
| Row count | `row_count > 0` |
| Missing | `missing_count(col) = 0` |
| Invalid | `invalid_count(col) = 0: { valid values: [...] }` |
| Duplicate | `duplicate_count(col) = 0` |
| Freshness | `freshness(ts_col) < 24h` |
| Min/Max | `min(col) >= 0` |
| Average | `avg(col) between 10 and 100` |
| Custom SQL | `failed rows: { fail query: SELECT ... }` |
| Schema | `schema: { fail: { when required column missing: [...] } }` |
| Cross-table | `row_count same as other_table` |
| Anomaly | `anomaly score for row_count < default` |
