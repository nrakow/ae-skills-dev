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
    SELECT encode(hmac(email::bytea, secret::bytea, 'sha256'), 'hex')
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
