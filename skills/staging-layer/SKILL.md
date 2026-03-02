---
name: staging-layer
description: "Build dbt staging models (stg_ prefix) that clean and standardize raw source data one-to-one. Use when adding a new source, building the first layer of transformation, or auditing existing staging models. Triggers: 'staging layer', 'staging model', 'stg_ model', 'build staging', 'raw to staging', 'clean source data', 'new source model'."
triggers:
  - "staging layer"
  - "staging model"
  - "stg_ model"
  - "build staging"
  - "raw to staging"
  - "clean source data"
reads_first:
  - data-stack-context
cli_tools:
  - schema-introspect.js
  - manifest-coverage.js
produces:
  - "stg_ model SQL"
  - "sources.yml"
  - "schema.yml"
validates_with:
  - "dbt compile"
  - "dbt source freshness"
  - "dbt test --select staging"
---

# Staging Layer

I'll help you build clean, consistent staging models — the first dbt transformation layer that converts raw source data into a standardized, well-named foundation.

## Before You Start

Run schema introspection on the raw source before writing SQL to avoid column name surprises:

```bash
node tools/clis/schema-introspect.js
```

Also read existing `sources.yml` files under `models/staging/` to avoid duplicate source declarations for tables already registered.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: warehouse, ingestion tool (Fivetran, Airbyte), raw schema names.

## Staging Layer Principles

Staging models follow strict rules:
1. **One staging model per source table** — 1:1 mapping, never join sources in staging
2. **Only `source()` references** — never `ref()` to other models
3. **Rename and recast only** — no business logic, no filtering, no aggregation
4. **Materialize as views** — staging is cheap and should be transparent
5. **Prefix**: `stg_<source_name>__<table_name>` (double underscore separates source from table)

## File Organization

```
models/staging/
├── salesforce/
│   ├── _salesforce__sources.yml      # source() declarations
│   ├── _salesforce__models.yml       # staging model docs + tests
│   ├── stg_salesforce__accounts.sql
│   └── stg_salesforce__opportunities.sql
└── stripe/
    ├── _stripe__sources.yml
    ├── _stripe__models.yml
    └── stg_stripe__charges.sql
```

## Source Declaration Template

```yaml
# models/staging/salesforce/_salesforce__sources.yml
version: 2

sources:
  - name: salesforce
    description: "Salesforce CRM data loaded by Fivetran"
    database: "{{ env_var('RAW_DATABASE', 'raw') }}"
    schema: salesforce
    loaded_at_field: _fivetran_synced
    freshness:
      warn_after: {count: 24, period: hour}
      error_after: {count: 48, period: hour}

    tables:
      - name: account
        identifier: account   # actual table name if different from name
        description: "Salesforce Account object (companies)"
        columns:
          - name: id
            description: "Salesforce Account ID (18-char)"
            data_tests:
              - unique
              - not_null

      - name: opportunity
        description: "Salesforce Opportunity object (deals)"
        freshness:
          warn_after: {count: 12, period: hour}
        columns:
          - name: id
            data_tests:
              - unique
              - not_null
```

## Staging Model Template

```sql
-- models/staging/salesforce/stg_salesforce__accounts.sql
-- One row per Salesforce Account
-- No joins, no aggregations, no business logic

with

source as (

    select * from {{ source('salesforce', 'account') }}

),

renamed as (

    select
        -----------------------------------------------------------------------
        -- IDs
        -----------------------------------------------------------------------
        id as account_id,
        owner_id as owner_salesforce_id,
        parent_id as parent_account_id,

        -----------------------------------------------------------------------
        -- Attributes
        -----------------------------------------------------------------------
        name as account_name,
        type as account_type,
        industry,
        number_of_employees,
        annual_revenue,
        website,

        -----------------------------------------------------------------------
        -- Address
        -----------------------------------------------------------------------
        billing_street,
        billing_city,
        billing_state,
        billing_postal_code,
        billing_country,

        -----------------------------------------------------------------------
        -- Booleans (standardize to true/false)
        -----------------------------------------------------------------------
        (type = 'Customer') as is_customer,
        (is_deleted = '1' or is_deleted = 'true') as is_deleted,

        -----------------------------------------------------------------------
        -- Timestamps (cast to consistent timezone)
        -----------------------------------------------------------------------
        cast(created_date as timestamp) as created_at,
        cast(last_modified_date as timestamp) as updated_at,
        _fivetran_synced

    from source
    -- Exclude soft-deleted records in staging (or keep and filter downstream)
    -- where not is_deleted

)

select * from renamed
```

## Common Source-Specific Patterns

### Fivetran Sources

```sql
-- Fivetran adds _fivetran_synced, _fivetran_deleted, _fivetran_id columns
-- Always preserve _fivetran_synced for freshness checks

with source as (
    select * from {{ source('salesforce', 'account') }}
    -- Exclude Fivetran-deleted records
    where not coalesce(_fivetran_deleted, false)
),
```

### Airbyte Sources

```sql
-- Airbyte adds _airbyte_raw_id, _airbyte_extracted_at, _airbyte_meta columns
-- Deduplicate using _airbyte_raw_id for the latest record

with source as (
    select * from {{ source('salesforce', 'account') }}
    qualify row_number() over (
        partition by id
        order by _airbyte_extracted_at desc
    ) = 1  -- Snowflake QUALIFY
    -- BigQuery: use a CTE with row_number() and filter where rn = 1
),
```

### Stripe / Payment Sources

```sql
-- Stripe amounts are in cents — convert to dollars in staging
select
    id as charge_id,
    amount / 100.0 as amount_usd,              -- cents → dollars
    amount_refunded / 100.0 as refunded_usd,
    currency,
    (currency = 'usd') as is_usd,
    -- Stripe timestamps are Unix epoch integers
    to_timestamp(created) as created_at,       -- Snowflake
    -- timestamp_seconds(created) as created_at  -- BigQuery
    status as charge_status,
    (status = 'succeeded') as is_succeeded
```

### Boolean Standardization

```sql
-- Source systems use inconsistent boolean representations
-- Standardize to SQL boolean in staging

-- Salesforce: 'true'/'false' strings
(is_closed = 'true') as is_closed,

-- MySQL: 0/1 integers
(is_active = 1) as is_active,

-- Excel/CSV: 'Yes'/'No'
(approved = 'Yes') as is_approved,

-- Snowflake-friendly coalesce pattern:
coalesce(try_cast(is_deleted as boolean), false) as is_deleted
```

### Timestamp Standardization

```sql
-- Always normalize to UTC in staging

-- Unix epoch (Stripe, many APIs):
to_timestamp(created_at_epoch) as created_at           -- Snowflake
timestamp_seconds(created_at_epoch) as created_at      -- BigQuery
from_unixtime(created_at_epoch) as created_at          -- Databricks/Spark

-- Snowflake: convert TZ-aware string to UTC
convert_timezone('UTC', created_at::timestamp_tz)::timestamp_ntz as created_at

-- BigQuery: normalize to UTC
datetime(created_at, 'America/New_York') at time zone 'UTC'

-- Redshift: AT TIME ZONE
convert_timezone('EST', 'UTC', created_at)
```

## Staging Model YAML Docs

```yaml
# models/staging/salesforce/_salesforce__models.yml
version: 2

models:
  - name: stg_salesforce__accounts
    description: |
      One row per Salesforce Account. Cleaned and renamed from the raw
      `salesforce.account` table. Excludes Fivetran-deleted records.
    config:
      materialized: view
      contract:
        enforced: false  # Relax contracts on staging views
    columns:
      - name: account_id
        description: "Primary key: Salesforce 18-char Account ID"
        data_tests:
          - unique
          - not_null
      - name: account_name
        description: "Company name"
        data_tests:
          - not_null
      - name: is_customer
        description: "True if Account type = 'Customer'"
      - name: created_at
        description: "UTC timestamp of Account creation in Salesforce"
        data_tests:
          - not_null
      - name: _fivetran_synced
        description: "UTC timestamp of last Fivetran sync"
```

## What NOT to Do in Staging

```sql
-- ❌ DON'T: Join two sources
from {{ source('salesforce', 'account') }} a
join {{ source('salesforce', 'user') }} u on a.owner_id = u.id

-- ❌ DON'T: Apply business logic or filters
where account_type = 'Customer'  -- This is a business rule — do it in intermediate/marts

-- ❌ DON'T: Reference other staging models
from {{ ref('stg_salesforce__accounts') }}  -- staging should only use source()

-- ❌ DON'T: Aggregate
group by account_type  -- Aggregation goes in intermediate or marts

-- ❌ DON'T: Name columns with business context
account_arr  -- ARR is a business metric, not a source column
```

## Codegen — Auto-Generate Staging Models

Use the `dbt-labs/codegen` package to scaffold staging models from source:

```bash
# Generate source YAML from existing tables
dbt run-operation codegen.generate_source \
  --args '{"schema_name": "salesforce", "generate_columns": true}'

# Generate staging model SQL from a source table
dbt run-operation codegen.generate_base_model \
  --args '{"source_name": "salesforce", "table_name": "account"}'
```

Review the generated output and apply the naming/casting conventions above.

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

After generating staging models and sources.yml, run:

```bash
dbt compile --select staging
dbt source freshness
node tools/clis/manifest-coverage.js --manifest target/manifest.json
```

`dbt compile` catches SQL syntax errors and missing source declarations. `dbt source freshness` validates that `loaded_at_field` is correctly configured. `manifest-coverage.js` confirms staging models have tests attached.

## If Something Goes Wrong

- **Source not found**: `dbt compile` reports "source not found". Confirm the `database` and `schema` in `sources.yml` exactly match the raw schema in your warehouse — check for environment-specific prefixes.
- **Freshness check fails**: `dbt source freshness` errors on a table. Verify the `loaded_at_field` column exists in the raw table by running `node tools/clis/schema-introspect.js`. Common issue: Fivetran uses `_fivetran_synced`, Airbyte uses `_airbyte_extracted_at`.
- **Column mismatch after source change**: The source added or dropped columns and the staging model no longer matches. Re-run `schema-introspect.js` to get the current column list, then update the staging model and schema.yml accordingly.
- **Duplicate source declaration**: `dbt compile` warns about a source already declared. Search existing `sources.yml` files under `models/staging/` for the table name before adding a new source declaration.
