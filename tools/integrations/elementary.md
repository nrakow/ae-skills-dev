# Elementary Integration Guide

## Overview
Elementary is an open-source data observability tool built for dbt. It runs as a dbt package that adds anomaly detection tests, monitors data quality over time, and generates an observability report — all within your existing dbt workflow.

## Installation

```yaml
# packages.yml
packages:
  - package: elementary-data/elementary
    version: [">=0.14.0", "<0.15.0"]
```

```bash
dbt deps
dbt run --select elementary
```

Elementary creates its own schema (default: `<target_schema>_elementary`) with tables tracking:
- `dbt_models` — model run history
- `dbt_tests` — test results over time
- `dbt_sources` — source freshness history
- `elementary_test_results` — anomaly detection results

## Elementary Profile Setup

```yaml
# profiles.yml — add elementary profile
elementary:
  outputs:
    default:
      type: snowflake  # or bigquery, databricks, redshift, postgres
      account: myorg.us-east-1
      user: ELEMENTARY_USER
      password: "{{ env_var('SNOWFLAKE_PASSWORD') }}"
      role: ELEMENTARY_ROLE
      database: ANALYTICS
      warehouse: ELEMENTARY_WH
      schema: elementary
```

## Anomaly Detection Tests

### Volume Anomalies
```yaml
# models/marts/fct_orders.yml
models:
  - name: fct_orders
    tests:
      - elementary.volume_anomalies:
          timestamp_column: created_at
          where_expression: "status != 'cancelled'"
          anomaly_sensitivity: 3          # z-score threshold (default: 3)
          days_back: 30                   # training period
          backfill_days: 2                # days to re-check
      - elementary.freshness_anomalies:
          timestamp_column: created_at
          anomaly_sensitivity: 2
          min_training_set_size: 7
```

### Column Anomalies
```yaml
    columns:
      - name: revenue
        tests:
          - elementary.column_anomalies:
              column_anomalies:
                - null_count
                - null_percent
                - zero_count
                - average
                - standard_deviation
                - max
                - min
              timestamp_column: created_at
              days_back: 30

      - name: status
        tests:
          - elementary.column_anomalies:
              column_anomalies:
                - null_percent
                - missing_count   # new categories
              timestamp_column: created_at
```

### All Available Anomaly Monitors

| Monitor | Detects |
|---|---|
| `volume_anomalies` | Row count spikes/drops |
| `freshness_anomalies` | Data not updating on schedule |
| `event_freshness_anomalies` | Gap between event time and load time |
| `column_anomalies` | Null rate, average, range, distribution changes |
| `schema_changes` | Column additions, removals, type changes |
| `all_columns_anomalies` | Applies column_anomalies to every column |
| `table_anomalies` | Multi-metric table-level monitor |

### Schema Change Detection
```yaml
models:
  - name: fct_orders
    tests:
      - elementary.schema_changes          # alert on any schema change
      - elementary.schema_changes_from_baseline:
          fail_on_added: false             # don't fail when columns added
```

## Source-Level Monitoring

```yaml
# models/staging/sources.yml
sources:
  - name: raw_orders
    database: RAW
    schema: FIVETRAN
    tables:
      - name: orders
        tests:
          - elementary.volume_anomalies:
              timestamp_column: _fivetran_synced
          - elementary.freshness_anomalies:
              timestamp_column: _fivetran_synced
              anomaly_sensitivity: 2
```

## Elementary CLI

```bash
pip install elementary-data

# Generate HTML observability report
edr report \
  --profiles-dir ~/.dbt \
  --profile elementary

# Send Slack alert
edr monitor \
  --slack-token xoxb-*** \
  --slack-channel-name data-alerts \
  --profiles-dir ~/.dbt \
  --profile elementary

# Send to multiple channels based on model owner
edr monitor \
  --slack-token xoxb-*** \
  --config-dir ./elementary_config

# Export report to S3/GCS for sharing
edr send-report \
  --slack-token xoxb-*** \
  --slack-channel-name data-team \
  --update-bucket-website s3://my-bucket/elementary/index.html
```

## Alerting Configuration

```yaml
# elementary_config/config.yml
slack:
  token: "{{ env_var('ELEMENTARY_SLACK_TOKEN') }}"
  channel_name: "#data-alerts"

# Per-model Slack routing
models:
  - name: fct_orders
    meta:
      elementary:
        owner:
          slack: "@revenue-team"
        tags: ["critical", "finance"]
```

In dbt YAML, set model-level alert routing:
```yaml
models:
  - name: fct_orders
    meta:
      owner: "@revenue-team"
      slack_channel: "#finance-alerts"
      subscribers:
        - "@data-eng"
```

## CI/CD Integration

```yaml
# .github/workflows/dbt-ci.yml
- name: Run dbt tests
  run: dbt test --target prod

- name: Generate Elementary report
  run: |
    pip install elementary-data
    edr report \
      --profiles-dir . \
      --profile elementary \
      --file-path ./elementary_report.html

- name: Upload report artifact
  uses: actions/upload-artifact@v3
  with:
    name: elementary-report
    path: elementary_report.html

- name: Notify Slack on test failures
  if: failure()
  run: |
    edr monitor \
      --slack-token ${{ secrets.SLACK_TOKEN }} \
      --slack-channel-name "#data-ci-alerts" \
      --profiles-dir . \
      --profile elementary
```

## Querying Elementary Tables Directly

```sql
-- Recent test failures
SELECT
    model_unique_id,
    test_name,
    status,
    failures,
    detected_at
FROM analytics_elementary.elementary_test_results
WHERE status = 'fail'
  AND detected_at >= CURRENT_DATE - 7
ORDER BY detected_at DESC;

-- Volume anomaly trend for a model
SELECT
    bucket_start,
    metric_value,
    average_metric_value,
    sensitivity,
    is_anomalous
FROM analytics_elementary.data_monitoring_metrics
WHERE full_table_name ILIKE '%fct_orders%'
  AND metric_name = 'row_count'
  AND bucket_start >= CURRENT_DATE - 30
ORDER BY bucket_start;

-- Model run SLA monitoring
SELECT
    unique_id,
    name,
    status,
    execution_time,
    generated_at
FROM analytics_elementary.dbt_models
WHERE status = 'error'
   OR execution_time > 300  -- models taking > 5 minutes
ORDER BY generated_at DESC
LIMIT 50;
```

## Elementary vs Alternatives

| Feature | Elementary | Monte Carlo | Soda |
|---|---|---|---|
| dbt-native | Yes (dbt package) | Integration | Integration |
| Self-hosted | Yes | No (SaaS) | OSS + Cloud |
| Anomaly detection | Yes (ML) | Yes (ML) | Yes (rules-based) |
| Lineage | Via dbt | Full graph | No |
| Pricing | Open source | Enterprise ($) | Open source + paid |
| Setup complexity | Low | High | Medium |
