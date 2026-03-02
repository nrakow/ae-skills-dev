---
name: funnel-analysis
description: "Build funnel analysis models that measure step-by-step conversion rates and identify where users drop off. Use when tracking conversion through a user flow, calculating drop-off rates between funnel stages, building a reusable funnel macro, or segmenting funnel performance by cohort, channel, or device. Produces dbt fact models, aggregation models, and a reusable Jinja funnel macro."
triggers:
  - "funnel analysis"
  - "conversion funnel"
  - "drop-off analysis"
  - "where are users dropping off"
  - "measure conversion rate between steps"
reads_first:
  - data-stack-context
cli_tools: []
produces:
  - "dbt model SQL (fct_*_funnel, mtr_funnel_summary)"
  - "Jinja funnel macro (macros/funnel.sql)"
  - "schema.yml column documentation"
validates_with:
  - "dbt compile --select tag:funnel"
  - "dbt test --select tag:funnel"
  - "dbt run --select fct_signup_conversion_funnel --limit 500"
  - "dbt run --select mtr_funnel_summary"
---

# Funnel Analysis

I'll help you build funnel analysis models that measure step-by-step conversion rates and identify where users drop off.

## Before You Start

Read these project files before proceeding:

- `.claude/data-stack-context.md` — warehouse type, event data structure, and the key conversion funnels to measure

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: warehouse type, event data structure, key conversion funnels to measure.

## Funnel Design Decisions

Before building, clarify:
1. **What are the funnel steps?** (e.g., signup → activation → first purchase → repeat purchase)
2. **What is the conversion window?** (e.g., must complete all steps within 30 days)
3. **Is order required?** (strict sequential vs. any order)
4. **What is the grain?** (user-level vs. session-level)
5. **What dimensions slice the funnel?** (segment, channel, device, cohort)

---

## Pattern 1: Sequential Funnel (Most Common)

Users must complete steps in order within a time window.

```sql
-- models/marts/product/fct_signup_conversion_funnel.sql
-- Funnel: signup → email_verified → profile_completed → first_order
-- Window: must complete each step within 30 days of signup

with

step_1_signed_up as (
    select
        user_id,
        min(event_ts) as step_1_at
    from {{ ref('stg_product__events') }}
    where event_name = 'user_signed_up'
    group by 1
),

step_2_verified as (
    select
        user_id,
        min(event_ts) as step_2_at
    from {{ ref('stg_product__events') }}
    where event_name = 'email_verified'
    group by 1
),

step_3_profile as (
    select
        user_id,
        min(event_ts) as step_3_at
    from {{ ref('stg_product__events') }}
    where event_name = 'profile_completed'
    group by 1
),

step_4_order as (
    select
        customer_id as user_id,
        min(ordered_at) as step_4_at
    from {{ ref('stg_orders') }}
    where order_status = 'completed'
    group by 1
),

-- Build user-level funnel: one row per user who entered the funnel
funnel as (

    select
        s1.user_id,

        -- Step timestamps
        s1.step_1_at,
        s2.step_2_at,
        s3.step_3_at,
        s4.step_4_at,

        -- Step completion booleans
        true as completed_step_1,
        (s2.step_2_at is not null and s2.step_2_at <= s1.step_1_at + interval '30 days')
            as completed_step_2,
        (s3.step_3_at is not null and s3.step_3_at <= s1.step_1_at + interval '30 days'
            and s3.step_3_at >= s2.step_2_at)  -- must come after step 2
            as completed_step_3,
        (s4.step_4_at is not null and s4.step_4_at <= s1.step_1_at + interval '30 days'
            and s4.step_4_at >= s3.step_3_at)
            as completed_step_4,

        -- Time to completion per step
        datediff('hour', s1.step_1_at, s2.step_2_at) as hours_to_step_2,
        datediff('hour', s2.step_2_at, s3.step_3_at) as hours_to_step_3,
        datediff('hour', s3.step_3_at, s4.step_4_at) as hours_to_step_4,

        -- Cohort (month of funnel entry)
        date_trunc('month', s1.step_1_at) as entry_cohort

    from step_1_signed_up s1
    left join step_2_verified s2 using (user_id)
    left join step_3_profile s3 using (user_id)
    left join step_4_order s4 using (user_id)

)

select * from funnel
```

### Funnel Aggregation Model

```sql
-- models/marts/product/mtr_funnel_summary.sql
-- Aggregate funnel metrics by cohort and segment

select
    entry_cohort,
    count(distinct user_id) as entered_funnel,

    -- Count at each step
    sum(completed_step_1::int) as step_1_count,
    sum(completed_step_2::int) as step_2_count,
    sum(completed_step_3::int) as step_3_count,
    sum(completed_step_4::int) as step_4_count,

    -- Conversion rates (each step vs. previous)
    1.0 as step_1_rate,
    sum(completed_step_2::int) * 1.0 / nullif(sum(completed_step_1::int), 0) as step_1_to_2_rate,
    sum(completed_step_3::int) * 1.0 / nullif(sum(completed_step_2::int), 0) as step_2_to_3_rate,
    sum(completed_step_4::int) * 1.0 / nullif(sum(completed_step_3::int), 0) as step_3_to_4_rate,

    -- Overall funnel conversion rate (step 1 → step 4)
    sum(completed_step_4::int) * 1.0 / nullif(count(distinct user_id), 0) as overall_conversion_rate,

    -- Median time between steps
    median(hours_to_step_2) as median_hours_step_1_to_2,
    median(hours_to_step_3) as median_hours_step_2_to_3,
    median(hours_to_step_4) as median_hours_step_3_to_4

from {{ ref('fct_signup_conversion_funnel') }}
group by 1
```

---

## Pattern 2: Warehouse-Native Funnel Functions

### BigQuery — COUNTIF for Simple Funnels

```sql
-- BigQuery: simple funnel without user-level tracking
select
    date_trunc(event_date, month) as cohort_month,
    countif(step = 1) as visited_page,
    countif(step >= 2) as clicked_cta,
    countif(step >= 3) as started_checkout,
    countif(step >= 4) as completed_purchase,
    countif(step >= 4) / nullif(countif(step >= 1), 0) as overall_conversion

from (
    select user_id, event_date,
        case event_name
            when 'page_view' then 1
            when 'cta_clicked' then 2
            when 'checkout_started' then 3
            when 'purchase_completed' then 4
        end as step
    from events
    where event_name in ('page_view', 'cta_clicked', 'checkout_started', 'purchase_completed')
)
group by 1
```

### Snowflake — CONDITIONAL_CHANGE_EVENT

```sql
-- Snowflake: detect step completions within a session
select
    session_id,
    user_id,
    conditional_change_event(event_name = 'checkout_started') over (
        partition by session_id order by event_ts
    ) as started_checkout,
    conditional_change_event(event_name = 'purchase_completed') over (
        partition by session_id order by event_ts
    ) as completed_purchase
from events
```

---

## Pattern 3: Reusable Funnel Macro (dbt)

```sql
-- macros/funnel.sql
{% macro funnel(
    event_table,
    entity_col,
    timestamp_col,
    steps,
    window_days=30
) %}

with

{% for step in steps %}
step_{{ loop.index }} as (
    select
        {{ entity_col }} as entity_id,
        min({{ timestamp_col }}) as step_at
    from {{ event_table }}
    where {{ step.filter }}
    group by 1
),
{% endfor %}

combined as (
    select
        step_1.entity_id,
        {% for step in steps %}
        step_{{ loop.index }}.step_at as step_{{ loop.index }}_at,
        {% endfor %}
        {% for step in steps %}
        (step_{{ loop.index }}.step_at is not null
            {% if not loop.first %}
            and step_{{ loop.index }}.step_at <= step_1.step_at + interval '{{ window_days }} days'
            and step_{{ loop.index }}.step_at >= step_{{ loop.index - 1 }}.step_at
            {% endif %}
        ) as completed_step_{{ loop.index }}{{ "," if not loop.last }}
        {% endfor %}
    from step_1
    {% for step in steps[1:] %}
    left join step_{{ loop.index + 1 }} using (entity_id)
    {% endfor %}
)

select * from combined

{% endmacro %}
```

**Usage:**
```sql
-- models/marts/product/fct_checkout_funnel.sql
{{ funnel(
    event_table="ref('stg_product__events')",
    entity_col='user_id',
    timestamp_col='event_ts',
    steps=[
        {"filter": "event_name = 'cart_viewed'"},
        {"filter": "event_name = 'checkout_started'"},
        {"filter": "event_name = 'payment_entered'"},
        {"filter": "event_name = 'order_placed'"}
    ],
    window_days=7
) }}
```

---

## Funnel Drop-Off Analysis

Find where and why users drop off:

```sql
-- Characteristics of users who drop at each step
select
    'Dropped at step 2' as drop_point,
    e.customer_segment,
    e.acquisition_channel,
    e.device_type,
    count(distinct f.user_id) as users_dropped,
    avg(hours_to_step_2) as avg_time_at_step  -- How long did they linger?

from {{ ref('fct_signup_conversion_funnel') }} f
join {{ ref('dim_users') }} e on f.user_id = e.user_id
where f.completed_step_1 = true
  and f.completed_step_2 = false  -- Dropped at step 2
group by 1, 2, 3, 4

union all

select
    'Dropped at step 3',
    e.customer_segment,
    e.acquisition_channel,
    e.device_type,
    count(distinct f.user_id),
    avg(hours_to_step_3)

from {{ ref('fct_signup_conversion_funnel') }} f
join {{ ref('dim_users') }} e on f.user_id = e.user_id
where f.completed_step_2 = true
  and f.completed_step_3 = false
group by 1, 2, 3, 4
```

---

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

Run these commands after building your funnel models to confirm correctness:

```bash
# Compile all funnel models to catch SQL syntax errors
dbt compile --select tag:funnel

# Run data tests — not_null on user_id, completed_step_1 always true
dbt test --select tag:funnel

# Spot-check that step counts are monotonically decreasing (step N+1 <= step N)
dbt run --select mtr_funnel_summary

# Confirm no user appears in the funnel more than once (grain check)
dbt test --select fct_signup_conversion_funnel --select unique_combination_of_columns
```

## If Something Goes Wrong

- **Step counts are not monotonically decreasing** (step 3 count > step 2 count): The sequential ordering constraint (`step_3_at >= step_2_at`) is missing or wrong. Verify the LEFT JOIN conditions enforce ordering and the time window check references the correct step timestamp.
- **Overall conversion rate is higher than expected**: Check whether users are being double-counted. The funnel grain should be one row per unique `user_id`. Add a `dbt test` for `unique` on the `user_id` column of the fact model.
- **NULL step timestamps causing incorrect completion flags**: A NULL `step_2_at` in the boolean expression evaluates to NULL (not FALSE) in some warehouses. Wrap completion flags with `coalesce(..., false)` to make them explicit booleans.
- **Funnel macro Jinja errors**: The loop variable `loop.index - 1` is zero-based in Jinja. Verify the generated SQL with `dbt compile` and inspect the compiled output in `target/compiled/`.
- **BigQuery COUNTIF returning 0 for all steps**: Confirm the `event_name` values in the `CASE` statement exactly match the values in your events table — these are case-sensitive in BigQuery.
