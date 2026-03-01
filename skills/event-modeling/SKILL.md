---
name: event-modeling
description: "Model business processes as event streams for temporal analytics, audit trails, and process analysis. Use when designing an event-driven data model, tracking state transitions over time, modeling complex business processes like order lifecycles or subscription changes, or building audit trails. Produces fact event stream models, accumulating snapshot models, and event catalog YAML documentation."
triggers:
  - "event modeling"
  - "model state transitions"
  - "order lifecycle events"
  - "event sourcing"
  - "process mining"
reads_first:
  - data-stack-context
cli_tools: []
produces:
  - "dbt model SQL (fct_*_events, fct_*_snapshot)"
  - "schema.yml column documentation"
  - "event catalog YAML"
validates_with:
  - "dbt compile --select tag:event_modeling"
  - "dbt test --select tag:event_modeling"
  - "dbt run --select fct_order_lifecycle_events --limit 100"
  - "dbt run --select fct_subscription_events --limit 100"
---

# Event Modeling

I'll help you model business processes as event streams, capturing state transitions over time for audit trails, process analysis, and temporal queries.

## Before You Start

Read these project files before proceeding:

- `.claude/data-stack-context.md` — warehouse type, dbt version, source systems, and business processes to model

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: business processes to model, source systems, warehouse type.

## Core Concept: Events as Facts

Instead of storing only the current state ("order is completed"), store every state change:

```
Traditional (current state only):
order_id: 123, status: completed, updated_at: 2024-03-15

Event stream (full history):
order_id: 123, event: order_placed,     ts: 2024-03-14 09:30
order_id: 123, event: payment_captured, ts: 2024-03-14 09:31
order_id: 123, event: order_shipped,    ts: 2024-03-14 14:22
order_id: 123, event: order_delivered,  ts: 2024-03-15 11:45
order_id: 123, event: order_confirmed,  ts: 2024-03-15 14:10
```

**Benefits:**
- Full audit trail for compliance
- Time-to-complete analysis per stage
- Anomaly detection (orders stuck in state)
- Process mining (find inefficient paths)
- Replay/reconstruct state at any point in time

---

## Pattern 1: Order Lifecycle Events

```sql
-- models/marts/core/fct_order_lifecycle_events.sql
-- One row per state transition per order

with

-- Source: extract state change timestamps from source
raw_orders as (
    select * from {{ ref('stg_orders') }}
),

-- Unpivot: convert wide status table to long event stream
order_events as (

    -- Order placed
    select order_id, customer_id, 'order_placed' as event_type, placed_at as event_ts,
        null as duration_seconds,
        placed_by_user_id as actor_id
    from raw_orders
    where placed_at is not null

    union all

    -- Payment captured
    select order_id, customer_id, 'payment_captured', payment_captured_at,
        datediff('second', placed_at, payment_captured_at),
        payment_processor as actor_id
    from raw_orders
    where payment_captured_at is not null

    union all

    -- Shipped
    select order_id, customer_id, 'order_shipped', shipped_at,
        datediff('second', payment_captured_at, shipped_at),
        shipped_by_warehouse_id as actor_id
    from raw_orders
    where shipped_at is not null

    union all

    -- Delivered
    select order_id, customer_id, 'order_delivered', delivered_at,
        datediff('second', shipped_at, delivered_at),
        'carrier' as actor_id
    from raw_orders
    where delivered_at is not null

    union all

    -- Cancelled (if applicable)
    select order_id, customer_id, 'order_cancelled', cancelled_at,
        datediff('second', placed_at, cancelled_at),
        cancelled_by as actor_id
    from raw_orders
    where cancelled_at is not null

    union all

    -- Refunded
    select order_id, customer_id, 'order_refunded', refunded_at,
        datediff('second', delivered_at, refunded_at),
        null as actor_id
    from raw_orders
    where refunded_at is not null

)

select
    {{ dbt_utils.generate_surrogate_key(['order_id', 'event_type']) }} as event_id,
    order_id,
    customer_id,
    event_type,
    event_ts,
    event_ts::date as event_date,
    duration_seconds,  -- time since previous step
    actor_id,
    -- Sequence number for this order
    row_number() over (partition by order_id order by event_ts) as event_sequence

from order_events
```

---

## Pattern 2: Subscription State Machine

```sql
-- models/marts/finance/fct_subscription_events.sql
-- Model subscription lifecycle: started → paused → resumed → upgraded → churned

with

subscription_changes as (

    select * from {{ ref('stg_stripe__subscription_events') }}

),

enriched as (

    select
        {{ dbt_utils.generate_surrogate_key(['subscription_id', 'event_type', 'event_ts']) }}
            as event_id,
        subscription_id,
        customer_id,
        event_type,
        event_ts,

        -- State before this event
        lag(event_type) over (
            partition by subscription_id
            order by event_ts
        ) as previous_event_type,

        -- Duration in previous state (seconds)
        datediff('second',
            lag(event_ts) over (partition by subscription_id order by event_ts),
            event_ts
        ) as time_in_previous_state_seconds,

        -- Revenue impact of this event
        case event_type
            when 'subscription_started' then plan_amount_usd / 12.0
            when 'subscription_upgraded' then (new_plan_amount - old_plan_amount) / 12.0
            when 'subscription_downgraded' then (new_plan_amount - old_plan_amount) / 12.0  -- negative
            when 'subscription_cancelled' then -(plan_amount_usd / 12.0)
            else 0
        end as mrr_impact_usd,

        -- Attributes at time of event
        plan_type,
        plan_amount_usd,
        customer_segment

    from subscription_changes

)

select * from enriched
```

---

## Pattern 3: Accumulating Snapshot (Multi-Stage Process)

An alternative to the pure event stream — the "accumulating snapshot" fact table tracks the full lifecycle in a single row that updates as milestones are reached:

```sql
-- models/marts/core/fct_order_snapshot.sql
-- Accumulating snapshot: one row per order, columns for each milestone
-- Row updates as new events arrive (use incremental with merge)

{{ config(
    materialized='incremental',
    unique_key='order_id',
    incremental_strategy='merge'
) }}

select
    o.order_id,
    o.customer_id,

    -- Milestone timestamps (NULL until reached)
    o.placed_at,
    o.payment_captured_at,
    o.shipped_at,
    o.delivered_at,
    o.refunded_at,
    o.cancelled_at,

    -- Current state
    case
        when o.refunded_at is not null then 'refunded'
        when o.cancelled_at is not null then 'cancelled'
        when o.delivered_at is not null then 'delivered'
        when o.shipped_at is not null then 'shipped'
        when o.payment_captured_at is not null then 'processing'
        else 'pending'
    end as current_status,

    -- Lag metrics (time between milestones)
    datediff('hour', placed_at, payment_captured_at) as hours_to_payment,
    datediff('hour', payment_captured_at, shipped_at) as hours_to_shipment,
    datediff('hour', shipped_at, delivered_at) as hours_in_transit,

    -- Flags for process mining
    (payment_captured_at is not null) as payment_completed,
    (shipped_at is not null) as shipped,
    (delivered_at is not null) as delivered,
    (refunded_at is not null) as refunded

from {{ ref('stg_orders') }} o

{% if is_incremental() %}
where o.updated_at >= (select max(placed_at) - interval '24 hours' from {{ this }})
{% endif %}
```

---

## Temporal Queries on Event Data

### State at a Point in Time

```sql
-- "What was the status of all subscriptions on March 1, 2024?"
-- Find the most recent event before that date per subscription

select
    subscription_id,
    customer_id,
    event_type as status_on_date,
    event_ts as last_changed_at

from (
    select
        subscription_id,
        customer_id,
        event_type,
        event_ts,
        row_number() over (
            partition by subscription_id
            order by event_ts desc
        ) as rn
    from {{ ref('fct_subscription_events') }}
    where event_ts <= '2024-03-01'
)
where rn = 1
```

### Average Time in Each State

```sql
-- How long do orders stay in each state on average?
select
    event_type as entered_state,
    count(*) as events,
    avg(time_in_previous_state_seconds) / 3600 as avg_hours_in_state,
    percentile_cont(0.5) within group (order by time_in_previous_state_seconds) / 3600
        as median_hours_in_state,
    percentile_cont(0.9) within group (order by time_in_previous_state_seconds) / 3600
        as p90_hours_in_state

from {{ ref('fct_order_lifecycle_events') }}
where time_in_previous_state_seconds is not null
group by 1
order by avg_hours_in_state desc
```

### Stuck Orders (Anomaly Detection)

```sql
-- Orders that have been in "processing" for more than 48 hours
-- (no "order_shipped" event after "payment_captured")
select
    order_id,
    customer_id,
    event_ts as last_event_at,
    datediff('hour', event_ts, current_timestamp) as hours_stuck

from {{ ref('fct_order_lifecycle_events') }}
where event_type = 'payment_captured'
  and order_id not in (
      select order_id from {{ ref('fct_order_lifecycle_events') }}
      where event_type in ('order_shipped', 'order_cancelled')
  )
  and datediff('hour', event_ts, current_timestamp) > 48

order by hours_stuck desc
```

---

## Event Catalog

Document every event type in your system:

```yaml
# docs/event_catalog.md
events:
  order_placed:
    description: "Customer submitted an order"
    actor: customer
    triggers: payment_capture_initiated
    properties: [order_id, customer_id, cart_value, item_count]

  payment_captured:
    description: "Payment successfully collected from customer"
    actor: payment_processor
    triggers: fulfillment_initiated
    properties: [order_id, payment_method, amount_usd, payment_id]

  order_shipped:
    description: "Order handed to carrier"
    actor: warehouse
    triggers: customer_notification
    properties: [order_id, carrier, tracking_number, warehouse_id]
```

---

## Verify Your Work

Run these commands after building your event models to confirm correctness:

```bash
# Compile and validate SQL syntax for all event models
dbt compile --select tag:event_modeling

# Run data tests (not_null, unique on surrogate keys, accepted_values for event_type)
dbt test --select tag:event_modeling

# Check that the event stream has no duplicate (order_id, event_type) pairs
dbt test --select fct_order_lifecycle_events

# Confirm accumulating snapshot row counts match source orders
dbt test --select fct_order_snapshot

# Spot-check temporal ordering: no event_ts should be before the preceding step
dbt run --select fct_order_lifecycle_events && dbt test --select fct_order_lifecycle_events
```

## If Something Goes Wrong

- **Duplicate event rows**: The surrogate key `generate_surrogate_key(['order_id', 'event_type'])` assumes one row per event type per entity. If source data has multiple timestamps for the same event (e.g., two `payment_captured` rows), deduplicate in the staging layer with `qualify row_number() over (partition by order_id, event_type order by event_ts) = 1`.
- **NULL duration_seconds for first event**: The first event in a sequence has no preceding step, so `duration_seconds` is always NULL for event sequence = 1. This is expected — filter it out in aggregation queries.
- **Negative duration values**: Happens when source timestamps are out of order (e.g., `shipped_at` recorded before `payment_captured_at`). Add a dbt `expression_is_true` test: `duration_seconds >= 0 or duration_seconds is null`.
- **Accumulating snapshot not updating**: If using `incremental_strategy='merge'`, confirm the `unique_key` matches the primary key and that the `is_incremental()` filter lookback window is wide enough to capture all recently updated orders.
- **dbt_utils not installed**: `generate_surrogate_key` requires `dbt_utils`. Add `dbt-labs/dbt_utils` to `packages.yml` and run `dbt deps`.
