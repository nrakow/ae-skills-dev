---
name: metrics-layer
description: "Define semantic metrics with dbt Semantic Layer, MetricFlow, or Cube. Use when you need a single source of truth for metric definitions, want metrics available across BI tools, or are standardizing KPI calculations across teams. Triggers: 'metrics layer', 'dbt metrics', 'MetricFlow', 'Cube metrics', 'semantic layer', 'metric definitions', 'single source of truth metrics'."
triggers:
  - "metrics layer"
  - "semantic layer"
  - "dbt metrics"
  - "MetricFlow"
  - "define metrics"
  - "business metrics dbt"
reads_first:
  - data-stack-context
  - marts-design
cli_tools:
  - manifest-parse.js
produces:
  - "semantic_models.yml"
  - "metrics.yml"
validates_with:
  - "dbt parse"
  - "mf validate"
---

# Metrics Layer

I'll help you define a semantic metrics layer so that KPIs are calculated consistently everywhere — in SQL, BI tools, and APIs.

## Before You Start

Run manifest-parse to see which mart models are available to reference in semantic_models:

```bash
node tools/clis/manifest-parse.js --manifest target/manifest.json
```

Also read existing `metrics.yml` if present to avoid duplicating metric names. Confirm dbt version >= 1.6 — MetricFlow is not available in earlier versions and the legacy `dbt metrics` syntax is required instead.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: dbt version (MetricFlow requires dbt 1.6+), BI tool, whether you have dbt Cloud.

## Options Overview

| Tool | Best for |
|------|---------|
| **dbt Semantic Layer + MetricFlow** | Teams already using dbt; works with Tableau, Looker, Power BI via integrations |
| **Cube** | Multi-warehouse; complex pre-aggregation; REST/GraphQL API needed |
| **LookML** | Looker-only shops |
| **Lightdash** | Open-source; native dbt metric support |
| **Custom SQL mart** | Simple metrics without semantic tooling |

---

## dbt Semantic Layer (MetricFlow)

### 1. Define a Semantic Model

```yaml
# models/marts/core/_metrics.yml  (or a dedicated semantic_models/ directory)
semantic_models:
  - name: orders
    description: "Order-level semantic model for revenue metrics"
    model: ref('fct_orders')
    defaults:
      agg_time_dimension: ordered_at

    entities:
      - name: order
        type: primary
        expr: order_id
      - name: customer
        type: foreign
        expr: customer_id
      - name: product
        type: foreign
        expr: product_id

    dimensions:
      - name: ordered_at
        type: time
        type_params:
          time_granularity: day
      - name: customer_segment
        type: categorical
        expr: customer_segment
      - name: product_category
        type: categorical
        expr: product_category
      - name: order_status
        type: categorical

    measures:
      - name: order_count
        description: "Number of orders"
        agg: count
        expr: order_id
      - name: revenue
        description: "Net revenue (USD)"
        agg: sum
        expr: net_revenue_usd
      - name: avg_order_value
        description: "Average order value"
        agg: average
        expr: net_revenue_usd
      - name: unique_customers
        description: "Count of distinct customers"
        agg: count_distinct
        expr: customer_id
```

### 2. Define Metrics

```yaml
metrics:
  # Simple metrics
  - name: revenue
    description: "Total net revenue"
    type: simple
    type_params:
      measure: revenue
    label: "Net Revenue (USD)"

  - name: order_count
    description: "Number of completed orders"
    type: simple
    type_params:
      measure: order_count
    filter: |
      {{ Dimension('order__order_status') }} = 'completed'
    label: "Order Count"

  # Ratio metrics
  - name: average_order_value
    description: "Revenue per order"
    type: ratio
    type_params:
      numerator: revenue
      denominator: order_count
    label: "Average Order Value (USD)"

  # Derived metrics
  - name: revenue_per_customer
    description: "Revenue divided by unique customers"
    type: derived
    type_params:
      expr: revenue / unique_customers
      metrics:
        - name: revenue
        - name: unique_customers
    label: "Revenue per Customer"

  # Cumulative metrics
  - name: cumulative_revenue
    description: "Running total revenue (MTD, QTD, YTD)"
    type: cumulative
    type_params:
      measure: revenue
      window: unbounded
    label: "Cumulative Revenue"
```

### 3. Query the Semantic Layer

```bash
# dbt CLI
dbt sl query \
  --metrics revenue,order_count \
  --group-by ordered_at__month,customer_segment \
  --where "ordered_at__year = '2024'" \
  --order-by ordered_at__month

# dbt Cloud: JDBC/ADBC endpoint for BI tools
# Tableau: use dbt Semantic Layer connector
# Lightdash: reads metrics from YAML automatically
```

### 4. Saved Queries (for common combinations)

```yaml
saved_queries:
  - name: revenue_by_segment_monthly
    description: "Monthly revenue by customer segment — used in CEO dashboard"
    label: "Monthly Revenue by Segment"
    query_params:
      metrics:
        - revenue
        - order_count
        - average_order_value
      group_by:
        - "TimeDimension('order__ordered_at', 'month')"
        - "Dimension('order__customer_segment')"
    exports:
      - name: revenue_by_segment_monthly
        config:
          export_as: table
          schema: metrics
```

---

## Cube Semantic Layer

### cube.js Schema

```javascript
// model/cubes/Orders.js
cube('Orders', {
  sql_table: 'analytics.marts.fct_orders',

  measures: {
    count: {
      type: 'count',
      drillMembers: [orderId, customerId]
    },
    revenue: {
      sql: 'net_revenue_usd',
      type: 'sum',
      format: 'currency',
      title: 'Net Revenue (USD)'
    },
    averageOrderValue: {
      sql: '${revenue} / ${count}',
      type: 'number',
      format: 'currency',
      title: 'Avg Order Value'
    },
    uniqueCustomers: {
      sql: 'customer_id',
      type: 'countDistinct',
      title: 'Unique Customers'
    }
  },

  dimensions: {
    orderId: {
      sql: 'order_id',
      type: 'string',
      primaryKey: true
    },
    customerSegment: {
      sql: 'customer_segment',
      type: 'string',
      title: 'Customer Segment'
    },
    orderedAt: {
      sql: 'ordered_at',
      type: 'time',
      title: 'Order Date'
    },
    status: {
      sql: 'order_status',
      type: 'string'
    }
  },

  segments: {
    completed: {
      sql: "${CUBE}.order_status = 'completed'"
    }
  },

  pre_aggregations: {
    // Pre-aggregate for dashboard performance
    monthlyBySegment: {
      measures: [revenue, count, uniqueCustomers],
      dimensions: [customerSegment],
      time_dimension: orderedAt,
      granularity: 'month',
      refresh_key: {
        every: '1 hour'
      }
    }
  }
});
```

---

## Simple Custom Metrics Mart (No Semantic Layer)

For teams not ready for a full semantic layer:

```sql
-- models/marts/metrics/mtr_revenue_daily.sql
-- Stable, agreed-upon metric definitions as a mart table

select
    ordered_at::date as metric_date,
    customer_segment,
    product_category,

    -- Core metrics (agreed definitions)
    count(distinct order_id) as order_count,
    count(distinct customer_id) as unique_customers,
    sum(net_revenue_usd) as revenue_usd,
    sum(net_revenue_usd) / nullif(count(distinct order_id), 0) as avg_order_value_usd,

    -- Trailing aggregates (computed here, not in BI)
    sum(net_revenue_usd) over (
        partition by customer_segment
        order by ordered_at::date
        rows between 29 preceding and current row
    ) as revenue_30d_rolling_usd

from {{ ref('fct_orders') }}
where order_status = 'completed'
group by 1, 2, 3
```

## Metric Documentation Template

Document every metric with the same structure so there's no ambiguity:

```yaml
# Paste into your team wiki or docs/metrics.md

## Revenue

**Definition**: Sum of `net_revenue_usd` from `fct_orders` where `order_status = 'completed'`
**Owner**: Finance Analytics
**Unit**: US Dollars (USD)
**Grain**: Can be sliced by day, month, quarter, year; customer_segment; product_category
**Excludes**: Refunded orders, test orders (customer_segment = 'internal')
**Source table**: `marts.core.fct_orders`
**Metric layer name**: `revenue` (dbt Semantic Layer)
**Last updated**: 2024-01-15
**Slack channel for questions**: #data-metrics
```

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

After writing `semantic_models.yml` and `metrics.yml`, validate YAML syntax and then test query compilation:

```bash
dbt parse
mf validate
```

`dbt parse` catches YAML schema errors. `mf validate` (when MetricFlow CLI is installed) confirms metrics can be queried. If `mf` is not available, use `dbt sl query --metrics <metric_name>` via dbt Cloud.

## If Something Goes Wrong

- **Metric not found in query**: The metric name in the query doesn't match the `name:` field in `metrics.yml`. Check for typos and confirm the semantic_model name matches what the metric references.
- **Dimension not available**: A group-by dimension is not recognized. The dimension must be declared in the `dimensions` or `entities` block of the semantic_model — add it there and re-run `dbt parse`.
- **dbt version too old**: MetricFlow semantic layer requires dbt >= 1.6. For older projects, use the legacy `metrics:` YAML syntax (dbt 1.3-1.5) or upgrade dbt. Check `dbt_project.yml` for the `require-dbt-version` field.
- **mf validate fails with connection error**: MetricFlow needs a live warehouse connection to validate. Confirm your profile target is set and the warehouse is accessible.
