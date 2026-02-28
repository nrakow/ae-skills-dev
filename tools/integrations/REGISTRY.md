# Tool Integration Registry

Quick reference for platform-specific patterns used by analytics engineering skills.

## Warehouses

| Tool | File | Key Patterns |
|------|------|-------------|
| Snowflake | [snowflake.md](snowflake.md) | QUALIFY, FLATTEN, ARRAY_AGG, warehouse sizing, clustering, AUTO_SUSPEND |
| BigQuery | [bigquery.md](bigquery.md) | PARTITION BY DATE(), STRUCT/ARRAY, slot reservations, BI Engine |
| Databricks | [databricks.md](databricks.md) | Delta Lake, Unity Catalog, OPTIMIZE/ZORDER, photon, MLflow |
| Redshift | [redshift.md](redshift.md) | DISTKEY/SORTKEY, COPY command, Spectrum, WLM queues |
| DuckDB | [duckdb.md](duckdb.md) | local file support, ATTACH, Parquet/CSV direct query, MotherDuck |

## Transformation

| Tool | File | Key Patterns |
|------|------|-------------|
| dbt Core | [dbt-core.md](dbt-core.md) | Project setup, macros, packages, CLI commands |
| dbt Cloud | [dbt-cloud.md](dbt-cloud.md) | Jobs, environments, Semantic Layer, Slim CI |

## Ingestion

| Tool | File | Key Patterns |
|------|------|-------------|
| Fivetran | [fivetran.md](fivetran.md) | Connector config, metadata columns, sync scheduling |
| Airbyte | [airbyte.md](airbyte.md) | Connector setup, metadata columns, custom connectors |

## Orchestration

| Tool | File | Key Patterns |
|------|------|-------------|
| Apache Airflow | [airflow.md](airflow.md) | DAG patterns, operators, connections, sensors |
| Dagster | [dagster.md](dagster.md) | Software-defined assets, dbt integration, schedules |
| Prefect | [prefect.md](prefect.md) | Flows, tasks, deployments, blocks |

## BI

| Tool | File | Key Patterns |
|------|------|-------------|
| Looker | [looker.md](looker.md) | LookML views/explores, PDTs, access grants |
| Metabase | [metabase.md](metabase.md) | Question setup, dashboards, embedding |
| Lightdash | [lightdash.md](lightdash.md) | dbt YAML metrics, explores, dashboards |
| Tableau | [tableau.md](tableau.md) | Data sources, extracts, calculated fields |

## Observability

| Tool | File | Key Patterns |
|------|------|-------------|
| Elementary | [elementary.md](elementary.md) | dbt package setup, anomaly tests, alerting |
| Monte Carlo | [monte-carlo.md](monte-carlo.md) | Circuit breaker, monitors, lineage |
| Soda | [soda.md](soda.md) | Checks DSL, Soda Cloud, CI integration |

## Catalogs

| Tool | File | Key Patterns |
|------|------|-------------|
| OpenMetadata | [openmetadata.md](openmetadata.md) | dbt connector, lineage, data quality |
