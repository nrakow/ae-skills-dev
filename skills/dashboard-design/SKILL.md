---
name: dashboard-design
description: "Design effective BI dashboards with clear layout, metric hierarchy, and filtering strategy. Use when building a new dashboard, improving an existing one, or establishing dashboard standards. Triggers: 'design dashboard', 'build dashboard', 'BI dashboard', 'dashboard layout', 'visualization', 'reporting dashboard', 'dashboard best practices'."
triggers:
  - "design dashboard"
  - "build dashboard"
  - "BI dashboard"
  - "dashboard layout"
  - "visualization"
  - "reporting dashboard"
reads_first:
  - data-stack-context
  - kpi-framework
  - marts-design
cli_tools: []
produces:
  - "dashboard specification"
  - "BI layer configuration"
validates_with: []
---

# Dashboard Design

I'll help you design dashboards that answer business questions clearly — from layout and metric hierarchy to the underlying data requirements.

## Before You Start

- Read `.claude/data-stack-context.md` for BI tool choice and team maturity level.
- Review existing mart and metrics layer schemas to understand available fields and grain.
- Confirm KPIs are defined (run `kpi-framework` skill if not).
- Identify the primary audience and decision this dashboard drives.
- Check existing dashboards to avoid duplicating work or creating conflicting metrics.

## Step 1: Clarify the Purpose

Before any layout, answer:
1. **Who is the primary audience?** (Executive / Operations / Analyst / Self-serve)
2. **What decision does this dashboard drive?** ("Should we hire more support staff?", "Is revenue on track?")
3. **What is the cadence?** (Real-time, daily, weekly, monthly review)
4. **What's the call-to-action when something looks wrong?**

## Dashboard Types

| Type | Audience | Update frequency | Design principle |
|------|----------|-----------------|-----------------|
| **Executive** | C-suite | Daily/weekly | 3-5 KPIs, no drilling |
| **Operational** | Team managers | Hourly/daily | Trends + alerts, action links |
| **Analytical** | Data/product teams | On-demand | Filters, drill-downs, raw data |
| **Self-serve** | Business users | On-demand | Guided exploration, no SQL |

---

## Dashboard Layout Principles

### The 5-Second Rule

A viewer should understand the dashboard's primary message within 5 seconds. Structure:

```
┌─────────────────────────────────────────────────────────┐
│  [Dashboard Title]         [Date range filter] [Refresh] │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│  Revenue │  Orders  │  Cust.   │  Churn   │  NPS        │  ← KPI row (hero metrics)
│  $2.1M   │  4,832   │  12,433  │  2.1%    │  42         │
│  ↑12%    │  ↑8%     │  ↑5%     │  ↓0.3%   │  ↑3         │  ← vs. prior period
├──────────┴──────────┴──────────┴──────────┴─────────────┤
│                                                           │
│  Revenue Over Time (line chart)  │  Revenue by Segment   │  ← Main trends
│                                  │  (bar or pie chart)   │
├──────────────────────────────────┴───────────────────────┤
│  Top Customers Table  │  Recent Orders  │  Support Queue  │  ← Detail tables
└─────────────────────────────────────────────────────────┘
```

### Hierarchy Rules

1. **Most important metric top-left** (Western reading pattern)
2. **KPI scorecards before charts** — numbers first, context second
3. **Time series before breakdowns** — show trend before slicing
4. **Tables at the bottom** — detail for exploration, not scanning
5. **No more than 7 charts** — if you need more, split into sections/tabs

---

## Chart Selection Guide

| Data question | Best chart | Avoid |
|---------------|-----------|-------|
| How is X changing over time? | Line chart | Bar chart (unless few periods) |
| Compare A vs. B vs. C? | Bar chart | Pie chart (> 5 categories) |
| Part of a whole? | Stacked bar or donut | 3D pie |
| Relationship between X and Y? | Scatter plot | Line chart |
| Distribution of a value? | Histogram or box plot | Average alone |
| Progress toward a goal? | Bullet chart or gauge | Red/green traffic lights alone |
| Table of records? | Data table with sorting | Dense pivot table |

---

## Metric Hierarchy

Define three levels for every dashboard:

```
Level 1 — NORTH STAR (1 metric, always visible)
  └─ "Monthly Recurring Revenue"

Level 2 — DRIVERS (3-5 metrics that explain the north star)
  ├─ "New MRR" (expansion)
  ├─ "Churned MRR" (churn)
  └─ "Net Revenue Retention"

Level 3 — DIAGNOSTICS (drill-down metrics, shown on click or filter)
  ├─ "Churn by Customer Segment"
  └─ "Top Churned Accounts"
```

---

## Data Requirements Checklist

Before building, confirm:

```markdown
For dashboard: Revenue Overview

**Grain needed**: Daily revenue by customer_segment and product_category
**Source model**: marts.finance.fct_revenue_daily
**Filters needed**: Date range, customer_segment, product_category, region
**Comparison**: vs. prior period (DoD, WoW, MoM, YoY)
**Aggregations**: SUM(revenue), COUNT(distinct customers), AVG(order_value)
**Freshness required**: By 7am UTC (matches SLA on fct_revenue)
**Performance SLA**: Dashboard loads in < 3 seconds

**BI tool**: Looker
**Explore**: finance/revenue
**Fields to expose**:
  - revenue_daily.revenue_date (dimension)
  - revenue_daily.customer_segment (dimension)
  - revenue_daily.revenue_usd (measure)
  - revenue_daily.order_count (measure)
```

---

## Performance Optimization

```sql
-- Optimize: pre-aggregate to the smallest grain the dashboard needs
-- Instead of hitting fct_orders (line-item level), hit a daily aggregate

-- Bad: BI queries fct_orders at query time
select date_trunc('day', ordered_at), sum(net_revenue_usd)
from fct_orders
where ordered_at >= '2024-01-01'
group by 1  -- Scans 500M rows on every dashboard load

-- Good: dbt pre-aggregates to daily grain
-- models/marts/metrics/mtr_revenue_daily.sql
-- Dashboard queries 365 rows instead of 500M
```

### Caching Strategy by BI Tool

| BI Tool | Caching approach |
|---------|-----------------|
| Looker | PDT with `datagroup_trigger` |
| Metabase | Question caching (Pro); pre-aggregated models |
| Lightdash | dbt model is the "query"; use incremental models |
| Tableau | Extracts for large datasets; live for < 10M rows |

---

## Accessibility Checklist

- [ ] Color-blind safe palette (avoid red/green alone; use icons + color)
- [ ] Minimum 14px font size for labels
- [ ] Tooltips on all data points
- [ ] Consistent date formats (always show year for cross-year data)
- [ ] "As of" timestamp visible on every dashboard

---

## Common Dashboard Antipatterns

| Antipattern | Problem | Fix |
|-------------|---------|-----|
| 20 KPIs in a row | Cognitive overload | Limit to 5, hide rest behind toggle |
| Raw counts without context | "1,247 orders" — good or bad? | Always show vs. prior period |
| Unlinked date filters | KPI shows March, chart shows April | Sync all tiles to global date filter |
| Pie charts > 5 slices | Unreadable | Bar chart or "Other" bucket |
| Embedded SQL in BI | No reuse, no testing | Move logic to dbt model |

---

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

- Open the dashboard in the BI tool and confirm all tiles load without errors.
- Apply each filter and verify all tiles update consistently to the same time range.
- Check the "as of" timestamp against the latest dbt run timestamp for the source model.
- Query the underlying mart directly and spot-check one KPI against what the dashboard shows.
- Test the dashboard in a non-admin account to confirm no permission errors for intended audience.

## If Something Goes Wrong

- **Dashboard tiles show different time ranges**: check that all tiles reference the same date filter field and that the global filter is wired to each tile.
- **KPI value differs from a SQL query**: confirm the BI tool measure definition matches the dbt metric definition; watch for off-by-one in date truncation (UTC vs. local).
- **Dashboard loads slowly (> 5 seconds)**: check if the underlying model is pre-aggregated to the right grain; consider adding a PDT or incremental aggregate model.
- **Filters return no data**: check that filter values match the actual data values in the mart (case sensitivity, whitespace, enum spelling).
- **Metric looks wrong after a dbt run**: run `dbt test --select <model>` on the source mart to check for freshness or data quality failures upstream.
