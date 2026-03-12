---
name: cohort-analysis
description: "Build cohort retention and LTV models for product and revenue analysis. Use when the CEO asks 'are we retaining users?', when you need a retention triangle or heatmap, when calculating lifetime value by signup month, or when product wants to compare behavior across acquisition cohorts. Covers day-N retention, weekly/monthly cohorts, segmented retention by channel or plan, and revenue cohorts. Fires for 'our churn is terrible but we can't measure it' or 'I need to show the board a retention chart.' Use this whenever retention, churn, LTV, or cohort comparison comes up. For conversion funnels, see funnel-analysis. For event stream modeling, see activity-schema. For KPI definitions, see metrics-layer."
triggers:
  - "build a cohort analysis"
  - "measure user retention"
  - "calculate LTV by cohort"
  - "create a retention curve"
  - "show me cohort retention"
  - "are we retaining users"
  - "retention triangle"
  - "day N retention"
  - "lifetime value"
  - "churn by cohort"
  - "how do January signups compare to February"
  - "user retention over time"
  - "cohort table"
  - "retention is dropping"
  - "weekly retention"
reads_first:
  - data-stack-context
cli_tools: []
produces:
  - "dbt model SQL (fct_cohort_retention)"
  - "dbt model SQL (fct_cohort_ltv)"
  - "dbt model SQL (fct_day_n_retention)"
  - "schema.yml column descriptions"
validates_with:
  - "dbt run --select fct_cohort_retention fct_cohort_ltv"
  - "dbt test --select fct_cohort_retention fct_cohort_ltv"
  - "dbt compile --select fct_cohort_retention"
---

# Cohort Analysis

I'll help you build cohort models that measure retention, revenue, and behavior over time for groups of users who share a common start event.

## Before You Start

Read the following files before proceeding:

- `.claude/data-stack-context.md` — warehouse type, key cohort events (signup, first purchase), retention metrics to track, and dbt project structure

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: warehouse type, key cohort events (signup, first purchase), retention metrics to track.

## Cohort Design Decisions

1. **What defines a cohort?** (signup month, first purchase month, plan start)
2. **What is the retention event?** (any login, purchase, active session)
3. **What time unit?** (day, week, month)
4. **How many periods to show?** (typically 12 weeks or 12 months)
5. **What are cohort dimensions?** (acquisition channel, segment, plan type)

---

## Pattern 1: User Retention Cohort (Classic Triangle)

```sql
-- models/marts/product/fct_cohort_retention.sql
-- Shows % of users from signup cohort who were "active" in each subsequent period

with

-- Step 1: Define cohort membership (when each user joined)
cohort_base as (

    select
        user_id,
        date_trunc('month', created_at) as cohort_month,
        created_at as cohort_start_at

    from {{ ref('dim_users') }}
    where created_at >= '2023-01-01'

),

-- Step 2: Define activity events (what counts as "retained")
activity as (

    select
        user_id,
        date_trunc('month', event_ts) as active_month

    from {{ ref('stg_product__sessions') }}
    group by 1, 2

),

-- Step 3: Cross-join to get cohort × period grid
-- Every user should appear in every period from their cohort month
cohort_periods as (

    select
        c.user_id,
        c.cohort_month,
        a.active_month,
        datediff('month', c.cohort_month, a.active_month) as period_number

    from cohort_base c
    left join activity a
        on c.user_id = a.user_id
        and a.active_month >= c.cohort_month
        and a.active_month <= c.cohort_month + interval '12 months'

),

-- Step 4: Aggregate into cohort × period counts
cohort_summary as (

    select
        cohort_month,
        period_number,
        count(distinct user_id) as retained_users

    from cohort_periods
    where period_number is not null
    group by 1, 2

),

-- Step 5: Get cohort sizes (users at period 0 = cohort size)
cohort_sizes as (

    select
        cohort_month,
        count(distinct user_id) as cohort_size

    from cohort_base
    group by 1

)

select
    s.cohort_month,
    s.period_number,
    sz.cohort_size,
    s.retained_users,
    s.retained_users * 1.0 / sz.cohort_size as retention_rate

from cohort_summary s
join cohort_sizes sz using (cohort_month)
order by cohort_month, period_number
```

### Pivot to Triangle Format

```sql
-- Pivot retention rates into classic triangle format for BI
-- (Supported in: Snowflake PIVOT, BigQuery PIVOT, manual CASE)

select
    cohort_month,
    cohort_size,
    max(case when period_number = 0 then retention_rate end) as period_0,  -- 100% always
    max(case when period_number = 1 then retention_rate end) as period_1,
    max(case when period_number = 2 then retention_rate end) as period_2,
    max(case when period_number = 3 then retention_rate end) as period_3,
    max(case when period_number = 6 then retention_rate end) as period_6,
    max(case when period_number = 12 then retention_rate end) as period_12

from {{ ref('fct_cohort_retention') }}
group by 1, 2
order by 1
```

---

## Pattern 2: Revenue Cohort (LTV by Acquisition Cohort)

```sql
-- models/marts/finance/fct_cohort_ltv.sql
-- Cumulative revenue by acquisition cohort over time

with

cohorts as (

    select
        customer_id,
        date_trunc('month', first_order_at) as acquisition_cohort,
        acquisition_channel,
        customer_segment

    from {{ ref('dim_customers') }}
    where first_order_at is not null

),

revenue as (

    select
        customer_id,
        date_trunc('month', ordered_at) as order_month,
        sum(net_revenue_usd) as monthly_revenue_usd

    from {{ ref('fct_orders') }}
    where order_status = 'completed'
    group by 1, 2

),

cohort_revenue as (

    select
        c.customer_id,
        c.acquisition_cohort,
        c.acquisition_channel,
        c.customer_segment,
        r.order_month,
        datediff('month', c.acquisition_cohort, r.order_month) as months_since_acquisition,
        r.monthly_revenue_usd

    from cohorts c
    left join revenue r
        on c.customer_id = r.customer_id
        and r.order_month >= c.acquisition_cohort

),

cumulative_ltv as (

    select
        acquisition_cohort,
        acquisition_channel,
        customer_segment,
        months_since_acquisition,
        count(distinct customer_id) as cohort_size,
        sum(monthly_revenue_usd) as period_revenue_usd,
        sum(sum(monthly_revenue_usd)) over (
            partition by acquisition_cohort, acquisition_channel, customer_segment
            order by months_since_acquisition
            rows between unbounded preceding and current row
        ) as cumulative_revenue_usd,
        sum(sum(monthly_revenue_usd)) over (
            partition by acquisition_cohort, acquisition_channel, customer_segment
            order by months_since_acquisition
            rows between unbounded preceding and current row
        ) / nullif(max(count(distinct customer_id)) over (
            partition by acquisition_cohort, acquisition_channel, customer_segment
        ), 0) as cumulative_ltv_per_customer_usd

    from cohort_revenue
    where months_since_acquisition is not null
    group by 1, 2, 3, 4

)

select * from cumulative_ltv
```

---

## Pattern 3: Weekly Day-N Retention

For product teams measuring daily active user retention:

```sql
-- models/marts/product/fct_day_n_retention.sql
-- Day 1, Day 7, Day 14, Day 30 retention after first session

with

first_sessions as (

    select
        user_id,
        min(session_date) as first_session_date

    from {{ ref('stg_product__sessions') }}
    group by 1

),

-- Get all subsequent session dates per user
subsequent_sessions as (

    select
        s.user_id,
        fs.first_session_date,
        s.session_date,
        s.session_date - fs.first_session_date as days_since_first_session

    from {{ ref('stg_product__sessions') }} s
    join first_sessions fs on s.user_id = fs.user_id
    where s.session_date > fs.first_session_date
      and s.session_date <= fs.first_session_date + 30

)

select
    date_trunc('week', first_session_date) as signup_week,
    count(distinct user_id) as cohort_size,

    -- Day-N retention: % of cohort active on exactly day N
    count(distinct case when days_since_first_session = 1 then user_id end) * 1.0
        / count(distinct user_id) as day_1_retention,
    count(distinct case when days_since_first_session = 7 then user_id end) * 1.0
        / count(distinct user_id) as day_7_retention,
    count(distinct case when days_since_first_session = 14 then user_id end) * 1.0
        / count(distinct user_id) as day_14_retention,
    count(distinct case when days_since_first_session = 30 then user_id end) * 1.0
        / count(distinct user_id) as day_30_retention,

    -- Rolling retention: active at any point in period (more forgiving)
    count(distinct case when days_since_first_session between 1 and 7 then user_id end) * 1.0
        / count(distinct user_id) as week_1_rolling_retention

from first_sessions fs
left join subsequent_sessions ss using (user_id)
group by 1
```

---

## Retention Benchmarks

Use these to calibrate your product's health:

| Product type | Day 1 | Day 7 | Day 30 |
|-------------|-------|-------|--------|
| Consumer social app | 25-40% | 10-20% | 5-10% |
| B2B SaaS | 60-75% | 40-60% | 25-40% |
| E-commerce | 30-50% (repurchase) | — | 15-25% |
| Mobile game | 20-35% | 7-15% | 2-8% |

---

## Cohort Dashboard Template

```sql
-- mtr_cohort_overview.sql
-- One-stop model for cohort dashboard

select
    cohort_month,
    period_number,
    cohort_size,
    retained_users,
    retention_rate,

    -- Benchmark comparison
    retention_rate - avg(retention_rate) over (
        partition by period_number
    ) as vs_average_cohort,

    -- Cumulative LTV (if joined)
    cumulative_ltv_per_customer_usd

from {{ ref('fct_cohort_retention') }}
left join {{ ref('fct_cohort_ltv') }} using (cohort_month, period_number)
```

---

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

After building cohort models, verify correctness with:

```bash
# Run all cohort models
dbt run --select fct_cohort_retention fct_cohort_ltv fct_day_n_retention

# Run tests
dbt test --select fct_cohort_retention fct_cohort_ltv
```

```sql
-- Confirm period_0 retention is always 1.0 (100%) for every cohort
SELECT cohort_month, retention_rate
FROM fct_cohort_retention
WHERE period_number = 0
  AND retention_rate != 1.0;
-- Should return 0 rows

-- Confirm cohort sizes are reasonable (no cohort of 1 user skewing percentages)
SELECT cohort_month, cohort_size
FROM fct_cohort_retention
WHERE period_number = 0
ORDER BY cohort_month;

-- Confirm cumulative LTV only increases over time per cohort
SELECT acquisition_cohort, months_since_acquisition, cumulative_ltv_per_customer_usd
FROM fct_cohort_ltv
ORDER BY acquisition_cohort, months_since_acquisition;
```

## If Something Goes Wrong

- **Period 0 retention is not 1.0**: The `cohort_sizes` CTE and `cohort_summary` are pulling from different populations; ensure both use the same `cohort_base` definition and the same `user_id` field without additional filters in the activity CTE that exclude cohort members.
- **Retention rates exceed 1.0**: Users are being counted in activity months before their cohort month; check the `and a.active_month >= c.cohort_month` join condition is present.
- **Very recent cohorts show low retention for later periods**: This is expected — recent cohorts have not yet had enough time to reach later periods. Filter to `period_number <= months_since_cohort_start` when presenting to stakeholders.
- **`datediff` function not available**: BigQuery uses `DATE_DIFF(date1, date2, MONTH)`; Redshift and DuckDB use `DATEDIFF('month', date1, date2)`; Snowflake uses `DATEDIFF('month', date1, date2)` — adjust dialect to match your warehouse.
- **Cumulative LTV window function returning nulls**: Ensure the `months_since_acquisition` filter (`WHERE months_since_acquisition IS NOT NULL`) is applied before the window, otherwise null periods pollute the running sum.
