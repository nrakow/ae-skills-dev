---
name: data-quality-testing
description: "Write comprehensive dbt tests including schema tests, custom SQL tests, unit tests, and Elementary anomaly tests to ensure data quality. Use when adding test coverage to existing models, auditing test gaps, or setting up a testing strategy from scratch. Triggers: 'add tests', 'write tests', 'test coverage', 'data quality', 'dbt tests', 'schema tests', 'test my models', 'data testing strategy'."
triggers:
  - "add tests"
  - "write tests"
  - "test coverage"
  - "data quality"
  - "dbt tests"
  - "test my models"
reads_first:
  - data-stack-context
cli_tools:
  - manifest-coverage.js
  - test-results.js
produces:
  - "schema.yml test definitions"
  - "tests/singular/ SQL files"
validates_with:
  - "dbt test"
  - "dbt test --store-failures"
  - "node tools/clis/manifest-coverage.js --manifest target/manifest.json"
---

# Data Quality Testing

I'll help you write comprehensive dbt tests — from basic schema tests to complex custom SQL assertions — that catch data quality issues before they reach dashboards.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: dbt version, packages installed (dbt_utils, Elementary), warehouse type.

## Before You Start

- Run `node tools/clis/manifest-coverage.js --manifest target/manifest.json` first to identify which models have no tests — start with those.
- Read existing `schema.yml` files to understand current test coverage before adding more.
- Check `packages.yml` to confirm `dbt_utils` and `elementary-data/elementary` are installed.
- Confirm your dbt version supports `data_tests:` key (dbt 1.8+) vs `tests:` (older versions).

## Testing Hierarchy

| Test type | Coverage | When to use |
|-----------|----------|-------------|
| **Generic schema tests** | PK, FK, nulls, accepted values | Every model, every column |
| **dbt_utils tests** | Ranges, expressions, cardinality | Business rule validation |
| **Singular tests** | Complex multi-table assertions | Cross-model consistency |
| **Elementary tests** | Anomalies, volume, freshness | Production monitoring |

## 1. Generic Schema Tests (Always Required)

Every model must have these on key columns:

```yaml
models:
  - name: fct_orders
    description: "One row per order"
    columns:
      # Primary key
      - name: order_id
        data_tests:
          - unique
          - not_null

      # Foreign keys
      - name: customer_id
        data_tests:
          - not_null
          - relationships:
              to: ref('dim_customers')
              field: customer_id

      - name: product_id
        data_tests:
          - relationships:
              to: ref('dim_products')
              field: product_id
              # Allow NULLs if not every order has a product
              config:
                where: "product_id is not null"

      # Accepted values
      - name: order_status
        data_tests:
          - accepted_values:
              values: ['pending', 'processing', 'completed', 'cancelled', 'refunded']

      # Not null with conditions
      - name: shipped_at
        data_tests:
          - not_null:
              config:
                where: "order_status = 'completed'"
```

## 2. dbt_utils Tests

```yaml
columns:
  - name: order_amount_usd
    data_tests:
      # Numeric range
      - dbt_utils.accepted_range:
          min_value: 0
          inclusive: false  # strictly > 0, not >= 0
          max_value: 1000000

  - name: created_at
    data_tests:
      # Date range
      - dbt_utils.accepted_range:
          min_value: "'2019-01-01'::timestamp"
          max_value: "current_timestamp"
          config:
            severity: warn  # warn only, don't fail CI

  - name: customer_email
    data_tests:
      # Regex pattern
      - dbt_utils.expression_is_true:
          expression: "customer_email like '%@%.%'"
          config:
            where: "customer_email is not null"

# Model-level: unique combination of columns
data_tests:
  - dbt_utils.unique_combination_of_columns:
      combination_of_columns:
        - customer_id
        - order_date

  # Row count is never zero
  - dbt_utils.expression_is_true:
      name: "fct_orders_not_empty"
      expression: "(select count(*) from {{ model }}) > 0"
```

## 3. Singular Tests (Custom SQL)

For complex assertions that don't fit YAML tests:

```sql
-- tests/assert_revenue_matches_source.sql
-- Fails if dbt revenue deviates from Stripe by more than 0.1%

with mart_revenue as (
    select sum(net_revenue_usd) as total_usd
    from {{ ref('fct_revenue') }}
    where invoice_date >= dateadd(day, -7, current_date)
),

stripe_revenue as (
    select sum(amount / 100.0) as total_usd
    from {{ source('stripe', 'invoice') }}
    where
        status = 'paid'
        and created >= dateadd(day, -7, current_date)::timestamp
),

comparison as (
    select
        mart_revenue.total_usd as mart_total,
        stripe_revenue.total_usd as stripe_total,
        abs(mart_revenue.total_usd - stripe_revenue.total_usd)
            / nullif(stripe_revenue.total_usd, 0) as relative_diff
    from mart_revenue, stripe_revenue
)

-- Singular tests pass when 0 rows returned
select * from comparison where relative_diff > 0.001
```

```sql
-- tests/assert_no_customer_in_multiple_segments.sql
-- A customer should be in exactly one segment

select
    customer_id,
    count(distinct customer_segment) as segment_count
from {{ ref('dim_customers') }}
group by 1
having count(distinct customer_segment) > 1
```

## 4. Test Configuration

```yaml
# Fine-tune test behavior per test
models:
  - name: fct_orders
    data_tests:
      - dbt_utils.expression_is_true:
          expression: "net_revenue_usd >= 0"
          config:
            severity: error          # error | warn
            error_if: ">10"          # fail if more than 10 violations
            warn_if: ">0"            # warn if any violations at all
            store_failures: true     # save failing rows to target schema
            store_failures_as: table # table | view (default: view)
            limit: 500               # limit stored failures to 500 rows
```

## 5. Source Freshness Tests

```yaml
# models/staging/salesforce/_salesforce__sources.yml
sources:
  - name: salesforce
    freshness:
      warn_after: {count: 24, period: hour}
      error_after: {count: 48, period: hour}
    loaded_at_field: _fivetran_synced
    tables:
      - name: account
        # Override freshness per-table
        freshness:
          warn_after: {count: 12, period: hour}
          error_after: {count: 24, period: hour}
```

Run: `dbt source freshness`

## 6. Elementary Anomaly Tests

```yaml
# Requires elementary-data/elementary package installed
models:
  - name: fct_orders
    config:
      elementary:
        timestamp_column: ordered_at
        anomaly_sensitivity: 3.0    # sigma threshold (default: 3.0)
        anomaly_direction: both     # both | spike | drop
        days_back: 14               # training window
        min_training_set_size: 7

    data_tests:
      # Volume: row count per time bucket
      - elementary.volume_anomalies:
          time_bucket:
            period: hour
            count: 1

      # Nulls: null rate per column
      - elementary.column_anomalies:
          column_anomalies:
            - null_count
            - null_percent

      # Distribution: value distribution changes
      - elementary.all_columns_anomalies:
          column_anomalies:
            - null_percent
            - zero_percent
```

## Test Coverage Audit

Start by running `node tools/clis/manifest-coverage.js --manifest target/manifest.json` to identify models with no tests, then review `node tools/clis/test-results.js --results target/run_results.json` to see existing failures.

```bash
# List all models with no tests
dbt ls --select "config.materialized:table config.materialized:view" \
  --exclude "*_tests" \
  --output json \
| python3 -c "
import json, sys
for line in sys.stdin:
    obj = json.loads(line)
    if not obj.get('config', {}).get('tests'):
        print(obj['name'])
"

# Run only failing tests
dbt test --store-failures
dbt run-operation elementary.get_test_results

# Check column test coverage
dbt run-operation codegen.generate_model_yaml \
  --args '{"model_names": ["fct_orders"]}'
```

## 7. dbt Unit Tests (dbt 1.8+)

Unit tests mock model inputs and test your SQL logic in isolation — no warehouse connection needed during `dbt parse`.

```yaml
# tests/unit/test_fct_orders_revenue.yml  (or inline in models YAML)
unit_tests:
  - name: test_net_revenue_calculation
    model: fct_orders
    given:
      - input: ref('stg_orders')
        rows:
          - {order_id: 1, unit_price: 100, quantity: 2, discount_amount: 10}
          - {order_id: 2, unit_price: 50,  quantity: 1, discount_amount: 0}
    expect:
      rows:
        - {order_id: 1, net_revenue: 190}
        - {order_id: 2, net_revenue: 50}
```

**When to use unit tests vs data tests:**

| Test type | Purpose | Warehouse needed? |
|-----------|---------|-----------------|
| Unit test | Validate SQL logic with fixed inputs | ❌ No |
| Data test | Validate real data meets constraints | ✅ Yes |
| Singular test | Complex cross-model assertions | ✅ Yes |

Run unit tests: `dbt test --select fct_orders --select-unit-tests-only`

**Testing macros via unit tests** — pass the compiled output:
```yaml
unit_tests:
  - name: test_mask_email_macro
    model: stg_customers
    overrides:
      macros:
        mask_email: "CONCAT('***@', SPLIT_PART(email, '@', 2))"
```

## 8. Custom Generic Tests

Reusable assertions in `tests/generic/`:

```sql
-- tests/generic/assert_no_future_dates.sql
{% test assert_no_future_dates(model, column_name) %}

select *
from {{ model }}
where {{ column_name }} > current_date

{% endtest %}
```

Use in YAML like any built-in test:
```yaml
columns:
  - name: shipped_at
    data_tests:
      - assert_no_future_dates
```

## Test Severity Levels

Classify every test with a severity so CI knows what to block:

```yaml
data_tests:
  - unique:
      config:
        severity: error   # Block deploy — data integrity broken
  - dbt_utils.accepted_range:
      min_value: 0
      config:
        severity: warn    # Investigate — might be a data issue, not code
  - elementary.volume_anomalies:
      config:
        severity: warn    # Monitor — don't break CI for statistical drift
```

| Level | Action |
|-------|--------|
| `error` | Fail CI, block deploy |
| `warn` | Log warning, do not fail CI |

Never deploy with `error` tests failing.

## Testing Best Practices

**Testing pyramid — layer your tests:**

```
Source   → freshness, schema stability
Staging  → PK unique/not_null, FK relationships
Int      → join cardinality (fanout detection)
Marts    → metric bounds, volume thresholds
Metrics  → trend stability, anomaly detection
```

**For every model, minimum test set:**
```yaml
# Primary key
- unique + not_null on primary key column

# Foreign keys
- relationships test for every FK column

# Critical business columns
- accepted_values for categorical columns
- accepted_range for monetary/count columns

# Model-level
- not_null on required columns
```

**Test naming convention:**
```yaml
config:
  name: "fct_orders_revenue_non_negative"  # descriptive name for store_failures
```

**Testing strategy by model tier:**

| Tier | Required tests |
|------|---------------|
| Sources | Freshness, schema stability |
| Staging | PK unique/not_null, source freshness |
| Intermediate | PK unique/not_null, join fanout check |
| Marts (facts) | PK, FK relationships, accepted_values, ranges, row count |
| Marts (dims) | PK, accepted_values, completeness |
| Metrics | Trend anomaly, cross-source reconciliation |

## Incident Response

When tests fail in production:
1. Freeze deploys until scope is understood
2. Identify which models, metrics, and dashboards are affected
3. Notify stakeholders with plain-language impact statement
4. Patch source data or transform logic (don't just silence the test)
5. Backfill affected partitions/incremental windows
6. Add a postmortem test to prevent recurrence

## Verify Your Work

- Run `dbt test` to execute all schema and singular tests.
- Run `dbt test --store-failures` to persist failing rows for inspection.
- Run `node tools/clis/test-results.js --results target/run_results.json` to see a structured summary of pass/fail/warn counts by model.
- Review the output for any `ERROR` severity tests — those must pass before merging or deploying.

## If Something Goes Wrong

- **Test compile error**: The test name references a column that doesn't exist — check spelling against the model's actual column list.
- **Relationship test fails**: Verify the FK column is populated and the referenced PK exists in the target model; add `where: "fk_column is not null"` if NULLs are expected.
- **Too many failures stored**: Add `limit: 500` to the `store_failures` config to prevent bloating the target schema.
- **Elementary not found**: Check `packages.yml` has `elementary-data/elementary`, then run `dbt deps` to install it.
- **`data_tests:` key not recognized**: Your dbt version is older than 1.8 — use the `tests:` key instead.
