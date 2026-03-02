---
name: anomaly-detection
description: "Set up automated anomaly detection for data pipelines using Elementary or custom dbt tests. Use when implementing proactive data monitoring, detecting volume spikes or drops, catching distribution shifts, or alerting on freshness violations. Triggers: 'anomaly detection', 'detect anomalies', 'data spikes', 'outliers', 'elementary anomalies', 'volume monitoring', 'data monitoring', 'alert on data changes'."
triggers:
  - "anomaly detection"
  - "detect anomalies"
  - "data spikes"
  - "volume monitoring"
  - "data monitoring"
  - "elementary anomalies"
  - "alert on data"
reads_first:
  - data-stack-context
  - data-quality-testing
cli_tools:
  - test-results.js
  - source-freshness.js
produces:
  - "Elementary anomaly test YAML"
  - "schema.yml anomaly tests"
validates_with:
  - "dbt test --select tag:elementary"
  - "node tools/clis/test-results.js --results target/run_results.json"
---

# Anomaly Detection

I'll help you set up automated anomaly detection for your data pipelines using Elementary, Monte Carlo, Soda, or custom statistical approaches.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: observability tool, dbt version, alerting channels (Slack, PagerDuty).

## Before You Start

- Run `node tools/clis/source-freshness.js` to check which sources are currently fresh before configuring anomaly detection.
- Confirm `elementary-data/elementary` is in `packages.yml` and run `dbt deps` if not already installed.
- Check how many days of historical data exist — Elementary needs at least `min_training_set_size` days (default 7) to establish a baseline.
- Read the model's `schema.yml` to identify the timestamp column for `timestamp_column` config.

## Detection Categories

| Category | What it catches | Priority |
|----------|----------------|---------|
| **Volume** | Row count drops/spikes | Critical — catch pipeline failures |
| **Freshness** | Data stopped updating | Critical — catch pipeline failures |
| **Nulls** | Null rate changed unexpectedly | High — catch schema/logic changes |
| **Distribution** | Value distribution shifted | High — catch data quality issues |
| **Schema drift** | Column added, removed, or type changed | Medium — catch source changes |
| **Cross-table** | Referential integrity violations | High — catch join logic failures |

---

## Option 1: Elementary (Recommended for dbt Teams)

### Setup

```yaml
# packages.yml
packages:
  - package: elementary-data/elementary
    version: [">=0.13.0", "<1.0.0"]
```

```yaml
# dbt_project.yml
models:
  my_project:
    +elementary:
      timestamp_column: "updated_at"  # default timestamp for all models
```

### Volume Monitoring

```yaml
# models/marts/core/_core__models.yml
models:
  - name: fct_orders
    config:
      elementary:
        timestamp_column: ordered_at
    data_tests:
      # Alert if hourly row count deviates by > 3 sigma from baseline
      - elementary.volume_anomalies:
          time_bucket:
            period: hour
            count: 1
          anomaly_sensitivity: 3.0
          anomaly_direction: both
          days_back: 14           # training window
          min_training_set_size: 7
          config:
            severity: error

      # Minimum row count guarantee
      - elementary.volume_anomalies:
          time_bucket:
            period: day
            count: 1
          anomaly_direction: drop  # only alert on drops
          min_proportion_of_time_with_data: 0.9  # data must exist 90% of periods
```

### Freshness Monitoring

```yaml
data_tests:
  - elementary.freshness_anomalies:
      timestamp_column: ordered_at
      max_allowed_delay:
        - 2 hours  # alert if data is more than 2 hours stale
      time_bucket:
        period: hour
        count: 1
```

### Column-Level Monitoring

```yaml
columns:
  - name: net_revenue_usd
    data_tests:
      - elementary.column_anomalies:
          column_anomalies:
            - null_count        # count of nulls
            - null_percent      # % nulls
            - zero_percent      # % zeros (e.g., detect revenue going to 0)
            - average           # mean value
            - min_value
            - max_value
          timestamp_column: ordered_at
          anomaly_sensitivity: 3.0

  - name: order_status
    data_tests:
      - elementary.column_anomalies:
          column_anomalies:
            - null_percent
          # Also monitor distribution of values
      - elementary.categorical_distribution_tests:
          timestamp_column: ordered_at
```

### Running Elementary

```bash
# Run tests with Elementary
dbt test --select elementary

# Generate monitoring report
dbt run --select elementary  # runs Elementary internal models

# View report in CLI
edr report

# Send Slack alert (configure in profiles.yml or env vars)
edr send-report --slack-token $SLACK_TOKEN --slack-channel-name data-alerts
```

### Elementary Alert Configuration

```yaml
# ~/.dbt/profiles.yml (or environment variables)
my_project:
  outputs:
    prod:
      # ... warehouse config ...
      # Elementary alert settings (via environment variables):
      # ELEMENTARY_SLACK_TOKEN=xoxb-xxx
      # ELEMENTARY_SLACK_CHANNEL_NAME=data-alerts
      # ELEMENTARY_PAGERDUTY_API_KEY=xxx
```

---

## Option 2: Custom SQL Statistical Monitoring

For teams not using Elementary:

### Z-Score Anomaly Detection

```sql
-- tests/assert_order_volume_normal.sql
-- Fails if today's order count is more than 3 sigma from 30-day mean

with daily_counts as (

    select
        ordered_at::date as order_date,
        count(*) as order_count

    from {{ ref('fct_orders') }}
    where ordered_at >= current_date - 31

    group by 1

),

stats as (

    select
        avg(order_count) as mean_count,
        stddev(order_count) as stddev_count,
        max(order_date) as latest_date

    from daily_counts
    where order_date < current_date  -- exclude today from baseline

),

today as (

    select order_count
    from daily_counts
    where order_date = current_date

)

select
    today.order_count as actual,
    stats.mean_count as expected_mean,
    stats.stddev_count as expected_stddev,
    abs(today.order_count - stats.mean_count) / nullif(stats.stddev_count, 0)
        as z_score

from today, stats
where abs(today.order_count - stats.mean_count) / nullif(stats.stddev_count, 0) > 3
```

### Null Rate Change Detection

```sql
-- tests/assert_null_rate_stable.sql
-- Alert if null rate on a critical column changed by > 5%

with baseline as (

    select
        count(case when customer_id is null then 1 end) * 1.0 / count(*)
            as null_rate

    from {{ ref('fct_orders') }}
    where ordered_at::date between current_date - 8 and current_date - 2

),

current_period as (

    select
        count(case when customer_id is null then 1 end) * 1.0 / count(*)
            as null_rate

    from {{ ref('fct_orders') }}
    where ordered_at::date = current_date - 1

)

select
    current_period.null_rate as current_null_rate,
    baseline.null_rate as baseline_null_rate,
    abs(current_period.null_rate - baseline.null_rate) as rate_change

from current_period, baseline
where abs(current_period.null_rate - baseline.null_rate) > 0.05
```

### Row Count Reconciliation (Cross-Table)

```sql
-- tests/assert_orders_match_stripe.sql
-- Row count in mart should be within 1% of source

with mart as (
    select count(*) as cnt from {{ ref('fct_orders') }}
    where ordered_at::date = current_date - 1
),
stripe as (
    select count(*) as cnt from {{ source('stripe', 'charge') }}
    where status = 'succeeded'
      and created::date = current_date - 1
)

select
    mart.cnt as mart_count,
    stripe.cnt as stripe_count,
    abs(mart.cnt - stripe.cnt) * 1.0 / nullif(stripe.cnt, 0) as pct_diff
from mart, stripe
where abs(mart.cnt - stripe.cnt) * 1.0 / nullif(stripe.cnt, 0) > 0.01
```

---

## Option 3: Soda

### soda_checks.yml

```yaml
# soda/checks/fct_orders.yml
checks for fct_orders:
  # Freshness
  - freshness(ordered_at) < 2h:
      name: "orders are fresh"
      fail: when > 4h
      warn: when > 2h

  # Volume
  - row_count > 0:
      name: "orders table not empty"

  # Anomaly detection (requires Soda Cloud)
  - anomaly score for row_count < default:
      name: "order volume normal"

  # Column quality
  - missing_count(customer_id) = 0:
      name: "no missing customer IDs"

  - invalid_percent(order_status) < 1%:
      valid values: [pending, processing, completed, cancelled, refunded]
      name: "order status values valid"

  - avg(net_revenue_usd) between 50 and 500:
      name: "average order value in range"
```

```bash
# Run Soda checks
soda scan -d snowflake -c soda/configuration.yml soda/checks/fct_orders.yml
```

---

## Alerting Integration

### Slack Alert via dbt Macro

```sql
-- macros/alert_slack.sql
{% macro alert_slack(message, channel='#data-alerts', severity='warning') %}
    {% if execute %}
        {% set slack_payload = {
            "channel": channel,
            "text": "Data Quality Alert",
            "attachments": [{
                "color": "danger" if severity == "error" else "warning",
                "text": message
            }]
        } %}
        -- This macro is illustrative; call via Python or dbt-slack package
    {% endif %}
{% endmacro %}
```

### PagerDuty via GitHub Actions

```yaml
# .github/workflows/data-quality-check.yml
- name: Alert PagerDuty if tests fail
  if: failure()
  run: |
    curl -X POST https://events.pagerduty.com/v2/enqueue \
      -H 'Content-Type: application/json' \
      -d '{
        "routing_key": "${{ secrets.PAGERDUTY_KEY }}",
        "event_action": "trigger",
        "payload": {
          "summary": "dbt data quality test failed",
          "severity": "error",
          "source": "GitHub Actions"
        }
      }'
```

## Alert Priority Matrix

| Test type | On failure → |
|-----------|-------------|
| PK uniqueness | PagerDuty (P1) |
| Source freshness > SLA | PagerDuty (P1) |
| Row count drop > 50% | PagerDuty (P1) |
| Row count drop > 20% | Slack (urgent) |
| Null rate spike | Slack (urgent) |
| Distribution anomaly | Slack (warning) |
| Range violation | Slack (warning) |

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

- Run `dbt test --select tag:elementary` to execute all Elementary anomaly tests.
- Run `node tools/clis/test-results.js --results target/run_results.json` to see which models triggered anomaly alerts and review pass/fail/warn counts.
- Check that Elementary internal models ran successfully: `dbt run --select elementary`.

## If Something Goes Wrong

- **No training data**: The model doesn't have enough history — wait for `min_training_set_size` days of data, or reduce the setting in the Elementary config block.
- **Too many false positives**: Increase `anomaly_sensitivity` from the default `3.0` to `4` or `5` to require a larger deviation before alerting.
- **Elementary package not found**: Add `elementary-data/elementary` to `packages.yml` and run `dbt deps`.
- **Timestamp column missing or wrong**: Add a `timestamp_column` config to the model's Elementary block matching the actual event time column name in the table.
