---
name: kpi-framework
description: "Define, document, and socialize KPIs across your organization. Use when establishing metric definitions, building a metrics dictionary, aligning teams on KPI calculations, or running a north-star metric workshop. Triggers: 'KPI framework', 'define metrics', 'metrics dictionary', 'north star metric', 'metric definition', 'KPI alignment', 'what is our revenue metric'."
---

# KPI Framework

I'll help you define, document, and align your organization on KPIs — from individual metric definitions to a full metrics hierarchy.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: north star metrics, team maturity, BI tool.

## Step 1: North Star Metric Workshop

**Exercise (30 minutes with leadership):**

Ask: "If you could only look at one number to know if the business is healthy, what would it be?"

Common answers by business type:

| Business type | North star metric |
|---------------|-------------------|
| SaaS (subscription) | Monthly Recurring Revenue (MRR) |
| Marketplace | Gross Merchandise Value (GMV) |
| Consumer app | Daily Active Users (DAU) |
| Media/content | Time on site / content views |
| E-commerce | Revenue or Orders |
| B2B services | Customer Retention Rate |

Once chosen, define the north star rigorously (see definition template below).

---

## Metric Definition Template

Every KPI needs a complete definition:

```markdown
# Metric: Monthly Recurring Revenue (MRR)

## One-Liner
The total predictable, recurring revenue normalized to a monthly basis.

## Calculation
```
MRR = SUM(
  CASE subscription_interval
    WHEN 'monthly' THEN plan_amount_usd
    WHEN 'annual' THEN plan_amount_usd / 12
    WHEN 'quarterly' THEN plan_amount_usd / 3
  END
)
WHERE subscription_status = 'active'
  AND subscription_start_date <= LAST_DAY(reporting_month)
  AND (subscription_end_date IS NULL OR subscription_end_date > LAST_DAY(reporting_month))
```

## Source
- **dbt model**: `marts.finance.fct_subscriptions_monthly`
- **Source table**: `stripe.subscriptions` (via Fivetran)

## Grain
One row per subscription per month. Report at monthly grain.

## Filters / Exclusions
- Excludes trial subscriptions (plan_type != 'trial')
- Excludes internal test accounts (customer_segment != 'internal')
- Includes paused subscriptions (counts toward MRR while paused)

## Owner
- **Business owner**: CFO / VP Finance
- **Technical owner**: Finance Analytics team

## Segments
MRR can be sliced by:
- Customer Segment (Enterprise / Mid-market / SMB)
- Plan Type (Starter / Growth / Enterprise)
- Geography (Region / Country)
- Acquisition Channel

## Related Metrics
- **New MRR**: MRR from new subscriptions started this month
- **Expansion MRR**: MRR increase from existing customers (upsells)
- **Churned MRR**: MRR lost from cancellations
- **Net Revenue Retention (NRR)**: (MRR_end - Churned_MRR) / MRR_start

## Change History
| Date | Change | Approved by |
|------|--------|-------------|
| 2024-01-01 | Annual subscriptions now divided by 12 (previously counted at full amount) | CFO |
| 2023-06-01 | Paused subscriptions included | Finance Analytics |

## Common Misunderstandings
- "Bookings" ≠ MRR. Bookings = contract signed; MRR = active, billing
- Annual plans are normalized to monthly (not counted as full amount in month 1)
- MRR is based on subscription data, not payment data (invoices can lag)
```

---

## KPI Hierarchy Framework

Structure metrics in a hierarchy so teams know how each metric relates:

```
COMPANY NORTH STAR
└── MRR ($2.1M)

BUSINESS DRIVERS (explain the north star)
├── New MRR (+$180k)       — from new customers
├── Expansion MRR (+$45k)  — from existing customers upgrading
├── Churned MRR (-$38k)    — from cancellations/downgrades
└── Net Revenue Retention (NRR): 112%

DEPARTMENTAL METRICS (each team owns their drivers)
├── Sales
│   ├── Qualified Pipeline ($8M)
│   ├── Win Rate (23%)
│   └── Average Contract Value ($12k)
│
├── Customer Success
│   ├── Gross Retention Rate (96%)
│   ├── Net Promoter Score (NPS: 42)
│   └── Time to Value (avg 14 days)
│
└── Product
    ├── Feature Adoption Rate (activation features: 67%)
    ├── Daily Active Users (DAU: 4,200)
    └── Support Ticket Volume (98 open)

OPERATIONAL METRICS (real-time, for team managers)
├── Trials started today
├── Demos booked this week
└── Tickets resolved today
```

---

## Metrics Dictionary

Build a central metrics dictionary (markdown or dedicated tool):

```markdown
# Metrics Dictionary

## Revenue Metrics

| Metric | Definition | Owner | Source model | Dashboard |
|--------|-----------|-------|-------------|-----------|
| MRR | Monthly recurring revenue from active subscriptions | Finance | fct_subscriptions_monthly | Revenue Overview |
| ARR | MRR × 12 | Finance | fct_subscriptions_monthly | Revenue Overview |
| New MRR | MRR from subscriptions starting this month | Finance | fct_mrr_movements | Revenue Overview |
| Churned MRR | MRR lost from cancellations this month | Finance | fct_mrr_movements | Churn Analysis |
| NRR | (MRR_end - Churned) / MRR_start, by cohort | Finance | fct_net_revenue_retention | Retention Dashboard |

## Customer Metrics

| Metric | Definition | Owner | Source model |
|--------|-----------|-------|-------------|
| Active Customer | Customer with ≥1 purchase in last 90 days | Growth | fct_orders |
| Customer LTV | 12-month predicted revenue per customer | Analytics | fct_customer_ltv |
| CAC | Total sales+marketing spend / new customers acquired | Finance | mtr_cac_monthly |
| Payback Period | CAC / (MRR per customer × gross margin) | Finance | mtr_unit_economics |

## Engagement Metrics

| Metric | Definition | Owner | Source model |
|--------|-----------|-------|-------------|
| DAU | Unique users with ≥1 session in a calendar day | Product | fct_sessions_daily |
| WAU | Unique users in a rolling 7-day window | Product | fct_sessions_daily |
| Activation Rate | % of signups who complete onboarding step within 7 days | Product | fct_user_lifecycle |
```

---

## SQL Implementations

```sql
-- MRR calculation
-- models/marts/finance/fct_subscriptions_monthly.sql

with month_spine as (
    {{ dbt_utils.date_spine(
        datepart="month",
        start_date="'2022-01-01'",
        end_date="current_date"
    ) }}
),

subscriptions as (
    select * from {{ ref('stg_stripe__subscriptions') }}
    where plan_type != 'trial'
      and customer_segment != 'internal'
),

-- Cross join subscriptions with months where they were active
sub_months as (

    select
        date_trunc('month', month_spine.date_month) as reporting_month,
        subscriptions.subscription_id,
        subscriptions.customer_id,
        subscriptions.customer_segment,
        subscriptions.plan_type,
        -- Normalize to monthly revenue
        case subscriptions.billing_interval
            when 'month' then subscriptions.plan_amount_usd
            when 'year' then subscriptions.plan_amount_usd / 12.0
            when 'quarter' then subscriptions.plan_amount_usd / 3.0
        end as mrr_usd

    from month_spine
    join subscriptions
        on subscriptions.subscription_start_date
                <= last_day(month_spine.date_month)
        and (
            subscriptions.subscription_end_date is null
            or subscriptions.subscription_end_date
                > last_day(month_spine.date_month)
        )

)

select
    reporting_month,
    sum(mrr_usd) as mrr_usd,
    count(distinct subscription_id) as active_subscription_count,
    count(distinct customer_id) as active_customer_count,
    sum(mrr_usd) * 12 as arr_usd

from sub_months
group by 1
```

---

## Socialization Plan

After defining KPIs:

1. **Present at all-hands**: Walk through the metrics hierarchy, explain why each metric was chosen
2. **Metrics Slack channel**: `#metrics-definitions` for questions and change proposals
3. **Change process**: Any metric redefinition requires 2-week notice and Finance approval
4. **Monthly metrics review**: Finance + Analytics review top metrics for accuracy
5. **Dashboard linking**: Every dashboard shows metric name + link to definition

---

## Common KPI Anti-Patterns

| Anti-pattern | Problem | Fix |
|-------------|---------|-----|
| Vanity metrics | "We have 100k users" (inactive ones) | Define "active user" rigorously |
| Too many metrics | 45 KPIs tracked weekly — no focus | Choose ≤ 5 north star + drivers |
| Conflicting definitions | Sales says ARR = $5M, Finance says $4.8M | One source of truth in dbt |
| No denominator | "Revenue up $100k" — good? Relative to what? | Always show growth rate + absolute |
| Metric FOMO | Tracking everything because you can | Each metric must drive a decision |
