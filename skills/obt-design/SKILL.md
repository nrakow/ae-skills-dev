---
name: obt-design
description: "Design and build One Big Table (OBT) models — wide, pre-joined, denormalized datasets that eliminate BI-layer joins for self-service analytics. Use when building executive dashboards, replacing ad-hoc extracts, supporting non-technical users, or reducing Tableau/Metabase/Power BI join complexity. Triggers: 'one big table', 'OBT', 'wide table', 'flatten for BI', 'denormalized mart', 'self-service dataset', 'dashboard table', 'pre-joined'."
triggers:
  - "one big table"
  - "OBT"
  - "wide table"
  - "flatten for BI"
  - "denormalized mart"
  - "self-service dataset"
  - "dashboard table"
  - "pre-joined"
  - "executive reporting table"
reads_first:
  - data-stack-context
  - data-modeling
  - marts-design
consumes:
  - "data-modeling: fact and dimension tables"
  - "marts-design: mart layer conventions"
produces:
  - "OBT model SQL"
  - "schema YAML with column-level docs"
  - "dbt tests for row stability and nulls"
validates_with:
  - "dbt compile"
  - "dbt run"
  - "dbt test --select <obt_model>"
---

# OBT Design

I'll help you design and build One Big Table (OBT) models — wide, pre-joined datasets that make self-service analytics fast and reliable for business users who don't want to write joins.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: BI tool in use (Tableau, Metabase, Looker, Power BI), warehouse type, and whether dimensional models already exist upstream.

## Before You Start

- Confirm the upstream fact and dimension tables exist and are tested before building an OBT on top of them.
- Clarify the target audience: who will query this table, and what do they filter on most often?
- Define the grain before writing any SQL: "one row per ___." If you can't state it in one sentence, stop and clarify.
- Check `marts/obt/` for existing OBTs — don't build a duplicate for the same grain and audience.

## What Is an OBT?

An OBT is a mart-layer table that pre-joins a fact table to all its relevant dimensions, producing a single wide table a business user can `SELECT` from without joining anything.

```
fct_orders + dim_user + dim_product + dim_date
        ↓
   obt_orders   ← one wide table, fully denormalized
```

OBTs are **downstream products** — they consume from fact/dim tables and expose clean, business-friendly columns. Nothing upstream should depend on an OBT.

---

## Step 1: Declare the Grain

State it explicitly in the model's YAML description and as a comment at the top of the SQL:

```sql
-- Grain: one row per order
-- Source: fct_orders + dim_user + dim_product
-- Owner: Analytics
-- Audience: Finance, Sales ops, Tableau dashboards

select ...
```

If the grain changes between `fct_orders` and this OBT, that's a bug — not a design choice.

---

## Step 2: Join Pattern (Fact ← Dimensions Only)

Always join **fact to dimensions** — never dimension to fact, and never fact to fact.

```sql
select
    -- identifiers
    o.order_id,
    o.order_date,

    -- user attributes
    u.user_country,
    u.user_plan_type,
    u.user_signup_channel,

    -- product attributes
    p.product_name,
    p.product_category,
    p.product_price_tier,

    -- measures
    o.total_revenue_usd,
    o.quantity,
    o.is_refunded

from {{ ref('fct_orders') }} o
left join {{ ref('dim_user') }} u on o.user_sk = u.user_sk and u.is_current
left join {{ ref('dim_product') }} p on o.product_sk = p.product_sk and p.is_current
```

**Why LEFT JOIN?** Fact rows must be preserved even if a dimension record is missing. An INNER JOIN silently drops fact rows with no matching dimension.

---

## Step 3: Column Naming

Use `<entity>_<attribute>` for all non-measure columns. This prevents ambiguity when the table is 40+ columns wide.

```sql
-- ✅ Clear
u.country          as user_country,
u.plan_type        as user_plan_type,
p.category         as product_category,
p.name             as product_name,

-- ❌ Ambiguous
u.country          as country,   -- country of what?
p.name             as name,      -- name of what?
```

**What to include:**
- Human-readable labels and categories from dimensions
- Commonly filtered attributes (channel, region, plan type)
- All measures from the fact table

**What to exclude:**
- Surrogate keys (`user_sk`, `product_sk`) — business users never need these
- SCD metadata (`is_current`, `effective_from`, `effective_to`)
- Raw JSON blobs or debug columns
- Columns used by fewer than ~20% of queries ("just in case" columns inflate cost)

---

## Step 4: Directory and Materialization

```
models/
  marts/
    obt/
      obt_orders.sql
      obt_sessions_daily.sql
```

Always materialize OBTs as **tables**, not views:

```yaml
# dbt_project.yml
models:
  my_project:
    marts:
      obt:
        +materialized: table
        +schema: obt
```

Views re-execute the join logic on every query — for OBTs used by dashboards running dozens of queries per hour, this creates unnecessary cost.

---

## Step 5: YAML Documentation

Every column must be documented. Business users rely on column descriptions as the only documentation they'll read.

```yaml
models:
  - name: obt_orders
    description: >
      Executive reporting table. One row per completed order.
      Grain: order_id. Sources: fct_orders, dim_user, dim_product.
      Owner: Analytics. Audience: Finance, Sales ops, Tableau.
    columns:
      - name: order_id
        description: "Unique order identifier."
        tests:
          - not_null
          - unique

      - name: user_country
        description: "Country of the user who placed the order, from dim_user."
        tests:
          - not_null

      - name: total_revenue_usd
        description: "Net revenue in USD after refunds and discounts."
        tests:
          - not_null
          - dbt_utils.expression_is_true:
              expression: ">= 0"
```

---

## Required Tests

### 1. Primary key integrity
```yaml
- not_null:
    column_name: order_id
- unique:
    column_name: order_id
```

### 2. Row count matches source fact
Confirm no rows are lost or duplicated by the joins:

```sql
-- tests/assert_obt_orders_matches_fct_orders.sql
select count(*) as delta
from (
    select order_id from {{ ref('obt_orders') }}
    except
    select order_id from {{ ref('fct_orders') }}
)
having delta != 0
```

### 3. Fanout detection
Verify the join didn't multiply rows (a many-to-many join symptom):

```sql
-- tests/assert_obt_orders_no_fanout.sql
select
    count(*)                        as total_rows,
    count(distinct order_id)        as distinct_keys,
    count(*) / count(distinct order_id) as fanout_ratio
from {{ ref('obt_orders') }}
having fanout_ratio > 1.001
```

### 4. Null control on critical dimensions
```yaml
- not_null:
    column_name: user_country
- not_null:
    column_name: product_category
```

---

## Common Mistakes to Avoid

**Mega OBT (100+ columns)**
Split by audience. One OBT for Finance (revenue focus), another for Product (engagement focus). Wide tables slow down BI tools and confuse users.

**Joining fact to fact**
```sql
-- ❌ Never do this
from fct_orders o
join fct_sessions s on o.user_id = s.user_id  -- fan-out disaster
```
If you need session data alongside order data, pre-aggregate sessions in an intermediate model first.

**Hidden filters**
```sql
-- ❌ Hidden: silently excludes data
where o.status != 'test'
```
OBTs must be fully transparent. If you need to exclude test orders, document it prominently in the model description. Downstream users will be confused when their counts don't match the source.

**DISTINCT as a fix**
If `SELECT DISTINCT` is the only thing keeping your row count correct, you have a join problem. Fix the join — don't mask it.

**Logic leakage**
Don't calculate metrics inside the OBT:
```sql
-- ❌ Metric logic hidden in OBT
sum(revenue) / nullif(count(distinct user_id), 0) as arpu
```
Metrics belong in the semantic layer or a named metric model. OBTs assemble columns — they don't compute KPIs.

---

## Incremental OBTs (Large Tables)

For OBTs over ~50M rows, use incremental materialization:

```sql
{{ config(
    materialized='incremental',
    unique_key='order_id',
    incremental_strategy='merge',   -- Snowflake / Redshift
    -- incremental_strategy='insert_overwrite',  -- BigQuery (partition by order_date)
    partition_by={"field": "order_date", "data_type": "date"}  -- BigQuery only
) }}

select ...
from {{ ref('fct_orders') }} o
left join {{ ref('dim_user') }} u on o.user_sk = u.user_sk and u.is_current

{% if is_incremental() %}
where o.order_date >= date_sub(current_date(), interval 7 day)
{% endif %}
```

Always include a 7-day lookback window to catch late-arriving dimension updates (e.g., a user's plan changing after the order was placed).

---

## Verify Your Work

**Do not present output as complete until all checks pass.**

- Run `dbt compile --select obt_*` to confirm models compile without errors.
- Run `dbt run --select obt_*` to confirm the table materializes.
- Run `dbt test --select obt_*` to confirm primary key uniqueness, row count parity with source fact, and no fanout.
- Open the table in your BI tool and confirm columns are named correctly and no business user would need to write a join.

## If Something Goes Wrong

- **Row count higher than source fact**: A dimension join is producing multiple matches (M:M). Add `and dim.is_current` to SCD Type 2 dimensions, or deduplicate the dimension before joining.
- **Row count lower than source fact**: An INNER JOIN is dropping fact rows with no dimension match. Switch to LEFT JOIN and investigate why dimension records are missing.
- **`SELECT DISTINCT` needed to fix counts**: You have a join fan-out. Don't patch with DISTINCT — find the join causing the duplication and fix it upstream.
- **Surrogate key appears in output**: A `SELECT *` or explicit SK column was included. Remove it — replace with the natural key or human-readable label.
- **BI tool query is slow**: OBT is materialized as a view. Change to `materialized: table`. If it's incremental, confirm partition pruning is working.
