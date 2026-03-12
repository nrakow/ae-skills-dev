---
name: pipeline-design
description: "Design end-to-end data pipeline architecture including orchestration, dependency management, scheduling, retries, and failure handling. Use when planning a new pipeline, choosing between Airflow vs Dagster vs Prefect, redesigning a brittle pipeline that keeps failing, or someone says 'our pipeline broke again'. Also fires for 'DAG design', 'orchestration setup', 'pipeline keeps failing', 'how should I schedule dbt', 'Airflow DAG for dbt', or 'my pipeline is unreliable'. Use this whenever you need to design, architect, or fix a data pipeline end to end. For ingestion tooling, see ingestion-strategy. For CI/CD, see dbt-ci-cd. For performance, see warehouse-optimization."
triggers:
  - "pipeline design"
  - "data pipeline"
  - "orchestration design"
  - "DAG design"
  - "pipeline architecture"
  - "pipeline reliability"
  - "our pipeline broke again"
  - "Airflow DAG"
  - "Dagster asset"
  - "Prefect flow"
  - "how should I schedule dbt"
  - "pipeline keeps failing"
  - "orchestration setup"
  - "pipeline is unreliable"
reads_first:
  - data-stack-context
  - ingestion-strategy
cli_tools:
  - lineage-export.js
produces:
  - "pipeline architecture diagram"
  - "orchestrator DAG definition"
  - "dbt job configuration"
validates_with:
  - "dbt parse"
  - "node tools/clis/lineage-export.js --manifest target/manifest.json --format dot"
---

# Pipeline Design

I'll help you design data pipelines that are reliable, observable, and cost-efficient — from ingestion through transformation to serving.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: orchestrator (Airflow/Dagster/Prefect), warehouse, team maturity.

## Before You Start

- Run `node tools/clis/lineage-export.js --manifest target/manifest.json --format dot` to visualize the current model DAG before designing pipeline dependencies.
- Read the orchestrator integration guide in `tools/integrations/` for your specific tool (e.g., `airflow.md`, `dagster.md`, `prefect.md`).
- Confirm `target/manifest.json` exists — run `dbt compile` first if it doesn't.
- Review the existing DAG or job definitions if any are already in the repo before designing a new one.

## Pipeline Architecture Overview

```
Source Systems
    │
    ▼
[Ingestion Layer]          — Fivetran / Airbyte / custom
    │ raw data
    ▼
[Raw Storage]              — Snowflake / BigQuery / S3 + Databricks
    │
    ▼
[Transformation Layer]     — dbt (staging → intermediate → marts)
    │
    ▼
[Serving Layer]            — BI tool / API / data export
    │
    ▼
[Consumers]                — Dashboards / Applications / Data science
```

## Design Principles

1. **Idempotency**: Running a pipeline twice produces the same result
2. **Atomicity**: Either the full load succeeds, or nothing changes
3. **Observability**: Every step has metrics and alerts
4. **Graceful failure**: A failure in one step doesn't corrupt downstream
5. **Cost awareness**: Flag expensive operations; choose incremental over full-refresh

---

## Orchestrator Selection

| Orchestrator | Best for | Avoid if |
|-------------|---------|---------|
| **Airflow** | Large teams, complex dependencies, custom operators | Small teams (heavy ops overhead) |
| **Dagster** | dbt + data asset modeling, software-defined assets | Not using Python |
| **Prefect** | Python-first teams, simple UI, managed hosting | Need complex graph dependencies |
| **dbt Cloud Jobs** | Pure dbt pipelines, no custom Python | Need non-dbt steps in DAG |
| **GitHub Actions** | CI/CD for dbt, simple scheduled runs | Complex dependencies |

---

## DAG Design Patterns

### Pattern 1: Linear Pipeline (Simplest)

```
ingest_salesforce → dbt_staging → dbt_intermediate → dbt_marts → notify_success
```

```python
# Airflow example
with DAG(
    dag_id='analytics_pipeline',
    schedule_interval='0 4 * * *',  # 4am UTC daily
    start_date=datetime(2024, 1, 1),
    catchup=False,
    default_args={
        'retries': 2,
        'retry_delay': timedelta(minutes=5),
        'on_failure_callback': alert_slack,
    }
) as dag:

    wait_for_fivetran = FivetranSensor(
        task_id='wait_for_fivetran_salesforce',
        fivetran_conn_id='fivetran_default',
        connector_id='{{ var("fivetran_salesforce_connector_id") }}',
        poke_interval=60,
        timeout=3600,
    )

    run_dbt_staging = BashOperator(
        task_id='dbt_staging',
        bash_command='dbt run --select staging --target prod',
        env={'DBT_TARGET': 'prod'},
    )

    run_dbt_marts = BashOperator(
        task_id='dbt_marts',
        bash_command='dbt run --select marts --target prod',
    )

    test_marts = BashOperator(
        task_id='dbt_test',
        bash_command='dbt test --select marts --target prod',
    )

    wait_for_fivetran >> run_dbt_staging >> run_dbt_marts >> test_marts
```

### Pattern 2: Fan-Out + Fan-In (Parallel Sources)

```
ingest_salesforce ──┐
ingest_stripe    ──┤── dbt_staging → dbt_marts → test_all
ingest_shopify   ──┘
```

```python
# Airflow parallel ingestion
ingest_tasks = []
for source in ['salesforce', 'stripe', 'shopify']:
    task = FivetranOperator(
        task_id=f'ingest_{source}',
        fivetran_conn_id='fivetran_default',
        connector_id=f'{{{{ var("fivetran_{source}_connector_id") }}}}',
    )
    ingest_tasks.append(task)

all_ingested = EmptyOperator(task_id='all_sources_loaded')
run_dbt = BashOperator(task_id='run_dbt', bash_command='dbt build --target prod')

ingest_tasks >> all_ingested >> run_dbt
```

### Pattern 3: Dagster Software-Defined Assets (Recommended for dbt teams)

```python
# Dagster: define data assets, not tasks
from dagster import asset, AssetExecutionContext
from dagster_dbt import DbtCliResource, dbt_assets

@dbt_assets(manifest=dbt_manifest_path)
def analytics_dbt_assets(context: AssetExecutionContext, dbt: DbtCliResource):
    yield from dbt.cli(["build"], context=context).stream()

# Dagster automatically infers the dependency graph from dbt's manifest
# No manual task dependencies needed

@asset(deps=[analytics_dbt_assets])
def export_to_erp(context: AssetExecutionContext):
    # Export mart data to ERP system
    ...
```

---

## Error Handling Patterns

### Retry Strategy

```python
default_args = {
    'retries': 3,
    'retry_delay': timedelta(minutes=5),
    'retry_exponential_backoff': True,  # 5min, 10min, 20min
    'max_retry_delay': timedelta(hours=1),
}
```

### Alerting

```python
def alert_slack_on_failure(context):
    dag_id = context['dag'].dag_id
    task_id = context['task_instance'].task_id
    execution_date = context['execution_date']
    log_url = context['task_instance'].log_url

    message = f":red_circle: Pipeline failed\n*DAG*: {dag_id}\n*Task*: {task_id}\n*Date*: {execution_date}\n<{log_url}|View logs>"

    slack_hook = SlackHook(slack_conn_id='slack_default')
    slack_hook.call("chat.postMessage", json={
        "channel": "#data-alerts",
        "text": message
    })

default_args = {
    'on_failure_callback': alert_slack_on_failure,
}
```

### Circuit Breaker Pattern

```python
def check_source_freshness(**context):
    """Abort pipeline if source data is too stale"""
    from airflow.models import Variable
    import snowflake.connector

    conn = snowflake.connector.connect(...)
    cursor = conn.cursor()
    cursor.execute("""
        select max(_fivetran_synced) as last_sync
        from raw.salesforce.account
    """)
    last_sync = cursor.fetchone()[0]

    hours_stale = (datetime.utcnow() - last_sync).total_seconds() / 3600
    if hours_stale > 25:
        raise AirflowFailException(
            f"Salesforce data is {hours_stale:.1f} hours stale — pipeline aborted"
        )

check_freshness = PythonOperator(
    task_id='check_source_freshness',
    python_callable=check_source_freshness,
)
check_freshness >> run_dbt_staging
```

---

## Schedule Design

```python
# Stagger schedules to avoid warehouse contention
schedules = {
    'ingest_salesforce': '0 1 * * *',    # 1am UTC — ingest first
    'ingest_stripe': '0 1 * * *',        # concurrent ingestion ok
    'dbt_staging': '0 3 * * *',          # 3am — after ingestion window
    'dbt_marts': '0 5 * * *',            # 5am — after staging
    'dashboard_cache_refresh': '0 6 * * *',  # 6am — dashboards fresh by 7am
}
```

**SLA targets:**
- Data available to consumers: by 7am local business time
- Pipeline completion: must finish by 6:30am (30 min buffer)
- Maximum pipeline runtime: set `dagrun_timeout=timedelta(hours=4)`

---

## Cost Optimization Checklist

- [ ] Use incremental dbt models for large tables (avoid full-refresh nightly)
- [ ] Schedule warehouse auto-suspend (Snowflake: `AUTO_SUSPEND = 60`)
- [ ] Use a dedicated "TRANSFORMING" warehouse (separate from "REPORTING")
- [ ] Cluster/partition tables accessed by date filters
- [ ] Use `dbt build --select state:modified+` in CI (not full rebuild)
- [ ] Archive historical raw data to cheaper storage after 90 days

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

- For Airflow/Dagster/Prefect: run `dbt parse` to validate the model graph is cycle-free before coding the DAG.
- Draw the pipeline topology and verify it matches the dbt lineage graph exported by `lineage-export.js`.
- For Airflow specifically: run `airflow dags list` and `airflow tasks list <dag_id>` to confirm the DAG parses correctly.

## If Something Goes Wrong

- **Circular dependency in DAG**: Run `dbt ls` — if dbt raises a cycle error, fix the model graph first; dbt cycles will cause orchestrator cycles.
- **Task fails silently**: Add explicit failure callbacks (`on_failure_callback` in Airflow, `failure_hook` in Dagster) so failures surface to alerting.
- **Resource contention**: Add concurrency limits per warehouse tier — avoid running heavy dbt builds and BI queries on the same warehouse simultaneously.
