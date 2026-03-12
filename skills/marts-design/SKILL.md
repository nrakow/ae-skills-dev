---
name: marts-design
description: "Design and build the dbt mart layer -- fact tables, dimension tables, star schemas, and business-ready reporting models. Use when stakeholders need a new report, you are modeling a business process, designing a data mart for a domain like finance or marketing, or your BI tool needs clean tables to query. Also fires for 'I need a reporting table', 'how should I model orders', 'what grain should my fact table be', 'build a star schema', or 'analysts need a clean table'. Use this whenever you need to create business-facing dbt models. For the upstream staging layer, see staging-layer. For defining metrics on top of marts, see metrics-layer. For full end-to-end mart creation, see new-mart-build. For entity-relationship modeling, see data-modeling."
triggers:
  - "design a mart"
  - "fact table"
  - "dimension table"
  - "build a mart"
  - "star schema"
  - "fct_ model"
  - "dim_ model"
  - "reporting model"
  - "I need a reporting table"
  - "how should I model orders"
  - "what grain should this be"
  - "snowflake schema"
  - "business-ready model"
  - "analysts need a clean table"
  - "new data mart"
reads_first:
  - data-stack-context
  - data-modeling
  - staging-layer
consumes:
  - "data-modeling: entity-relationship diagram"
  - "staging-layer: stg_ model SQL"
cli_tools:
  - manifest-parse.js
  - schema-introspect.js
produces:
  - "fct_ or dim_ model SQL"
  - "schema.yml with column docs"
validates_with:
  - "dbt compile"
  - "dbt test --select marts"
---

# Marts Design

I'll help you design the data mart layer — the business-facing output of your dbt project — with clear domain ownership, consistent grain, and BI-ready structure.

## Before You Start

Read and check these before generating mart SQL to avoid naming collisions and understand available inputs:
- `.claude/data-stack-context.md` — BI tool, warehouse type, and team structure determine mart design choices
- `dbt_project.yml` — confirm mart model paths and default materializations under the `marts:` key
- Existing `schema.yml` files in `models/staging/` and `models/intermediate/` — understand available columns before designing joins
- Run `node tools/clis/manifest-parse.js --manifest target/manifest.json` if a compiled manifest exists to see all available `ref()` targets and avoid naming collisions

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: BI tool, team structure, warehouse type.

## What Belongs in a Mart?

**Marts are the final, stable layer for business consumption.** They should be:

- **Wide**: Pre-joined, pre-aggregated where appropriate — minimize joins in BI
- **Business-named**: Use business language, not technical terms
- **Owned**: Each mart has a clear business domain owner
- **Stable**: Column names don't change without deprecation notices
- **Documented**: Every column has a description and agreed-upon definition

**What does NOT belong in a mart:**
- Raw or lightly-cleaned source data (that's staging)
- Complex business logic mid-pipeline (that's intermediate)
- Exploratory/ad-hoc queries (that's analyses/)

## Mart Organization Patterns

### Pattern 1: Domain-Based (Recommended for most teams)

```
models/marts/
├── core/                  # Shared entities used across domains
│   ├── dim_customers.sql
│   ├── dim_products.sql
│   ├── dim_dates.sql
│   └── fct_orders.sql
│
├── finance/               # Owned by Finance team
│   ├── fct_revenue.sql    # Revenue at daily/monthly grain
│   ├── fct_invoices.sql
│   └── dim_cost_centers.sql
│
├── marketing/             # Owned by Marketing team
│   ├── fct_campaigns.sql
│   ├── fct_ad_spend.sql
│   └── dim_channels.sql
│
├── product/               # Owned by Product team
│   ├── fct_sessions.sql
│   ├── fct_feature_usage.sql
│   └── dim_features.sql
│
└── customer_success/      # Owned by CS team
    ├── fct_support_tickets.sql
    └── fct_health_scores.sql
```

### Pattern 2: Fact/Dimension Split (for large teams with shared dims)

```
models/marts/
├── dimensions/            # Shared across all domains
│   ├── dim_customers.sql
│   ├── dim_products.sql
│   └── dim_dates.sql
│
└── facts/                 # Domain-specific facts
    ├── fct_orders.sql
    ├── fct_sessions.sql
    └── fct_subscriptions.sql
```

### Pattern 3: Subject Area (for smaller teams)

```
models/marts/
├── revenue.sql            # Wide table: order + customer + product
├── engagement.sql         # Wide table: session + user + feature
└── retention.sql          # Wide table: cohort + churn + renewal
```

## Mart Design Process

### Step 1: Identify the Grain

For every mart, answer: **"One row = one ___?"**

| Grain | Example |
|-------|---------|
| One row per order | `fct_orders` |
| One row per customer per day | `fct_customer_daily` |
| One row per campaign per week | `fct_campaign_weekly` |
| One row per customer (current state) | `dim_customers` |

Never mix grains. If you need order-level and order-line-level, create two separate facts.

### Step 2: Define Ownership

```yaml
# models/marts/finance/_finance__models.yml
version: 2

models:
  - name: fct_revenue
    description: |
      **Owner**: Finance Analytics (finance-analytics@company.com)
      **Grain**: One row per invoice line item per day
      **SLA**: Updated by 6am UTC daily
      **Consumer**: Looker Revenue dashboard, FP&A team
    config:
      meta:
        owner: finance-analytics@company.com
        team: Finance
        sla_hours: 6
```

### Step 3: Design the Wide Mart

The goal: analysts can answer questions with 1-2 joins maximum.

```sql
-- fct_revenue.sql
-- Grain: one row per invoice line item
-- Wide: includes customer segment, product category, channel attribution

with

invoices as (
    select * from {{ ref('stg_stripe__invoices') }}
),

customers as (
    select * from {{ ref('dim_customers') }}
),

products as (
    select * from {{ ref('dim_products') }}
),

final as (

    select
        -- Keys
        invoices.invoice_line_id,
        invoices.invoice_id,
        invoices.customer_id,
        invoices.product_id,

        -- Customer context (pre-joined — no extra join needed in BI)
        customers.customer_name,
        customers.customer_segment,
        customers.customer_region,
        customers.acquisition_channel,

        -- Product context
        products.product_name,
        products.product_category,
        products.product_tier,

        -- Temporal
        invoices.invoice_date,
        invoices.billing_period_start,
        invoices.billing_period_end,
        date_trunc('month', invoices.invoice_date) as invoice_month,

        -- Measures
        invoices.amount_usd,
        invoices.discount_amount_usd,
        invoices.tax_amount_usd,
        invoices.amount_usd - invoices.discount_amount_usd as net_revenue_usd,

        -- Status
        invoices.invoice_status,
        (invoices.invoice_status = 'paid') as is_paid

    from invoices
    left join customers using (customer_id)
    left join products using (product_id)

)

select * from final
```

### Step 4: Aggregated Mart Variants

For high-query-volume metrics, pre-aggregate to common grains:

```sql
-- fct_revenue_daily.sql
-- Grain: one row per customer per day
-- Built on top of fct_revenue (line item level)

select
    invoice_date as revenue_date,
    customer_id,
    customer_segment,
    customer_region,
    sum(net_revenue_usd) as net_revenue_usd,
    count(distinct invoice_id) as invoice_count,
    sum(case when is_paid then net_revenue_usd end) as collected_revenue_usd

from {{ ref('fct_revenue') }}
group by 1, 2, 3, 4
```

## Mart Governance Checklist

For each mart before shipping:

- [ ] **Grain documented** in model description
- [ ] **Owner defined** in meta tags
- [ ] **SLA defined** (how fresh is this data?)
- [ ] **Primary key tested** (unique + not_null)
- [ ] **Foreign keys tested** (relationships test)
- [ ] **Column descriptions** for all columns
- [ ] **No deprecated columns** (or deprecated flag on retiring ones)
- [ ] **Downstream consumers listed** (who uses this and how?)
- [ ] **Cost reviewed** — full refresh or incremental?

## Deprecation Pattern

Never delete mart columns without warning:

```yaml
columns:
  - name: old_customer_segment   # being replaced by customer_tier
    description: |
      **DEPRECATED** as of 2024-Q3. Use `customer_tier` instead.
      Will be removed in 2025-Q1.
    config:
      meta:
        deprecated: true
        remove_after: "2025-01-01"
```

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

After generating mart SQL and schema.yml, compile and run tests:

```bash
dbt compile --select marts
dbt test --select marts
```

The compile step catches ref() errors and syntax issues. The test step validates primary key uniqueness and foreign key relationships defined in schema.yml.

## If Something Goes Wrong

- **Fanout from joins**: Row count in the mart is higher than expected. Check join cardinality — use `COUNT(*) / COUNT(DISTINCT primary_key)` to detect fanout. Identify the M:M join and resolve it with aggregation or deduplication before joining.
- **Missing upstream ref**: `dbt compile` reports a model not found. Confirm the staging model exists under `models/staging/`; run the staging-layer skill first if it doesn't.
- **PK uniqueness test fails**: A `unique` test on the fact primary key is failing. Either the grain definition is wrong (rows represent different things than expected) or the join is creating duplicates — add a deduplication step or fix the join condition.
- **Naming collision**: A mart model name already exists. Run `node tools/clis/manifest-parse.js --manifest target/manifest.json` to list all current model names before renaming.

## Red Flags in Mart Design

- **"Everything mart"** — one 200-column table for all use cases: split by domain
- **Metrics in dims** — `dim_customers.lifetime_value`: put in `fct_customer_lifetime`
- **Grain mixing** — order-level and line-item-level in same fact: split into two
- **No owner** — "shared" marts that no team maintains: assign ownership explicitly
- **Business logic in BI tool** — date math, segment logic repeated per dashboard: move to mart
