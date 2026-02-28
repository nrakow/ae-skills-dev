# Looker Integration Guide

## Overview
Looker is a BI/data exploration platform using LookML (a YAML-like modeling language) to define metrics, dimensions, and relationships on top of your warehouse. It generates SQL at query time, so your dbt models serve as the physical layer.

## LookML ↔ dbt Mapping

| dbt concept | LookML concept |
|---|---|
| `ref('model')` | `sql_table_name: schema.table` |
| column | dimension / measure |
| model | view |
| mart | explore |
| metric | measure |
| tag | group_label |

## Connection Setup

### Looker → Snowflake
```ini
# Admin > Connections > New Connection
Dialect: Snowflake
Host: <account>.snowflakecomputing.com
Database: ANALYTICS
Schema: PUBLIC
Username: LOOKER_USER
Password: ****
Warehouse: LOOKER_WH
Role: LOOKER_ROLE
```

### Looker → BigQuery
```ini
Dialect: Google BigQuery Standard SQL
Project: my-gcp-project
Dataset: analytics
Authentication: Service Account JSON
```

### Looker → Databricks
```ini
Dialect: Databricks
Server Hostname: <workspace>.azuredatabricks.net
HTTP Path: /sql/1.0/warehouses/<id>
Port: 443
Token: dapi...
```

## LookML Project Structure

```
my_looker_project/
├── models/
│   ├── ecommerce.model.lkml       # Explore definitions
│   └── finance.model.lkml
├── views/
│   ├── orders.view.lkml
│   ├── customers.view.lkml
│   └── order_items.view.lkml
├── explores/
│   └── order_explorer.explore.lkml
└── manifest.lkml
```

## View Definition

```lookml
# views/orders.view.lkml
view: orders {
  sql_table_name: analytics.fct_orders ;;

  dimension: order_id {
    type: number
    primary_key: yes
    sql: ${TABLE}.order_id ;;
  }

  dimension: status {
    type: string
    sql: ${TABLE}.status ;;
  }

  dimension_group: created {
    type: time
    timeframes: [raw, date, week, month, quarter, year]
    datatype: timestamp
    sql: ${TABLE}.created_at ;;
  }

  dimension: is_first_order {
    type: yesno
    sql: ${TABLE}.order_number = 1 ;;
  }

  measure: count {
    type: count
    drill_fields: [order_id, customers.name, created_date, status]
  }

  measure: total_revenue {
    type: sum
    sql: ${TABLE}.revenue ;;
    value_format_name: usd
    drill_fields: [order_id, created_date, total_revenue]
  }

  measure: average_order_value {
    type: average
    sql: ${TABLE}.revenue ;;
    value_format_name: usd
  }

  measure: distinct_customers {
    type: count_distinct
    sql: ${TABLE}.customer_id ;;
  }
}
```

## Explore Definition

```lookml
# models/ecommerce.model.lkml
connection: "production"

include: "/views/*.view.lkml"

datagroup: daily_refresh {
  sql_trigger: SELECT MAX(DATE(created_at)) FROM analytics.fct_orders ;;
  max_cache_age: "24 hours"
}

explore: orders {
  label: "Orders & Revenue"
  description: "Analyze orders, revenue, and customer behavior"

  always_filter: {
    filters: [orders.created_date: "90 days"]
  }

  access_filter: {
    field: orders.region
    user_attribute: region
  }

  join: customers {
    type: left_outer
    sql_on: ${orders.customer_id} = ${customers.customer_id} ;;
    relationship: many_to_one
  }

  join: order_items {
    type: left_outer
    sql_on: ${orders.order_id} = ${order_items.order_id} ;;
    relationship: one_to_many
  }

  aggregate_table: rollup__revenue_by_month {
    query: {
      dimensions: [orders.created_month]
      measures: [orders.total_revenue, orders.count]
    }
    materialization: {
      datagroup_trigger: daily_refresh
    }
  }
}
```

## dbt-looker Integration

Auto-generate LookML from dbt YAML:

```bash
pip install dbt-looker
dbt-looker expose --target prod
```

Annotate dbt columns to control LookML output:

```yaml
# models/marts/fct_orders.yml
models:
  - name: fct_orders
    meta:
      looker:
        label: "Orders"
        hidden: false
    columns:
      - name: order_id
        meta:
          looker:
            hidden: false
            primary_key: true
      - name: revenue
        meta:
          looker:
            measure:
              total_revenue:
                type: sum
                value_format_name: usd
              average_order_value:
                type: average
                value_format_name: usd
      - name: created_at
        meta:
          looker:
            dimension_group: created
            timeframes: [date, week, month, quarter, year]
```

## Persistent Derived Tables (PDTs)

```lookml
view: customer_lifetime_value {
  derived_table: {
    sql:
      SELECT
        customer_id,
        SUM(revenue) AS lifetime_value,
        COUNT(*) AS order_count,
        MIN(created_at) AS first_order_at,
        MAX(created_at) AS last_order_at
      FROM analytics.fct_orders
      GROUP BY 1
    ;;
    datagroup_trigger: daily_refresh
    partition_keys: []
    indexes: ["customer_id"]
  }

  dimension: customer_id {
    type: number
    primary_key: yes
    sql: ${TABLE}.customer_id ;;
  }

  measure: average_ltv {
    type: average
    sql: ${TABLE}.lifetime_value ;;
    value_format_name: usd
  }
}
```

## Row-Level Security

```lookml
# User attributes: Admin > User Attributes
# Create attribute: "region" (type: string, user access: view)

access_filter: {
  field: orders.region
  user_attribute: region
}

# Or via access grants:
access_grant: can_view_finance {
  user_attribute: department
  allowed_values: ["finance", "executive"]
}

measure: gross_margin {
  type: number
  sql: (${revenue} - ${cogs}) / NULLIF(${revenue}, 0) ;;
  required_access_grants: [can_view_finance]
}
```

## Caching and Performance

```lookml
# Model-level datagroup
datagroup: hourly_refresh {
  sql_trigger: SELECT FLOOR(EXTRACT(EPOCH FROM NOW()) / 3600) ;;
  max_cache_age: "1 hour"
}

# Explore-level PDT materialization
explore: high_traffic_explore {
  persist_with: hourly_refresh

  aggregate_table: daily_summary {
    query: {
      dimensions: [orders.created_date, customers.segment]
      measures: [orders.total_revenue, orders.count]
    }
    materialization: {
      datagroup_trigger: hourly_refresh
    }
  }
}
```

## LookML Validation Checklist

- [ ] All `sql_table_name` references point to dbt mart models (not staging)
- [ ] Every view has a `primary_key` dimension
- [ ] Measures have appropriate `value_format_name` (usd, decimal_2, percent_2)
- [ ] Explores have `always_filter` for date ranges on high-cardinality tables
- [ ] PDTs use `datagroup_trigger` (not `sql_trigger`) where possible
- [ ] `access_filter` applied to all explores with PII or sensitive data
- [ ] `label` and `description` set on all explores and key dimensions
- [ ] Hidden dimensions/measures for join keys and internal fields

## Common Looker SQL Dialects

```lookml
# Snowflake-specific: use QUALIFY
dimension: row_number {
  type: number
  sql: ROW_NUMBER() OVER (PARTITION BY ${customer_id} ORDER BY ${created_raw}) ;;
  hidden: yes
}

# BigQuery-specific: use SAFE_DIVIDE
measure: conversion_rate {
  type: number
  sql: SAFE_DIVIDE(${conversions}, ${sessions}) ;;
}

# Date spine reference
dimension: days_since_first_order {
  type: number
  sql: DATE_DIFF(CURRENT_DATE(), ${first_order_date}, DAY) ;;  -- BigQuery
  # sql: DATEDIFF('day', ${first_order_date}, CURRENT_DATE()) ;;  -- Snowflake
}
```
