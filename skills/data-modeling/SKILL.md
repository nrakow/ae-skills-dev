---
name: data-modeling
description: "Design dimensional data models, fact and dimension tables, and dbt model architecture. Use when planning a new data domain, when you're not sure how to structure tables, when choosing between star schema vs wide table vs Data Vault, or when a new source needs proper modeling. Fires for 'I have raw data and don't know where to start,' 'should I normalize or denormalize?', or 'my tables are a mess and queries are slow.' Covers grain decisions, surrogate keys, conformed dimensions, and slowly changing attributes. Use this whenever someone needs to design, restructure, or rethink how data is organized in the warehouse. For staging patterns, see staging-layer. For mart layer, see marts-design. For SCD handling, see slowly-changing-dimensions."
triggers:
  - "model my data"
  - "design data model"
  - "dimensional modeling"
  - "data architecture"
  - "entity model"
  - "star schema"
  - "fact and dimension tables"
  - "how should I structure this data"
  - "what should the grain be"
  - "wide table or star schema"
  - "Data Vault"
  - "surrogate keys"
  - "new data domain"
  - "normalize or denormalize"
  - "design tables for reporting"
reads_first:
  - data-stack-context
cli_tools:
  - schema-introspect.js
  - manifest-parse.js
produces:
  - "entity-relationship diagram"
  - "dbt model SQL stubs"
  - "schema.yml"
validates_with:
  - "dbt compile"
---

# Data Modeling

I'll help you design warehouse-optimized data models — fact tables, dimension tables, and marts — tailored to your specific warehouse and reporting needs.

## Before You Start

Gather these before generating model SQL to avoid mismatches with the existing project:
- `dbt_project.yml` — confirm model paths and default materializations
- `models/staging/*/schema.yml` and `models/intermediate/*/schema.yml` — understand available columns and existing tests
- `macros/` directory — check for available macros like `generate_surrogate_key` overrides before generating SQL
- Run `node tools/clis/schema-introspect.js --help` to introspect your warehouse schema without writing a query

## Check Context First

Read `.claude/data-stack-context.md` if it exists. If not, ask: Which warehouse (Snowflake / BigQuery / Databricks / Redshift / DuckDB)?

## Step 1: Clarify the Business Process

Before drawing any tables, answer:

1. **What business process are we modeling?** (Orders, sessions, subscriptions, support tickets, etc.)
2. **What is the grain?** One row = one ___? (order, order-line-item, daily session, etc.)
3. **Who will query this?** (Analysts building dashboards, data scientists, BI tool)
4. **What are the key metrics?** (Revenue, count of events, duration, etc.)
5. **What dimensions slice those metrics?** (Date, customer, product, geography, etc.)

## Step 2: Choose a Schema Pattern

### Star Schema (Default)
Use when: denormalized queries, BI tools, Snowflake/BigQuery/Redshift.

```
fct_orders
├── order_id (PK)
├── customer_key (FK → dim_customers)
├── product_key (FK → dim_products)
├── date_key (FK → dim_dates)
├── order_amount
└── quantity

dim_customers (denormalized — no separate dim_geographies)
├── customer_key (PK surrogate)
├── customer_id (NK natural key)
├── customer_name
├── country, region, city
└── customer_segment
```

### Snowflake Schema
Use when: storage optimization required, high-cardinality dimensions with shared sub-dimensions.

```
dim_customers → dim_regions → dim_countries
```

**Recommendation**: Default to star schema. Only snowflake if dimension tables exceed 50M+ rows and storage is constrained.

## Step 3: Define the Fact Table

### Fact Table Template

```sql
-- fct_orders: grain = one row per order line item
-- Additive measures: revenue, quantity (sum across any dimension)
-- Semi-additive: account_balance (sum across products, not dates)
-- Non-additive: unit_price (average, not sum)

select
    -- Surrogate keys (hashed or sequence)
    {{ dbt_utils.generate_surrogate_key(['order_id', 'line_item_id']) }} as order_line_key,

    -- Foreign keys to dimensions
    customer_key,
    product_key,
    date_key,

    -- Natural/business keys (for debugging)
    order_id,
    line_item_id,

    -- Degenerate dimensions (no separate dim table needed)
    order_status,
    payment_method,

    -- Measures
    unit_price,
    quantity,
    discount_amount,
    unit_price * quantity - discount_amount as net_revenue,

    -- Timestamps
    ordered_at,
    shipped_at,
    delivered_at

from {{ ref('stg_orders') }}
```

### Fact Table Types

| Type | Example | When to use |
|------|---------|-------------|
| **Transaction** | fct_orders | Each row = discrete event |
| **Periodic snapshot** | fct_daily_inventory | One row per entity per period |
| **Accumulating snapshot** | fct_order_lifecycle | Track multi-stage processes |

## Step 4: Define Dimension Tables

### SCD Type 1 (Overwrite — default for most dims)

```sql
-- dim_customers: SCD Type 1
-- Use when historical values don't matter (e.g., email corrections)

select
    {{ dbt_utils.generate_surrogate_key(['customer_id']) }} as customer_key,
    customer_id,
    customer_name,
    email,
    customer_segment,
    country,
    region,
    city,
    created_at,
    updated_at

from {{ ref('stg_customers') }}
```

### SCD Type 2 (Track history — for slowly changing attributes)

```sql
-- dim_customers_history: SCD Type 2
-- Use when historical values matter (e.g., customer segment changes)

select
    {{ dbt_utils.generate_surrogate_key(['customer_id', 'dbt_scd_id']) }} as customer_key,
    customer_id,
    customer_segment,
    -- Validity window
    dbt_valid_from,
    dbt_valid_to,
    dbt_is_deleted,
    -- Current record flag
    (dbt_valid_to is null) as is_current

from {{ ref('snapshot_customers') }}
```

Use [dbt snapshots](https://docs.getdbt.com/docs/build/snapshots) for SCD Type 2.

### Date Dimension

Always use a spine-based date dimension — never generate dates in fact queries:

```sql
-- dim_dates: generated via dbt_utils date_spine
-- Range: 5 years back, 2 years forward from today

with date_spine as (
    {{ dbt_utils.date_spine(
        datepart="day",
        start_date="cast('2019-01-01' as date)",
        end_date="cast('2027-12-31' as date)"
    ) }}
)
select
    cast(date_day as date) as date_key,
    extract(year from date_day) as year,
    extract(quarter from date_day) as quarter,
    extract(month from date_day) as month_number,
    format_date('%B', date_day) as month_name,  -- BigQuery
    -- format('%B', date_day) in Snowflake: monthname(date_day)
    extract(week from date_day) as iso_week,
    extract(dayofweek from date_day) as day_of_week,
    (extract(dayofweek from date_day) in (1, 7)) as is_weekend,
    -- Fiscal periods (adjust offsets for your fiscal year)
    date_add(date_day, interval 3 month) as fiscal_date,
    extract(year from date_add(date_day, interval 3 month)) as fiscal_year,
    extract(quarter from date_add(date_day, interval 3 month)) as fiscal_quarter

from date_spine
```

## Step 5: Warehouse-Specific Optimizations

### Snowflake
```sql
-- Cluster fact tables on high-cardinality filter columns
alter table fct_orders cluster by (ordered_at::date, customer_key);

-- Use automatic clustering for tables > 1TB
alter table fct_orders enable automatic clustering;
```

### BigQuery
```sql
-- Partition + cluster (BigQuery partitioning is mandatory for large tables)
{{ config(
    partition_by={
        "field": "ordered_at",
        "data_type": "timestamp",
        "granularity": "day"
    },
    cluster_by=["customer_key", "product_key"]
) }}
```

### Databricks (Delta Lake)
```sql
{{ config(
    file_format='delta',
    partition_by=['ordered_date'],
    post_hook="OPTIMIZE {{ this }} ZORDER BY (customer_key, product_key)"
) }}
```

### Redshift
```sql
{{ config(
    dist='customer_key',      -- distkey: join column used most
    sort=['ordered_at']       -- sortkey: most common filter
) }}
```

## Step 6: dbt YAML Documentation

Always document every model and column:

```yaml
models:
  - name: fct_orders
    description: "One row per order line item. Primary source of truth for revenue reporting."
    config:
      contract:
        enforced: true
    columns:
      - name: order_line_key
        description: "Surrogate key: hash of order_id + line_item_id"
        data_tests:
          - unique
          - not_null
      - name: customer_key
        description: "FK to dim_customers"
        data_tests:
          - not_null
          - relationships:
              to: ref('dim_customers')
              field: customer_key
      - name: net_revenue
        description: "unit_price × quantity − discount_amount. Additive."
        data_tests:
          - not_null
          - dbt_utils.accepted_range:
              min_value: -10000  # Allow refunds
              max_value: 1000000
```

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

After generating model SQL and schema.yml, confirm the model compiles and appears in lineage:

```bash
dbt compile
node tools/clis/manifest-parse.js --manifest target/manifest.json
```

Check the manifest-parse output to confirm the new model appears with the expected upstream refs. Fix any compilation errors before proceeding to tests.

## If Something Goes Wrong

- **Circular reference error**: A `ref()` in the model points back to a downstream model. Trace the ref() chain and break the cycle — usually by moving shared logic to an intermediate model.
- **Missing upstream model**: The staging layer model referenced by `ref()` does not exist yet. Check the `models/staging/` directory; run the staging-layer skill first if needed.
- **Naming collision**: A model with the same name already exists. Run `node tools/clis/manifest-parse.js --manifest target/manifest.json` to list existing model names before finalizing the new model name.
- **Surrogate key null**: `dbt_utils.generate_surrogate_key()` returns null if any input column is null. Coalesce null-able key columns before passing them to the macro.

## Common Mistakes to Avoid

- **Wrong grain**: Mixing order-level and line-item-level in one fact table — split into two facts
- **Measures in dimensions**: Don't put `lifetime_value` in `dim_customers` — compute it in a mart
- **Missing surrogate keys**: Always use surrogate keys; natural keys change over time
- **No date spine**: Avoid `generate_series` in live queries; pre-build `dim_dates`
- **Over-normalized**: Don't create `dim_cities → dim_regions → dim_countries` for 3 rows each

## Common AI Failure Modes

Specific mistakes AI assistants frequently make when generating dimensional models:

### 1. "Kitchen Sink" Tables
Combining events, users, revenue, and products into a single wide table. Destroys governance and makes grain undefinable. Separate concerns into distinct facts and dimensions.

### 2. Implicit Grain Explosion
Joining sessions → users → orders without checking cardinality. A single M:M join silently multiplies rows. Always validate with a fanout check before committing:
```sql
SELECT
    COUNT(*) AS total_rows,
    COUNT(DISTINCT primary_key) AS distinct_keys,
    COUNT(*) / COUNT(DISTINCT primary_key) AS fanout_ratio
FROM {{ ref('your_model') }}
HAVING fanout_ratio > 1.001
```

### 3. Natural Key Drift
Source systems reassign IDs over time. Without surrogate keys, metric corruption is silent and irreversible. Always use `dbt_utils.generate_surrogate_key()`.

### 4. `SELECT DISTINCT` to Hide Fanout
Adding `DISTINCT` to hide a join cardinality bug masks the root cause and produces wrong aggregations. Fix the join logic instead.

### 5. Snapshot Misuse
Using raw `dbt snapshot` output directly as a dimension. Snapshots are raw history — always build a `dim_*_history.sql` on top with `valid_from`, `valid_to`, `is_current`.

## Output Checklist

I'll produce:
- [ ] ERD diagram (Mermaid or text-based)
- [ ] Fact table DDL / dbt model skeleton
- [ ] Dimension table DDL / dbt model skeleton
- [ ] dbt YAML with column-level docs and tests
- [ ] Warehouse-specific config (partition, cluster, dist/sort)
