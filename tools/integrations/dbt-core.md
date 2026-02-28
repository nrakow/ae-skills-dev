# dbt Core Integration Guide

## Essential CLI Commands

```bash
# Development
dbt debug                          # Test connection
dbt deps                           # Install packages
dbt parse                          # Validate syntax (fast)
dbt compile                        # Compile SQL without running
dbt run                            # Run all models
dbt run --select staging           # Run tag/path/name selector
dbt run --select "state:modified+" # Run changed models + dependents
dbt run --select "+fct_orders"     # Run fct_orders + all upstream
dbt run --select "fct_orders+"     # Run fct_orders + all downstream
dbt run --full-refresh             # Force full rebuild of incrementals
dbt run --defer --state ./prod-artifacts  # Use prod state for unchanged models

# Testing
dbt test                           # Run all tests
dbt test --select fct_orders       # Test specific model
dbt test --store-failures          # Save failing rows

# Building (run + test)
dbt build                          # Run all + test all
dbt build --select staging         # Scoped build

# Documentation
dbt docs generate                  # Generate docs site
dbt docs serve                     # Serve at localhost:8080

# Snapshots
dbt snapshot                       # Run all snapshots

# Seeds
dbt seed                           # Load all CSV seeds

# Source freshness
dbt source freshness               # Check source recency
```

## Key Selectors
```bash
# By model name
--select fct_orders

# By tag
--select "tag:critical"

# By path (folder)
--select "models/staging/"

# By config property
--select "config.materialized:incremental"

# By modification (requires state)
--select "state:modified"

# Operators
+fct_orders        # fct_orders + all ancestors
fct_orders+        # fct_orders + all descendants
1+fct_orders+1     # fct_orders + direct parents and children

# Intersection (both selectors must match)
--select "tag:critical,config.materialized:table"

# Exclusion
--select "staging" --exclude "stg_legacy__*"
```

## Key Macros

### dbt_utils
```sql
{{ dbt_utils.generate_surrogate_key(['col1', 'col2']) }}
{{ dbt_utils.date_spine(datepart, start_date, end_date) }}
{{ dbt_utils.get_column_values(table, column) }}
{{ dbt_utils.union_relations(relations=[ref('a'), ref('b')]) }}
{{ dbt_utils.safe_divide(numerator, denominator) }}
```

### Built-in Jinja
```sql
{% if is_incremental() %}
where updated_at >= (select max(updated_at) from {{ this }})
{% endif %}

{% if target.name == 'prod' %}
    -- production-only logic
{% endif %}

{% set my_var = var('my_variable', 'default_value') %}
{{ env_var('MY_ENV_VAR', 'default') }}
```

## Project Structure Best Practices

```yaml
# dbt_project.yml
models:
  my_project:
    staging:
      +materialized: view
      +tags: ["staging"]
    intermediate:
      +materialized: ephemeral
    marts:
      +materialized: table
      +tags: ["marts"]
```

## packages.yml
```yaml
packages:
  - package: dbt-labs/dbt_utils
    version: [">=1.1.0", "<2.0.0"]
  - package: elementary-data/elementary
    version: [">=0.13.0", "<1.0.0"]
  - package: dbt-labs/codegen
    version: [">=0.12.0", "<1.0.0"]
```

## Common Issues

| Issue | Fix |
|-------|-----|
| Circular reference | Check `ref()` chain for cycles |
| Schema drift | Add `on_schema_change='append_new_columns'` to incremental config |
| Slow compile | Use `dbt parse` (faster than `dbt compile`) for syntax checks |
| Missing package | Run `dbt deps` after adding to packages.yml |
| Test failures not shown | Add `--store-failures` to see failing rows |
