# Analytics Engineering Tools Registry

Unified index of all platform integrations and CLI utilities available to analytics engineering skills. Use this registry to quickly identify the right tool for a task.

## Quick Reference by Task

| Task | Tools | Category |
|------|-------|----------|
| Store and query data | Snowflake, BigQuery, Databricks, Redshift, DuckDB | Warehouse |
| Transform data with dbt | dbt Core, dbt Cloud | Transformation |
| Ingest data from sources | Fivetran, Airbyte | Ingestion |
| Orchestrate pipelines | Airflow, Dagster, Prefect | Orchestration |
| Build dashboards and reports | Looker, Metabase, Lightdash, Tableau | BI |
| Monitor data quality | Elementary, Monte Carlo, Soda | Observability |
| Document and discover data | OpenMetadata | Catalog |
| Analyze dbt artifacts locally | CLI utilities (see below) | CLI |

---

## Platform Integrations

Detailed API guides and platform-specific patterns. Each file lives in `tools/integrations/`.

### Warehouses

| Tool | Guide | Key Patterns | When to Use |
|------|-------|-------------|-------------|
| Snowflake | [snowflake.md](integrations/snowflake.md) | QUALIFY, FLATTEN, ARRAY_AGG, warehouse sizing, clustering, AUTO_SUSPEND | Most common cloud warehouse; strong semi-structured data support |
| BigQuery | [bigquery.md](integrations/bigquery.md) | PARTITION BY DATE(), STRUCT/ARRAY, slot reservations, BI Engine | Google ecosystem; serverless, pay-per-query pricing |
| Databricks | [databricks.md](integrations/databricks.md) | Delta Lake, Unity Catalog, OPTIMIZE/ZORDER, Photon engine, MLflow | Unified analytics + ML; lakehouse architecture |
| Redshift | [redshift.md](integrations/redshift.md) | DISTKEY/SORTKEY, COPY command, Spectrum, WLM queues | AWS-native; provisioned cluster pricing |
| DuckDB | [duckdb.md](integrations/duckdb.md) | Local file support, ATTACH, Parquet/CSV direct query, MotherDuck | Local development, CI testing, embedded analytics |

### Transformation

| Tool | Guide | Key Patterns | When to Use |
|------|-------|-------------|-------------|
| dbt Core | [dbt-core.md](integrations/dbt-core.md) | Project setup, macros, packages, CLI commands | Open-source, self-hosted dbt |
| dbt Cloud | [dbt-cloud.md](integrations/dbt-cloud.md) | Jobs, environments, Semantic Layer, Slim CI | Managed dbt with IDE, scheduling, and Semantic Layer |

### Ingestion

| Tool | Guide | Key Patterns | When to Use |
|------|-------|-------------|-------------|
| Fivetran | [fivetran.md](integrations/fivetran.md) | Connector config, metadata columns, sync scheduling | Managed connectors; minimal setup, 300+ sources |
| Airbyte | [airbyte.md](integrations/airbyte.md) | Connector setup, metadata columns, custom connectors | Open-source alternative; custom connector support |

### Orchestration

| Tool | Guide | Key Patterns | When to Use |
|------|-------|-------------|-------------|
| Apache Airflow | [airflow.md](integrations/airflow.md) | DAG patterns, operators, connections, sensors | Most common orchestrator; large ecosystem |
| Dagster | [dagster.md](integrations/dagster.md) | Software-defined assets, dbt integration, schedules | Asset-centric orchestration; strong dbt integration |
| Prefect | [prefect.md](integrations/prefect.md) | Flows, tasks, deployments, blocks | Python-native; hybrid execution model |

### BI

| Tool | Guide | Key Patterns | When to Use |
|------|-------|-------------|-------------|
| Looker | [looker.md](integrations/looker.md) | LookML views/explores, PDTs, access grants | Enterprise BI with governed semantic layer |
| Metabase | [metabase.md](integrations/metabase.md) | Question setup, dashboards, embedding | Open-source; quick setup, self-serve friendly |
| Lightdash | [lightdash.md](integrations/lightdash.md) | dbt YAML metrics, explores, dashboards | dbt-native BI; metrics defined in YAML |
| Tableau | [tableau.md](integrations/tableau.md) | Data sources, extracts, calculated fields | Enterprise visualization; rich interactivity |

### Observability

| Tool | Guide | Key Patterns | When to Use |
|------|-------|-------------|-------------|
| Elementary | [elementary.md](integrations/elementary.md) | dbt package setup, anomaly tests, alerting | dbt-native observability; runs as dbt tests |
| Monte Carlo | [monte-carlo.md](integrations/monte-carlo.md) | Circuit breaker, monitors, lineage | Enterprise data observability; ML-powered anomaly detection |
| Soda | [soda.md](integrations/soda.md) | Checks DSL, Soda Cloud, CI integration | Declarative data quality checks; multi-warehouse |

### Catalogs

| Tool | Guide | Key Patterns | When to Use |
|------|-------|-------------|-------------|
| OpenMetadata | [openmetadata.md](integrations/openmetadata.md) | dbt connector, lineage, data quality | Open-source catalog with lineage and quality integration |

---

## CLI Utilities

Zero-dependency Node.js scripts for analyzing dbt artifacts and warehouse metadata locally. All scripts live in `tools/clis/`. Run with `node tools/clis/<script>.js`.

**Requirements:** Node.js 18+, a dbt `target/` directory with `manifest.json` and `run_results.json` (produced by `dbt compile` or `dbt build`).

### Cost and Performance

| Script | Description | Usage |
|--------|-------------|-------|
| `cost-estimate.js` | Estimate warehouse compute costs from query history | `node cost-estimate.js --warehouse snowflake --days 30` |

### Lineage and Dependencies

| Script | Description | Usage |
|--------|-------------|-------|
| `lineage-export.js` | Export dbt model lineage graph to JSON or DOT format | `node lineage-export.js --manifest target/manifest.json --output lineage.json` |
| `manifest-lineage.js` | Build and query the lineage graph from a dbt manifest | `node manifest-lineage.js --manifest target/manifest.json --model fct_orders` |

### Test Coverage and Quality

| Script | Description | Usage |
|--------|-------------|-------|
| `manifest-coverage.js` | Report test coverage gaps across all dbt models | `node manifest-coverage.js --manifest target/manifest.json` |
| `test-results.js` | Parse and summarize dbt test results | `node test-results.js --results target/run_results.json` |

### Schema and Metadata

| Script | Description | Usage |
|--------|-------------|-------|
| `manifest-parse.js` | Parse and pretty-print a dbt manifest.json | `node manifest-parse.js --manifest target/manifest.json` |
| `model-stats.js` | Show row counts, column counts, and test counts per model | `node model-stats.js --manifest target/manifest.json` |
| `schema-introspect.js` | Introspect warehouse schemas and output column metadata | `node schema-introspect.js --schema analytics.marts` |
| `source-freshness.js` | Check source freshness status from dbt artifacts | `node source-freshness.js --sources target/sources.json` |

### Skill Management

| Script | Description | Usage |
|--------|-------------|-------|
| `skill-index.js` | Generate the skills/index.json machine-readable index | `node skill-index.js` |

---

## Choosing the Right Tool

### Warehouse Selection
- **Starting out / local dev:** DuckDB (zero infrastructure, instant setup)
- **Google ecosystem:** BigQuery (serverless, pay-per-query)
- **AWS ecosystem:** Redshift (provisioned) or Snowflake (consumption-based)
- **Multi-cloud / scaling:** Snowflake (separation of storage and compute)
- **Lakehouse / ML workloads:** Databricks (unified analytics + ML)

### Orchestrator Selection
- **Existing Airflow investment:** Stay with Airflow; use Cosmos for dbt integration
- **Greenfield / dbt-heavy:** Dagster (asset-centric, native dbt support)
- **Python team / simple workflows:** Prefect (lowest learning curve)
- **No orchestrator yet:** Start without one; add when you have 3+ scheduled jobs

### BI Selection
- **Enterprise governance:** Looker (LookML semantic layer)
- **dbt-native metrics:** Lightdash (metrics in YAML, dbt-first)
- **Quick self-serve:** Metabase (open-source, minimal config)
- **Rich visualization:** Tableau (most visualization options)

### Observability Selection
- **dbt-native / budget-conscious:** Elementary (runs as dbt package)
- **Enterprise / ML anomaly detection:** Monte Carlo (automated monitors)
- **Multi-warehouse / declarative checks:** Soda (Checks DSL)
