# Lightdash Integration Guide

## Overview
Lightdash is an open-source BI tool built specifically for dbt. It reads your dbt project directly — models, columns, metrics, and metadata — and auto-generates an explore UI without requiring a separate semantic layer configuration.

## How Lightdash Reads dbt

Lightdash requires access to your compiled dbt project. It reads:
- `manifest.json` — model metadata, column descriptions, tests
- `profiles.yml` — warehouse connection (or environment variables)

Connection modes:
1. **dbt Core** — points at a local or CI-compiled `manifest.json`
2. **dbt Cloud** — reads artifacts from dbt Cloud jobs via API
3. **GitHub** — pulls repo directly and runs `dbt compile`

## Connection Setup

### Lightdash → dbt Core + Snowflake

```yaml
# In Lightdash project settings (or lightdash.yml)
type: dbt
target: prod
profiles_dir: /app/profiles
project_dir: /app/dbt_project

# profiles.yml used by Lightdash
my_project:
  target: prod
  outputs:
    prod:
      type: snowflake
      account: myorg.us-east-1
      user: LIGHTDASH_USER
      password: "{{ env_var('SNOWFLAKE_PASSWORD') }}"
      role: LIGHTDASH_ROLE
      database: ANALYTICS
      warehouse: LIGHTDASH_WH
      schema: marts
```

### Lightdash → dbt Cloud

```yaml
# Project settings
type: dbt_cloud
api_key: "{{ env_var('DBT_CLOUD_API_KEY') }}"
account_id: 12345
project_id: 67890
environment_id: 11111
```

## Exposing Metrics in dbt YAML

Lightdash uses `meta` blocks in dbt YAML to define explore behavior:

```yaml
# models/marts/fct_orders.yml
models:
  - name: fct_orders
    description: "One row per order"
    meta:
      label: "Orders"
      joins:
        - join: dim_customers
          sql_on: "${fct_orders.customer_id} = ${dim_customers.customer_id}"

    columns:
      - name: order_id
        description: "Unique order identifier"
        meta:
          dimension:
            type: number
            hidden: true

      - name: status
        description: "Order fulfillment status"
        meta:
          dimension:
            type: string
            label: "Order Status"

      - name: revenue
        description: "Revenue in USD"
        meta:
          dimension:
            type: number
            hidden: true
          metrics:
            total_revenue:
              type: sum
              label: "Total Revenue"
              description: "Sum of order revenue"
              format: "usd"
              round: 2
            avg_order_value:
              type: average
              label: "Avg Order Value"
              format: "usd"
              round: 2
            order_count:
              type: count_distinct
              sql: "${order_id}"
              label: "# Orders"

      - name: created_at
        meta:
          dimension:
            type: timestamp
            label: "Order Date"
            time_intervals: ["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"]

      - name: customer_id
        meta:
          dimension:
            type: number
            hidden: true
```

## Joining Models

```yaml
# models/marts/fct_orders.yml — meta.joins
meta:
  joins:
    - join: dim_customers
      sql_on: "${fct_orders.customer_id} = ${dim_customers.customer_id}"
      label: "Customers"
    - join: dim_products
      sql_on: "${fct_orders.product_id} = ${dim_products.product_id}"
      label: "Products"
      always: false  # optional join (default)
```

## Custom Metrics with SQL

```yaml
- name: gross_margin_pct
  description: "Gross margin percentage"
  meta:
    metrics:
      gross_margin_pct:
        type: number
        sql: "SUM(${revenue} - ${cogs}) / NULLIF(SUM(${revenue}), 0)"
        label: "Gross Margin %"
        format: "percent"
        round: 1
```

## Lightdash CLI

```bash
npm install -g @lightdash/cli

# Authenticate
lightdash login https://app.lightdash.cloud --token <token>

# Deploy dbt project to Lightdash
lightdash deploy --project <project-uuid>

# Preview before deploying
lightdash preview --name "my-preview"

# Validate metrics YAML
lightdash validate --project <project-uuid>

# Generate metrics from dbt model
lightdash generate-exposures --project <project-uuid>
```

## Self-Hosted Deployment (Docker)

```yaml
# docker-compose.yml
version: '3'
services:
  lightdash:
    image: lightdash/lightdash:latest
    ports:
      - "8080:8080"
    environment:
      - LIGHTDASH_SECRET=supersecret
      - DATABASE_URL=postgresql://user:pass@postgres:5432/lightdash
      - SITE_URL=http://localhost:8080
      - DBT_PROJECT_DIR=/dbt
    volumes:
      - ./dbt_project:/dbt
      - ./profiles.yml:/root/.dbt/profiles.yml

  postgres:
    image: postgres:14
    environment:
      POSTGRES_DB: lightdash
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
```

## CI/CD Integration

Deploy Lightdash metrics on every dbt project merge:

```yaml
# .github/workflows/lightdash-deploy.yml
name: Deploy to Lightdash

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup dbt
        run: pip install dbt-snowflake

      - name: Compile dbt project
        run: dbt compile --target prod
        env:
          DBT_SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}

      - name: Deploy to Lightdash
        run: |
          npm install -g @lightdash/cli
          lightdash login ${{ secrets.LIGHTDASH_URL }} --token ${{ secrets.LIGHTDASH_TOKEN }}
          lightdash deploy --project ${{ secrets.LIGHTDASH_PROJECT_UUID }}
```

## Access Control

Lightdash uses space-based permissions:

```
Organization
├── Admins — full access
├── Editors — can create/edit content
├── Viewers — read-only dashboards
└── Spaces
    ├── "Engineering" (private) — Editors only
    ├── "Finance" (restricted) — Finance group only
    └── "Company Dashboards" (public) — all Viewers
```

Row-level security via dbt column filters:

```yaml
# Use Lightdash user attributes (Enterprise)
meta:
  required_attributes:
    is_admin: "true"
```

## Comparison: Lightdash vs Metabase vs Looker

| Feature | Lightdash | Metabase | Looker |
|---|---|---|---|
| dbt-native | Yes (first-class) | Via plugin | Via dbt-looker |
| Self-hosted | Yes (open source) | Yes (open source) | No (cloud only) |
| SQL editor | Yes | Yes | Yes |
| Semantic layer | dbt YAML | No | LookML |
| Pricing | Open source / Cloud | Open source / Pro | Enterprise |
| Best for | dbt-first teams | Non-technical users | Large enterprises |
