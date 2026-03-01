---
name: self-serve-analytics
description: "Design and implement a self-serve analytics layer that enables business users to answer questions without engineering help. Use when improving analyst independence, building a semantic layer, or reducing ad hoc request volume. Triggers: 'self-serve', 'self-service analytics', 'empower analysts', 'ad hoc queries', 'business user analytics', 'reduce engineering bottleneck'."
triggers:
  - "self-serve"
  - "self-service analytics"
  - "empower analysts"
  - "ad hoc queries"
  - "business user analytics"
  - "reduce engineering bottleneck"
reads_first:
  - data-stack-context
  - kpi-framework
  - metrics-layer
cli_tools: []
produces:
  - "semantic layer design"
  - "mart exposure configuration"
  - "dbt exposures.yml"
validates_with:
  - "dbt parse"
---

# Self-Serve Analytics

I'll help you build a self-serve analytics layer that empowers business stakeholders to find answers independently, reducing interrupt-driven analyst work.

## Before You Start

- Read `.claude/data-stack-context.md` for BI tool, team maturity, and non-technical stakeholder count.
- Review existing mart models to understand which are ready for business-user exposure.
- Confirm KPIs are defined and agreed upon before exposing metrics to non-technical users.
- Assess current interrupt rate (ad-hoc requests per week) to set a baseline for measuring improvement.
- Run `dbt parse` to confirm the project is clean before adding new exposures.

## What Makes Self-Serve Work (and Fail)

**Why self-serve fails:**
- Too many tables/fields to navigate (> 20 explores or 100+ dimensions)
- Confusing technical names (`fct_orders`, `dim_sku_id`)
- Missing definitions (what does "active customer" mean?)
- Slow queries (users give up after 30 seconds)
- No training or guided starting points

**Why self-serve succeeds:**
- Business-language naming with clear descriptions
- Pre-built starting points (example explores, saved questions)
- Fast performance (< 3 seconds for 90% of queries)
- Clear onboarding path (guided tour + cheat sheet)
- Light support channel (Slack for stuck users)

---

## Step 1: Design the Self-Serve Data Layer

### Rule: Hide Complexity Behind Business Language

```yaml
# In dbt — good column names for self-serve
models:
  - name: fct_orders
    description: "One row per customer order. Use for revenue and order analysis."
    columns:
      - name: order_date
        description: "The date the customer placed the order (in your local timezone)"
      - name: revenue_usd
        description: "Revenue from this order in USD, after discounts and before tax"
      - name: is_first_order
        description: "True if this was the customer's very first purchase"
      - name: customer_segment
        description: "Customer tier: Enterprise, Mid-market, or SMB"
```

### Which Models to Expose for Self-Serve

```
EXPOSE (clearly named, business-friendly):
✅ fct_orders → label: "Customer Orders"
✅ fct_revenue_monthly → label: "Monthly Revenue"
✅ dim_customers → label: "Customers"

HIDE from self-serve:
❌ stg_salesforce__accounts (staging, technical)
❌ int_orders__joined (intermediate, incomplete)
❌ fct_orders_raw (pre-transformation, confusing)
```

---

## Step 2: Configure the BI Tool

### Looker — Self-Serve Setup

```lkml
explore: customer_orders {
  label: "Customer Orders (Start Here)"
  description: "Answer questions about revenue, order volume, and customer segments."
  view_name: fct_orders

  join: customers {
    from: dim_customers
    type: left_outer
    sql_on: ${fct_orders.customer_id} = ${customers.customer_id} ;;
    relationship: many_to_one
    fields: [customers.customer_name, customers.segment, customers.region]
  }

  tags: ["self-serve", "revenue"]
}
```

### Metabase — Self-Serve Setup

Key field metadata to configure (via UI):
- Set `display_name` for every exposed table and column
- Set `semantic_type` on currency and date fields
- Mark technical/FK columns as `visibility_type: "details-only"`

### Lightdash — Self-Serve Setup

Lightdash reads directly from dbt YAML. Focus on dbt model quality:

```yaml
models:
  - name: fct_orders
    label: "Customer Orders"
    description: "Start here for revenue and order analysis"
    columns:
      - name: revenue_usd
        label: "Revenue (USD)"
        meta:
          metrics:
            total_revenue:
              type: sum
              label: "Total Revenue"
```

---

## Step 3: Build Starting Points

Pre-build the 10 most common questions and name them clearly:

```
"Monthly Revenue by Customer Segment"
"Top 25 Customers by Revenue (Last 90 Days)"
"New vs. Returning Customer Orders This Month"
"Revenue vs. Last Year by Month"
"Order Count by Day (Last 30 Days)"
```

### dbt Exposures for Self-Serve

Document which BI content uses which models:

```yaml
# models/marts/_exposures.yml
exposures:
  - name: revenue_dashboard
    type: dashboard
    url: "https://company.looker.com/dashboards/42"
    owner:
      name: Finance Analytics
      email: finance-analytics@company.com
    depends_on:
      - ref('fct_orders')
      - ref('dim_customers')
```

---

## Step 4: Training Plan

### 30-Minute Onboarding Session

```markdown
## Agenda (30 min)
1. Where to find data (5 min) — show the BI tool home, saved dashboards
2. Reading a dashboard (5 min) — date filters, KPI cards, charts
3. Asking a new question (15 min) — live demo with an explore
4. When to ask the data team (5 min) — complex analysis, new metrics

## Cheat Sheet
- Revenue questions → Customer Orders explore
- Customer questions → Customers explore
- Can't find it? → #data-help Slack channel
```

---

## Step 5: Measure Self-Serve Adoption

```sql
select
    date_trunc('week', query_date) as week,
    count(distinct user_email) as active_self_serve_users,
    count(case when user_role = 'business_user' then 1 end) * 1.0
        / nullif(count(*), 0) as self_serve_rate
from bi_tool_query_log
group by 1
order by 1 desc
```

**Target metrics:**
- Self-serve rate > 60% of queries from non-analysts
- Analyst interrupt rate < 5 ad-hoc requests per analyst per week

---

## Verify Your Work

- Run `dbt parse` to confirm all exposure YAML is valid and references real models.
- Open the self-serve explore or dashboard as a business-user test account and confirm all fields are visible and labeled in plain language.
- Run a representative business-user query (e.g., "revenue by month") and verify it returns in under 3 seconds.
- Check that staging and intermediate models are not visible in the BI tool's table picker.
- Query the BI tool's activity log one week after rollout to confirm self-serve rate is trending up.

## If Something Goes Wrong

- **Business users see technical model names**: check that `label:` is set in dbt YAML and the BI tool has re-synced the schema metadata.
- **Queries time out for business users**: the mart is not pre-aggregated to the right grain; add an intermediate aggregate model or a PDT in Looker.
- **Exposures fail `dbt parse`**: a `depends_on` ref points to a model that has been renamed or deleted; update the exposure YAML to match current model names.
- **Users build queries against staging tables**: hide staging and intermediate models from the BI tool's connection schema or use Looker `hidden: yes` on the explore.
- **Adoption is low after launch**: run a 30-minute onboarding session, identify the top 3 questions the team asks by email/Slack, and pre-build those as saved questions.
