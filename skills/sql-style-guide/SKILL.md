---
name: sql-style-guide
description: "Generate or audit SQL style guides for your team, and produce linter configs for SQLFluff or sqlfmt. Use when onboarding a new team, establishing SQL standards, auditing existing SQL for style compliance, or configuring automated SQL linting. Triggers: 'SQL style guide', 'SQL linting', 'SQLFluff config', 'SQL conventions', 'format SQL', 'audit SQL style'."
---

# SQL Style Guide

I'll help you establish SQL coding standards, generate a team style guide, or configure SQLFluff to enforce it automatically.

## Check Context First

Read `.claude/data-stack-context.md` if it exists. Key inputs: warehouse dialect and dbt version.

## Two Modes

1. **Generate**: Create a style guide + linter config from scratch
2. **Audit**: Review existing SQL files and flag violations

---

## The Style Guide

### Naming Conventions

```sql
-- ✅ DO: snake_case, descriptive, no abbreviations
select
    customer_id,
    order_total_amount,
    is_first_purchase,
    created_at

-- ❌ DON'T: camelCase, cryptic abbreviations, Hungarian notation
select
    custId,
    ordTot,
    strCustNm,
    bIsNew
```

**Table/model naming rules:**

| Layer | Prefix | Example |
|-------|--------|---------|
| Source | `src_` (rarely used) | `src_salesforce__accounts` |
| Staging | `stg_` | `stg_salesforce__accounts` |
| Intermediate | `int_` | `int_orders__joined` |
| Facts | `fct_` | `fct_orders` |
| Dimensions | `dim_` | `dim_customers` |
| Metrics | `mtr_` | `mtr_revenue_daily` |

**Column naming rules:**

- Boolean columns: `is_`, `has_`, `does_` prefix → `is_active`, `has_subscription`
- Date columns: `_date` suffix → `created_date`, `shipped_date`
- Timestamp columns: `_at` suffix → `created_at`, `updated_at`
- IDs: `_id` suffix for natural keys, `_key` for surrogate keys → `customer_id`, `customer_key`
- Amounts: `_amount` suffix, always in base currency units → `revenue_amount`

### SELECT Statement Structure

```sql
-- ✅ DO: logical grouping, one column per line, leading commas
with source as (

    select * from {{ source('salesforce', 'account') }}

),

renamed as (

    select
        -- Primary key
        id as account_id,

        -- Foreign keys
        owner_id as owner_salesforce_id,
        parent_id as parent_account_id,

        -- Attributes
        name as account_name,
        type as account_type,
        industry,
        number_of_employees,

        -- Booleans
        (type = 'Customer') as is_customer,

        -- Timestamps
        created_date,
        last_modified_date as updated_at,
        _fivetran_synced

    from source

)

select * from renamed
```

### CTE Conventions

```sql
-- ✅ DO: named CTEs, blank lines between them, final select is simple
with

orders as (

    select * from {{ ref('stg_orders') }}

),

customers as (

    select * from {{ ref('dim_customers') }}

),

joined as (

    select
        orders.order_id,
        orders.order_amount,
        customers.customer_name,
        customers.customer_segment

    from orders
    left join customers
        on orders.customer_id = customers.customer_id

)

select * from joined

-- ❌ DON'T: nested subqueries, unnamed expressions
select
    o.id,
    o.amt,
    (select name from cust where cust.id = o.cust_id) as nm
from orders o
where o.dt > (select max(dt) from orders) - 30
```

### JOIN Formatting

```sql
-- ✅ DO: explicit JOIN type, ON condition indented, table alias matches model name
select
    orders.order_id,
    customers.customer_name,
    products.product_name

from orders
left join customers
    on orders.customer_id = customers.customer_id
inner join products
    on orders.product_id = products.product_id
    and products.is_active = true

-- ❌ DON'T: implicit joins, ON same line, vague aliases
select o.id, c.nm, p.nm
from orders o, customers c, products p
where o.cust_id = c.id and o.prod_id = p.id
```

### WHERE / HAVING / GROUP BY

```sql
-- ✅ DO: one condition per line, AND/OR at start of line
where
    order_status = 'completed'
    and created_at >= '2024-01-01'
    and (
        customer_segment = 'enterprise'
        or order_amount > 10000
    )

-- ✅ DO: use column names in GROUP BY (not positional)
group by
    customer_id,
    order_date,
    customer_segment

-- ❌ DON'T: positional GROUP BY (fragile)
group by 1, 2, 3
```

### Window Functions

```sql
-- ✅ DO: named window with WINDOW clause for reuse
select
    order_id,
    customer_id,
    order_amount,
    row_number() over w as row_number,
    sum(order_amount) over w as running_total,
    lag(order_amount) over w as previous_order_amount

from orders

window w as (
    partition by customer_id
    order by created_at
    rows between unbounded preceding and current row
)

-- Or inline for one-off windows:
select
    customer_id,
    order_id,
    rank() over (
        partition by customer_id
        order by created_at desc
    ) as recency_rank
from orders
```

### Formatting Rules

- **Keywords**: UPPERCASE (`SELECT`, `FROM`, `WHERE`, `LEFT JOIN`, `GROUP BY`)
- **Functions**: UPPERCASE (`COALESCE`, `DATE_TRUNC`, `COUNT`, `SUM`)
- **Identifiers**: lowercase (`customer_id`, `order_amount`)
- **Indentation**: 4 spaces (no tabs)
- **Line length**: max 100 characters
- **Trailing commas vs leading commas**: leading commas preferred in dbt models (easier diff review)

---

## SQLFluff Configuration

### .sqlfluff (project root)

```ini
[sqlfluff]
dialect = snowflake
templater = dbt
max_line_length = 100
indent_unit = space
tab_space_size = 4
fix_even_unparsable = true

# Exclude generated files
exclude_rules = AL01  # Disable if you use * selects in staging

[sqlfluff:indentation]
indent_unit = space
tab_space_size = 4
indented_joins = false
indented_ctes = false
template_blocks_indent = false

[sqlfluff:rules:aliasing.table]
aliasing = explicit

[sqlfluff:rules:aliasing.column]
aliasing = explicit

[sqlfluff:rules:capitalisation.keywords]
capitalisation_policy = upper

[sqlfluff:rules:capitalisation.functions]
extended_capitalisation_policy = upper

[sqlfluff:rules:capitalisation.identifiers]
extended_capitalisation_policy = lower

[sqlfluff:rules:layout.cte_bracket]
# Require blank lines around CTEs
```

### For BigQuery
```ini
[sqlfluff]
dialect = bigquery
templater = dbt
max_line_length = 100
```

### For Databricks
```ini
[sqlfluff]
dialect = sparksql
templater = dbt
max_line_length = 100
```

### .sqlfluff-ignore (skip generated or legacy files)
```
target/
dbt_packages/
seeds/
analyses/
```

### GitHub Actions CI

```yaml
# .github/workflows/sqlfluff.yml
name: SQL Lint

on:
  pull_request:
    paths:
      - 'models/**/*.sql'
      - 'macros/**/*.sql'
      - 'tests/**/*.sql'

jobs:
  sqlfluff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: pip
      - run: pip install sqlfluff sqlfluff-templater-dbt dbt-snowflake
      - run: dbt deps
      - name: Lint
        run: |
          sqlfluff lint models/ \
            --format github-annotation \
            --annotation-level warning
      - name: Check (fail on errors only, not warnings)
        run: sqlfluff lint models/ --nocolor
```

## Audit Mode

When asked to audit existing SQL files, I'll check for:

1. **Naming violations**: columns with camelCase, missing type suffixes
2. **SELECT * in marts**: acceptable in staging, not in marts
3. **Implicit joins**: `FROM a, b WHERE a.id = b.id`
4. **Magic numbers**: `WHERE status = 1` instead of `WHERE status = 'active'`
5. **Positional GROUP BY**: `GROUP BY 1, 2`
6. **Non-SARGable filters**: `WHERE YEAR(created_at) = 2024` (kills index/cluster usage)
7. **Unaliased expressions**: `SELECT a + b FROM ...`
8. **Missing semicolons** (if using non-dbt SQL)

Provide 3-5 SQL files and I'll return a violation report with line numbers and suggested fixes.
