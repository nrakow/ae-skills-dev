---
name: pii-handling
description: "Identify, classify, and protect PII in accordance with GDPR, CCPA, and HIPAA. Use when auditing data for PII exposure, implementing data masking, setting up retention policies, handling data deletion requests, or preparing for a compliance audit. Triggers: 'PII', 'GDPR', 'CCPA', 'HIPAA', 'data privacy', 'personal data', 'mask PII', 'data deletion', 'right to erasure', 'compliance'."
---

# PII Handling

I'll help you identify, classify, and protect personal data in your analytics stack in compliance with GDPR, CCPA, and HIPAA.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: compliance requirements (GDPR/CCPA/HIPAA), warehouse type, current PII controls.

## PII Classification Levels

| Level | Examples | Required protection |
|-------|---------|-------------------|
| **Level 1 — Direct identifiers** | Name, email, SSN, passport, credit card | Hash or pseudonymize; never in non-prod |
| **Level 2 — Quasi-identifiers** | Date of birth, zip code, gender, occupation | Suppress or generalize |
| **Level 3 — Sensitive categories** | Health data, religion, political views, biometrics | Strongest protection; explicit consent required |
| **Level 4 — Non-personal** | Aggregated counts, anonymized behavior | No special protection needed |

---

## Step 1: PII Discovery

### Automated Discovery in Snowflake

```sql
-- Snowflake: find columns with PII-suggestive names
SELECT
    table_schema,
    table_name,
    column_name,
    data_type,
    -- PII risk score based on column name
    CASE
        WHEN LOWER(column_name) REGEXP '(email|e_mail|email_address)' THEN 'High: Email'
        WHEN LOWER(column_name) REGEXP '(phone|mobile|cell|telephone)' THEN 'High: Phone'
        WHEN LOWER(column_name) REGEXP '(ssn|social_security|national_id|passport)' THEN 'Critical: Government ID'
        WHEN LOWER(column_name) REGEXP '(credit_card|card_number|cvv|ccn)' THEN 'Critical: Payment'
        WHEN LOWER(column_name) REGEXP '(name|full_name|first_name|last_name)' THEN 'Medium: Name'
        WHEN LOWER(column_name) REGEXP '(address|street|city|zip|postal)' THEN 'Medium: Address'
        WHEN LOWER(column_name) REGEXP '(dob|birth_date|date_of_birth|birthdate)' THEN 'High: DOB'
        WHEN LOWER(column_name) REGEXP '(ip_address|ip_addr|ipv4|ipv6)' THEN 'Medium: IP Address'
        WHEN LOWER(column_name) REGEXP '(latitude|longitude|lat|lng|geo)' THEN 'Medium: Location'
        ELSE NULL
    END as pii_risk
FROM information_schema.columns
WHERE table_schema NOT IN ('INFORMATION_SCHEMA', 'ACCOUNT_USAGE')
  AND CASE
        WHEN LOWER(column_name) REGEXP '(email|phone|ssn|credit|name|address|dob|ip_|birth|lat|lng|passport|national_id)' THEN TRUE
        ELSE FALSE
      END
ORDER BY table_schema, table_name;
```

### dbt Column-Level Tags for PII

```yaml
# models/staging/salesforce/_salesforce__models.yml
models:
  - name: stg_salesforce__accounts
    columns:
      - name: email
        description: "Customer email address (PII — Level 1)"
        tags: ["pii", "pii_email"]
        meta:
          pii_level: 1
          pii_category: direct_identifier
          retention_period: "7 years"

      - name: phone
        description: "Phone number (PII — Level 1)"
        tags: ["pii", "pii_phone"]
        meta:
          pii_level: 1

      - name: billing_zip
        description: "Billing postal code (PII — Level 2)"
        tags: ["pii", "pii_quasi"]
        meta:
          pii_level: 2
```

---

## Step 2: PII Protection Techniques

### Pseudonymization (Reversible — Recommended for Analytics)

Replace identifiers with a pseudonym that can be reversed with a secret key.

```sql
-- Snowflake: HMAC-SHA256 pseudonymization
-- Use a secret key stored in a Snowflake secret (not hardcoded)

CREATE OR REPLACE FUNCTION pseudonymize_email(email VARCHAR, secret VARCHAR)
RETURNS VARCHAR
AS $$
    -- sha2_hex is available in all Snowflake editions
    -- For true HMAC: SYSTEM$HMAC_SHA256(secret, email) requires Enterprise edition
    SELECT sha2_hex(concat(email, secret), 256)
$$;

-- In staging model: replace email with pseudonym
SELECT
    pseudonymize_email(email, $PSEUDONYMIZATION_SECRET) as email_pseudonym,
    -- Keep domain for analytics purposes (not PII)
    split_part(email, '@', 2) as email_domain,
    customer_id,
    created_at
FROM {{ source('crm', 'customers') }}
```

### Masking in dbt (Non-Reversible)

```sql
-- macros/mask_pii.sql
{% macro mask_email(column_name) %}
    CASE
        WHEN {{ column_name }} IS NULL THEN NULL
        ELSE CONCAT(
            REPEAT('*', LENGTH(SPLIT_PART({{ column_name }}, '@', 1))),
            '@',
            SPLIT_PART({{ column_name }}, '@', 2)
        )
    END
{% endmacro %}

{% macro mask_phone(column_name) %}
    CASE
        WHEN {{ column_name }} IS NULL THEN NULL
        ELSE CONCAT('***-***-', RIGHT(REGEXP_REPLACE({{ column_name }}, '[^0-9]', ''), 4))
    END
{% endmacro %}

{% macro generalize_dob(column_name) %}
    DATE_TRUNC('year', {{ column_name }})  -- Keep year only (not exact DOB)
{% endmacro %}
```

```sql
-- models/staging/stg_customers.sql
SELECT
    customer_id,
    -- In non-prod: mask PII; in prod: keep for authorized roles
    {% if target.name == 'prod' %}
        email,
        phone,
        date_of_birth
    {% else %}
        {{ mask_email('email') }} as email,
        {{ mask_phone('phone') }} as phone,
        {{ generalize_dob('date_of_birth') }} as date_of_birth
    {% endif %}
FROM {{ source('crm', 'customers') }}
```

---

## Synthetic Data for Non-Production Environments

Never copy production PII into dev/staging. Use synthetic data that mirrors the shape and distribution of real data without containing actual personal information.

### Python (Faker library)

```python
# scripts/generate_synthetic_customers.py
from faker import Faker
import csv

fake = Faker()
Faker.seed(42)  # Reproducible seed

with open('seeds/synthetic_customers.csv', 'w') as f:
    writer = csv.writer(f)
    writer.writerow(['customer_id', 'email', 'phone', 'date_of_birth', 'zip_code'])
    for i in range(10000):
        writer.writerow([
            f'cust_{i:06d}',
            fake.email(),
            fake.phone_number(),
            fake.date_of_birth(minimum_age=18, maximum_age=90).isoformat(),
            fake.zipcode()
        ])
```

### Snowflake (built-in randomization)

```sql
-- Generate synthetic customer records in Snowflake
SELECT
    'cust_' || LPAD(seq4()::VARCHAR, 6, '0') as customer_id,
    RANDSTR(8, RANDOM()) || '@' || RANDSTR(6, RANDOM()) || '.com' as email,
    '+1-' || UNIFORM(200, 999, RANDOM())::VARCHAR || '-' ||
             UNIFORM(100, 999, RANDOM())::VARCHAR || '-' ||
             UNIFORM(1000, 9999, RANDOM())::VARCHAR as phone,
    DATEADD(day, -UNIFORM(6570, 29200, RANDOM()), CURRENT_DATE()) as date_of_birth
FROM TABLE(GENERATOR(ROWCOUNT => 10000));
```

### BigQuery

```sql
-- BigQuery synthetic data using GENERATE_UUID and RAND()
SELECT
    CONCAT('cust_', CAST(ROW_NUMBER() OVER () AS STRING)) as customer_id,
    CONCAT(
        SUBSTR(TO_HEX(MD5(CAST(RAND() AS STRING))), 1, 8),
        '@example.com'
    ) as email,
    CAST(FLOOR(RAND() * (29200 - 6570) + 6570) AS INT64) as age_days
FROM UNNEST(GENERATE_ARRAY(1, 10000)) AS n
```

**Best practice**: seed synthetic data as a dbt seed (`seeds/`) in dev/staging only. Never commit seeds with real PII.

---

## Warehouse-Native Dynamic Masking (Upgrade Path)

For production environments, prefer warehouse-native masking policies over Jinja `{% if target.name %}` conditionals. Native masking enforces access control at the query layer — even direct warehouse connections are masked.

### Snowflake Dynamic Data Masking

```sql
-- 1. Create a masking policy
CREATE OR REPLACE MASKING POLICY mask_email AS (val STRING) RETURNS STRING ->
    CASE
        WHEN CURRENT_ROLE() IN ('ANALYST', 'BI_ROLE') THEN val
        ELSE CONCAT(REPEAT('*', LENGTH(SPLIT_PART(val, '@', 1))), '@', SPLIT_PART(val, '@', 2))
    END;

-- 2. Apply to column
ALTER TABLE analytics.staging.stg_customers
    MODIFY COLUMN email SET MASKING POLICY mask_email;

-- 3. In dbt — apply via post_hook
{{ config(
    post_hook=[
        "alter table {{ this }} modify column email set masking policy analytics.mask_email"
    ]
) }}
```

### BigQuery Policy Tags (Column-Level Security)

```sql
-- Assign a policy tag to a column (via BigQuery Data Catalog)
-- 1. Create a taxonomy and policy tag in the console or via API
-- 2. In dbt YAML, annotate columns (documentation only — enforcement via IAM):
columns:
  - name: email
    description: "Customer email — protected by PII policy tag"
    meta:
      bigquery_policy_tag: "projects/my-project/locations/us/taxonomies/123/policyTags/456"
```

For BigQuery, enforcement is applied via Column-Level Security in the BigQuery console; the `meta` field above serves as documentation.

---

## GDPR Compliance

### Data Subject Access Request (DSAR) — Right of Access

```sql
-- Return all data for a specific customer (for DSAR fulfillment)
-- Run by Data Protection Officer or automated via API

CREATE PROCEDURE fulfill_dsar(customer_email VARCHAR)
RETURNS TABLE(table_name VARCHAR, record_data VARIANT)
AS $$
BEGIN
    RETURN TABLE (
        SELECT 'orders' as table_name, object_construct(*) as record_data
        FROM fct_orders WHERE customer_email = :customer_email
        UNION ALL
        SELECT 'sessions', object_construct(*)
        FROM fct_sessions WHERE customer_email = :customer_email
        -- Add all tables containing customer data
    );
END;
$$;
```

### Right to Erasure (RTBE) — Data Deletion

```sql
-- Hard delete: actually remove the data
-- Use this for permanent deletion requests

DELETE FROM raw.salesforce.contact WHERE email = :customer_email;
DELETE FROM raw.stripe.customer WHERE email = :customer_email;

-- Then run dbt full-refresh to propagate deletion through transformed layers:
-- dbt run --full-refresh --select "tag:pii"

-- Alternative: Soft-delete with pseudonymization
-- Replace PII with a hash, keep record structure for analytics
UPDATE analytics.marts.dim_customers
SET
    email = concat('deleted_', customer_id),  -- Irreversible pseudonym
    full_name = 'Deleted User',
    phone = NULL,
    date_of_birth = NULL,
    address = NULL,
    is_deleted = TRUE,
    deleted_at = CURRENT_TIMESTAMP()
WHERE customer_id = :customer_id;
```

### Data Retention Policy

```sql
-- Implement retention in dbt via incremental model
-- models/marts/core/fct_orders.sql

{{ config(materialized='incremental', unique_key='order_id') }}

SELECT * FROM {{ ref('stg_orders') }}

{% if is_incremental() %}
WHERE created_at >= current_date - interval '7 years'  -- 7-year financial retention
{% endif %}
```

```yaml
# Document retention in dbt metadata
models:
  - name: fct_orders
    meta:
      retention_period: "7 years"
      deletion_policy: "Soft-delete on RTBE request; hard delete after retention period"
      legal_basis: "Contract fulfillment + legitimate interest"
```

---

## HIPAA Compliance (PHI)

```sql
-- Protected Health Information (PHI) requires additional controls
-- 18 HIPAA identifiers that must be de-identified:
-- name, geographic data, dates (except year), phone, fax, email, SSN,
-- medical record numbers, health plan numbers, account numbers,
-- certificate/license numbers, URLs, IP addresses, biometrics, photos

-- De-identification: Safe Harbor method
-- Remove all 18 identifiers OR use statistical methods (Expert Determination)

-- Snowflake: tag PHI columns and apply masking
CREATE TAG phi_data COMMENT = 'Protected Health Information — HIPAA';

ALTER TABLE clinical_data.patients
    MODIFY COLUMN patient_name SET TAG phi_data = 'direct_identifier';

-- Apply masking policy to all PHI columns
ALTER TABLE clinical_data.patients
    MODIFY COLUMN patient_name SET MASKING POLICY mask_phi_name;
```

---

## PII Audit Checklist

**Before going to production:**
- [ ] PII discovery scan run on all schemas
- [ ] All PII columns tagged in dbt YAML
- [ ] Masking policies applied for non-prod environments
- [ ] Column-level access control applied for prod
- [ ] Data retention periods documented
- [ ] DSAR fulfillment procedure tested
- [ ] Deletion procedure tested end-to-end (raw → mart)
- [ ] Non-prod data confirmed to use masked/synthetic data
- [ ] Audit log enabled for all PII table access
- [ ] Privacy policy updated to reflect actual data usage
