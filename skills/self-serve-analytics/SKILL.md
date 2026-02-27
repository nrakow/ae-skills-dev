---
name: self-serve-analytics
description: "Build self-serve analytics capabilities for non-technical stakeholders. Use when enabling business users to answer their own questions without SQL, designing a BI layer for non-technical consumers, reducing analyst interrupt rate, or training business teams on data tools. Triggers: 'self-serve analytics', 'enable business users', 'reduce analyst interrupts', 'BI training', 'data democratization', 'non-technical analytics'."
---

# Self-Serve Analytics

I'll help you build a self-serve analytics layer that empowers business stakeholders to find answers independently, reducing interrupt-driven analyst work.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: BI tool, team maturity, non-technical stakeholder count.

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
      # Business-friendly names (not technical)
      - name: order_date          # NOT ordered_at, NOT created_date
        description: "The date the customer placed the order (in your local timezone)"
      - name: revenue_usd         # NOT net_revenue_usd, NOT amount_cents_divided
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
# Create a simple, focused explore for business users
explore: customer_orders {
  label: "Customer Orders (Start Here)"
  description: "Answer questions about revenue, order volume, and customer segments. Best for: revenue by month, top customers, order trends."
  view_name: fct_orders

  # Pre-join commonly needed dimensions
  join: customers {
    from: dim_customers
    type: left_outer
    sql_on: ${fct_orders.customer_id} = ${customers.customer_id} ;;
    relationship: many_to_one
    fields: [customers.customer_name, customers.segment, customers.region]
    # LIMIT exposed fields — don't expose all 50 customer columns
  }

  # Guide users with curated field suggestions
  tags: ["self-serve", "revenue"]
}

# In the view: group fields for business users
view: fct_orders {
  dimension: order_date {
    group_label: "📅 Date"
    type: date
    sql: ${TABLE}.order_date ;;
  }

  dimension: customer_segment {
    group_label: "👥 Customer"
    type: string
    sql: ${TABLE}.customer_segment ;;
  }

  measure: total_revenue {
    group_label: "💰 Revenue"
    type: sum
    sql: ${TABLE}.revenue_usd ;;
    value_format_name: usd
    description: "Total revenue for selected orders"
  }
}
```

### Metabase — Self-Serve Setup

```json
// .metabase/data_model.json (conceptual — configure via UI)
// Field metadata to set:
{
  "fct_orders": {
    "display_name": "Customer Orders",
    "description": "Use this to analyze orders, revenue, and customer trends",
    "fields": {
      "order_date": {
        "display_name": "Order Date",
        "description": "The date the customer placed the order"
      },
      "revenue_usd": {
        "display_name": "Revenue (USD)",
        "description": "Revenue from this order in US dollars",
        "semantic_type": "type/Currency",
        "currency": "USD"
      },
      "customer_id": {
        "display_name": "Customer ID",
        "visibility_type": "details-only"  // Hide from default view
      }
    }
  }
}
```

### Lightdash — Self-Serve Setup

Lightdash reads directly from dbt YAML — the SKILL.md names and descriptions appear as-is in the UI. Focus on dbt model quality:

```yaml
# models/marts/core/_core__models.yml
models:
  - name: fct_orders
    label: "Customer Orders"          # Lightdash display name
    description: "Start here for revenue and order analysis"
    columns:
      - name: revenue_usd
        label: "Revenue (USD)"
        description: "Revenue from this order"
        meta:
          metrics:                    # Lightdash metric definition
            total_revenue:
              type: sum
              label: "Total Revenue"
```

---

## Step 3: Build Starting Points

### Saved Questions / Looks

Pre-build the 10 most common questions and name them clearly:

```
"Monthly Revenue by Customer Segment" ← clear, business-friendly
"Top 25 Customers by Revenue (Last 90 Days)"
"New vs. Returning Customer Orders This Month"
"Revenue vs. Last Year by Month"
"Order Count by Day (Last 30 Days)"
```

### Dashboard Templates for Self-Serve

Create a "Questions to Answer" index dashboard:

```
┌─────────────────────────────────────────────────────────┐
│  Data Resources for [Team Name]                          │
│                                                          │
│  📊 Revenue Analysis                                     │
│  → Monthly Revenue Dashboard                            │
│  → Revenue by Customer Segment                          │
│                                                          │
│  👥 Customer Analysis                                    │
│  → Customer Growth Dashboard                            │
│  → Churn Analysis                                       │
│                                                          │
│  🛒 Orders & Operations                                 │
│  → Order Volume by Day                                  │
│  → Order Status Breakdown                               │
│                                                          │
│  💡 Start a New Question                                │
│  → Open Customer Orders explore                         │
└─────────────────────────────────────────────────────────┘
```

---

## Step 4: Training Plan

### 30-Minute Onboarding Session

```markdown
# Self-Serve Analytics Onboarding

## Agenda (30 min)
1. Where to find data (5 min) — show the BI tool home, saved dashboards
2. Reading a dashboard (5 min) — date filters, KPI cards, charts
3. Asking a new question (15 min) — live demo with an explore
   - Pick a metric (revenue)
   - Add a dimension (segment)
   - Add a filter (date range)
   - Save as a question
4. When to ask the data team (5 min) — complex analysis, new metrics

## Cheat Sheet (give to attendees)
- Revenue questions → Customer Orders explore
- Customer questions → Customers explore
- Can't find it? → #data-help Slack channel
- Data looks wrong? → Tag @data-team in the question
```

### Cheat Sheet Template

```markdown
# Data Cheat Sheet — [Team Name]

## Quick Links
- Revenue Dashboard: [link]
- Customer Dashboard: [link]
- Orders Explore: [link]

## Common Questions + How to Answer
| Question | Where to start | Filters to use |
|----------|---------------|---------------|
| Revenue this month | Revenue Dashboard | Date = This Month |
| Top customers | Customer Orders explore | Group by Customer Name, sort by Revenue |
| Orders by status | Customer Orders explore | Group by Order Status |

## Definitions
- **Revenue**: Net amount after discounts, before tax (USD)
- **Active Customer**: Made a purchase in the last 90 days
- **Churn**: Cancelled subscription in the period
- **Customer Segment**: Enterprise (> $50k ARR), Mid-market ($5-50k), SMB (< $5k)
```

---

## Step 5: Measure Self-Serve Adoption

```sql
-- Track self-serve success metrics
-- (from your BI tool's activity log / query log)

select
    date_trunc('week', query_date) as week,
    count(distinct user_email) as active_self_serve_users,
    count(*) as total_queries,
    count(case when user_role = 'business_user' then 1 end) as business_user_queries,
    count(case when user_role = 'analyst' then 1 end) as analyst_queries,
    -- Self-serve rate: % of queries from non-analysts
    count(case when user_role = 'business_user' then 1 end) * 1.0
        / nullif(count(*), 0) as self_serve_rate

from bi_tool_query_log
group by 1
order by 1 desc
```

**Target metrics:**
- Self-serve rate > 60% of queries from non-analysts
- Analyst interrupt rate < 5 ad-hoc requests per analyst per week
- Query success rate > 85% (users found what they needed)
