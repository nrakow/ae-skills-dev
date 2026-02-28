# Fivetran Integration Guide

## Metadata Columns

Fivetran adds these to every synced table:

| Column | Type | Description |
|--------|------|-------------|
| `_fivetran_synced` | TIMESTAMP | When Fivetran last synced this row (UTC) |
| `_fivetran_deleted` | BOOLEAN | Soft-delete flag (true = deleted in source) |
| `_fivetran_id` | VARCHAR | Fivetran's internal row ID |

### Staging pattern
```sql
with source as (
    select * from {{ source('salesforce', 'account') }}
    -- Exclude Fivetran soft-deleted rows
    where not coalesce(_fivetran_deleted, false)
),
```

### Source freshness
```yaml
sources:
  - name: salesforce
    loaded_at_field: _fivetran_synced
    freshness:
      warn_after: {count: 24, period: hour}
      error_after: {count: 48, period: hour}
```

## Terraform Configuration

```hcl
resource "fivetran_connector" "salesforce" {
  group_id     = var.fivetran_group_id
  service      = "salesforce"
  sync_frequency   = 360       # minutes (360 = 6 hours)
  paused           = false
  pause_after_trial = false
  trust_certificates = true

  config {
    schema   = "salesforce"
    username = var.salesforce_username
    password = var.salesforce_password
    is_sandbox = false
  }
}

resource "fivetran_destination" "snowflake" {
  group_id    = var.fivetran_group_id
  service     = "snowflake"
  region      = "GCP_US_EAST4"
  time_zone_offset = "0"

  config {
    host     = var.snowflake_host
    database = "RAW"
    user     = var.fivetran_snowflake_user
    password = var.fivetran_snowflake_password
    port     = 443
    auth     = "PASSWORD"
  }
}
```

## Common Connectors and Their Schema

### Salesforce
- Tables: `account`, `contact`, `opportunity`, `lead`, `user`, `task`
- Soft deletes: `is_deleted` column (Salesforce native)
- Schema prefix: configurable (default: `salesforce`)

### Stripe
- Tables: `charge`, `customer`, `invoice`, `invoice_line_item`, `subscription`, `payment_intent`
- Amounts in cents — divide by 100 in staging
- Timestamps as Unix epoch integers — use `to_timestamp()` in Snowflake

### Shopify
- Tables: `order`, `order_line`, `product`, `product_variant`, `customer`, `refund`
- Prices as strings in some versions — cast to FLOAT

### Google Ads
- Tables: `campaign`, `ad_group`, `ad_group_ad`, `keyword`, `campaign_performance_report`
- Date-based reporting tables: one row per date per entity

## Sync Scheduling Guidelines

| Source type | Frequency | Notes |
|-------------|-----------|-------|
| CRM (Salesforce) | Every 6h | Rarely changes minute-to-minute |
| Payments (Stripe) | Every 1h | Revenue-critical; more frequent |
| Ecommerce (Shopify) | Every 6h | Matches order review cadence |
| Ads (Google/Facebook) | Every 24h | Data often delayed 3h anyway |
| Support (Zendesk) | Every 6h | Ticket volume not real-time |

## Monitoring

```python
# Check sync status via Fivetran API
import requests

response = requests.get(
    f"https://api.fivetran.com/v1/connectors/{connector_id}",
    auth=(api_key, api_secret)
)
data = response.json()["data"]
print(f"Status: {data['status']['sync_state']}")
print(f"Last sync: {data['succeeded_at']}")
print(f"Next sync: {data['scheduled_for']}")
```
