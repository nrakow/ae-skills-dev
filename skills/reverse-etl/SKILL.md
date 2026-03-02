---
name: reverse-etl
description: "Design and implement reverse ETL pipelines that sync modeled warehouse data into operational tools like Salesforce, HubSpot, Intercom, and ad platforms. Use when syncing warehouse data to a CRM or marketing tool, configuring Census or Hightouch syncs, building a dbt activation layer, computing lead scores or customer health scores, or activating warehouse data for personalized marketing. Produces dbt activation model SQL, companion schema.yml, Census/Hightouch sync configuration, and a governance PR checklist."
triggers:
  - "sync warehouse data to Salesforce"
  - "reverse ETL"
  - "set up Census or Hightouch"
  - "build an activation layer"
  - "lead scoring from the warehouse"
reads_first:
  - data-stack-context
cli_tools: []
produces:
  - "dbt model SQL (act_<destination>__<object>.sql)"
  - "schema.yml with sync metadata and data tests"
  - "Census or Hightouch sync configuration YAML"
  - "Snowflake least-privilege role SQL"
  - "reverse ETL governance PR checklist"
validates_with:
  - "dbt compile --select tag:activation"
  - "dbt test --select tag:activation"
  - "dbt run --select tag:activation"
  - "dbt test --select act_salesforce__lead_scores --select not_null_email"
---

# Reverse ETL

I'll help you design and implement a reverse ETL pipeline that sends cleaned, modeled warehouse data back into operational tools — Salesforce, HubSpot, Intercom, ad platforms, and more.

## Before You Start

Read these project files before proceeding:

- `.claude/data-stack-context.md` — warehouse type (Snowflake/BigQuery/Databricks/Redshift), dbt version, reverse ETL tool (Census/Hightouch/none), and destination systems (Salesforce/HubSpot/Intercom/ad platforms)

## Check Context First

Read `.claude/data-stack-context.md` if it exists. Key inputs needed: warehouse (Snowflake / BigQuery / Databricks / Redshift), transformation tool (dbt version), reverse ETL tool (Census / Hightouch / none), and destination systems (Salesforce / HubSpot / Intercom / ad platforms).

## What Reverse ETL Is

Traditional ETL moves data **into** the warehouse. Reverse ETL moves **modeled warehouse data back out** into the operational tools your sales, marketing, and success teams use every day.

**Core use cases:**
- Lead scoring: sync propensity scores from the warehouse to Salesforce Lead records
- Customer health scores: surface churn risk in your CRM before CSMs talk to accounts
- Audience activation: sync cohorts to Google Ads, Facebook Ads, or Klaviyo for personalization
- Personalized marketing: send product usage signals to HubSpot for lifecycle email triggers
- Account-based marketing: enrich Salesforce Account fields with warehouse-computed firmographic signals

Reverse ETL is not a replacement for real-time event streaming. It is best suited for batch-computed, model-derived signals that change on hourly-to-daily cadence.

## Tool Selection Guide

### Decision Matrix

| Criteria | Census | Hightouch | Polytomus | Custom (dbt + Airflow + API) |
|---|---|---|---|---|
| Team technical level | Low–Medium | Low–Medium | Low | High |
| Number of destinations | 1–20 | 1–20 | 1–10 | Unlimited |
| dbt model native support | Excellent | Excellent | Good | Native |
| Pricing model | Per-record synced | Per-record synced | Flat fee | Infra cost only |
| Governance / audit log | Built-in | Built-in | Limited | Custom |
| Custom transforms in sync | Limited | Limited | Limited | Full control |
| Recommended for | Most teams | Most teams | Budget SMB | Platform/data teams |

**Opinionated recommendation:**

- **Use Census** if your team uses dbt Cloud and wants tight dbt model integration with minimal ops overhead. Census's dbt integration is the most mature.
- **Use Hightouch** if you need more advanced audience-building features (Hightouch Audiences product) or are already invested in their ecosystem.
- **Use custom** only if you have a dedicated data platform engineer, need complex multi-step transformations at sync time, or want zero vendor dependency. Budget 2–4 weeks for initial setup and ongoing maintenance.
- **Avoid building custom** if you have fewer than 3 sync targets — the operational overhead outweighs the savings.

## Modeling for Reverse ETL

### The Activation Layer

Create an `activation/` directory in your dbt project, sitting **between `marts/` and the sync tool**. This is not a reporting layer — it is purpose-built for operational system consumption.

```
models/
  staging/       # source-conformed
  intermediate/  # joined, deduplicated
  marts/         # business-oriented reporting models
  activation/    # reverse ETL targets — one model per sync object
    salesforce/
      act_salesforce__lead_scores.sql
      act_salesforce__account_health.sql
    hubspot/
      act_hubspot__contact_lifecycle.sql
    google_ads/
      act_google_ads__remarketing_audience.sql
```

### Activation Model Design Principles

1. **One model = one sync target.** `act_salesforce__lead_scores.sql` syncs only to Salesforce Lead. Never mix destination objects in one model.
2. **Include only fields the destination needs.** Do not select `*` from a mart. Explicitly name every column you intend to sync.
3. **Always include a natural key the destination uses for upserts.** For Salesforce this is typically `email` or a custom external ID field. Without a stable key, syncs create duplicates.
4. **Idempotent by design.** Running the same sync twice must produce no changes. Activation models must be deterministic.
5. **No PII you did not intentionally include.** See the PII section below.

## dbt Activation Model Template

### `act_salesforce__lead_scores.sql`

```sql
{{
    config(
        materialized='table',
        tags=['activation', 'salesforce', 'hourly'],
        meta={
            'sync_to': 'salesforce',
            'sync_object': 'Lead',
            'sync_frequency': 'hourly',
            'sync_identifier': 'email',
            'sync_operation': 'upsert',
            'owner': 'analytics-engineering',
            'approved_by': 'revenue-ops'
        }
    )
}}

with leads as (

    select
        email,
        account_id,
        lead_source,
        created_at

    from {{ ref('dim_leads') }}
    where email is not null  -- Salesforce upsert requires a valid identifier

),

product_signals as (

    select
        user_email,
        count(distinct session_id)                          as sessions_last_30d,
        sum(case when event_type = 'feature_used'
                 then 1 else 0 end)                         as feature_events_last_30d,
        max(event_timestamp)                                as last_active_at,
        datediff(
            'day',
            max(event_timestamp),
            current_date
        )                                                   as days_since_last_active

    from {{ ref('fct_product_events') }}
    where event_timestamp >= dateadd('day', -30, current_timestamp())  -- Snowflake
    -- where event_timestamp >= timestamp_sub(current_timestamp(), interval 30 day)  -- BigQuery
    group by 1

),

firmographics as (

    select
        domain,
        employee_count,
        industry,
        annual_revenue_band

    from {{ ref('dim_company_firmographics') }}

),

scored as (

    select
        l.email,

        -- Lead score: 0–100 scale, higher = more likely to convert
        least(100, greatest(0,
            -- Recency (max 30 pts)
            case
                when p.days_since_last_active <= 3  then 30
                when p.days_since_last_active <= 7  then 20
                when p.days_since_last_active <= 14 then 10
                else 0
            end
            -- Engagement depth (max 30 pts)
            + least(30, p.feature_events_last_30d * 3)
            -- Firmographic fit (max 40 pts)
            + case f.employee_count
                when 'enterprise'   then 40
                when 'mid_market'   then 25
                when 'smb'          then 10
                else 0
              end
        ))                                                  as lead_score,

        -- Signals for Salesforce reps to read (not formulas)
        p.sessions_last_30d                                 as wh_sessions_last_30d,
        p.feature_events_last_30d                           as wh_feature_events_last_30d,
        p.last_active_at                                    as wh_last_active_at,
        f.industry                                          as wh_industry,
        f.employee_count                                    as wh_employee_count,
        f.annual_revenue_band                               as wh_annual_revenue_band,

        -- Metadata for debugging syncs
        current_timestamp()                                 as wh_scored_at

    from leads l
    left join product_signals p  on l.email = p.user_email
    left join firmographics f    on split_part(l.email, '@', 2) = f.domain

)

select * from scored
```

### Companion YAML

```yaml
# models/activation/salesforce/_salesforce__models.yml
models:
  - name: act_salesforce__lead_scores
    description: "Lead enrichment sync to Salesforce. Synced hourly by Census. Do not add columns without Revenue Ops approval."
    config:
      meta:
        sync_to: salesforce
        sync_object: Lead
        sync_frequency: hourly
        sync_identifier: email
    columns:
      - name: email
        description: "Upsert key — never null."
        data_tests: [not_null, unique]
      - name: lead_score
        description: "0–100 propensity score."
        data_tests:
          - not_null
          - dbt_utils.accepted_range: {min_value: 0, max_value: 100}
```

## Census Setup

### Warehouse Connection

**Snowflake:**
```yaml
# Census warehouse connection (configured in Census UI or via API)
connection:
  type: snowflake
  account: your-account.snowflakecomputing.com
  database: ANALYTICS
  schema: ACTIVATION          # Point Census at the activation schema only
  warehouse: CENSUS_WH        # Dedicated XS warehouse; auto-suspend after 60s
  role: CENSUS_ROLE           # Least-privilege role — SELECT on activation only
  username: census_service
  # Password or key-pair stored in Census secrets vault
```

Snowflake role setup (least-privilege):
```sql
create role census_role;
grant usage on database analytics to role census_role;
grant usage on schema analytics.activation to role census_role;
grant select on all tables in schema analytics.activation to role census_role;
grant select on future tables in schema analytics.activation to role census_role;

create warehouse census_wh warehouse_size='x-small' auto_suspend=60 auto_resume=true initially_suspended=true;
grant usage on warehouse census_wh to role census_role;

create user census_service default_warehouse=census_wh default_role=census_role;
grant role census_role to user census_service;
```

**BigQuery:**
```yaml
connection:
  type: bigquery
  project: your-gcp-project
  dataset: activation           # Census only reads from this dataset
  # Service account JSON key uploaded to Census
  # Minimum permissions: bigquery.dataViewer on activation dataset only
```

BigQuery IAM:
```bash
# Grant Census service account read-only access to activation dataset only
bq add-iam-policy-binding \
  --member="serviceAccount:census@your-project.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer" \
  your-project:activation
```

### Defining a Sync in Census

1. **Source**: Select "dbt Model" and point to `act_salesforce__lead_scores`
2. **Destination**: Select "Salesforce" → object type "Lead"
3. **Identifier mapping**: Map `email` (warehouse) → `Email` (Salesforce Lead field). Set as "Upsert on" identifier.
4. **Field mappings** (warehouse column → Salesforce API field name):

```
email                     → Email                    [upsert key]
lead_score                → Lead_Score__c
wh_sessions_last_30d      → WH_Sessions_Last_30D__c
wh_feature_events_last_30d→ WH_Feature_Events_30D__c
wh_last_active_at         → WH_Last_Active_At__c
wh_industry               → WH_Industry__c
wh_employee_count         → WH_Employee_Count__c
wh_scored_at              → WH_Scored_At__c
```

5. **Sync schedule**: Hourly (`0 * * * *`). Match your dbt run cadence — sync must run after dbt completes.
6. **Sync behavior**: Upsert (update if exists, skip if unchanged). Never use "mirror" mode unless you understand it will delete Salesforce records not in the warehouse.

## Hightouch Setup

### Model Source Configuration

```yaml
# Hightouch model config (UI or Terraform provider)
model:
  name: act_salesforce__lead_scores
  type: dbt_model              # Use dbt model reference, not raw SQL
  dbt_model_name: act_salesforce__lead_scores
  warehouse: snowflake_prod    # Hightouch warehouse connection name
  primary_key: email           # Column that uniquely identifies each row
```

### Destination Setup

```yaml
destination:
  name: salesforce_prod
  type: salesforce
  credentials:
    instance_url: https://yourorg.salesforce.com
    # OAuth flow completed in Hightouch UI; credentials stored encrypted
```

### Sync Configuration

```yaml
sync:
  name: lead_scores_to_salesforce
  model: act_salesforce__lead_scores
  destination: salesforce_prod
  destination_object: Lead
  mode: upsert                 # update existing, insert new
  schedule:
    type: cron
    cron: "30 * * * *"         # 30 min after the hour, allowing dbt to finish

  identity_resolution:
    source_field: email
    destination_field: Email

  field_mappings:
    - source: lead_score
      destination: Lead_Score__c
    - source: wh_sessions_last_30d
      destination: WH_Sessions_Last_30D__c
    - source: wh_feature_events_last_30d
      destination: WH_Feature_Events_30D__c
    - source: wh_last_active_at
      destination: WH_Last_Active_At__c
    - source: wh_industry
      destination: WH_Industry__c
    - source: wh_scored_at
      destination: WH_Scored_At__c
```

### Field Mapping Notes

- Always prefix warehouse-derived fields in Salesforce with `WH_` to distinguish them from fields maintained by the CRM team.
- Custom Salesforce fields require the `__c` suffix.
- Coordinate with the Salesforce Admin before creating custom fields — they control schema.

## Handling PII

**This is the highest-risk area of reverse ETL.** You are moving data into third-party SaaS vendors who may use it for their own model training, store it indefinitely, or expose it in ways your privacy policy does not cover.

### What Must Never Flow Into SaaS Tools

- Raw email addresses of users who have not opted in to marketing communications
- Phone numbers beyond what the destination already holds
- Health, financial, or government-ID data under any circumstances
- Behavioral data tied to users in jurisdictions with GDPR / CCPA deletion rights, unless you have a deletion propagation strategy for the destination
- Data from internal employees (HR data, Slack signals, etc.)

### Allowlist Fields Explicitly

Activation models are the enforcement point. Only select fields you have explicitly approved for external transmission:

```sql
-- CORRECT: explicit allowlist
select
    email,          -- collected with marketing consent
    lead_score,     -- computed aggregate, not raw event data
    wh_industry     -- firmographic (not personal data)
from scored

-- WRONG: never do this in an activation model
select * from {{ ref('dim_leads') }}
```

Add a dbt-meta tag to document the legal basis for each synced field:

```yaml
columns:
  - name: email
    meta:
      pii_level: 1
      legal_basis: "Marketing consent collected at signup"
      sync_approved_by: "privacy-team@company.com"
      sync_approved_date: "2025-01-15"
```

### Deletion Propagation

If you sync PII to a third-party tool and receive a GDPR erasure request, you must delete from the destination too. Deletion runbook: (1) delete from raw source, (2) `dbt run --full-refresh` on activation models, (3) trigger Census/Hightouch sync to propagate the deletion, (4) confirm deletion from the destination system, (5) log completion in the erasure ticket.

## Monitoring Syncs

### What to Alert On

| Signal | Threshold | Severity |
|---|---|---|
| Sync failed (any reason) | Any failure | Critical — page on-call |
| Records synced = 0 | When previous run > 0 | High — Slack alert |
| Records synced dropped > 20% | vs. 7-day median | High — Slack alert |
| Records synced increased > 200% | vs. 7-day median | Medium — investigate |
| Field mapping error | Any | High — Slack alert |
| Sync duration > 2x median | Sustained for 2 runs | Medium |
| dbt model row count = 0 | Any activation model | Critical |

### dbt Test for Row Count Safety

Add Elementary volume anomaly tests to every activation model:

```yaml
data_tests:
  - elementary.volume_anomalies:
      timestamp_column: wh_scored_at
      time_bucket: {period: hour, count: 1}
      sensitivity: 2
```

### Census / Hightouch Webhook Alerts

Both tools support outbound webhooks on sync failure. Route these to PagerDuty or Slack. You can also poll the Census API from Airflow or a Lambda:

```python
import requests

def check_census_sync(sync_id: str, api_key: str) -> dict:
    r = requests.get(
        f"https://bearer.census.app/api/v1/syncs/{sync_id}/sync_runs",
        headers={"Authorization": f"Bearer {api_key}"},
        params={"order": "desc", "limit": 1}
    )
    run = r.json()["data"][0]
    if run["status"] != "completed":
        raise ValueError(f"Sync {sync_id} failed: {run['error_message']}")
    if run["records_processed"] == 0:
        raise ValueError(f"Sync {sync_id} processed 0 records")
    return run
```

## Governance

### Who Approves New Syncs

Every new sync must go through a lightweight approval gate before being turned on in production. Use a pull request checklist:

```markdown
## Reverse ETL Sync PR Checklist

**Activation model:**
- [ ] Model is in `models/activation/` and follows naming convention `act_<destination>__<object>.sql`
- [ ] `meta` block documents sync_to, sync_object, sync_frequency, owner, approved_by
- [ ] Only explicitly allowlisted columns selected — no `select *`
- [ ] Natural key column is NOT NULL tested
- [ ] Row count anomaly test added

**PII review:**
- [ ] Privacy team sign-off if any PII is being synced (@privacy-team)
- [ ] Legal basis documented in YAML meta for each PII field
- [ ] Deletion propagation documented in runbook

**Destination review:**
- [ ] Salesforce/HubSpot Admin confirmed custom fields exist (@sfdc-admin)
- [ ] Field naming convention followed (WH_ prefix for warehouse-sourced fields)
- [ ] No fields conflict with fields maintained by the CRM team

**Operational:**
- [ ] Sync schedule confirmed with data engineering (runs after dbt)
- [ ] Alerting webhook configured in PagerDuty/Slack
- [ ] Rollback plan documented (how to turn off sync if something goes wrong)
```

### Change Management

- **Removing a field from an activation model** requires coordination with the destination system owner. Removing a mapped field will cause the sync to fail or leave stale data.
- **Renaming a column** in an activation model requires updating the Census/Hightouch field mapping in the same PR/deploy.
- **Schema changes in dbt** that affect activation models should be flagged to the Revenue Ops and Marketing Ops owners of those syncs before merging.
- Treat the `activation/` layer as a **public API contract**. Downstream consumers (CRM admins, marketing ops) depend on column names not changing without notice.

### Audit Log

Both Census and Hightouch expose sync run history via API. Ingest these logs into your warehouse after each run and retain for 12 months minimum (7 years if syncing financially regulated data):

```sql
create table ops.reverse_etl_sync_log (
    sync_id            varchar,
    tool               varchar,    -- 'census' | 'hightouch'
    sync_name          varchar,
    destination        varchar,
    destination_object varchar,
    run_started_at     timestamp,
    run_completed_at   timestamp,
    status             varchar,    -- 'completed' | 'failed' | 'partial'
    records_processed  integer,
    records_updated    integer,
    records_inserted   integer,
    records_errored    integer,
    error_message      varchar,
    ingested_at        timestamp default current_timestamp()
);
```

---

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

Run these commands after building activation models and configuring syncs:

```bash
# Compile all activation models to catch SQL errors before syncing
dbt compile --select tag:activation

# Run data tests — especially not_null and unique on the upsert key column
dbt test --select tag:activation

# Build all activation models to confirm they materialize without errors
dbt run --select tag:activation

# Confirm the upsert key (email) is never null in the lead scores model
dbt test --select act_salesforce__lead_scores
```

## If Something Goes Wrong

- **Sync creates duplicate records in Salesforce**: The upsert key column (`email`) is NULL for some rows, or the field mapped in Census/Hightouch does not match the Salesforce external ID field exactly. Confirm the `not_null` and `unique` dbt tests pass on the upsert key before enabling the sync.
- **Census or Hightouch reports 0 records synced**: The activation model built successfully but returned 0 rows. Check that the upstream `dim_leads` or `fct_product_events` models are populated and that the `where email is not null` filter is not too restrictive. Add an Elementary volume anomaly test to catch this automatically.
- **Field mapping errors on sync run**: A column was renamed or dropped in the dbt activation model without updating the Census/Hightouch field mapping. Schema changes in activation models must be coordinated with sync configuration updates in the same deploy.
- **Sync runs before dbt finishes**: The sync schedule is set to run at the same time as (or before) the dbt run completes. Add a 30-minute buffer: if dbt runs at `0 * * * *`, schedule the sync at `30 * * * *`. Alternatively, trigger the sync from your orchestrator (Airflow/Dagster) as a downstream task of the dbt run.
- **PII flowing to Salesforce without consent**: An `act_` model is selecting `*` from a mart instead of an explicit column allowlist. Immediately pause the sync, audit which fields were transmitted, notify the privacy team, and restrict the model to only approved columns.
