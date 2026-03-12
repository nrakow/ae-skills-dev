---
name: activity-schema
description: "Model event streams using the Activity Schema pattern into a single unified activity table. Use when events are scattered across dozens of tables and every behavioral query is a nightmare of joins, when adding a new event type means yet another table, or when product asks 'did users do X before Y?' and the query takes an hour to write. Also fires for 'our event data is a mess' or 'I hate joining all these event tables.' Use this whenever event data feels fragmented, behavioral queries are painful, or someone mentions activity schema. For event stream design, see event-modeling. For conversion tracking, see funnel-analysis. For retention, see cohort-analysis."
triggers:
  - "build an activity schema"
  - "model event streams as a unified activity table"
  - "set up behavioral analytics"
  - "create a user activity stream"
  - "implement activity schema pattern"
  - "too many event tables"
  - "unify all events into one table"
  - "behavioral analytics"
  - "user journey model"
  - "did users do X before Y"
  - "temporal event queries"
  - "activity stream"
  - "Ahmed Elsamadisi pattern"
  - "single event table"
  - "event data is a mess"
reads_first:
  - data-stack-context
cli_tools: []
produces:
  - "dbt model SQL (activity_stream mart)"
  - "dbt model SQL (entity_enrichment mart)"
  - "schema.yml column descriptions"
validates_with:
  - "dbt run --select activity_stream entity_enrichment"
  - "dbt test --select activity_stream entity_enrichment"
  - "dbt compile --select activity_stream"
---

# Activity Schema

I'll help you implement the Activity Schema — a pattern for modeling event data as a single, unified activity stream that enables powerful behavioral queries without complex joins.

## Before You Start

Read the following files before proceeding:

- `.claude/data-stack-context.md` — warehouse type, existing event tables or source schema, and dbt project structure

## What Is Activity Schema?

The Activity Schema pattern (popularized by Ahmed Elsamadisi) models all user actions as a single table with a consistent structure:

```
entity_id | activity | ts | revenue_impact | feature_1 | feature_2 | feature_3
```

Instead of many separate event tables, you have **one activity stream** and query it with temporal patterns.

**Benefits:**
- No schema change required to add new event types
- Easy temporal queries ("did A happen before B?")
- Single join point for all behavioral analysis
- Excellent for conversion and cohort analysis

---

## Core Activity Table Design

```sql
-- models/marts/product/activity_stream.sql
-- Grain: one row per user per activity event
-- All events from all sources in one table

with

-- Session events
sessions as (
    select
        user_id as entity_id,
        'session_started' as activity,
        session_started_at as ts,
        null as revenue_impact,
        session_id as feature_1,        -- identifier
        device_type as feature_2,       -- attribute
        referrer_channel as feature_3   -- attribution
    from {{ ref('stg_product__sessions') }}

    union all

    select
        user_id,
        'session_ended',
        session_ended_at,
        null,
        session_id,
        cast(duration_seconds as varchar),
        null
    from {{ ref('stg_product__sessions') }}
    where session_ended_at is not null
),

-- Order events
orders as (
    select
        customer_id as entity_id,
        'order_completed' as activity,
        ordered_at as ts,
        net_revenue_usd as revenue_impact,
        order_id as feature_1,
        order_status as feature_2,
        customer_segment as feature_3
    from {{ ref('stg_orders') }}
    where order_status = 'completed'

    union all

    select
        customer_id,
        'order_cancelled',
        cancelled_at,
        -net_revenue_usd,  -- negative impact for cancellations
        order_id,
        cancellation_reason,
        null
    from {{ ref('stg_orders') }}
    where order_status = 'cancelled'
),

-- Subscription events
subscriptions as (
    select
        customer_id as entity_id,
        'subscription_started' as activity,
        subscription_start_date::timestamp as ts,
        plan_amount_usd / 12.0 as revenue_impact,  -- Monthly MRR
        subscription_id as feature_1,
        plan_type as feature_2,
        acquisition_channel as feature_3
    from {{ ref('stg_stripe__subscriptions') }}
    where event_type = 'started'

    union all

    select
        customer_id,
        'subscription_churned',
        subscription_end_date::timestamp,
        -(plan_amount_usd / 12.0),
        subscription_id,
        churn_reason,
        null
    from {{ ref('stg_stripe__subscriptions') }}
    where event_type = 'cancelled'
),

combined as (
    select * from sessions
    union all
    select * from orders
    union all
    select * from subscriptions
)

select
    {{ dbt_utils.generate_surrogate_key(['entity_id', 'activity', 'ts', 'feature_1']) }} as activity_id,
    entity_id,
    activity,
    ts,
    ts::date as activity_date,
    revenue_impact,
    feature_1,
    feature_2,
    feature_3
from combined
```

---

## Query Patterns

### Pattern 1: "First time a user did X"

```sql
-- First order date per user
select
    entity_id,
    min(ts) as first_order_at
from activity_stream
where activity = 'order_completed'
group by 1
```

### Pattern 2: "Users who did A then B" (Sequence Query)

```sql
-- Users who completed a session and then placed an order within 7 days
with sessions as (
    select entity_id, ts as session_ts
    from activity_stream
    where activity = 'session_started'
),

orders as (
    select entity_id, ts as order_ts
    from activity_stream
    where activity = 'order_completed'
)

select distinct s.entity_id
from sessions s
join orders o
    on s.entity_id = o.entity_id
    and o.order_ts > s.session_ts
    and o.order_ts <= s.session_ts + interval '7 days'
```

### Pattern 3: "Users who did A but NOT B" (Exclusion Query)

```sql
-- Users who started a session but never completed an order (non-converters)
select distinct entity_id
from activity_stream
where activity = 'session_started'
  and entity_id not in (
      select entity_id
      from activity_stream
      where activity = 'order_completed'
  )
```

### Pattern 4: Time Between Activities

```sql
-- Time from subscription_started to first order_completed
with first_sub as (
    select entity_id, min(ts) as subscribed_at
    from activity_stream
    where activity = 'subscription_started'
    group by 1
),

first_order as (
    select entity_id, min(ts) as first_ordered_at
    from activity_stream
    where activity = 'order_completed'
    group by 1
)

select
    s.entity_id,
    s.subscribed_at,
    o.first_ordered_at,
    datediff('day', s.subscribed_at, o.first_ordered_at) as days_to_first_order
from first_sub s
join first_order o on s.entity_id = o.entity_id
where o.first_ordered_at >= s.subscribed_at
```

### Pattern 5: Nth Activity

```sql
-- The 3rd order per customer (for cohort analysis)
select
    entity_id,
    ts as third_order_at,
    feature_1 as third_order_id
from (
    select
        entity_id,
        ts,
        feature_1,
        row_number() over (partition by entity_id order by ts) as order_rank
    from activity_stream
    where activity = 'order_completed'
)
where order_rank = 3
```

---

## Activity Stream Enrichment Table

Pair the activity stream with an "entity enrichment" table for dimensional context:

```sql
-- models/marts/product/entity_enrichment.sql
-- One row per entity (user/customer) with current attributes

select
    entity_id,
    first_seen_at,
    first_activity,
    latest_seen_at,
    total_activities,
    -- Current segment (from most recent enrichment)
    customer_segment,
    plan_type,
    acquisition_channel
from {{ ref('dim_customers') }}
```

**Query pattern with enrichment:**
```sql
select
    e.customer_segment,
    count(distinct a.entity_id) as users,
    count(*) as orders,
    sum(a.revenue_impact) as revenue
from activity_stream a
join entity_enrichment e on a.entity_id = e.entity_id
where a.activity = 'order_completed'
  and a.ts >= current_date - 30
group by 1
```

---

## Activity Schema vs. Traditional Event Tables

| Question | Activity Schema | Traditional events |
|---------|----------------|-------------------|
| "All events for user 123" | `WHERE entity_id = 123` | JOIN 5 tables |
| "Users who did A then B" | Single-table sequence query | Complex CTEs |
| "Add new event type" | Add rows to same table | Add new table + code |
| "Revenue from events" | `SUM(revenue_impact)` | Event-specific aggregation |
| "Performance at scale" | Need good indexing | Can partition by event type |

**When to use:** Behavioral analytics, conversion analysis, user journey analysis.
**When to avoid:** Operational systems needing strict schema; real-time < 1 second; PB-scale (use separate tables per event type).

---

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

After building the activity stream, confirm correctness with:

```bash
# Compile and run the models
dbt run --select activity_stream entity_enrichment

# Run all tests
dbt test --select activity_stream entity_enrichment
```

```sql
-- Confirm all expected activity types are present
SELECT activity, count(*) as event_count
FROM activity_stream
GROUP BY activity
ORDER BY event_count DESC;

-- Confirm no duplicate activity_id values (surrogate key uniqueness)
SELECT activity_id, count(*) as cnt
FROM activity_stream
GROUP BY activity_id
HAVING cnt > 1;

-- Confirm revenue_impact sign is correct (cancellations should be negative)
SELECT activity, sum(revenue_impact) as total_revenue
FROM activity_stream
GROUP BY activity;
```

## If Something Goes Wrong

- **Duplicate rows in the activity stream**: The surrogate key uses `entity_id + activity + ts + feature_1`; if `feature_1` (the identifier) is null for some events, multiple rows with the same timestamp and activity will collide — ensure `feature_1` is always populated for events with possible duplicates, or add another disambiguating field.
- **UNION ALL column count mismatch**: All CTEs must select the same seven columns in the same order (`entity_id`, `activity`, `ts`, `revenue_impact`, `feature_1`, `feature_2`, `feature_3`); a missing column in one branch will cause a compile error.
- **Sequence queries returning no results**: Confirm both activity types are spelled exactly the same as they appear in the `activity` column — activity names are case-sensitive strings.
- **`dbt_utils.generate_surrogate_key` not found**: Ensure `dbt-utils` is in `packages.yml` and run `dbt deps` before running the model.
- **Exclusion query (`NOT IN`) returning incorrect results**: If the subquery returns any `NULL` entity_ids, `NOT IN` will return no rows; use `NOT EXISTS` or filter out nulls from the subquery with `WHERE entity_id IS NOT NULL`.
