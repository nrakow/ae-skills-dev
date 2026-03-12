---
name: warehouse-udf-strategy
description: "Decide when to use warehouse-native UDFs vs dbt macros, then implement, version, and govern them correctly. Use when you keep copy-pasting the same SQL logic across models, need a function that runs at query time not compile time, or someone says 'should this be a macro or a UDF'. Also fires for 'create a custom function', 'JavaScript UDF', 'Python UDF in Snowflake', 'reusable SQL logic', 'BigQuery function', or 'safe divide function'. Use this whenever you need reusable logic and are unsure whether it belongs in dbt or in the warehouse. For advanced Jinja and macros, see advanced-jinja-patterns. For warehouse performance, see warehouse-optimization."
triggers:
  - "create function"
  - "UDF"
  - "user defined function"
  - "reusable SQL logic"
  - "macro vs UDF"
  - "javascript UDF"
  - "BigQuery function"
  - "Snowflake function"
  - "safe divide"
  - "custom function"
  - "should this be a macro or a UDF"
  - "Python UDF"
  - "keep copy-pasting the same SQL"
reads_first:
  - data-stack-context
  - advanced-jinja-patterns
produces:
  - "SQL UDF definition"
  - "dbt macro wrapper"
  - "adapter dispatch integration"
  - "UDF documentation block"
validates_with:
  - "dbt compile"
  - "dbt run"
---

# Warehouse UDF Strategy

I'll help you decide between warehouse-native UDFs and dbt macros, then implement, version, and document whichever is appropriate.

## Macro vs UDF: Decide First

Before writing anything, answer these three questions:

| Question | Macro | UDF |
|---|---|---|
| Does the logic run at **compile time** (generating SQL)? | ✅ | ❌ |
| Does the logic run at **query time** (transforming data in the warehouse)? | ❌ | ✅ |
| Is it reused across **multiple models**? | ✅ | ✅ |
| Is it used in a **single model only**? | Inline it | Inline it |
| Does it need to be **warehouse-portable**? | ✅ with `adapter.dispatch` | ❌ (rewrite per warehouse) |

**Quick rule**: If you're generating SQL dynamically → macro. If you're transforming a value at query time → UDF.

### Use a UDF when:
- String normalization across many models (slugify, clean phone numbers, strip PII)
- JSON extraction helpers
- Safe math (`safe_divide`, `safe_log`)
- Time bucketing / fiscal calendar conversions
- Hashing / surrogate key generation
- Reusable classification logic called in many CTEs

### Use a macro (not a UDF) when:
- Generating `CASE` expressions dynamically
- Building `UNION ALL` chains
- Wrapping `adapter.dispatch` logic
- Producing boilerplate SQL at compile time
- Simple one-liner `CASE WHEN` — just inline it

### Do not use a UDF when:
- The logic is used in only one model
- It alters the grain (never)
- It encodes a business KPI definition (keep that in the semantic layer)
- It requires nondeterministic results (`RAND()`, `NOW()`) — be explicit about this

---

## BigQuery: SQL UDFs (Preferred)

```sql
-- models/udfs/udf_safe_divide.sql
-- materialize via run-operation or a pre-hook
CREATE OR REPLACE FUNCTION {{ target.dataset }}.safe_divide(
  numerator FLOAT64,
  denominator FLOAT64
)
RETURNS FLOAT64 AS (
  IF(denominator = 0 OR denominator IS NULL, NULL, numerator / denominator)
);
```

Prefer SQL UDFs over JavaScript for:
- Deterministic scalar transformations
- Anything that can be expressed in SQL
- Performance (SQL UDFs are inlined by the query planner)

### BigQuery: JavaScript UDFs (Use Carefully)

```sql
CREATE OR REPLACE FUNCTION {{ target.dataset }}.slugify(input STRING)
RETURNS STRING
LANGUAGE js AS r"""
  if (!input) return null;
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
""";
```

Use JavaScript UDFs only when the logic genuinely can't be expressed in SQL (complex regex, recursive string processing). JS UDFs:
- Cannot be inlined by the planner
- Have higher invocation overhead
- Are harder to test and debug

---

## Snowflake: SQL UDFs

```sql
CREATE OR REPLACE FUNCTION {{ target.schema }}.safe_divide(
  numerator FLOAT,
  denominator FLOAT
)
RETURNS FLOAT
AS $$
  IFF(denominator = 0 OR denominator IS NULL, NULL, numerator / denominator)
$$;
```

---

## Deploying UDFs via dbt

### Option 1: post-hook on a model
```yaml
# dbt_project.yml
models:
  my_project:
    udfs:
      +materialized: table  # dummy materialization
      +post-hook:
        - "{{ create_udf_safe_divide() }}"
```

### Option 2: run-operation (recommended for standalone UDFs)
```yaml
# macros/operations/create_udfs.sql
{% macro create_udfs() %}
  {{ create_udf_safe_divide() }}
  {{ create_udf_slugify() }}
{% endmacro %}
```

Run with: `dbt run-operation create_udfs`

Call from CI/CD before `dbt run`:
```yaml
- run: dbt run-operation create_udfs --target prod
- run: dbt run --target prod
```

---

## dbt Macro Wrapper (Always Provide One)

Wrap every UDF in a macro so models don't hard-code the schema name, and so you can swap implementations across warehouses:

```jinja
{# macros/safe_divide.sql #}
{% macro safe_divide(numerator, denominator) %}
  {{ adapter.dispatch('safe_divide', 'my_project')(numerator, denominator) }}
{% endmacro %}

{% macro my_project__safe_divide(numerator, denominator) %}
  {# Default: pure SQL, works on any warehouse #}
  case
    when {{ denominator }} = 0 or {{ denominator }} is null then null
    else {{ numerator }} / cast({{ denominator }} as float64)
  end
{% endmacro %}

{% macro my_project__safe_divide__bigquery(numerator, denominator) %}
  {# BigQuery: use native function #}
  {{ target.dataset }}.safe_divide({{ numerator }}, {{ denominator }})
{% endmacro %}

{% macro my_project__safe_divide__snowflake(numerator, denominator) %}
  {# Snowflake: use native function #}
  {{ target.schema }}.safe_divide({{ numerator }}, {{ denominator }})
{% endmacro %}
```

Usage in any model:
```sql
select
  order_id,
  {{ safe_divide('revenue', 'sessions') }} as revenue_per_session
from {{ ref('fct_orders') }}
```

This pattern means:
- Models never reference `dataset.safe_divide(...)` directly
- Swapping warehouse or renaming the UDF requires one change in the macro
- Pure-SQL fallback works without the UDF deployed

---

## Governance Rules

### 1. Always version UDFs
Use `_v1`, `_v2` suffixes or controlled migration scripts:

```sql
-- safe to deploy: new version exists before old is dropped
CREATE OR REPLACE FUNCTION dataset.safe_divide_v2(...) AS (...);
-- after validation:
DROP FUNCTION IF EXISTS dataset.safe_divide_v1;
```

Never silently overwrite a UDF that production models call.

### 2. Always document UDFs

Add a documentation block in the macro or a `schema.yml` entry:

```yaml
# macros/schema.yml
macros:
  - name: safe_divide
    description: >
      Divides numerator by denominator. Returns NULL if denominator is 0 or NULL.
      Dispatches to a native warehouse UDF on BigQuery and Snowflake; falls back
      to a pure-SQL CASE expression on other warehouses.
    arguments:
      - name: numerator
        type: numeric expression
        description: The value to divide.
      - name: denominator
        type: numeric expression
        description: The divisor. Returns NULL when this is 0 or NULL.
```

### 3. Never encode business definitions in a UDF

A UDF should be a **pure transformation utility** — not a business rule.

```sql
-- ❌ Wrong: business definition hidden inside UDF
CREATE FUNCTION is_active_user(last_seen DATE)
RETURNS BOOLEAN AS (last_seen >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY));

-- ✅ Right: business definition lives in the model or semantic layer
-- UDF only does the date math utility
CREATE FUNCTION days_since(event_date DATE)
RETURNS INT64 AS (DATE_DIFF(CURRENT_DATE(), event_date, DAY));
```

KPI logic belongs in marts or the semantic layer where it's visible to stakeholders, versioned, and documented.

### 4. Deterministic only (unless clearly labeled)

Avoid `RAND()`, `NOW()`, or `CURRENT_TIMESTAMP()` inside UDFs unless the non-determinism is intentional and documented. Non-deterministic UDFs break incremental models and make testing unreliable.

---

## Performance Notes (BigQuery)

- SQL UDFs **are inlined** by the query planner — they don't add execution overhead beyond the SQL itself.
- JS UDFs are **not inlined** — they invoke a JS runtime per row, which adds latency and cost.
- Avoid calling any UDF (SQL or JS) inside `UNNEST` on large arrays — it multiplies invocation cost.
- Test bytes scanned before and after introducing a UDF. Never assume it's free.

---

## Common Anti-Patterns

| Anti-pattern | Fix |
|---|---|
| Hard-coding `dataset.udf_name()` in models | Wrap in a macro, use `target.dataset` |
| UDF encodes a KPI (e.g., `is_churned()`) | Move definition to mart or semantic layer |
| JS UDF for something SQL can do | Rewrite in SQL |
| No macro wrapper (schema drift on rename) | Always add a wrapper macro |
| Silent UDF overwrite in production | Version with `_v2` before dropping `_v1` |
| UDF with no documentation | Add `macros/schema.yml` entry |
| Nondeterministic UDF in incremental model | Use deterministic logic or document explicitly |

---

## Verify Your Work

**Do not present output as complete until all checks pass.**

- Run `dbt compile --select <model>` to confirm the macro wrapper generates valid SQL.
- Run `dbt run-operation create_udfs` (or equivalent) to confirm UDF deploys without errors.
- Run `dbt run --select <model>` to confirm the model executes successfully against the deployed UDF.
- Query the UDF directly to validate edge cases: `SELECT safe_divide(10, 0)` → should return `NULL`, not error.
- Confirm bytes scanned / query cost hasn't increased unexpectedly (BigQuery: check query details panel).

## If Something Goes Wrong

- **`Function not found` error**: UDF wasn't deployed before `dbt run` — run the `create_udfs` operation first, or add it as a `pre-hook`.
- **Schema mismatch on BigQuery**: UDF is in a different dataset — use `{{ target.dataset }}.udf_name()` in the macro, not a hard-coded dataset name.
- **JS UDF timeout**: JS UDFs have execution time limits per row — consider rewriting in SQL or batching.
- **Macro fallback not triggering**: Check `adapter.dispatch` namespace matches your `dbt_project.yml` `dispatch` config or macro naming (`<namespace>__<name>__<adapter>`).
- **Non-deterministic results in incremental model**: UDF uses `NOW()` or `RAND()` — replace with a deterministic equivalent or pass the timestamp as an argument.
