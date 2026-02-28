# Prefect Integration Guide

## Flow and Task Pattern

```python
# flows/analytics_pipeline.py
from prefect import flow, task, get_run_logger
from prefect.blocks.system import Secret
from datetime import timedelta

@task(retries=2, retry_delay_seconds=60, timeout_seconds=600)
def run_dbt(command: str, target: str = "prod") -> bool:
    import subprocess
    logger = get_run_logger()
    result = subprocess.run(
        f"dbt {command} --target {target}",
        shell=True, capture_output=True, text=True, cwd="/opt/dbt"
    )
    logger.info(result.stdout)
    if result.returncode != 0:
        logger.error(result.stderr)
        raise Exception(f"dbt {command} failed")
    return True

@task(retries=3, retry_delay_seconds=30)
def trigger_fivetran_sync(connector_id: str) -> None:
    import httpx
    api_key = Secret.load("fivetran-api-key").get()
    api_secret = Secret.load("fivetran-api-secret").get()
    # Trigger + wait for sync to complete
    ...

@flow(name="Analytics Nightly Pipeline", log_prints=True)
def analytics_pipeline():
    # Parallel ingestion
    sync_sf = trigger_fivetran_sync.submit("salesforce_connector_id")
    sync_stripe = trigger_fivetran_sync.submit("stripe_connector_id")

    # Wait for both
    sync_sf.result()
    sync_stripe.result()

    # Sequential dbt build
    run_dbt("deps")
    run_dbt("build --select state:modified+")
    run_dbt("source freshness")

if __name__ == "__main__":
    analytics_pipeline()
```

## Deployments (Scheduled Runs)

```python
# Create a deployment (from CLI or Python)
from prefect import serve
from prefect.client.schemas.schedules import CronSchedule

# Serve locally (for development)
analytics_pipeline.serve(
    name="analytics-nightly",
    cron="0 4 * * *",
    timezone="UTC"
)

# Or deploy to Prefect Cloud/Server
from prefect.deployments import Deployment

deployment = Deployment.build_from_flow(
    flow=analytics_pipeline,
    name="analytics-nightly",
    schedule=CronSchedule(cron="0 4 * * *", timezone="UTC"),
    work_pool_name="default-agent-pool",
    tags=["production", "analytics"]
)
deployment.apply()
```

## Blocks (Secret Management)

```python
# Store secrets as Prefect Blocks
from prefect.blocks.system import Secret

# Set from CLI
# prefect block create secret --name snowflake-password --value "your-password"

# Use in flow
@task
def get_snowflake_conn():
    password = Secret.load("snowflake-password").get()
    return snowflake.connector.connect(password=password, ...)
```

## Automations (Alerting)

```python
# Set up via Prefect Cloud UI or API
# Automation: on flow run failure → send Slack notification

# Or programmatically:
from prefect.automations import Automation
from prefect.events.actions import SendNotification

automation = Automation(
    name="Alert on failure",
    trigger=EventTrigger(
        event="prefect.flow-run.Failed",
        resource={"prefect.resource.id": "prefect.flow-run.*"}
    ),
    actions=[
        SendNotification(
            block_document_id="slack-block-id",
            body="Flow {{ event.resource.name }} failed!"
        )
    ]
)
automation.save()
```

## Key Differences from Airflow

| Feature | Prefect | Airflow |
|---------|---------|---------|
| Setup | Minimal (pip install, no server for dev) | Complex (scheduler, webserver, db) |
| Code | Pure Python — no DAG magic | DAG context manager |
| Scheduling | Cron + event-based | Cron only (natively) |
| Retries | Per-task or per-flow | Per-task |
| UI | Modern, real-time | Mature, feature-rich |
| Managed | Prefect Cloud (paid) | MWAA, Astronomer, Cloud Composer |
