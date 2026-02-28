# OpenMetadata Integration Guide

## Overview
OpenMetadata is an open-source metadata platform providing data discovery, data lineage, data quality, and collaboration features. It aggregates metadata from warehouses, dbt, pipelines, and BI tools into a unified catalog.

## Architecture

```
Ingestion Sources              OpenMetadata Platform
├── Snowflake / BigQuery  →    ┌─────────────────────┐
├── dbt (manifest.json)  →    │  Metadata Store      │
├── Airflow / Dagster    →    │  Lineage Graph        │
├── Looker / Tableau     →    │  Data Quality        │
├── Fivetran / Airbyte   →    │  Collaboration       │
└── Custom sources       →    │  Search & Discovery  │
                               └─────────────────────┘
```

## Installation (Docker)

```yaml
# docker-compose.yml
version: "3.9"
services:
  openmetadata-server:
    image: openmetadata/server:1.3.0
    ports:
      - "8585:8585"
    environment:
      DB_HOST: mysql
      DB_PORT: 3306
      DB_USER: openmetadata_user
      DB_USER_PASSWORD: openmetadata_password
      DB_DATABASE: openmetadata_db
      ELASTICSEARCH_HOST: elasticsearch
      ELASTICSEARCH_PORT: 9200

  ingestion:
    image: openmetadata/ingestion:1.3.0
    environment:
      AIRFLOW__DATABASE__SQL_ALCHEMY_CONN: postgresql+psycopg2://airflow:airflow@postgresql/airflow
    volumes:
      - ./dags:/opt/airflow/dags

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: openmetadata_db
      MYSQL_USER: openmetadata_user
      MYSQL_PASSWORD: openmetadata_password
      MYSQL_ROOT_PASSWORD: root
```

```bash
# Using OpenMetadata CLI
pip install openmetadata-ingestion[all]
```

## Ingestion Connectors

### Snowflake Connector

```yaml
# snowflake_ingestion.yml
source:
  type: snowflake
  serviceName: snowflake_production
  serviceConnection:
    config:
      type: Snowflake
      username: OPENMETADATA_USER
      password: "****"
      account: myorg.us-east-1
      role: OPENMETADATA_ROLE
      warehouse: OPENMETADATA_WH
      database: ANALYTICS

  sourceConfig:
    config:
      type: DatabaseMetadata
      schemaFilterPattern:
        includes: ["marts", "reporting"]
      tableFilterPattern:
        excludes: [".*_backup.*", ".*_temp.*"]
      includeTables: true
      includeViews: true
      markDeletedTables: true
      generateSampleData: true
      sampleDataCount: 50

sink:
  type: metadata-rest
  config:
    api_endpoint: http://localhost:8585/api

workflowConfig:
  openMetadataServerConfig:
    hostPort: http://localhost:8585/api
    authProvider: openmetadata
    securityConfig:
      jwtToken: "****"
```

### BigQuery Connector

```yaml
source:
  type: bigquery
  serviceName: bigquery_production
  serviceConnection:
    config:
      type: BigQuery
      credentials:
        gcpConfig:
          type: service_account
          projectId: my-gcp-project
          privateKeyId: "****"
          privateKey: "-----BEGIN RSA PRIVATE KEY-----\n..."
          clientEmail: openmetadata@my-gcp-project.iam.gserviceaccount.com
          clientId: "****"
  sourceConfig:
    config:
      type: DatabaseMetadata
      datasetFilterPattern:
        includes: ["marts", "reporting"]
```

### dbt Connector (Metadata + Lineage)

```yaml
source:
  type: dbt
  serviceName: dbt_production
  serviceConnection:
    config:
      type: Dbt
      dbtConfigSource:
        dbtConfigType: local
        dbtCatalogFilePath: /dbt/target/catalog.json
        dbtManifestFilePath: /dbt/target/manifest.json
        dbtRunResultsFilePath: /dbt/target/run_results.json

  sourceConfig:
    config:
      type: DBTMetadata
      dbtUpdateDescriptions: true    # sync dbt descriptions to OM
      includeTags: true
      dbtClassificationName: dbt_tags

sink:
  type: metadata-rest
  config:
    api_endpoint: http://localhost:8585/api
```

Run ingestion:
```bash
metadata ingest -c snowflake_ingestion.yml
metadata ingest -c dbt_ingestion.yml
```

## Python SDK

```python
from metadata.generated.schema.entity.data.table import Table
from metadata.generated.schema.entity.services.connections.metadata.openMetadataConnection import (
    OpenMetadataConnection, AuthProvider
)
from metadata.generated.schema.security.client.openMetadataJWTClientConfig import (
    OpenMetadataJWTClientConfig
)
from metadata.ingestion.ometa.ometa_api import OpenMetadata

# Connect
server_config = OpenMetadataConnection(
    hostPort="http://localhost:8585/api",
    authProvider=AuthProvider.openmetadata,
    securityConfig=OpenMetadataJWTClientConfig(jwtToken="****")
)
metadata = OpenMetadata(server_config)

# Get a table
table = metadata.get_by_name(
    entity=Table,
    fqn="snowflake_production.ANALYTICS.marts.fct_orders"
)
print(table.description.root if table.description else "No description")

# Search for tables
tables = metadata.list_entities(entity=Table, limit=10)
for t in tables.entities:
    print(f"{t.fullyQualifiedName.root}: {t.description}")

# Update table description
from metadata.generated.schema.type.basic import Markdown
metadata.patch_description(
    entity=Table,
    source=table,
    description="One row per order. Source of truth for order-level revenue metrics.",
    force=True
)

# Add tags
from metadata.generated.schema.type.tagLabel import TagLabel, TagSource, LabelType, State

tag_label = TagLabel(
    tagFQN="dbt_tags.critical",
    source=TagSource.Classification,
    labelType=LabelType.Automated,
    state=State.Suggested
)
metadata.patch_tags(entity=Table, source=table, tag_labels=[tag_label])
```

## Lineage Management

```python
from metadata.generated.schema.api.lineage.addLineage import AddLineageRequest
from metadata.generated.schema.type.entityLineage import EntitiesEdge, LineageDetails
from metadata.generated.schema.type.entityReference import EntityReference

# Add table-level lineage
source_table = metadata.get_by_name(entity=Table, fqn="snowflake.RAW.fivetran.orders")
target_table = metadata.get_by_name(entity=Table, fqn="snowflake.ANALYTICS.marts.fct_orders")

lineage = AddLineageRequest(
    edge=EntitiesEdge(
        fromEntity=EntityReference(id=source_table.id, type="table"),
        toEntity=EntityReference(id=target_table.id, type="table"),
        lineageDetails=LineageDetails(
            pipeline=EntityReference(id=pipeline_id, type="pipeline")
        )
    )
)
metadata.add_lineage(data=lineage)
```

## Data Quality Integration

```yaml
# data_quality_ingestion.yml
source:
  type: TestSuite
  serviceName: dq_fct_orders
  sourceConfig:
    config:
      type: TestSuite
      entityFullyQualifiedName: snowflake_production.ANALYTICS.marts.fct_orders

processor:
  type: orm-test-runner
  config:
    testCases:
      - name: order_id_not_null
        testDefinitionName: columnValuesToNotBeNull
        columnName: order_id
      - name: revenue_positive
        testDefinitionName: columnValuesToBeBetween
        columnName: revenue
        parameterValues:
          - name: minValue
            value: "0"
          - name: maxValue
            value: "10000000"
      - name: row_count_positive
        testDefinitionName: tableRowCountToBeGreaterThan
        parameterValues:
          - name: value
            value: "1000"
```

## Automation with dbt + OpenMetadata in CI

```yaml
# .github/workflows/catalog-sync.yml
- name: Run dbt
  run: dbt build --target prod

- name: Sync to OpenMetadata
  run: |
    pip install openmetadata-ingestion
    metadata ingest -c .openmetadata/dbt_ingestion.yml
  env:
    OPENMETADATA_JWT_TOKEN: ${{ secrets.OPENMETADATA_JWT_TOKEN }}
```

## Key Features Summary

| Feature | Description |
|---|---|
| **Auto-discovery** | Scans warehouse schemas and builds catalog |
| **dbt integration** | Syncs descriptions, tags, lineage from manifest.json |
| **Data lineage** | Visual lineage graph across sources, transforms, BI |
| **Glossary** | Business glossary with ownership and approval workflows |
| **Data quality** | Runs tests and tracks results over time |
| **Collaboration** | Comments, announcements, following/watching tables |
| **Search** | Full-text search across tables, columns, tags, owners |
| **Access control** | RBAC with team-based permissions |
