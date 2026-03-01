---
name: entity-resolution
description: "Deduplicate and resolve entity identity across sources. Use when the same customer appears in multiple systems with different IDs, merging user records from CRM and product database, or building a unified customer identity. Triggers: 'entity resolution', 'deduplication', 'identity stitching', 'merge customer records', 'cross-source customer matching', 'fuzzy matching', 'golden record'."
triggers:
  - "entity resolution"
  - "deduplication"
  - "match records"
  - "merge customers"
  - "identity graph"
  - "customer 360"
  - "golden record"
reads_first:
  - data-stack-context
  - staging-layer
cli_tools:
  - schema-introspect.js
  - model-stats.js
produces:
  - "entity resolution SQL"
  - "schema.yml"
validates_with:
  - "dbt compile"
  - "dbt test --select"
---

# Entity Resolution

I'll help you identify and merge duplicate or fragmented records across sources to build a unified entity identity (golden record).

## Before You Start

Run these to understand what identifier columns are available and estimate match complexity before choosing a strategy:

```bash
node tools/clis/schema-introspect.js        # identify email, phone, external ID columns
node tools/clis/model-stats.js --manifest target/manifest.json  # check table cardinalities
```

High cardinality (>10M rows) rules out naive cross-join fuzzy matching — use a blocking key or an external tool like Splink instead.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: source systems, identity attributes available, warehouse type.

## The Entity Resolution Problem

```
Salesforce:   customer_id=SF-001, email=jane@acme.com, name="Jane Smith"
Stripe:       customer_id=cus_xyz, email=jane@acme.com, card_name="J. Smith"
Product DB:   user_id=42, email=jane+signup@acme.com, name="Jane Smith"
Zendesk:      contact_id=ZD-789, email=jane@acme.com, company="ACME Corp"
```

Goal: recognize all four as the same person and assign a stable `entity_id`.

## Resolution Strategy Selection

| Situation | Recommended approach |
|-----------|---------------------|
| Shared email or phone across all systems | Deterministic: exact match on email/phone |
| Some shared IDs, some gaps | Deterministic: chained ID matching |
| Names + company match needed | Fuzzy: Jaro-Winkler or token sort ratio |
| High precision required (legal/finance) | Human review queue + ML scoring |
| Scale > 100M entities | Purpose-built tool (Zingg, Splink, or vendor) |

---

## Pattern 1: Deterministic — Exact Match on Email

```sql
-- int_entity_resolution__email_spine.sql
-- Assigns a cluster_id to all records sharing an email address

with all_emails as (

    -- Collect email + source_id from every system
    select
        'salesforce' as source_system,
        account_id as source_id,
        lower(trim(email)) as normalized_email
    from {{ ref('stg_salesforce__accounts') }}
    where email is not null

    union all

    select
        'stripe',
        customer_id,
        lower(trim(email))
    from {{ ref('stg_stripe__customers') }}
    where email is not null

    union all

    select
        'product',
        user_id,
        lower(trim(email))
    from {{ ref('stg_product__users') }}
    where email is not null

),

-- Generate a stable cluster_id for each unique email
email_clusters as (

    select
        normalized_email,
        -- Use the earliest source_id for stability
        min(source_id) over (partition by normalized_email) as cluster_id,
        source_system,
        source_id

    from all_emails

)

select * from email_clusters
```

---

## Pattern 2: Chained Identity Graph

Handles indirect connections: A shares email with B, B shares phone with C → A, B, C are same entity.

```sql
-- int_entity_resolution__identity_graph.sql
-- Build an identity graph using transitivity

with edges as (

    -- Edge: same email
    select
        a.source_system || ':' || a.source_id as node_a,
        b.source_system || ':' || b.source_id as node_b,
        'email' as match_type,
        1.0 as confidence

    from {{ ref('stg_all_entities') }} a
    join {{ ref('stg_all_entities') }} b
        on lower(a.email) = lower(b.email)
        and a.source_system != b.source_system

    union all

    -- Edge: same phone
    select
        a.source_system || ':' || a.source_id,
        b.source_system || ':' || b.source_id,
        'phone',
        0.95

    from {{ ref('stg_all_entities') }} a
    join {{ ref('stg_all_entities') }} b
        on regexp_replace(a.phone, '[^0-9]', '') =
           regexp_replace(b.phone, '[^0-9]', '')
        and a.source_system != b.source_system
        and a.phone is not null

),

-- Assign cluster_id using connected components
-- Snowflake: use graph traversal UDF or recursive CTE
-- For large graphs, use Splink or run in Python/Spark

nodes_with_cluster as (

    -- Simplified: use min(node) as cluster representative
    select
        node_a as node,
        min(least(node_a, node_b)) over (
            partition by greatest(node_a, node_b)
        ) as cluster_id
    from edges

    union all

    select
        node_b,
        min(least(node_a, node_b)) over (
            partition by greatest(node_a, node_b)
        )
    from edges

)

select
    node,
    -- Stable cluster_id = smallest node_id in the connected component
    min(cluster_id) as entity_id

from nodes_with_cluster
group by 1
```

---

## Pattern 3: Fuzzy Name Matching

Use when email isn't available. Warehouse-native approximate string matching:

### Snowflake — Jaro-Winkler

```sql
-- Snowflake has built-in Jaro-Winkler similarity (0.0 to 1.0)
select
    a.customer_id as id_a,
    b.customer_id as id_b,
    a.customer_name as name_a,
    b.customer_name as name_b,
    jarowinkler_similarity(a.customer_name, b.customer_name) as name_similarity

from {{ ref('stg_crm__customers') }} a
cross join {{ ref('stg_crm__customers') }} b
where
    a.customer_id < b.customer_id  -- deduplicate pairs
    and jarowinkler_similarity(a.customer_name, b.customer_name) >= 0.92
    and a.company_domain = b.company_domain  -- blocking key (required for performance)
```

### BigQuery — SOUNDEX + edit distance

```sql
select
    a.customer_id as id_a,
    b.customer_id as id_b,
    edit_distance(a.normalized_name, b.normalized_name) as name_distance

from customers a
cross join customers b
where
    a.customer_id < b.customer_id
    and soundex(a.normalized_name) = soundex(b.normalized_name)  -- blocking
    and edit_distance(a.normalized_name, b.normalized_name) <= 2
```

---

## Building the Golden Record

After resolving entity clusters, build the canonical record:

```sql
-- dim_customers_golden.sql
-- One row per resolved entity, picking "best" attribute values

with clusters as (
    select * from {{ ref('int_entity_resolution__clusters') }}
),

-- Rank sources by data quality/recency per attribute
ranked_emails as (

    select
        entity_id,
        email,
        row_number() over (
            partition by entity_id
            order by
                -- Prefer corporate email over alias
                (email like '%+%') asc,
                -- Prefer most recently updated source
                updated_at desc
        ) as rn
    from clusters
    where email is not null

),

-- Build golden record: pick best value per field
golden as (

    select
        c.entity_id,
        e.email as canonical_email,
        -- Collect all source IDs for cross-system lookups
        array_agg(distinct c.source_system || ':' || c.source_id)
            as source_ids,
        -- Count of merged records (data quality signal)
        count(distinct c.source_id) as merged_record_count,
        min(c.first_seen_at) as first_seen_at,
        max(c.last_seen_at) as last_seen_at

    from clusters c
    left join ranked_emails e
        on c.entity_id = e.entity_id
        and e.rn = 1

    group by c.entity_id, e.email

)

select * from golden
```

## Confidence Scoring

When matches aren't certain, expose a confidence score for human review:

```sql
select
    match_id,
    entity_id_a,
    entity_id_b,
    -- Weighted confidence score
    (
        case when email_match then 0.6 else 0 end +
        case when phone_match then 0.25 else 0 end +
        case when name_similarity >= 0.9 then 0.1 else 0 end +
        case when company_match then 0.05 else 0 end
    ) as confidence_score,
    case
        when confidence_score >= 0.85 then 'auto_merge'
        when confidence_score >= 0.6 then 'review_needed'
        else 'no_match'
    end as resolution_action

from match_candidates
```

## Maintaining Stable Entity IDs

**Critical**: entity IDs must be stable across reruns.

```sql
-- Use the earliest-seen node as the canonical ID
-- Don't use row_number() — it changes as new data arrives
-- Don't use auto-increment IDs — they shift on rebuild

-- Stable pattern:
entity_id = min(source_id) over (partition by cluster_id)

-- Or: generate a UUIDv5 from deterministic input
entity_id = {{ dbt_utils.generate_surrogate_key(['canonical_email']) }}
```

## Tools for Large-Scale Deduplication

For > 10M entity pairs, SQL cross joins become impractical:

| Tool | Type | Notes |
|------|------|-------|
| **Splink** | Python/DuckDB/Spark | Probabilistic; open source; excellent docs |
| **Zingg** | Spark | ML-based; works on Databricks |
| **Dedupe.io** | Python library | Supervised ML; requires training data |
| **Snowflake Entity Resolution** | Managed service | Native to Snowflake; GA 2024 |
| **BigQuery Entity Reconciliation** | Managed service | Requires Knowledge Graph API |

## Verify Your Work

After building the resolved entity model, validate uniqueness of the resolved entity ID and spot-check matched records:

```bash
dbt compile
dbt test --select <entity_model>
```

The `unique` and `not_null` tests on `entity_id` confirm the golden record has no duplicates. Then run a sample query to manually review 20-50 merged record pairs and confirm the match logic is correct before relying on it downstream.

## If Something Goes Wrong

- **Too many false positives** (unrelated records merged): Tighten the match threshold or require 2+ matching signals (e.g., email AND company domain). Adding a blocking key (e.g., same country) reduces spurious cross-cluster merges.
- **Too many false negatives** (same person not matched): Normalize inputs before matching — lowercase email, strip phone formatting, trim whitespace. Consider adding fuzzy name matching as a secondary signal.
- **Performance issues on large tables**: Cross-join fuzzy matching is O(n²) and unworkable above ~1M rows. Partition by a blocking key (email domain, zip code) to reduce the candidate space, or switch to Splink/Zingg for probabilistic matching at scale.
- **Entity IDs change between runs**: The `entity_id` generation is not deterministic. Use `min(source_id)` or `dbt_utils.generate_surrogate_key()` on a stable input — never `row_number()` or auto-increment IDs.
