---
name: advanced-jinja-patterns
description: "Write clean, correct, maintainable Jinja in dbt -- dynamic SQL generation, loops, macros, adapter dispatch, and compile-time debugging. Use when Jinja won't compile, when you need to DRY up repetitive SQL with loops or macros, when a macro behaves unexpectedly, or when you're stuck on set vs namespace mutation. Also covers run_query, adapter.dispatch, cross-database macros, and 'why does my variable reset inside a for loop?' Use this whenever Jinja, macros, or dynamic SQL comes up in dbt -- even if the user just says 'this SQL is repetitive.' For project structure, see dbt-project-setup. For unit testing macros, see dbt-unit-testing. For UDFs, see warehouse-udf-strategy."
triggers:
  - "dynamic SQL"
  - "jinja loop"
  - "dbt macro"
  - "adapter dispatch"
  - "set variable in jinja"
  - "namespace"
  - "union all loop"
  - "run_query"
  - "jinja template"
  - "compile-time error"
  - "my jinja won't compile"
  - "macro not working"
  - "write a reusable macro"
  - "generate SQL dynamically"
  - "jinja is confusing me"
reads_first:
  - data-stack-context
  - dbt-project-setup
produces:
  - "dbt macros"
  - "model SQL with Jinja"
  - "adapter-dispatched SQL helpers"
validates_with:
  - "dbt compile"
  - "dbt run"
---

# Advanced Jinja Patterns

I'll help you write clean, correct, and maintainable Jinja in dbt — from basic loops to adapter-aware macros and safe compile-time patterns.

## Core Mental Model (Read First)

### Compile-time vs Run-time
Jinja executes at **compile time** (when dbt builds the SQL file). The warehouse runs the SQL at **run time**.

```
dbt compile → Jinja executes → SQL file written → warehouse runs SQL
```

If you need warehouse values during compilation, use `run_query()` — but only when `execute` is `True`.

### The `execute` Guard
```jinja
{% if execute %}
  {# Only runs during dbt run, not dbt compile #}
  {% set res = run_query("select max(event_date) from events") %}
  {% set max_date = res.columns[0].values()[0] %}
{% else %}
  {% set max_date = modules.datetime.date.today() %}
{% endif %}
```

Without this guard, `run_query()` crashes during `dbt compile`.

---

## 1. Dynamic Select Lists

### Build a column list (no trailing comma)
```jinja
{% set cols = ["user_id", "session_id", "event_timestamp", "event_name"] %}

select
  {% for c in cols %}
    {{ c }}{% if not loop.last %},{% endif %}
  {% endfor %}
from {{ ref('stg_events') }}
```

**Rule**: Always use `loop.last` to avoid trailing commas. Never hard-code commas at the end of a loop.

### Prefix columns (leading comma style)
```jinja
{% set dims = ["country", "device_type", "channel"] %}

select
  user_id
  {% for d in dims %}
  , {{ d }}
  {% endfor %}
from {{ ref('dim_user') }}
```

**Rule**: Leading commas produce cleaner git diffs — prefer them in models.

---

## 2. Dynamic CASE Expressions

```jinja
{% set platform_map = {
  "ios": "mobile",
  "android": "mobile",
  "windows": "desktop",
  "macos": "desktop",
  "linux": "desktop"
} %}

case
  {% for platform, group in platform_map.items() %}
    when lower(device_os) = '{{ platform }}' then '{{ group }}'
  {% endfor %}
  else 'other'
end as device_group
```

**Rule**: Always include an `else` clause. Never trust that all values are in the map.

---

## 3. UNION ALL Loops

### Safe union (handles empty list)
```jinja
{% set rels = [
  ref('events_2024'),
  ref('events_2025'),
  ref('events_2026')
] %}

{% if rels | length == 0 %}
  select null as _empty where false
{% else %}
  {% for r in rels %}
  select * from {{ r }}
  {% if not loop.last %}union all{% endif %}
  {% endfor %}
{% endif %}
```

**Rule**: Always guard against empty lists — an empty UNION compiles to invalid SQL.

---

## 4. set Patterns

### Simple variable
```jinja
{% set lookback_days = var('lookback_days', 7) %}
```

### Multi-line SQL block
```jinja
{% set filter_sql %}
  event_date >= date_sub(current_date(), interval {{ lookback_days }} day)
  and not is_internal_user
{% endset %}

select *
from {{ ref('stg_events') }}
where {{ filter_sql }}
```

**Rule**: Use `{% set %}...{% endset %}` (block form) for multi-line SQL. Use `{% set x = ... %}` only for single values.

---

## 5. namespace for List Mutation in Loops

Jinja variables defined outside a loop are **read-only** inside the loop. Use `namespace` to mutate:

```jinja
{% set ns = namespace(cols=[]) %}

{% for col in adapter.get_columns_in_relation(ref('stg_orders')) %}
  {% if col.name | lower not in ['_fivetran_deleted', '_loaded_at', 'raw_payload'] %}
    {% do ns.cols.append(col.name) %}
  {% endif %}
{% endfor %}

select
  {{ ns.cols | join(',\n  ') }}
from {{ ref('stg_orders') }}
```

**Rule**: If you need to `append` inside a loop, always use `namespace`. Direct mutation of an outer variable silently fails.

---

## 6. do for Side Effects

Use `do` when you need to execute an expression without printing output:

```jinja
{# Log during compilation #}
{% do log("Building model: " ~ this.name, info=True) %}

{# Append to a list #}
{% do ns.cols.append("user_id") %}
```

---

## 7. Writing Reusable Macros

### Macro that returns SQL text
```jinja
{# macros/date_filter.sql #}
{% macro rolling_window(date_col, days=30) %}
  {{ date_col }} >= {{ dbt.dateadd('day', -days, 'current_date()') }}
{% endmacro %}
```

Usage:
```sql
where {{ rolling_window('event_date', 14) }}
```

### Macro that returns a value (not SQL)
```jinja
{% macro get_lookback() %}
  {{ return(var('lookback_days', 7)) }}
{% endmacro %}
```

Usage:
```jinja
{% set days = get_lookback() %}
```

**Rule**: Be explicit about whether a macro returns SQL text or a Python/Jinja value — they behave differently when composed.

---

## 8. Adapter Dispatch (Warehouse-Specific Logic)

Use `adapter.dispatch` to write warehouse-specific implementations behind a single call site.

### Call site (in model or macro)
```jinja
{{ adapter.dispatch('safe_divide', 'my_project')(revenue, sessions) }}
```

### Default implementation
```jinja
{# macros/safe_divide.sql #}
{% macro my_project__safe_divide(numerator, denominator) %}
  case
    when {{ denominator }} = 0 or {{ denominator }} is null then null
    else {{ numerator }} / {{ denominator }}
  end
{% endmacro %}
```

### BigQuery override (uses native function)
```jinja
{% macro my_project__safe_divide__bigquery(numerator, denominator) %}
  safe_divide({{ numerator }}, {{ denominator }})
{% endmacro %}
```

**Rule**: Always provide a default implementation. Overrides are optional — the default is the fallback for any warehouse not explicitly overridden.

---

## 9. Safe Empty-List Handling

### IN clause (guard against `IN ()`)
```jinja
{% set event_types = var('event_types', []) %}

where 1=1
{% if event_types | length > 0 %}
  and event_name in (
    {% for e in event_types %}
      '{{ e }}'{% if not loop.last %},{% endif %}
    {% endfor %}
  )
{% else %}
  -- no filter applied — all event types included
{% endif %}
```

**Rule**: `WHERE x IN ()` is invalid SQL in most warehouses. Always guard.

---

## 10. Column Introspection

```jinja
{% set rel = ref('stg_events') %}
{% set all_cols = adapter.get_columns_in_relation(rel) %}
{% set exclude = ['internal_flag', 'raw_json', '_fivetran_synced'] %}

{% set ns = namespace(selected=[]) %}
{% for col in all_cols %}
  {% if col.name | lower not in exclude %}
    {% do ns.selected.append(col.name) %}
  {% endif %}
{% endfor %}

select {{ ns.selected | join(', ') }}
from {{ rel }}
```

**Note**: `get_columns_in_relation` requires the table to exist in the warehouse. It works during `dbt run` but not `dbt compile` against a fresh environment.

---

## 11. run_query() (Use Sparingly)

Use `run_query()` only when you need warehouse values to drive compilation logic and there's no simpler SQL-level alternative.

```jinja
{% if execute %}
  {% set active_clients_sql %}
    select client_id from {{ ref('dim_client') }} where is_active = true
  {% endset %}
  {% set results = run_query(active_clients_sql) %}
  {% set client_ids = results.columns[0].values() %}
{% else %}
  {% set client_ids = [] %}
{% endif %}

{% for cid in client_ids %}
  select '{{ cid }}' as client_id, * from {{ ref('fct_events_' ~ cid) }}
  {% if not loop.last %}union all{% endif %}
{% endfor %}
```

**When to use**: Dynamic union over per-client tables, generating per-tenant models.
**When NOT to use**: Anything that can be expressed as a single SQL query at runtime.

---

## Common Anti-Patterns

| Anti-pattern | Fix |
|---|---|
| Trailing comma in loop | Use `{% if not loop.last %},{% endif %}` |
| `IN ()` from empty list | Guard with `{% if list \| length > 0 %}` |
| `append` fails silently in loop | Use `namespace` |
| `run_query()` without `execute` guard | Wrap in `{% if execute %}` |
| Warehouse-specific SQL without dispatch | Use `adapter.dispatch` |
| 50-line inline Jinja block in a model | Extract to a macro |
| `SELECT *` in generated SQL | Project explicit columns |

---

## Whitespace Control

Use `-%}` to trim trailing newlines when tight output matters:

```jinja
select
{%- for c in cols %}
  {% if not loop.first %}, {% endif %}{{ c }}
{%- endfor %}
from {{ ref('x') }}
```

Use sparingly — over-trimming makes compiled SQL hard to read.

---

## Verify Your Work

**Do not present output as complete until all checks pass.**

- Run `dbt compile --select <model>` — confirm the compiled SQL is valid and has no trailing commas, empty unions, or empty `IN ()` clauses.
- Run `dbt run --select <model>` — confirm the model executes without warehouse errors.
- For macros: run `dbt compile` on a model that calls the macro to confirm it produces correct SQL for both the default and any adapter-specific paths.
- Inspect `target/compiled/` to manually verify the generated SQL looks right.

## If Something Goes Wrong

- **`variable 'x' not defined`**: Jinja variable went out of scope inside a loop — use `namespace`.
- **`run_query() called outside of 'execute'`**: Wrap `run_query()` in `{% if execute %}...{% endif %}`.
- **Trailing comma in SELECT**: Missing `loop.last` guard — add `{% if not loop.last %},{% endif %}`.
- **Empty `IN ()` syntax error**: List was empty — add `{% if list | length > 0 %}` guard.
- **Macro not found**: Check the macro name matches the `adapter.dispatch` pattern: `<namespace>__<macro_name>` or `<namespace>__<macro_name>__<adapter>`.
- **`get_columns_in_relation` fails**: Table doesn't exist yet — this only works against existing warehouse objects during `dbt run`, not in a clean environment during `dbt compile`.
