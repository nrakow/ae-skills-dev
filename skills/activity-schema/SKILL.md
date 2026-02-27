---
name: activity-schema
description: "Model event streams using the Activity Schema pattern. Use when building a single unified activity stream from multiple sources, modeling user behavior over time, or implementing a flexible event-based analytics layer. Triggers: 'activity schema', 'event stream modeling', 'unified activity', 'user activity table', 'behavioral analytics model', 'single activity table'."
---

# Activity Schema

I'll help you implement the Activity Schema — a pattern for modeling event data as a single, unified activity stream that enables powerful behavioral queries without complex joins.

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
