---
name: data-quality-testing
description: "Write dbt tests, custom SQL assertions, and schema validations for data quality. Use when adding tests to a dbt project, writing custom data quality checks, setting up test coverage for a new model, or auditing test coverage gaps. Triggers: 'dbt tests', 'data quality tests', 'add tests to model', 'schema tests', 'SQL assertions', 'test coverage', 'write a test for'."
---

# Data Quality Testing

I'll help you write comprehensive dbt tests — from basic schema tests to complex custom SQL assertions — that catch data quality issues before they reach dashboards.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: dbt version, packages installed (dbt_utils, Elementary), warehouse type.

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

Check what's missing:

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

## Testing Best Practices

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
| Staging | PK unique/not_null, source freshness |
| Intermediate | PK unique/not_null |
| Marts (facts) | PK, FK relationships, accepted_values, ranges, row count |
| Marts (dims) | PK, accepted_values, completeness |
