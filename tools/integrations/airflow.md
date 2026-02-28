# Apache Airflow Integration Guide

## DAG Structure

```python
from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.providers.snowflake.sensors.snowflake import SnowflakeSensor
from airflow.providers.fivetran.operators.fivetran import FivetranOperator
from datetime import datetime, timedelta

def alert_on_failure(context):
    # Send Slack alert
    pass

default_args = {
    'owner': 'analytics-eng',
    'retries': 2,
    'retry_delay': timedelta(minutes=5),
    'retry_exponential_backoff': True,
    'on_failure_callback': alert_on_failure,
    'email_on_failure': False,  # Use Slack instead
}

with DAG(
    dag_id='analytics_pipeline',
    description='Nightly analytics pipeline',
    schedule='0 4 * * *',         # 4am UTC
    start_date=datetime(2024, 1, 1),
    catchup=False,
    max_active_runs=1,             # Prevent overlap
    dagrun_timeout=timedelta(hours=4),
    tags=['analytics', 'production'],
    default_args=default_args
) as dag:

    # Step 1: Trigger Fivetran sync
    sync_salesforce = FivetranOperator(
        task_id='sync_salesforce',
        fivetran_conn_id='fivetran_default',
        connector_id="{{ var('fivetran_salesforce_id') }}",
        do_xcom_push=False
    )

    # Step 2: Run dbt
    dbt_run = BashOperator(
        task_id='dbt_run',
        bash_command="""
            cd /opt/dbt && \
            dbt build \
                --select state:modified+ \
                --defer \
                --state /opt/dbt/prod-artifacts \
                --target prod \
                --profiles-dir /opt/dbt
        """,
        env={"DBT_TARGET": "prod"}
    )

    # Step 3: Source freshness check
    freshness_check = BashOperator(
        task_id='source_freshness',
        bash_command='cd /opt/dbt && dbt source freshness --target prod',
        trigger_rule='all_done'   # Run even if dbt had warnings
    )

    sync_salesforce >> dbt_run >> freshness_check
```

## Connections Setup (Airflow UI / CLI)

```bash
# Snowflake connection
airflow connections add snowflake_default \
    --conn-type snowflake \
    --conn-host "xxx.snowflakecomputing.com" \
    --conn-schema PROD \
    --conn-login dbt_user \
    --conn-password "{{ secret }}" \
    --conn-extra '{"warehouse": "TRANSFORMING", "database": "ANALYTICS", "role": "TRANSFORMER"}'

# Fivetran connection
airflow connections add fivetran_default \
    --conn-type http \
    --conn-host https://api.fivetran.com \
    --conn-login api_key \
    --conn-password api_secret
```

## Providers Required

```bash
pip install apache-airflow-providers-snowflake
pip install apache-airflow-providers-google  # BigQuery
pip install apache-airflow-providers-amazon  # S3, Redshift
pip install apache-airflow-providers-fivetran
pip install apache-airflow-providers-databricks
```

## XCom Patterns

```python
# Pass data between tasks
def process_data(ti, **kwargs):
    # Pull from upstream task
    row_count = ti.xcom_pull(task_ids='count_records', key='row_count')
    if row_count == 0:
        raise ValueError("No records found — aborting")
    return row_count

process = PythonOperator(
    task_id='process',
    python_callable=process_data
)
```

## TaskGroup (Organize parallel ingestion)

```python
from airflow.utils.task_group import TaskGroup

with TaskGroup("ingestion", tooltip="Fivetran syncs") as ingestion_group:
    for source in ['salesforce', 'stripe', 'shopify']:
        FivetranOperator(
            task_id=f'sync_{source}',
            connector_id="{{ var('" + f"fivetran_{source}_id" + "') }}"
        )

ingestion_group >> dbt_run
```
