# Dagster Integration Guide

## Software-Defined Assets with dbt

```python
# dagster_project/assets.py
from dagster import asset, AssetExecutionContext, Definitions
from dagster_dbt import DbtCliResource, dbt_assets, DbtProject

# Point to dbt project
dbt_project = DbtProject(project_dir="/opt/dbt")

@dbt_assets(manifest=dbt_project.manifest_path)
def analytics_dbt_assets(context: AssetExecutionContext, dbt: DbtCliResource):
    """All dbt models as Dagster assets — dependency graph auto-inferred from manifest."""
    yield from dbt.cli(["build"], context=context).stream()

# Non-dbt asset downstream of dbt
@asset(deps=[analytics_dbt_assets])
def erp_revenue_export(context: AssetExecutionContext):
    """Export revenue mart to ERP system."""
    import snowflake.connector
    conn = snowflake.connector.connect(...)
    data = conn.cursor().execute("SELECT * FROM marts.fct_revenue_monthly WHERE ...").fetchall()
    post_to_erp(data)
    context.log.info(f"Exported {len(data)} rows to ERP")

defs = Definitions(
    assets=[analytics_dbt_assets, erp_revenue_export],
    resources={
        "dbt": DbtCliResource(project_dir="/opt/dbt")
    }
)
```

## Schedules and Sensors

```python
from dagster import ScheduleDefinition, AssetSelection, define_asset_job

# Schedule: run analytics pipeline nightly
analytics_job = define_asset_job(
    name="analytics_nightly",
    selection=AssetSelection.all()
)

nightly_schedule = ScheduleDefinition(
    job=analytics_job,
    cron_schedule="0 4 * * *",   # 4am UTC
    execution_timezone="UTC"
)

# Sensor: trigger on Fivetran sync completion
from dagster_fivetran import FivetranResource, build_fivetran_assets_definitions

fivetran_assets = build_fivetran_assets_definitions(
    connector_ids=["salesforce_connector_id", "stripe_connector_id"]
)

# Fivetran sensor automatically triggers downstream dbt assets
from dagster_fivetran import fivetran_event_iterator
```

## Partitioned Assets

```python
from dagster import MonthlyPartitionsDefinition, asset

monthly_partitions = MonthlyPartitionsDefinition(start_date="2023-01-01")

@asset(partitions_def=monthly_partitions)
def monthly_revenue_report(context: AssetExecutionContext):
    partition_key = context.partition_key   # e.g. "2024-01"
    year, month = partition_key.split("-")
    # Process only this month's data
    ...
```

## Alerting

```python
from dagster import sensor, RunRequest, SensorEvaluationContext
from dagster import make_email_on_run_failure_sensor

# Email on failure
email_on_failure = make_email_on_run_failure_sensor(
    email_from="dagster@company.com",
    email_password="...",
    email_to=["data-team@company.com"]
)

# Custom Slack alert
from dagster_slack import make_slack_on_run_failure_sensor

slack_on_failure = make_slack_on_run_failure_sensor(
    channel="#data-alerts",
    slack_token="xoxb-..."
)
```

## Comparison to Airflow

| Feature | Dagster | Airflow |
|---------|---------|---------|
| Paradigm | Asset-centric | Task-centric |
| dbt integration | Native (manifest-aware) | BashOperator or provider |
| Data lineage | Built-in via asset graph | Manual documentation |
| Testing | Asset checks + built-in | Separate test tasks |
| UI | Modern, asset-focused | Mature, DAG-focused |
| Learning curve | Medium | Higher (for full feature set) |
| Best for | New data teams, dbt-first | Legacy systems, complex ops |
