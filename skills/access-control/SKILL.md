---
name: access-control
description: "Design role-based access control for warehouse and BI layers. Use when setting up data access policies, implementing row-level or column-level security, granting appropriate permissions to analysts and BI tools, or auditing current access controls. Triggers: 'access control', 'data permissions', 'role-based access', 'row-level security', 'column masking', 'grant permissions', 'RBAC', 'data security'."
---

# Access Control

I'll help you design and implement role-based access control (RBAC) for your warehouse and BI layer, with least-privilege principles and audit-ready configurations.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: warehouse type, compliance requirements (GDPR/HIPAA), team structure.

## RBAC Design Principles

1. **Least privilege**: Grant minimum access needed
2. **Role-based, not user-based**: Assign permissions to roles, not individuals
3. **Functional roles**: Align roles with job functions, not departments
4. **Separation of concerns**: Loaders can't read; readers can't load
5. **Audit trail**: Log all access; review quarterly

---

## Role Hierarchy (Recommended)

```
ACCOUNTADMIN (sysadmin only — never used for data access)
    │
SYSADMIN
    │
    ├── LOADER              — write raw tables (Fivetran/Airbyte service account)
    ├── TRANSFORMER         — read raw, write transformed (dbt service account)
    ├── REPORTER            — read marts only (BI tools)
    │
    └── ANALYST_*           — read specific schemas
        ├── ANALYST_FINANCE     — marts/finance schema
        ├── ANALYST_MARKETING   — marts/marketing schema
        └── ANALYST_ALL         — all marts (senior analysts)
```

---

## Snowflake RBAC Setup

```sql
-- Create functional roles
CREATE ROLE LOADER;
CREATE ROLE TRANSFORMER;
CREATE ROLE REPORTER;
CREATE ROLE ANALYST_FINANCE;
CREATE ROLE ANALYST_ALL;

-- Grant role hierarchy (roles can inherit from other roles)
GRANT ROLE REPORTER TO ROLE ANALYST_FINANCE;
GRANT ROLE ANALYST_FINANCE TO ROLE ANALYST_ALL;

-- LOADER: can write to raw database only
GRANT USAGE ON DATABASE RAW TO ROLE LOADER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE RAW TO ROLE LOADER;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN DATABASE RAW TO ROLE LOADER;
GRANT CREATE TABLE ON ALL SCHEMAS IN DATABASE RAW TO ROLE LOADER;

-- TRANSFORMER: read raw, write analytics
GRANT USAGE ON DATABASE RAW TO ROLE TRANSFORMER;
GRANT SELECT ON ALL TABLES IN DATABASE RAW TO ROLE TRANSFORMER;
GRANT FUTURE GRANTS ON TABLES IN DATABASE RAW TO ROLE TRANSFORMER;  -- auto-grant future tables

GRANT USAGE ON DATABASE ANALYTICS TO ROLE TRANSFORMER;
GRANT USAGE, CREATE TABLE, CREATE VIEW ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE TRANSFORMER;
GRANT ALL ON ALL TABLES IN DATABASE ANALYTICS TO ROLE TRANSFORMER;

-- REPORTER: read marts only
GRANT USAGE ON DATABASE ANALYTICS TO ROLE REPORTER;
GRANT USAGE ON SCHEMA ANALYTICS.MARTS TO ROLE REPORTER;
GRANT SELECT ON ALL TABLES IN SCHEMA ANALYTICS.MARTS TO ROLE REPORTER;
GRANT SELECT ON FUTURE TABLES IN SCHEMA ANALYTICS.MARTS TO ROLE REPORTER;

-- Service accounts
CREATE USER FIVETRAN_USER
    PASSWORD = '<generated>'
    DEFAULT_ROLE = LOADER
    DEFAULT_WAREHOUSE = LOADING;
GRANT ROLE LOADER TO USER FIVETRAN_USER;

CREATE USER DBT_USER
    RSA_PUBLIC_KEY = '<public_key>'
    DEFAULT_ROLE = TRANSFORMER
    DEFAULT_WAREHOUSE = TRANSFORMING;
GRANT ROLE TRANSFORMER TO USER DBT_USER;
```

### Column-Level Security (Snowflake)

```sql
-- Create a masking policy for PII
CREATE MASKING POLICY mask_email AS (val VARCHAR) RETURNS VARCHAR ->
    CASE
        WHEN current_role() IN ('ANALYST_ALL', 'TRANSFORMER') THEN val
        ELSE regexp_replace(val, '.+@', '****@')  -- Mask domain but show domain
    END;

-- Apply to a column
ALTER TABLE ANALYTICS.MARTS.DIM_CUSTOMERS
    MODIFY COLUMN email
    SET MASKING POLICY mask_email;

-- For numeric PII:
CREATE MASKING POLICY mask_ssn AS (val VARCHAR) RETURNS VARCHAR ->
    CASE
        WHEN current_role() IN ('ANALYST_FINANCE') THEN val
        ELSE '***-**-' || right(val, 4)  -- Show last 4 only
    END;
```

### Row-Level Security (Snowflake)

```sql
-- Create a row access policy (restrict rows by user attribute)
CREATE ROW ACCESS POLICY region_policy AS (customer_region VARCHAR) RETURNS BOOLEAN ->
    customer_region = current_context()  -- current_context() returns user's region attribute
    OR current_role() IN ('ANALYST_ALL', 'TRANSFORMER');

ALTER TABLE ANALYTICS.MARTS.DIM_CUSTOMERS
    ADD ROW ACCESS POLICY region_policy ON (customer_region);
```

---

## BigQuery IAM Setup

```yaml
# terraform/bigquery_iam.tf

# BI tool service account — read-only on marts
resource "google_bigquery_dataset_iam_member" "reporter" {
  dataset_id = google_bigquery_dataset.marts.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.reporter.email}"
}

# dbt transformer — full access on all datasets
resource "google_bigquery_dataset_iam_member" "transformer" {
  for_each   = toset(["raw", "staging", "marts"])
  dataset_id = google_bigquery_dataset[each.key].dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.transformer.email}"
}

# Analysts — read marts only
resource "google_bigquery_dataset_iam_binding" "analysts" {
  dataset_id = google_bigquery_dataset.marts.dataset_id
  role       = "roles/bigquery.dataViewer"
  members    = [
    "group:analytics-team@company.com",
    "group:finance-team@company.com",
  ]
}
```

### BigQuery Column-Level Security

```sql
-- BigQuery: use policy tags for column masking

-- 1. Create a taxonomy and policy tags in Data Catalog (UI or Terraform)
-- 2. Assign policy tag to columns

ALTER TABLE `analytics.marts.dim_customers`
ALTER COLUMN email SET OPTIONS (
    policy_tags.names = ['projects/my-project/locations/us/taxonomies/123/policyTags/456']
);

-- Grant access to masked data for specific groups
-- IAM: roles/datacatalog.categoryFineGrainedReader on the policy tag
```

---

## BI Tool Access Control

### Looker

```lkml
# In Looker: define access grants
access_grant: finance_data {
  user_attribute: team
  allowed_values: ["finance", "executive", "analytics"]
}

# Apply to sensitive explores or fields
explore: revenue {
  required_access_grants: [finance_data]

  # Or field-level:
  dimension: customer_email {
    type: string
    sql: ${TABLE}.email ;;
    required_access_grants: [pii_access]
    tags: ["pii"]
  }
}
```

### Metabase (Groups + Permissions)

```json
// Metabase permission groups (set via API or UI)
{
  "groups": [
    {
      "name": "Finance Team",
      "permissions": {
        "database_id": 1,
        "schemas": {
          "marts": {
            "tables": {
              "fct_revenue": "all",
              "dim_customers": "no-self-service"  // Read but can't query directly
            }
          }
        }
      }
    }
  ]
}
```

---

## Access Review Process

**Quarterly access audit:**

```sql
-- Snowflake: list all user-to-role grants
SELECT
    grantee_name as user_name,
    role as role_granted,
    granted_on,
    granted_by
FROM snowflake.account_usage.grants_to_users
WHERE deleted_on IS NULL
ORDER BY grantee_name, role;

-- Flag users with overly broad access
SELECT user_name, COUNT(DISTINCT role) as role_count
FROM snowflake.account_usage.grants_to_users
WHERE deleted_on IS NULL
GROUP BY 1
HAVING COUNT(DISTINCT role) > 5  -- Users with > 5 roles are suspects
ORDER BY 2 DESC;
```

**Access review checklist:**
- [ ] All service accounts use key-pair auth (not passwords)
- [ ] No human users granted ACCOUNTADMIN or SYSADMIN
- [ ] Departed employees removed from all roles
- [ ] BI tool service accounts use read-only roles
- [ ] PII columns have masking policies applied
- [ ] Row-level security tested with non-admin user
- [ ] Access log reviewed for anomalies (off-hours bulk exports, etc.)
