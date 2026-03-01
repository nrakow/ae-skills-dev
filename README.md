# Analytics Engineering Skills

A comprehensive collection of AI agent skills for analytics engineers.

## What Is This?

This repository provides **Claude Code agent skills** for analytics engineering workflows. Skills are installable as a plugin and cover the full analytics engineering lifecycle — from data modeling and transformation to testing, orchestration, governance, and BI.

Each skill is a structured prompt that Claude Code can invoke when you ask for help with a specific analytics engineering task. Skills are context-aware: they check your `.claude/data-stack-context.md` file to tailor advice to your specific warehouse, toolchain, and team maturity.

## Installation & Usage

### Via claude.ai Plugin

1. Navigate to [claude.ai](https://claude.ai) and open your project settings.
2. Search for **Analytics Engineering Skills** in the plugin directory.
3. Install the plugin. Skills become available immediately in any conversation.

### Local Skills (Claude Code CLI)

1. Clone this repository into your project's `.claude/skills/` directory:

   ```bash
   git clone https://github.com/nrakow/ae-skills-dev .claude/skills/analyticsengineering
   ```

2. Claude Code will automatically discover skills from `.claude/skills/`.

3. Reference a skill in conversation:

   ```
   /data-modeling
   /dbt-project-setup
   /incremental-models
   ```

### Setting Up Your Data Stack Context

Run the `data-stack-context` skill first to capture your environment. This enables all other skills to tailor their advice without asking repetitive diagnostic questions:

```
/data-stack-context
```

This creates `.claude/data-stack-context.md` with details about your warehouse, transformation tool, orchestrator, BI layer, and more.

---

## Skill Catalog

### Foundation

| Skill | Description |
|-------|-------------|
| `data-stack-context` | Capture your analytics stack configuration for context-aware skill behavior |
| `data-modeling` | Design dimensional models, entity-relationship diagrams, and warehouse schemas |
| `dbt-project-setup` | Scaffold a production-ready dbt project with folder structure, profiles, and configs |
| `sql-style-guide` | Generate or audit SQL style guides for your team, with linter configs |

### Transformation & Modeling

| Skill | Description |
|-------|-------------|
| `marts-design` | Design business-facing data mart layers with clear grain and ownership |
| `staging-layer` | Build clean, standardized staging models from raw sources |
| `incremental-models` | Implement incremental dbt models with appropriate strategies per warehouse |
| `slowly-changing-dimensions` | Design and implement SCD Type 1, 2, and 3 patterns |
| `metrics-layer` | Define semantic metrics with dbt Semantic Layer, MetricFlow, or Cube |
| `entity-resolution` | Deduplicate and resolve entity identity across sources |

### Testing & Quality

| Skill | Description |
|-------|-------------|
| `data-quality-testing` | Write dbt tests, custom SQL assertions, and schema validations |
| `data-contracts` | Define and enforce data contracts between producers and consumers |
| `anomaly-detection` | Detect data anomalies using statistical methods or observability tools |
| `data-observability-audit` | Audit your observability setup and recommend improvements |

### Reporting & BI

| Skill | Description |
|-------|-------------|
| `dashboard-design` | Design effective, accessible dashboards with clear metric hierarchies |
| `looker-lkml` | Write and review LookML views, explores, and dashboards |
| `self-serve-analytics` | Build self-serve analytics capabilities for non-technical stakeholders |
| `kpi-framework` | Define, document, and socialize KPIs across your organization |

### Pipelines & Orchestration

| Skill | Description |
|-------|-------------|
| `pipeline-design` | Design robust data pipelines with appropriate patterns and error handling |
| `ingestion-strategy` | Choose and configure ingestion tools (Fivetran, Airbyte, custom) |
| `warehouse-optimization` | Optimize warehouse costs, query performance, and resource utilization |
| `dbt-ci-cd` | Set up CI/CD for dbt projects with testing, linting, and deployment automation |

### Governance & Security

| Skill | Description |
|-------|-------------|
| `data-catalog` | Implement and maintain a data catalog with metadata and documentation |
| `access-control` | Design role-based access control for warehouse and BI layers |
| `pii-handling` | Identify, classify, and protect PII in accordance with GDPR/CCPA/HIPAA |
| `data-lineage` | Trace and document data lineage across sources, transformations, and reports |

### Design Patterns

| Skill | Description |
|-------|-------------|
| `activity-schema` | Model event streams using the Activity Schema pattern |
| `funnel-analysis` | Build funnel analysis models for conversion tracking |
| `cohort-analysis` | Design cohort retention and behavioral analysis models |
| `event-modeling` | Model business processes as event streams for temporal analytics |

---

## Tools

### Integrations

Skills are aware of the following platforms and can generate platform-specific SQL, YAML, and configuration:

**Warehouses**: Snowflake, BigQuery, Databricks, Redshift, DuckDB

**Transformation**: dbt Core, dbt Cloud

**Ingestion**: Fivetran, Airbyte

**Orchestration**: Apache Airflow, Dagster, Prefect

**BI**: Looker, Metabase, Lightdash, Tableau

**Observability**: Elementary, Monte Carlo, Soda

**Catalogs**: OpenMetadata, Atlan, dbt docs

### CLIs

The `tools/clis/` directory contains zero-dependency Node.js scripts for common analytics engineering tasks:

- Schema introspection helpers
- dbt manifest parsers
- Cost estimation utilities
- Lineage graph exporters

Each CLI is a single file with no external dependencies and can be run with `node`.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding skills, updating existing skills, and adding tool integrations.

---

## License

[MIT](LICENSE)
