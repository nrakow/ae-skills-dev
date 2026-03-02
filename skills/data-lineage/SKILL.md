---
name: data-lineage
description: "Trace and document data lineage across sources, transformations, and reports using dbt's DAG and exposure definitions. Use when investigating data incidents and need to find upstream root causes, performing impact analysis before refactoring a model, documenting column-level lineage, or setting up cross-system lineage tooling. Produces dbt exposure YAML, impact analysis CLI commands, and lineage documentation."
triggers:
  - "trace where this data comes from"
  - "run an impact analysis before changing a model"
  - "set up data lineage"
  - "show me what depends on this model"
  - "document column lineage"
reads_first:
  - data-stack-context
cli_tools: []
produces:
  - "dbt exposures YAML (_exposures.yml)"
  - "dbt column lineage schema.yml annotations"
  - "Impact analysis CLI commands"
validates_with:
  - "dbt ls --select +<model_name>"
  - "dbt ls --select <model_name>+"
  - "dbt docs generate && dbt docs serve"
  - "dbt source freshness"
---

# Data Lineage

I'll help you trace, document, and leverage data lineage — from source systems through transformations to dashboards.

## Before You Start

Read the following files before proceeding:

- `.claude/data-stack-context.md` — dbt project structure, BI tool, and catalog tool (OpenMetadata, Atlan, DataHub, etc.)

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: dbt project structure, BI tool, catalog tool.

## Lineage Levels

| Level | What it shows | Tools |
|-------|--------------|-------|
| **Table lineage** | Which tables feed which tables | dbt `ref()` graph |
| **Column lineage** | Which source columns become which target columns | dbt + OpenLineage, Atlan |
| **Business lineage** | Source system → metric → dashboard | dbt exposures + catalog |
| **Cross-system lineage** | Ingestion → warehouse → BI | OpenLineage, DataHub |

---

## dbt Native Lineage

### Automatic Lineage from `ref()`

dbt builds a DAG from every `ref()` and `source()` call. This is your lineage graph.

```sql
-- Every ref() creates a lineage edge
-- models/marts/core/fct_orders.sql
select
    o.order_id,
    c.customer_name,
    p.product_name
from {{ ref('stg_orders') }} o           -- lineage: stg_orders → fct_orders
join {{ ref('dim_customers') }} c         -- lineage: dim_customers → fct_orders
    on o.customer_id = c.customer_id
join {{ ref('dim_products') }} p          -- lineage: dim_products → fct_orders
    on o.product_id = p.product_id
```

### Explore Lineage via CLI

```bash
# Show all models upstream of fct_orders
dbt ls --select "+fct_orders"
# Output: stg_orders, stg_customers, stg_products, dim_customers, dim_products, fct_orders

# Show all downstream dependents of dim_customers (impact analysis)
dbt ls --select "dim_customers+"
# Output: fct_orders, fct_revenue, fct_customer_lifetime, mart_finance_revenue, ...

# Show direct parents and children
dbt ls --select "1+dim_customers+1"

# Generate visual lineage graph
dbt docs generate && dbt docs serve
# Navigate to model → click "Graph" view
```

### Impact Analysis Before Refactoring

```bash
# "I'm changing stg_stripe__charges — what breaks?"
dbt ls --select "stg_stripe__charges+" --output json \
| python3 -c "
import json, sys
for line in sys.stdin:
    try:
        obj = json.loads(line)
        print(f'{obj[\"resource_type\"]}: {obj[\"name\"]}')
    except:
        pass
"

# Run only affected models after a change
dbt build --select "stg_stripe__charges+"
```

---

## dbt Exposures (End-to-End Lineage)

Connect your dbt models to downstream BI dashboards:

```yaml
# models/marts/_exposures.yml
version: 2

exposures:
  - name: revenue_dashboard
    label: "Revenue Overview (Looker)"
    type: dashboard
    maturity: high
    url: "https://company.looker.com/dashboards/42"
    description: "Primary revenue dashboard reviewed in leadership meetings"
    owner:
      name: Finance Analytics
      email: finance-analytics@company.com
    depends_on:
      - ref('fct_orders')
      - ref('fct_revenue_monthly')
      - ref('dim_customers')

  - name: finance_erp_export
    label: "ERP Revenue Sync"
    type: application
    maturity: high
    description: "Nightly export to NetSuite ERP"
    owner:
      name: Finance Operations
      email: finance-ops@company.com
    depends_on:
      - ref('fct_revenue_monthly')
      - ref('dim_cost_centers')
```

After adding exposures, the dbt lineage graph shows:
`source → staging → marts → dashboard`

```bash
# "Which sources feed the Revenue Dashboard?"
dbt ls --select "+exposure:revenue_dashboard"

# "What breaks if stg_stripe__charges changes?"
dbt ls --select "stg_stripe__charges+exposure:*"  # All affected exposures
```

---

## Column-Level Lineage

Column lineage requires additional tooling beyond dbt's model-level graph.

### OpenLineage (Open Standard)

```python
# Emit OpenLineage events from your dbt run
# Install: pip install openlineage-dbt

# Run dbt with OpenLineage integration
dbt run --select fct_orders \
    --vars '{"openlineage_url": "http://marquez:5000"}'

# Or: use the dbt-openlineage adapter
# https://github.com/OpenLineage/OpenLineage
```

### dbt Column Lineage via Python

```python
# Parse dbt manifest.json for column-level lineage (heuristic approach)
import json
from pathlib import Path

manifest = json.loads(Path("target/manifest.json").read_text())

def get_column_sources(model_name: str, column_name: str) -> list:
    """Trace a column back to its sources (best-effort based on naming)"""
    model = manifest["nodes"].get(f"model.my_project.{model_name}", {})
    columns = model.get("columns", {})
    col = columns.get(column_name, {})

    # Check if column has explicit lineage docs
    if "refs" in col.get("meta", {}):
        return col["meta"]["refs"]

    # Find upstream models and check if they have matching column names
    upstream = []
    for dep in model.get("depends_on", {}).get("nodes", []):
        dep_node = manifest["nodes"].get(dep, {})
        if column_name in dep_node.get("columns", {}):
            upstream.append(f"{dep_node['name']}.{column_name}")
    return upstream
```

### Documenting Column Lineage in dbt YAML

```yaml
# Explicit column lineage documentation
models:
  - name: fct_orders
    columns:
      - name: net_revenue_usd
        description: |
          Net revenue in USD.
          **Source**: `stg_stripe__charges.amount` (converted from cents)
          **Formula**: `unit_price × quantity − discount_amount`
          **Lineage**: stripe.charges → stg_stripe__charges → int_orders__enriched → fct_orders
        meta:
          source_columns:
            - model: stg_stripe__charges
              column: amount_usd
            - model: stg_orders
              column: quantity
              column: discount_amount
```

---

## Lineage for Incident Response

When a dashboard shows wrong numbers, use lineage to find the root cause:

```bash
# Step 1: What models feed this dashboard?
dbt ls --select "+exposure:revenue_dashboard"

# Step 2: Check when each model last ran successfully
dbt run-operation elementary.get_model_run_results \
    --args '{"model_names": ["fct_orders", "fct_revenue_monthly"]}'

# Step 3: Check if source data changed
dbt source freshness

# Step 4: Identify which model introduced the issue
# Run models one-by-one and compare row counts
dbt run --select stg_stripe__charges && dbt test --select stg_stripe__charges
dbt run --select fct_orders && dbt test --select fct_orders
# ... until you find the failing step
```

**Incident response lineage runbook:**
```markdown
1. Get affected dashboard URL
2. `dbt ls --select "+exposure:<dashboard_name>"` → list upstream models
3. Check run history for each model (Elementary or dbt Cloud)
4. Find oldest model with wrong data
5. That model's source is the likely root cause
6. Fix source or transformation; re-run downstream: `dbt build --select <broken_model>+`
```

---

## Cross-System Lineage (Source → BI)

Full lineage across all systems:

```
Salesforce → Fivetran → raw.salesforce.account
                            ↓ (dbt)
                    stg_salesforce__accounts
                            ↓
                    dim_customers
                            ↓
                    fct_orders ← stg_stripe__charges ← Stripe → Fivetran
                            ↓
                    fct_revenue_monthly
                            ↓
                    Looker Revenue Dashboard
```

**Tools for cross-system lineage:**
- **OpenMetadata**: ingests from Fivetran, dbt, Snowflake, Looker — unified lineage graph
- **DataHub**: LinkedIn OSS; strong cross-platform lineage
- **Atlan**: Enterprise; native dbt + BI integrations
- **Monte Carlo**: Observability + lineage hybrid

---

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

After adding exposures or lineage documentation, verify with:

```bash
# Confirm upstream lineage resolves correctly for a model
dbt ls --select "+fct_orders"

# Confirm downstream impact is fully captured
dbt ls --select "dim_customers+"

# Confirm exposures are parsed and linked correctly
dbt ls --select "+exposure:revenue_dashboard"

# Regenerate docs and inspect lineage graph visually
dbt docs generate && dbt docs serve
```

## If Something Goes Wrong

- **`dbt ls --select "+model_name"` returns only the model itself**: The model has no upstream `ref()` or `source()` calls, or the model name is misspelled — confirm the exact model name with `dbt ls --select model_name` first.
- **Exposure not appearing in the lineage graph**: Confirm the `_exposures.yml` file is inside a directory that dbt scans (i.e., under `models/`) and that `depends_on` entries use `ref()` syntax matching exact model names.
- **`dbt build --select "model+"` rebuilding too many models**: Use `dbt ls --select "model+"` first to preview the full downstream set before running; use `dbt build --select "1+model+1"` to limit to direct parents and children only.
- **OpenLineage events not emitting**: Confirm `openlineage-dbt` is installed in the same Python environment as dbt and that the `OPENLINEAGE_URL` environment variable is set; the integration requires dbt 1.0+ and the adapter must support it.
- **Column lineage in YAML not reflected in catalog tool**: Most catalog tools (OpenMetadata, Atlan) ingest column lineage from the `meta.source_columns` field only if their connector is configured to read `meta` fields; verify the connector's `includeTags: true` or equivalent setting is enabled.
