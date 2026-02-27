---
name: marts-design
description: "Design business-facing data mart layers with clear grain, ownership, and access patterns. Use when building the final analytics layer, organizing marts by business domain, defining what goes in each mart vs. core, or planning mart governance. Triggers: 'design a mart', 'data mart structure', 'business mart', 'analytics mart', 'organize marts', 'mart ownership'."
---

# Marts Design

I'll help you design the data mart layer — the business-facing output of your dbt project — with clear domain ownership, consistent grain, and BI-ready structure.

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

## Red Flags in Mart Design

- **"Everything mart"** — one 200-column table for all use cases: split by domain
- **Metrics in dims** — `dim_customers.lifetime_value`: put in `fct_customer_lifetime`
- **Grain mixing** — order-level and line-item-level in same fact: split into two
- **No owner** — "shared" marts that no team maintains: assign ownership explicitly
- **Business logic in BI tool** — date math, segment logic repeated per dashboard: move to mart
