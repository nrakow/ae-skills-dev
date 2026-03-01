---
name: data-catalog
description: "Implement and maintain a data catalog with metadata, documentation, and discovery tooling. Use when setting up dbt docs or an external catalog tool, improving documentation coverage across models, building a data dictionary for stakeholders, or integrating dbt artifacts with OpenMetadata or Atlan. Produces dbt YAML documentation, an overview page, and catalog connector configuration."
triggers:
  - "set up a data catalog"
  - "document my dbt models"
  - "improve data discovery"
  - "generate dbt docs"
  - "build a data dictionary"
reads_first:
  - data-stack-context
cli_tools: []
produces:
  - "dbt schema.yml model and column descriptions"
  - "dbt docs overview page (docs/overview.md)"
  - "OpenMetadata connector YAML config"
validates_with:
  - "dbt docs generate"
  - "dbt compile"
  - "dbt test --select tag:documented"
---

# Data Catalog

I'll help you implement a data catalog that makes your analytics layer discoverable, documented, and trustworthy.

## Before You Start

Read the following files before proceeding:

- `.claude/data-stack-context.md` — existing catalog tool, dbt project structure, team size, and compliance requirements

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: existing catalog tool, dbt project structure, team size.

## Catalog Options

| Tool | Best for | dbt integration |
|------|---------|----------------|
| **dbt docs** | dbt-first teams, simple needs | Native |
| **Atlan** | Enterprise, data governance focus | Native dbt connector |
| **OpenMetadata** | Open-source, self-hosted | dbt connector |
| **DataHub** | LinkedIn OSS, complex lineage | dbt connector |
| **Collibra** | Regulated industries, glossary focus | Custom connector |
| **Lightdash** | BI + catalog in one | Native dbt |

---

## dbt Docs (Zero-Additional-Cost Catalog)

### Generate and Serve

```bash
# Generate docs site
dbt docs generate

# Serve locally (http://localhost:8080)
dbt docs serve

# Deploy to static hosting (S3 + CloudFront, Netlify, etc.)
# target/index.html + target/catalog.json + target/manifest.json
```

### Complete Documentation Template

Every model needs a full description:

```yaml
# models/marts/core/_core__models.yml
version: 2

models:
  - name: fct_orders
    description: |
      ## Overview
      One row per customer order. Primary source of truth for revenue and order
      reporting. Updated nightly by 7am UTC.

      ## Grain
      One row per order (not per line item — see `fct_order_lines` for line detail)

      ## Key Notes
      - Revenue is in USD, after discounts, before tax
      - Cancelled orders ARE included with `order_status = 'cancelled'`; filter as needed
      - `is_first_order` is calculated at order time; does not update if earlier orders are cancelled

      ## Owner
      **Data team**: analytics-eng@company.com
      **Business owner**: VP Revenue Operations

      ## Upstream
      Built from `stg_orders` + `dim_customers` + `dim_products`

    config:
      meta:
        owner: analytics-eng@company.com
        team: Analytics Engineering
        domain: Revenue
        sla: "Available by 7am UTC daily"
        freshness_expected: "< 24 hours"

    columns:
      - name: order_id
        description: "Unique identifier for the order. 18-character string from our e-commerce platform."
        data_tests:
          - unique
          - not_null

      - name: customer_id
        description: "FK to `dim_customers`. The customer who placed this order."
        data_tests:
          - not_null
          - relationships:
              to: ref('dim_customers')
              field: customer_id

      - name: net_revenue_usd
        description: |
          Revenue from this order in USD.
          **Formula**: unit_price × quantity − discount_amount
          **Note**: This is gross revenue (before tax, after discounts)
          **Sign**: Always ≥ 0; refunds are in `fct_refunds`

      - name: order_status
        description: |
          Current status of the order.
          - `pending`: Order placed, not yet processed
          - `processing`: Payment confirmed, preparing to ship
          - `completed`: Delivered and confirmed
          - `cancelled`: Cancelled before shipment
          - `refunded`: Post-shipment return processed
        data_tests:
          - accepted_values:
              values: [pending, processing, completed, cancelled, refunded]
```

### Overview Page

```markdown
<!-- docs/overview.md -->
# Analytics Engineering Data Catalog

Welcome! This is the source of truth for all analytics data at Acme Corp.

## How to Use This Catalog

1. **Finding data**: Use the search bar or browse by domain (Revenue, Product, Marketing)
2. **Understanding a table**: Click any model to see description, columns, and lineage
3. **Data issues**: Slack #data-help or open a GitHub issue
4. **Request new data**: Submit a data request form [here]

## Data Domains

| Domain | Key Models | Owner |
|--------|-----------|-------|
| Revenue | fct_orders, fct_revenue_monthly | Finance Analytics |
| Customer | dim_customers, fct_customer_lifetime | Growth Analytics |
| Product | fct_sessions, fct_feature_usage | Product Analytics |
| Marketing | fct_campaigns, fct_ad_spend | Marketing Analytics |

## Freshness SLAs

All mart tables are updated by **7am UTC daily** unless otherwise noted.
Freshness is monitored automatically — see #data-alerts for incidents.

## Glossary

| Term | Definition |
|------|-----------|
| MRR | Monthly Recurring Revenue — recurring subscription revenue normalized to monthly |
| Active Customer | Customer with ≥1 purchase in the last 90 days |
| Churn | Subscription cancellation in the reporting period |
| ARR | Annual Recurring Revenue = MRR × 12 |
```

---

## OpenMetadata Integration with dbt

```yaml
# openmetadata/dbt-connector.yaml
source:
  type: dbt
  serviceName: dbt_analytics
  serviceConnection:
    config:
      type: dbt
      dbtConfigSource:
        dbtCatalogFilePath: /dbt/target/catalog.json
        dbtManifestFilePath: /dbt/target/manifest.json
        dbtRunResultsFilePath: /dbt/target/run_results.json
  sourceConfig:
    config:
      type: DatabaseMetadata
      markDeletedTables: true
      includeTags: true
      dbtClassificationName: "dbt Tags"

sink:
  type: metadata-rest
  config: {}

workflowConfig:
  openMetadataServerConfig:
    hostPort: http://openmetadata-server:8585/api
    authProvider: openmetadata
    securityConfig:
      jwtToken: "your-jwt-token"
```

---

## Documentation Quality Metrics

Measure and improve documentation coverage:

```sql
-- dbt: count models without descriptions
-- Run against information_schema in your warehouse

with model_docs as (
    -- Query dbt manifest.json via your catalog or warehouse
    select
        model_name,
        description,
        (description is not null and length(trim(description)) > 0) as has_description
    from your_catalog_metadata_table
    where model_layer in ('staging', 'intermediate', 'marts')
),

column_docs as (
    select
        model_name,
        column_name,
        (description is not null and length(trim(description)) > 0) as has_description
    from your_catalog_column_metadata_table
)

select
    model_layer,
    count(*) as total_models,
    sum(case when has_description then 1 else 0 end) as documented_models,
    sum(case when has_description then 1 else 0 end) * 100.0 / count(*) as pct_documented

from model_docs
group by model_layer
```

**Target documentation coverage:**
- Staging models: 80% column coverage
- Mart models: 100% model description + 90% column coverage
- All primary keys and foreign keys: 100% documented

---

## Catalog Maintenance Process

**Weekly:**
- Review models added this week — ensure descriptions added before merge
- Check `dbt docs generate` succeeds in CI

**Monthly:**
- Audit low-documentation-coverage models
- Review and update outdated descriptions (check `last_updated_at`)
- Archive or delete deprecated models

**Quarterly:**
- Review entire catalog for stale entries
- Update data domain ownership
- Review glossary terms for accuracy

---

## Verify Your Work

After updating documentation and generating the catalog, verify with:

```bash
# Regenerate the docs site and confirm it compiles without errors
dbt docs generate

# Confirm all models compile (catches broken refs in YAML)
dbt compile

# Check freshness of source documentation
dbt source freshness
```

```bash
# Count undocumented mart models (should be 0 before merging)
python3 -c "
import json
manifest = json.load(open('target/manifest.json'))
undocumented = [
    n for n, v in manifest['nodes'].items()
    if v.get('resource_type') == 'model'
    and v.get('config', {}).get('materialized') in ('table', 'view', 'incremental')
    and 'marts' in v.get('fqn', [])
    and not v.get('description', '').strip()
]
print(f'{len(undocumented)} undocumented mart models:', undocumented)
"
```

## If Something Goes Wrong

- **`dbt docs generate` fails with a missing catalog error**: Run `dbt run` first to materialize models before generating docs; the catalog is built by inspecting the warehouse, so models must exist as physical tables or views.
- **Column descriptions not appearing in generated docs**: Confirm the YAML file is in the correct `models/` subdirectory and that the `columns:` block is nested under the correct model name with exact case matching.
- **OpenMetadata connector fails to ingest**: Verify that all three artifact paths (`catalog.json`, `manifest.json`, `run_results.json`) point to the same dbt target run; mixing artifacts from different runs causes ingestion failures.
- **Documentation coverage not improving despite YAML updates**: The coverage query reads from your catalog tool's metadata tables, which are only updated after a successful ingestion run — re-run the connector after adding descriptions.
- **`dbt docs serve` shows stale data**: The served docs reflect the last `dbt docs generate` output; re-run `dbt docs generate` to pick up new descriptions before serving or deploying.
