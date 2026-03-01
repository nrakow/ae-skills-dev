# CLI Tools

Zero-dependency Node.js scripts for common analytics engineering tasks. Run with `node <script>.js`.

## Available Tools

| Script | Description | Usage |
|--------|-------------|-------|
| `cost-estimate.js` | Estimate warehouse compute costs from query history | `node cost-estimate.js --warehouse snowflake --days 30` |
| `lineage-export.js` | Export dbt model lineage graph to JSON or DOT format | `node lineage-export.js --manifest target/manifest.json --output lineage.json` |
| `manifest-coverage.js` | Report test coverage gaps across all dbt models | `node manifest-coverage.js --manifest target/manifest.json` |
| `manifest-lineage.js` | Build and query the lineage graph from a dbt manifest | `node manifest-lineage.js --manifest target/manifest.json --model fct_orders` |
| `manifest-parse.js` | Parse and pretty-print a dbt manifest.json | `node manifest-parse.js --manifest target/manifest.json` |
| `model-stats.js` | Show row counts, column counts, and test counts per model | `node model-stats.js --manifest target/manifest.json` |
| `schema-introspect.js` | Introspect warehouse schemas and output column metadata | `node schema-introspect.js --schema analytics.marts` |
| `source-freshness.js` | Check source freshness status from dbt artifacts | `node source-freshness.js --sources target/sources.json` |
| `test-results.js` | Parse and summarize dbt test results | `node test-results.js --results target/run_results.json` |

## Requirements

- Node.js 18+ (no external dependencies)
- A dbt `target/` directory with `manifest.json` and `run_results.json` (produced by `dbt compile` or `dbt build`)

## Common Workflow

```bash
# 1. Compile your dbt project to generate artifacts
dbt compile

# 2. Check test coverage gaps
node tools/clis/manifest-coverage.js --manifest target/manifest.json

# 3. Export lineage for a specific model
node tools/clis/manifest-lineage.js --manifest target/manifest.json --model fct_orders

# 4. Review test results from the last run
node tools/clis/test-results.js --results target/run_results.json
```
