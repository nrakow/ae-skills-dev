---
name: looker-lkml
description: "Write LookML views, explores, and models for Looker BI. Use when building a new Looker explore, adding derived tables (PDTs), configuring access grants, or generating LookML from dbt models. Triggers: 'LookML', 'Looker view', 'Looker explore', 'PDT', 'Looker dashboard', 'Looker model', 'write LookML', 'dbt to Looker'."
triggers:
  - "LookML"
  - "Looker view"
  - "Looker explore"
  - "PDT"
  - "write LookML"
  - "dbt to Looker"
reads_first:
  - data-stack-context
  - marts-design
cli_tools:
  - manifest-parse.js
produces:
  - "LookML view file"
  - "LookML explore"
  - "LookML model file"
validates_with:
  - "lookml-linter (if configured)"
  - "Looker IDE validation"
---

# LookML

I'll help you write, review, and optimize LookML — the modeling layer that powers Looker dashboards and explores.

## Before You Start

- Read `.claude/data-stack-context.md` for dbt project structure, warehouse type, and Looker version.
- Review mart schemas to understand available tables and column names before writing views.
- Run `node tools/clis/manifest-parse.js --manifest target/manifest.json` to extract column metadata from your compiled dbt manifest — this bootstraps LookML view definitions with correct field names and types.
- Confirm which marts are ready for BI exposure (avoid exposing staging or intermediate models).
- Check existing LookML project structure so new files follow established naming conventions.

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

  dimension_group: ordered {
    type: time
    timeframes: [date, week, month, quarter, year, raw]
    datatype: timestamp
    sql: ${TABLE}.ordered_at ;;
    label: "Order Date"
  }

  dimension: order_value_tier {
    type: tier
    tiers: [0, 50, 100, 500, 1000, 5000]
    style: relational
    sql: ${TABLE}.net_revenue_usd ;;
    value_format_name: usd
  }

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
    drill_fields: [order_id, ordered_date, customer_id, total_revenue]
  }

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

  join: dim_customers {
    type: left_outer
    sql_on: ${fct_orders.customer_id} = ${dim_customers.customer_id} ;;
    relationship: many_to_one
  }

  join: dim_products {
    type: left_outer
    sql_on: ${fct_orders.product_id} = ${dim_products.product_id} ;;
    relationship: many_to_one
  }

  aggregate_table: rollup__revenue_monthly {
    query: {
      dimensions: [fct_orders.ordered_month, dim_customers.customer_segment]
      measures: [fct_orders.total_revenue, fct_orders.count]
    }
    materialization: {
      datagroup_trigger: nightly_refresh
    }
  }

  always_filter: {
    filters: [fct_orders.order_status: "-NULL"]
  }

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

datagroup: nightly_refresh {
  label: "Nightly (2am UTC)"
  sql_trigger: SELECT FLOOR(DATEDIFF(hour, '2000-01-01', CONVERT_TIMEZONE('UTC', CURRENT_TIMESTAMP)) / 24) ;;
  max_cache_age: "25 hours"
}
```

---

## dbt + Looker Integration

### Generating LookML from dbt

Run `node tools/clis/manifest-parse.js --manifest target/manifest.json` to extract column metadata from your compiled dbt manifest to bootstrap LookML view definitions. This surfaces column names, types, and descriptions already documented in your dbt YAML, so you are not starting from scratch.

### dbt-looker (Auto-generate LookML from dbt YAML)

```bash
pip install dbt-looker

# Generate LookML views from dbt schema.yml
dbt-looker --project-dir . --output-dir looker/views/
```

### dbt Exposures (Track what Looker uses)

```yaml
# models/marts/core/_core__exposures.yml
version: 2

exposures:
  - name: revenue_dashboard
    label: "Revenue Overview Dashboard"
    type: dashboard
    url: "https://company.looker.com/dashboards/42"
    owner:
      name: Finance Analytics
      email: finance-analytics@company.com
    depends_on:
      - ref('fct_orders')
      - ref('dim_customers')
```

---

## PDT: Persistent Derived Table

```lkml
# Pre-compute expensive aggregations as a PDT
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
  }

  dimension: month { type: date_month ; sql: ${TABLE}.month ;; }
  dimension: customer_segment { type: string ; sql: ${TABLE}.customer_segment ;; }
  measure: revenue_usd { type: sum ; sql: ${TABLE}.revenue_usd ;; value_format_name: usd }
}
```

---

## LookML Review Checklist

- [ ] All views have a `primary_key` dimension
- [ ] Dimension groups use `timeframes` (not bare date dimensions)
- [ ] Measures have `drill_fields` defined
- [ ] FKs are `hidden: yes`
- [ ] Value formats set (usd, percent_2, etc.)
- [ ] Explores have `always_filter` for soft-deleted records
- [ ] PDTs have appropriate `datagroup_trigger` (not `persist_for`)
- [ ] No hard-coded database names (use `${TABLE}` or connection settings)
- [ ] Sensitive fields have `required_access_grants`

---

## Verify Your Work

- Validate LookML in the Looker IDE (Development Mode → Validate LookML); confirm zero errors and zero warnings.
- Run `lookml-linter` if configured in your project to catch style issues.
- Open the explore in Looker UI, run a query with the new dimensions and measures, and confirm results match a direct warehouse query.
- Check PDT build status in Looker Admin → Persistent Derived Tables to confirm the PDT materialized without errors.
- Run `node tools/clis/manifest-parse.js --manifest target/manifest.json` and verify the column list matches what was used in the view definition.

## If Something Goes Wrong

- **LookML validation error "Unknown field"**: the `sql_table_name` or column name does not exist in the warehouse; re-run `manifest-parse.js` to get current column names from the compiled manifest.
- **PDT fails to build**: check the Looker Admin PDT log for the SQL error; common causes are schema changes in the upstream dbt model or a missing `datagroup_trigger`.
- **Explore returns wrong row counts**: check join `relationship` type — a `many_to_many` join causes fan-out; fix with `type: full_outer` or restructure the explore.
- **Access grant not enforced**: confirm the user attribute is set on the Looker user and matches an `allowed_values` entry in the `access_grant` block.
- **dbt model change breaks existing LookML**: run `dbt docs generate` to find renamed columns, then update the corresponding `sql:` references in the view file.
