---
name: looker-lkml
description: "Write and review LookML views, explores, and dashboards. Use when building Looker data models, optimizing LookML explores, writing custom dimensions and measures, troubleshooting Looker performance, or migrating dbt models to LookML. Triggers: 'LookML', 'Looker view', 'Looker explore', 'write LookML', 'Looker dashboard', 'dbt Looker integration', 'LookML review'."
---

# LookML

I'll help you write, review, and optimize LookML — the modeling layer that powers Looker dashboards and explores.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: dbt project structure, warehouse type, Looker version.

## LookML Architecture

```
Project
├── views/                  # Table/model definitions (dimensions, measures)
│   ├── fct_orders.view.lkml
│   ├── dim_customers.view.lkml
│   └── dim_products.view.lkml
├── explores/               # Join definitions (what tables connect how)
│   └── orders.explore.lkml
├── models/                 # Model file (ties explores to connection)
│   └── analytics.model.lkml
└── dashboards/             # Dashboard definitions
    └── revenue_overview.dashboard.lkml
```

---

## View Definition

```lkml
# views/fct_orders.view.lkml

view: fct_orders {
  sql_table_name: `analytics`.`marts`.`fct_orders` ;;

  # ------- DIMENSIONS -------

  dimension: order_id {
    type: string
    primary_key: yes
    sql: ${TABLE}.order_id ;;
    description: "Unique order identifier"
  }

  dimension: customer_id {
    type: string
    hidden: yes  # FK — don't expose directly; exposed via explore join
    sql: ${TABLE}.customer_id ;;
  }

  # Date dimension group — generates _date, _week, _month, _quarter, _year
  dimension_group: ordered {
    type: time
    timeframes: [date, week, month, quarter, year, raw]
    datatype: timestamp
    sql: ${TABLE}.ordered_at ;;
    description: "When the order was placed"
    label: "Order Date"
  }

  dimension: order_status {
    type: string
    sql: ${TABLE}.order_status ;;
    description: "Order status"
  }

  dimension: is_first_order {
    type: yesno
    sql: ${TABLE}.is_first_order ;;
    description: "True if this is the customer's first order"
  }

  # Tier dimension for bucketing
  dimension: order_value_tier {
    type: tier
    tiers: [0, 50, 100, 500, 1000, 5000]
    style: relational  # or classic
    sql: ${TABLE}.net_revenue_usd ;;
    value_format_name: usd
    description: "Order value bucket"
  }

  # ------- MEASURES -------

  measure: count {
    type: count
    label: "Order Count"
    drill_fields: [order_id, ordered_date, order_status]
  }

  measure: total_revenue {
    type: sum
    sql: ${TABLE}.net_revenue_usd ;;
    value_format_name: usd
    label: "Total Revenue"
    description: "Sum of net revenue across selected orders"
    drill_fields: [order_id, ordered_date, customer_id, total_revenue]
  }

  measure: average_order_value {
    type: average
    sql: ${TABLE}.net_revenue_usd ;;
    value_format_name: usd
    label: "Average Order Value"
  }

  # Running total (requires explore_source or window function)
  measure: cumulative_revenue {
    type: running_total
    sql: ${total_revenue} ;;
    value_format_name: usd
    direction: "column"
    label: "Cumulative Revenue"
  }

  # Filtered measure
  measure: completed_order_count {
    type: count
    filters: [order_status: "completed"]
    label: "Completed Orders"
  }

  # Ratio measure
  measure: completion_rate {
    type: number
    sql: ${completed_order_count} / nullif(${count}, 0) ;;
    value_format_name: percent_2
    label: "Completion Rate"
  }
}
```

---

## Explore Definition

```lkml
# explores/orders.explore.lkml

explore: orders {
  label: "Orders"
  description: "Start here for revenue analysis"
  view_name: fct_orders

  # Join dimensions from related views
  join: dim_customers {
    type: left_outer
    sql_on: ${fct_orders.customer_id} = ${dim_customers.customer_id} ;;
    relationship: many_to_one  # many orders → one customer
  }

  join: dim_products {
    type: left_outer
    sql_on: ${fct_orders.product_id} = ${dim_products.product_id} ;;
    relationship: many_to_one
  }

  # Conditionally join (require a specific filter first)
  join: dim_dates {
    type: left_outer
    sql_on: ${fct_orders.ordered_date} = ${dim_dates.date_key} ;;
    relationship: many_to_one
    required_access_grants: [finance_team]  # Access control
  }

  # Aggregate awareness — use pre-aggregated tables for speed
  aggregate_table: rollup__revenue_monthly {
    query: {
      dimensions: [fct_orders.ordered_month, dim_customers.customer_segment]
      measures: [fct_orders.total_revenue, fct_orders.count]
    }
    materialization: {
      datagroup_trigger: nightly_refresh
    }
  }

  # Always filter out deleted records
  always_filter: {
    filters: [fct_orders.order_status: "-NULL"]
  }

  # Limit what non-admin users can see
  access_filter: {
    field: dim_customers.customer_region
    user_attribute: allowed_regions
  }
}
```

---

## Model File

```lkml
# models/analytics.model.lkml

connection: "snowflake_prod"

include: "/views/*.view.lkml"
include: "/explores/*.explore.lkml"

# Datagroups (for caching triggers)
datagroup: nightly_refresh {
  label: "Nightly (2am UTC)"
  sql_trigger: SELECT FLOOR(DATEDIFF(hour, '2000-01-01', CONVERT_TIMEZONE('UTC', CURRENT_TIMESTAMP)) / 24) ;;
  max_cache_age: "25 hours"
}

datagroup: hourly_refresh {
  label: "Hourly"
  sql_trigger: SELECT FLOOR(DATEDIFF(minute, '2000-01-01', CONVERT_TIMEZONE('UTC', CURRENT_TIMESTAMP)) / 60) ;;
  max_cache_age: "65 minutes"
}
```

---

## dbt + Looker Integration

### Option 1: dbt-looker (Auto-generate LookML from dbt YAML)

```bash
pip install dbt-looker

# Generate LookML views from dbt schema.yml
dbt-looker --project-dir . --output-dir looker/views/
```

This reads column descriptions and tests from your dbt YAML and produces:
- View files with dimensions/measures mapped from columns
- Type inference from dbt column types

### Option 2: dbt Exposures (Track what Looker uses)

```yaml
# models/marts/core/_core__exposures.yml
version: 2

exposures:
  - name: revenue_dashboard
    label: "Revenue Overview Dashboard"
    type: dashboard
    maturity: high
    url: "https://company.looker.com/dashboards/42"
    description: "Executive revenue dashboard used in Monday reviews"
    owner:
      name: Finance Analytics
      email: finance-analytics@company.com
    depends_on:
      - ref('fct_orders')
      - ref('dim_customers')
      - ref('dim_products')
```

---

## Performance Optimization

```lkml
# Persistent Derived Table — pre-compute expensive aggregations
view: revenue_rollup_monthly {
  derived_table: {
    sql:
      SELECT
        DATE_TRUNC('month', ordered_at) AS month,
        customer_segment,
        SUM(net_revenue_usd) AS revenue_usd,
        COUNT(DISTINCT order_id) AS order_count
      FROM analytics.marts.fct_orders
      WHERE order_status = 'completed'
      GROUP BY 1, 2
    ;;
    datagroup_trigger: nightly_refresh
    distribution: "month"      # Redshift distkey
    sortkeys: ["month"]        # Redshift sortkey
    # cluster_by: ["month", "customer_segment"]  # Snowflake
  }

  dimension: month { type: date_month ; sql: ${TABLE}.month ;; }
  dimension: customer_segment { type: string ; sql: ${TABLE}.customer_segment ;; }
  measure: revenue_usd { type: sum ; sql: ${TABLE}.revenue_usd ;; value_format_name: usd }
  measure: order_count { type: sum ; sql: ${TABLE}.order_count ;; }
}
```

---

## LookML Review Checklist

When reviewing LookML PRs:

- [ ] All views have a `primary_key` dimension
- [ ] Dimension groups use `timeframes` (not bare date dimensions)
- [ ] Measures have `drill_fields` defined
- [ ] FKs are `hidden: yes`
- [ ] Value formats set (usd, percent_2, etc.) — not raw numbers
- [ ] Explores have `always_filter` for soft-deleted records
- [ ] PDTs have appropriate `datagroup_trigger` (not `persist_for`)
- [ ] No hard-coded database names (use `${TABLE}` or connection settings)
- [ ] Sensitive fields have `required_access_grants`
