---
name: dbt-unit-testing
description: "Write and run dbt unit tests to validate SQL transformation logic with mocked inputs. Use when you need to unit test a dbt model, mock dbt model inputs, test SQL logic without a warehouse connection, write dbt 1.8 tests, add dbt unit test fixtures, or test edge cases like null handling and division by zero. Triggers: 'unit test', 'mock dbt model', 'test SQL logic', 'dbt unit test', 'dbt 1.8 tests', 'test my model logic', 'fixture', 'mock ref', 'warehouse-free testing'."
---

# dbt Unit Testing

I'll help you write dbt unit tests that validate SQL transformation logic using mocked inputs — no warehouse connection required.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: dbt version (must be 1.8+), warehouse type, existing test patterns, CI platform.

## Unit Tests vs Data Tests vs Singular Tests

| Test type | Question answered | Runs against | Needs warehouse? |
|-----------|------------------|--------------|-----------------|
| **Unit test** | Does my SQL do what I think it does? | Mocked fixtures | No |
| **Generic/schema test** | Does my data look right? (nulls, uniques, FKs) | Live data | Yes |
| **Singular test** | Does this specific assertion hold in prod? | Live data | Yes |

**Use unit tests when:**
- Building or refactoring a model with non-trivial SQL (CASE, window functions, aggregations)
- Testing edge cases (nulls, zeroes, boundary dates) that may not exist in dev data
- You want fast feedback in CI before connecting to the warehouse

**Use data tests when:**
- Asserting ongoing data quality (uniqueness, referential integrity, accepted values)
- You care about production data state, not SQL correctness

**Use singular tests when:**
- You have a cross-model consistency rule that generic tests can't express

---

## Basic Unit Test YAML Format

Unit tests live in `schema.yml` alongside the model definition, under a top-level `unit_tests:` key.

```yaml
# models/marts/finance/schema.yml
models:
  - name: fct_orders
    description: "One row per order with computed revenue fields."
    columns:
      - name: order_id
        data_tests: [unique, not_null]

unit_tests:
  - name: test_net_revenue_calculation
    model: fct_orders          # model being tested
    given:                     # mocked upstream inputs
      - input: ref('stg_orders')
        rows:
          - {order_id: 1, gross_amount: 100.00, discount_amount: 10.00, refunded: false}
          - {order_id: 2, gross_amount: 50.00,  discount_amount: 0.00,  refunded: false}
          - {order_id: 3, gross_amount: 75.00,  discount_amount: 5.00,  refunded: true}
    expect:                    # expected output rows (all columns you want to assert)
      rows:
        - {order_id: 1, net_revenue: 90.00}
        - {order_id: 2, net_revenue: 50.00}
        - {order_id: 3, net_revenue: 0.00}   # refunded orders contribute nothing
```

**Rules:**
- `given:` mocks every `ref()` and `source()` your model calls. If you omit one, dbt will error.
- `expect:` only needs the columns you care about asserting — extra columns in the model output are ignored.
- Column types are inferred; you don't need to declare schemas for fixture rows.

---

## Inline Fixture Example — Revenue Calculation

The model under test:

```sql
-- models/marts/finance/fct_orders.sql
select
    order_id,
    gross_amount,
    discount_amount,
    case
        when refunded then 0
        else gross_amount - discount_amount
    end as net_revenue,
    case
        when gross_amount = 0 then null
        else round((discount_amount / gross_amount) * 100, 2)
    end as discount_pct
from {{ ref('stg_orders') }}
```

The unit test:

```yaml
unit_tests:
  - name: test_fct_orders_revenue_logic
    model: fct_orders
    given:
      - input: ref('stg_orders')
        rows:
          - {order_id: 1, gross_amount: 200.00, discount_amount: 20.00, refunded: false}
          - {order_id: 2, gross_amount: 100.00, discount_amount: 0.00,  refunded: false}
          - {order_id: 3, gross_amount: 50.00,  discount_amount: 5.00,  refunded: true}
          - {order_id: 4, gross_amount: 80.00,  discount_amount: 10.00, refunded: false}
    expect:
      rows:
        - {order_id: 1, net_revenue: 180.00, discount_pct: 10.00}
        - {order_id: 2, net_revenue: 100.00, discount_pct: 0.00}
        - {order_id: 3, net_revenue: 0.00,   discount_pct: 10.00}
        - {order_id: 4, net_revenue: 70.00,  discount_pct: 12.50}
```

---

## Testing Edge Cases

Always test nulls, zero denominators, and boundary values explicitly — these are the cases most likely to slip through in dev data.

**Model with guards:**

```sql
-- models/marts/finance/fct_customer_metrics.sql
select
    customer_id,
    total_orders,
    total_revenue,
    -- guard against division by zero
    case
        when total_orders = 0 then null
        else round(total_revenue / total_orders, 2)
    end as avg_order_value,
    -- null-safe status assignment
    coalesce(segment, 'unknown')            as segment,
    -- type-safe date diff (days since first order)
    {{ datediff('first_order_date', 'current_date', 'day') }} as days_since_first_order
from {{ ref('stg_customer_summary') }}
```

**Unit test covering the edge cases:**

```yaml
unit_tests:
  - name: test_customer_metrics_edge_cases
    model: fct_customer_metrics
    given:
      - input: ref('stg_customer_summary')
        rows:
          # Normal case
          - {customer_id: 1, total_orders: 5, total_revenue: 500.00, segment: 'vip',  first_order_date: '2024-01-01'}
          # Zero orders — avg_order_value must be null, not error
          - {customer_id: 2, total_orders: 0, total_revenue: 0.00,   segment: 'new',  first_order_date: '2024-06-01'}
          # Null segment — must coalesce to 'unknown'
          - {customer_id: 3, total_orders: 2, total_revenue: 80.00,  segment: null,   first_order_date: '2023-11-15'}
          # Single order, exact revenue
          - {customer_id: 4, total_orders: 1, total_revenue: 99.99,  segment: 'standard', first_order_date: '2025-01-01'}
    expect:
      rows:
        - {customer_id: 1, avg_order_value: 100.00, segment: 'vip'}
        - {customer_id: 2, avg_order_value: null,   segment: 'new'}
        - {customer_id: 3, avg_order_value: 40.00,  segment: 'unknown'}
        - {customer_id: 4, avg_order_value: 99.99,  segment: 'standard'}
```

Note: `days_since_first_order` is omitted from `expect:` because it depends on `current_date` — don't assert on time-relative values in unit tests. Override them instead (see `overrides:` below).

---

## CSV Fixtures for Larger Datasets

When inline rows become unwieldy (more than ~10 rows), use CSV fixture files.

**Directory convention:**

```
tests/
  fixtures/
    fct_orders/
      stg_orders.csv
      stg_products.csv
    fct_customer_metrics/
      stg_customer_summary.csv
```

**CSV file:**

```csv
# tests/fixtures/fct_orders/stg_orders.csv
order_id,gross_amount,discount_amount,refunded
1,200.00,20.00,false
2,100.00,0.00,false
3,50.00,5.00,true
4,80.00,10.00,false
5,0.00,0.00,false
```

**YAML referencing the CSV:**

```yaml
unit_tests:
  - name: test_fct_orders_from_csv
    model: fct_orders
    given:
      - input: ref('stg_orders')
        format: csv
        fixture:
          path: tests/fixtures/fct_orders/stg_orders.csv
    expect:
      rows:
        - {order_id: 1, net_revenue: 180.00}
        - {order_id: 2, net_revenue: 100.00}
        - {order_id: 3, net_revenue: 0.00}
        - {order_id: 4, net_revenue: 70.00}
        - {order_id: 5, net_revenue: 0.00}
```

Use CSV fixtures when: dataset has 10+ rows, fixtures are reused across multiple tests, or the data was exported from a real system.

---

## The `overrides:` Block

Use `overrides:` to mock `var()`, `env_var()`, `ref()` calls to other models, and macros that depend on runtime context.

```yaml
unit_tests:
  - name: test_fct_orders_with_overrides
    model: fct_orders
    overrides:
      # Mock dbt variables
      vars:
        fiscal_year_start_month: 4
        discount_cap_pct: 50

      # Mock environment variables
      env_vars:
        PRICING_TIER: 'enterprise'

      # Mock a ref() to a model you don't want to populate in given:
      # (useful when your model conditionally refs something based on a var)
      macros:
        is_incremental: false   # force the full-refresh path in incremental models

    given:
      - input: ref('stg_orders')
        rows:
          - {order_id: 1, gross_amount: 100.00, discount_amount: 60.00, refunded: false}
    expect:
      rows:
        # With discount_cap_pct=50, discount is capped at 50% of gross
        - {order_id: 1, net_revenue: 50.00}
```

**Override `current_date` for time-sensitive logic:**

```yaml
overrides:
  macros:
    dbt_utils.current_timestamp: "'2025-01-15 00:00:00'"
```

This is the correct way to get deterministic output from models that call date functions.

---

## Running Unit Tests

```bash
# Run all unit tests for a single model
dbt test --select fct_orders --indirect-selection=cautious

# Run only unit tests (exclude data tests) for a model
dbt test --select fct_orders,test_type:unit

# Run unit tests for a model and all its upstream dependencies
dbt build --select +fct_orders

# Store failures as tables for inspection
dbt test --select fct_orders --store-failures

# Run across the whole project (useful in CI)
dbt test --select test_type:unit

# Parse only — validates YAML syntax without running anything
dbt parse
```

**`--indirect-selection=cautious`** is recommended when running tests on a single model — it prevents dbt from also running tests that only indirectly depend on your model.

**`--store-failures`** writes failing rows to `<target_schema>_failures.test_name` tables so you can inspect what was expected vs. what the model actually returned.

---

## CI Integration — No Warehouse Needed

Unit tests require no warehouse connection. This makes them ideal as a fast pre-flight check in CI, before any warehouse-dependent steps run.

```yaml
# .github/workflows/dbt-ci.yml
name: dbt CI

on:
  pull_request:
    branches: [main]
    paths:
      - 'models/**'
      - 'macros/**'
      - 'tests/**'
      - 'dbt_project.yml'

jobs:
  # Stage 1: warehouse-free checks (fast, cheap, fail-fast)
  dbt-parse-and-unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: pip

      - name: Install dbt
        run: pip install dbt-core==1.8.*
        # dbt-core only — no warehouse adapter needed for unit tests

      - name: Install dbt packages
        run: dbt deps

      - name: Parse project (syntax check)
        run: dbt parse
        # Validates all YAML and Jinja without connecting to a warehouse

      - name: Run unit tests
        run: dbt test --select test_type:unit
        # No warehouse credentials required

  # Stage 2: warehouse-dependent checks (slower, only runs after Stage 1 passes)
  dbt-integration-tests:
    runs-on: ubuntu-latest
    needs: dbt-parse-and-unit-tests   # only runs if stage 1 passes
    environment: ci
    env:
      DBT_SNOWFLAKE_ACCOUNT: ${{ secrets.SNOWFLAKE_ACCOUNT }}
      DBT_SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_USER }}
      DBT_SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: pip

      - name: Install dbt with adapter
        run: pip install dbt-snowflake==1.8.*

      - name: Install dbt packages
        run: dbt deps

      - name: Build modified models + data tests
        run: |
          dbt build \
            --select state:modified+ \
            --defer \
            --state ./prod-manifest \
            --exclude test_type:unit   # unit tests already ran in stage 1
```

**Key principle:** Install only `dbt-core` in Stage 1 — no adapter package means no accidental warehouse connections and faster installs.

---

## Testing Models That Call Macros

Unit tests exercise the compiled SQL, so macros are expanded at parse time. You don't need to do anything special — just feed the model mock data and assert on the output.

**Model using a macro:**

```sql
-- models/marts/finance/fct_orders_converted.sql
select
    order_id,
    amount_usd,
    -- macro that applies currency conversion logic
    {{ convert_currency('amount_usd', 'currency_code', var('default_currency')) }} as amount_local
from {{ ref('stg_orders') }}
```

**Unit test — macro is transparent:**

```yaml
unit_tests:
  - name: test_currency_conversion_macro
    model: fct_orders_converted
    overrides:
      vars:
        default_currency: 'EUR'
    given:
      - input: ref('stg_orders')
        rows:
          - {order_id: 1, amount_usd: 100.00, currency_code: 'EUR'}
          - {order_id: 2, amount_usd: 100.00, currency_code: 'GBP'}
    expect:
      rows:
        - {order_id: 1, amount_local: 92.00}   # assert the macro's output, not its internals
        - {order_id: 2, amount_local: 79.00}
```

If the macro's logic itself has branches, cover them with separate unit tests feeding different input rows — not by mocking the macro itself.

---

## Checklist Before Shipping a New Model

- [ ] Unit test covers the primary transformation logic (the `CASE`, `JOIN`, aggregation that is the point of the model)
- [ ] Unit test covers at least one null input per nullable column
- [ ] Unit test covers division-by-zero or empty-set edge cases where applicable
- [ ] `dbt parse` passes (validates YAML syntax)
- [ ] `dbt test --select test_type:unit` passes locally
- [ ] CI Stage 1 (unit tests, no warehouse) is gated before Stage 2 (data tests, warehouse)
- [ ] Time-dependent columns use `overrides:` or are excluded from `expect:` assertions
