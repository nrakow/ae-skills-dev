---
name: data-contracts
description: "Define and enforce data contracts between producers and consumers to prevent breaking changes and guarantee schema stability. Use when formalizing producer-consumer agreements, implementing schema constraints, or protecting downstream dependencies from upstream changes. Triggers: 'data contract', 'schema contract', 'data SLA', 'producer consumer', 'enforce schema', 'breaking changes', 'contract testing'."
triggers:
  - "data contract"
  - "schema contract"
  - "data SLA"
  - "producer consumer"
  - "enforce schema"
  - "breaking changes"
reads_first:
  - data-stack-context
  - data-quality-testing
cli_tools:
  - schema-introspect.js
produces:
  - "contract YAML"
  - "dbt schema.yml constraints"
  - "dbt model contracts"
validates_with:
  - "dbt parse"
  - "dbt compile"
  - "dbt test --select <model>"
---

# Data Contracts

I'll help you define, implement, and enforce data contracts — formal agreements between data producers and consumers that prevent breaking changes and set clear quality expectations.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: dbt version (contracts require dbt 1.5+), warehouse type, team maturity.

## Before You Start

- Run `node tools/clis/schema-introspect.js` to get the current warehouse schema as the baseline for the contract.
- Read existing `schema.yml` files to identify already-documented columns before writing new contract definitions.
- Confirm dbt version is 1.5+ — earlier versions do not support `contract.enforced: true`.
- Identify who the consumers of this model are before defining SLAs and breaking change policies.

## What Is a Data Contract?

A data contract specifies:
1. **Schema**: column names, types, and nullability (guaranteed not to change without notice)
2. **Quality**: freshness SLAs, row count guarantees, accepted value ranges
3. **Ownership**: who is responsible for this data product
4. **Consumers**: who depends on it and must be notified of changes
5. **Versioning**: how breaking changes are communicated and phased

## dbt Model Contracts (dbt 1.5+)

The simplest form: enforce schema at the dbt level.

```yaml
# models/marts/core/_core__models.yml
models:
  - name: fct_orders
    description: |
      **Data Contract v1.2**
      **Owner**: Data Engineering (data-eng@company.com)
      **SLA**: Available by 7am UTC daily; p99 freshness < 2 hours
      **Consumers**: Looker revenue dashboard, Finance ERP sync, FP&A team
      **Breaking change policy**: 30-day notice via #data-changes Slack
    config:
      contract:
        enforced: true   # Fail dbt run if schema doesn't match YAML

    constraints:
      # Table-level constraints (warehouse must support)
      - type: primary_key
        columns: [order_id]

    columns:
      - name: order_id
        data_type: varchar     # dbt enforces this type in the warehouse
        constraints:
          - type: not_null
          - type: primary_key
        description: "Unique order identifier"

      - name: customer_id
        data_type: varchar
        constraints:
          - type: not_null
          - type: foreign_key
            to: ref('dim_customers')
            to_columns: [customer_id]
        description: "FK to dim_customers"

      - name: net_revenue_usd
        data_type: numeric(12, 2)
        constraints:
          - type: not_null
        description: "Net revenue in USD, always non-negative"

      - name: order_status
        data_type: varchar
        constraints:
          - type: not_null
        description: "One of: pending, processing, completed, cancelled, refunded"

      - name: ordered_at
        data_type: timestamp_ntz   # Snowflake; timestamp_ntz = no timezone
        # data_type: timestamp      # BigQuery
        constraints:
          - type: not_null
```

### Warehouse-Specific Type Names

| Logical type | Snowflake | BigQuery | Databricks | Redshift |
|---|---|---|---|---|
| String | VARCHAR | STRING | STRING | VARCHAR |
| Integer | NUMBER(18,0) | INT64 | BIGINT | BIGINT |
| Decimal | NUMBER(12,2) | NUMERIC | DECIMAL(12,2) | DECIMAL |
| Timestamp (no TZ) | TIMESTAMP_NTZ | TIMESTAMP | TIMESTAMP | TIMESTAMP |
| Boolean | BOOLEAN | BOOL | BOOLEAN | BOOLEAN |

---

## Full Data Contract Document

For formal agreements with business stakeholders:

```markdown
# Data Contract: fct_orders v1.2

## Parties
- **Producer**: Data Engineering (data-eng@company.com)
- **Consumers**:
  - Looker Revenue Dashboard (critical)
  - Finance ERP Sync (critical — automated)
  - FP&A Team (standard)

## Data Product
- **Table**: analytics.marts.fct_orders
- **Grain**: One row per order
- **Warehouse**: Snowflake (analytics database, prod schema)

## Schema Guarantee
The following columns are guaranteed stable:
| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| order_id | VARCHAR | NOT NULL | PK |
| customer_id | VARCHAR | NOT NULL | FK to dim_customers |
| product_id | VARCHAR | NOT NULL | FK to dim_products |
| net_revenue_usd | NUMERIC(12,2) | NOT NULL | Net revenue, non-negative |
| order_status | VARCHAR | NOT NULL | Enum: pending/processing/completed/cancelled/refunded |
| ordered_at | TIMESTAMP_NTZ | NOT NULL | UTC |

## Quality SLAs
| Metric | Guarantee | Alerting |
|--------|-----------|---------|
| Freshness | Data available by 7am UTC | PagerDuty on breach |
| Row count | > 0 rows for any calendar day | Alert if daily count drops >30% |
| Null rate | 0% on NOT NULL columns | Alert on any null in PK/FK |
| Revenue accuracy | Within 0.1% of Stripe source | Daily reconciliation test |

## Versioning & Change Policy
- **Patch** (no breaking change): new column added — 7-day notice
- **Minor** (soft breaking): column renamed with alias — 30-day deprecation period
- **Major** (breaking): column removed or type changed — 90-day notice + migration support

## Breaking Change Process
1. Open a `data-contract-change` ticket
2. Notify all consumers in #data-changes Slack
3. Keep old column/table with `_deprecated` suffix during transition
4. Remove deprecated artifacts on agreed date
```

---

## Enforcing Contracts in CI

```yaml
# .github/workflows/dbt-contract-check.yml
name: Data Contract Validation

on:
  pull_request:
    paths:
      - 'models/marts/**'

jobs:
  contract-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install dbt-snowflake

      - name: Check contracts compile
        run: dbt parse --target dev

      - name: Run contract models
        run: |
          # Run only models with enforced contracts
          dbt run --select "config.contract.enforced:true" --target dev

      - name: Test contract columns
        run: |
          dbt test --select "config.contract.enforced:true" --target dev
```

---

## Consumer-Side Contract Validation

Give consumers SQL checks they can run to detect upstream changes:

```sql
-- consumer_contract_check.sql (run by consuming team)
-- Fails if any expected column is missing or wrong type

with expected_schema as (
    select * from (values
        ('order_id',        'VARCHAR',       false),
        ('customer_id',     'VARCHAR',       false),
        ('net_revenue_usd', 'NUMERIC',       false),
        ('order_status',    'VARCHAR',       false),
        ('ordered_at',      'TIMESTAMP_NTZ', false)
    ) as t(column_name, expected_type, is_nullable)
),

actual_schema as (
    -- Snowflake information schema
    select
        lower(column_name) as column_name,
        data_type,
        (is_nullable = 'YES') as is_nullable
    from information_schema.columns
    where table_schema = 'MARTS'
      and table_name = 'FCT_ORDERS'
),

violations as (

    select
        e.column_name,
        e.expected_type,
        a.data_type as actual_type,
        'type_mismatch' as violation_type
    from expected_schema e
    left join actual_schema a using (column_name)
    where a.column_name is null  -- missing column
       or a.data_type not ilike e.expected_type  -- type changed

)

select * from violations
-- Returns 0 rows when contract is satisfied
```

---

## Practical Rollout Plan

For teams new to data contracts:

**Week 1-2: Identify critical models**
- List top 3 models used in executive dashboards
- Interview consumers: "What would break your work if it changed?"

**Week 3-4: Document existing behavior**
- Generate schema YAML from existing models: `dbt run-operation codegen.generate_model_yaml`
- Add consumer list and SLAs

**Month 2: Enable enforcement**
- Add `contract.enforced: true` to documented models
- Run in `--warn-only` mode first, then enforce in CI

**Month 3+: Expand and automate**
- Require contracts for all new mart models
- Add contract checks to PR review checklist
- Automate consumer notification on schema changes

## Verify Your Work

- Run `dbt parse` to validate contract YAML syntax and confirm `contract.enforced: true` is recognized.
- Run `dbt test --select contracts` (or the tag used for contract tests) to confirm all contract-level tests pass.
- Re-run `node tools/clis/schema-introspect.js` after any schema changes to confirm the live schema still matches the contract definition.

## If Something Goes Wrong

- **Contract violation on deploy**: An upstream model changed its schema — run `node tools/clis/schema-introspect.js` and compare the output to your contract YAML to find the mismatch.
- **Constraint not enforced**: Verify dbt version is 1.5+ — contract enforcement is a 1.5+ feature and silently no-ops on older versions.
- **Null in a not_null column**: The source data has upstream quality issues — add a `not_null` data test and trace the null back through the lineage.
- **`dbt parse` fails on constraint type**: Check the warehouse-specific type names table above — type names vary by warehouse (e.g., `TIMESTAMP_NTZ` on Snowflake vs `TIMESTAMP` on BigQuery).
