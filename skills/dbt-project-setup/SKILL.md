---
name: dbt-project-setup
description: "Scaffold a production-ready dbt project with folder structure, profiles, packages, and CI/CD configuration. Use when starting a new dbt project from scratch, auditing an existing project's structure, or when your project layout is messy and needs reorganizing. Fires for 'start a new dbt project,' 'our dbt project is disorganized,' 'best practices for dbt folder structure,' or 'how should I set up dbt_project.yml?' Covers project scaffolding, profile config, package selection, naming conventions, and custom schema macros. Use this whenever dbt project setup, structure, or organization comes up. For Jinja patterns, see advanced-jinja-patterns. For data modeling, see data-modeling. For SQL style, see sql-style-guide."
triggers:
  - "set up dbt"
  - "new dbt project"
  - "scaffold dbt"
  - "bootstrap dbt project"
  - "initialize dbt"
  - "dbt project structure"
  - "dbt_project.yml setup"
  - "organize my dbt project"
  - "dbt folder structure"
  - "profiles.yml configuration"
  - "packages.yml setup"
  - "dbt best practices project"
  - "messy dbt project"
  - "start from scratch dbt"
  - "custom schema macro"
reads_first:
  - data-stack-context
cli_tools: []
produces:
  - "dbt_project.yml"
  - "profiles.yml"
  - "packages.yml"
  - ".github/workflows/dbt.yml"
  - "generate_schema_name macro"
validates_with:
  - "dbt parse"
  - "dbt debug"
  - "dbt deps"
  - "dbt build"
---

# dbt Project Setup

I'll scaffold a production-ready dbt project structure with sensible defaults, then walk you through adapter config, packages, and CI setup.

## Before You Start

Check these before generating any files to avoid overwriting existing work:
- `dbt_project.yml` — if it already exists, do not overwrite; offer to audit it instead
- `packages.yml` — read if present to see existing dependencies before adding new ones
- `.env.example` — review for credential patterns that should carry into `profiles.yml`

## Check Context First

Read `.claude/data-stack-context.md` if it exists. If not, I need to know:
1. Warehouse (Snowflake / BigQuery / Databricks / Redshift / DuckDB)?
2. dbt Core or dbt Cloud?
3. Orchestrator (Airflow / Dagster / Prefect / dbt Cloud jobs / GitHub Actions)?

## Recommended Folder Structure

```
my_project/
├── dbt_project.yml            # Project config
├── profiles.yml               # Connection profiles (local dev only — not committed)
├── packages.yml               # dbt packages
├── .dbt/                      # (optional) local overrides
│
├── models/
│   ├── staging/               # stg_: 1-to-1 with sources, light transforms
│   │   ├── salesforce/
│   │   │   ├── _salesforce__sources.yml
│   │   │   ├── _salesforce__models.yml
│   │   │   ├── stg_salesforce__accounts.sql
│   │   │   └── stg_salesforce__opportunities.sql
│   │   └── stripe/
│   │       ├── _stripe__sources.yml
│   │       ├── _stripe__models.yml
│   │       └── stg_stripe__charges.sql
│   │
│   ├── intermediate/          # int_: business logic, not exposed to BI
│   │   └── int_orders__joined.sql
│   │
│   └── marts/                 # Final models exposed to BI
│       ├── core/              # Cross-domain entities
│       │   ├── _core__models.yml
│       │   ├── dim_customers.sql
│       │   └── fct_orders.sql
│       ├── finance/
│       │   ├── _finance__models.yml
│       │   └── fct_revenue.sql
│       └── marketing/
│           └── fct_campaigns.sql
│
├── snapshots/                 # SCD Type 2
│   └── snapshot_customers.sql
│
├── seeds/                     # Static CSV data
│   └── country_codes.csv
│
├── tests/                     # Singular tests (complex SQL assertions)
│   └── assert_orders_positive_revenue.sql
│
├── unit_tests/                # dbt unit tests (dbt 1.8+) — mock inputs, test SQL logic
│
├── macros/                    # Jinja macros
│   ├── generate_schema_name.sql
│   └── cents_to_dollars.sql
│
├── analyses/                  # Ad-hoc queries (not materialized)
│   └── revenue_exploration.sql
│
└── docs/                      # Extra documentation
    └── overview.md
```

## dbt_project.yml

```yaml
name: my_project
version: '1.0.0'
config-version: 2

profile: my_project

model-paths: ["models"]
analysis-paths: ["analyses"]
test-paths: ["tests"]
seed-paths: ["seeds"]
macro-paths: ["macros"]
snapshot-paths: ["snapshots"]

target-path: "target"
clean-targets: ["target", "dbt_packages"]

models:
  my_project:
    staging:
      +materialized: view
      +schema: staging
      +tags: ["staging"]
    intermediate:
      +materialized: ephemeral
      +tags: ["intermediate"]
    marts:
      +materialized: table
      +schema: marts
      +tags: ["marts"]
      core:
        +tags: ["core", "marts"]
      finance:
        +tags: ["finance", "marts"]
      marketing:
        +tags: ["marketing", "marts"]

snapshots:
  my_project:
    +target_schema: snapshots
    +strategy: timestamp
    +updated_at: updated_at

seeds:
  my_project:
    +schema: seeds
    +quote_columns: false
```

## profiles.yml (not committed to git)

### Snowflake
```yaml
my_project:
  target: dev
  outputs:
    dev:
      type: snowflake
      account: "{{ env_var('SNOWFLAKE_ACCOUNT') }}"
      user: "{{ env_var('SNOWFLAKE_USER') }}"
      password: "{{ env_var('SNOWFLAKE_PASSWORD') }}"
      role: "{{ env_var('SNOWFLAKE_ROLE', 'TRANSFORMER') }}"
      database: analytics
      warehouse: "{{ env_var('SNOWFLAKE_WAREHOUSE', 'TRANSFORMING') }}"
      schema: "dev_{{ env_var('DBT_USER', 'default') }}"
      threads: 4
      client_session_keep_alive: false
    prod:
      type: snowflake
      account: "{{ env_var('SNOWFLAKE_ACCOUNT') }}"
      user: "{{ env_var('SNOWFLAKE_SERVICE_USER') }}"
      private_key_path: "{{ env_var('SNOWFLAKE_PRIVATE_KEY_PATH') }}"
      role: TRANSFORMER
      database: analytics
      warehouse: TRANSFORMING_PROD
      schema: prod
      threads: 16
```

### BigQuery
```yaml
my_project:
  target: dev
  outputs:
    dev:
      type: bigquery
      method: oauth
      project: "{{ env_var('GCP_PROJECT') }}"
      dataset: "dev_{{ env_var('DBT_USER', 'default') }}"
      threads: 4
      timeout_seconds: 300
      location: US
    prod:
      type: bigquery
      method: service-account
      project: "{{ env_var('GCP_PROJECT') }}"
      keyfile: "{{ env_var('GOOGLE_APPLICATION_CREDENTIALS') }}"
      dataset: prod
      threads: 16
      timeout_seconds: 600
      location: US
```

### Databricks
```yaml
my_project:
  target: dev
  outputs:
    dev:
      type: databricks
      catalog: "{{ env_var('DATABRICKS_CATALOG', 'hive_metastore') }}"
      schema: "dev_{{ env_var('DBT_USER', 'default') }}"
      host: "{{ env_var('DATABRICKS_HOST') }}"
      http_path: "{{ env_var('DATABRICKS_HTTP_PATH') }}"
      token: "{{ env_var('DATABRICKS_TOKEN') }}"
      threads: 4
```

## packages.yml

```yaml
packages:
  # Core utilities — always include
  - package: dbt-labs/dbt_utils
    version: [">=1.1.0", "<2.0.0"]

  # Source freshness + anomaly detection
  - package: elementary-data/elementary
    version: [">=0.13.0", "<1.0.0"]

  # Code style enforcement
  - package: dbt-labs/codegen
    version: [">=0.12.0", "<1.0.0"]

  # Optionally: audit_helper for refactoring validation
  # - package: dbt-labs/audit_helper
  #   version: [">=0.10.0", "<1.0.0"]
```

Run `dbt deps` after adding packages.

## generate_schema_name Macro

By default, dbt appends the target schema prefix to custom schemas (e.g., `dev_staging`). Override this for cleaner prod schemas:

```sql
-- macros/generate_schema_name.sql
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- set default_schema = target.schema -%}
    {%- if custom_schema_name is none -%}
        {{ default_schema }}
    {%- elif target.name == 'prod' -%}
        {{ custom_schema_name | trim }}
    {%- else -%}
        {{ default_schema }}_{{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
```

## .gitignore

```
target/
dbt_packages/
logs/
profiles.yml
.env
*.pyc
__pycache__/
.DS_Store
```

## CI Configuration

### GitHub Actions

```yaml
# .github/workflows/dbt-ci.yml
name: dbt CI

on:
  pull_request:
    branches: [main]
    paths:
      - 'models/**'
      - 'macros/**'
      - 'tests/**'
      - 'snapshots/**'
      - 'dbt_project.yml'
      - 'packages.yml'

jobs:
  dbt-check:
    runs-on: ubuntu-latest
    env:
      SNOWFLAKE_ACCOUNT: ${{ secrets.SNOWFLAKE_ACCOUNT }}
      SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_CI_USER }}
      SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_CI_PASSWORD }}
      DBT_USER: ci_${{ github.event.pull_request.number }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: pip

      - run: pip install dbt-snowflake

      - run: dbt deps

      - name: dbt parse (validate syntax)
        run: dbt parse --target dev

      - name: dbt build (affected models only)
        run: |
          dbt build \
            --select state:modified+ \
            --defer \
            --state ./prod-artifacts \
            --target dev
        # Note: requires prod-artifacts/ with manifest.json from previous prod run

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: dbt-artifacts
          path: target/
```

## Source Declarations

```yaml
# models/staging/salesforce/_salesforce__sources.yml
version: 2

sources:
  - name: salesforce
    description: "Raw Salesforce data loaded by Fivetran"
    database: raw
    schema: salesforce
    freshness:
      warn_after: {count: 24, period: hour}
      error_after: {count: 48, period: hour}
    loaded_at_field: _fivetran_synced

    tables:
      - name: account
        description: "Salesforce Accounts (companies)"
        columns:
          - name: id
            description: "Salesforce Account ID"
            data_tests:
              - unique
              - not_null

      - name: opportunity
        description: "Salesforce Opportunities (deals)"
        freshness:
          warn_after: {count: 12, period: hour}
```

## Post-Setup Checklist

Run these to validate the setup:

```bash
# Validate syntax + compile
dbt parse

# Test connections
dbt debug

# Install packages
dbt deps

# Run a smoke test (staging layer only)
dbt build --select staging

# Check freshness
dbt source freshness

# Generate docs
dbt docs generate && dbt docs serve
```

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

Run the Post-Setup Checklist already in this skill (the `dbt parse`, `dbt debug`, `dbt deps`, `dbt build --select staging` sequence). All five commands should exit cleanly before considering the setup done. Pay particular attention to `dbt debug` — it confirms the warehouse connection and profiles path before any models are run.

## If Something Goes Wrong

- **Profile not found**: `dbt debug` reports "profile not found". Check that `profiles.yml` exists at `~/.dbt/profiles.yml` (default) or the path set in `DBT_PROFILES_DIR`. The profile name in `profiles.yml` must match the `profile:` key in `dbt_project.yml`.
- **Schema name conflicts**: Staging models materialize to `dev_staging` or `prod_staging` instead of `staging` in prod. Ensure the `generate_schema_name` macro is in `macros/` — without it, dbt appends the target schema prefix to every custom schema name.
- **Package install fails / version conflict**: `dbt deps` fails with a version constraint error. Check [hub.getdbt.com](https://hub.getdbt.com) for the latest compatible version range for your dbt version; update the constraint in `packages.yml`.
- **`dbt parse` errors on first run**: Usually a model path mismatch or missing `models/` directory. Confirm the `model-paths` setting in `dbt_project.yml` matches the actual directory structure; also check that `dbt_packages/` exists (run `dbt deps` first).

## Common Mistakes

- **Putting `profiles.yml` in git** — contains credentials, always gitignore it
- **Staging models querying marts** — staging should only reference `source()`, never `ref()` to marts
- **Missing `generate_schema_name` override** — prod schemas end up as `prod_staging`, `prod_marts` which is redundant
- **One giant `schema.yml`** — split per directory (one per source, one per layer)
- **No threads configured** — default is 1; set 4-8 for dev, 16+ for prod
