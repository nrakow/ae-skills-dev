#!/usr/bin/env node
/**
 * cost-estimate.js — Estimate warehouse query costs from dbt run results
 *
 * Parses dbt run_results.json and estimates cloud warehouse costs based on
 * execution time and warehouse sizing.
 *
 * Usage:
 *   node cost-estimate.js [run-results-path] [options]
 *
 * Options:
 *   --warehouse <type>    Warehouse type: snowflake|bigquery|databricks|redshift (default: snowflake)
 *   --size <size>         Snowflake warehouse size: xs|s|m|l|xl|2xl (default: m)
 *   --tbs-scanned <gb>    BigQuery: TB scanned (overrides auto-estimate)
 *   --dbu-rate <price>    Databricks: DBU price (default: 0.22)
 *   --sort-by cost        Sort output by cost (default) or time
 *   --format json         Output as JSON
 *
 * Examples:
 *   node cost-estimate.js
 *   node cost-estimate.js target/run_results.json --warehouse snowflake --size l
 *   node cost-estimate.js --warehouse bigquery
 */

'use strict';

const fs = require('fs');

// --- Argument parsing ---
const args = process.argv.slice(2);
let resultsPath = 'target/run_results.json';
const opts = {
  warehouse: 'snowflake',
  size: 'm',
  tbsScanned: null,
  dbuRate: 0.22,
  sortBy: 'cost',
  format: 'table',
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--warehouse') opts.warehouse = args[++i];
  else if (args[i] === '--size') opts.size = args[++i];
  else if (args[i] === '--tbs-scanned') opts.tbsScanned = parseFloat(args[++i]);
  else if (args[i] === '--dbu-rate') opts.dbuRate = parseFloat(args[++i]);
  else if (args[i] === '--sort-by') opts.sortBy = args[++i];
  else if (args[i] === '--format') opts.format = args[++i];
  else if (!args[i].startsWith('--')) resultsPath = args[i];
}

// --- Pricing models (USD) ---
// Snowflake: credits/hour by warehouse size (us-east-1 standard tier)
const SNOWFLAKE_CREDITS_PER_HOUR = { xs: 1, s: 2, m: 4, l: 8, xl: 16, '2xl': 32 };
const SNOWFLAKE_CREDIT_PRICE = 3.00;

// BigQuery: $5/TB scanned (on-demand)
const BQ_PRICE_PER_TB = 5.00;

// Databricks SQL: DBU/hour by size (SQL Pro)
const DATABRICKS_DBU_PER_HOUR = { '2x-small': 4, 'x-small': 8, small: 16, medium: 32, large: 64 };

// Redshift: node-hours (dc2.large = $0.25/hr, ra3.4xlarge = $3.26/hr)
const REDSHIFT_RATES = { 'dc2.large': 0.25, 'dc2.8xlarge': 4.80, 'ra3.4xlarge': 3.26, 'ra3.16xlarge': 13.04 };

function estimateCost(executionTime, warehouse, size) {
  const seconds = executionTime / 1000;
  const hours = seconds / 3600;

  switch (warehouse) {
    case 'snowflake': {
      const creditsPerHour = SNOWFLAKE_CREDITS_PER_HOUR[size] || 4;
      const credits = creditsPerHour * hours;
      return { cost: credits * SNOWFLAKE_CREDIT_PRICE, unit: 'credits', unitValue: credits.toFixed(4) };
    }
    case 'bigquery': {
      // Can't know bytes scanned without query metadata, estimate from time
      // (rough heuristic: 1 second ≈ 0.001 TB for medium complexity queries)
      const tbScanned = 0.001 * seconds;
      return { cost: tbScanned * BQ_PRICE_PER_TB, unit: 'TB', unitValue: tbScanned.toFixed(4) };
    }
    case 'databricks': {
      const dbuPerHour = DATABRICKS_DBU_PER_HOUR[size] || 16;
      const dbus = dbuPerHour * hours;
      return { cost: dbus * opts.dbuRate, unit: 'DBUs', unitValue: dbus.toFixed(4) };
    }
    case 'redshift': {
      const nodeRate = REDSHIFT_RATES[size] || 0.25;
      return { cost: nodeRate * hours, unit: 'node-hrs', unitValue: hours.toFixed(4) };
    }
    default:
      return { cost: 0, unit: '-', unitValue: '0' };
  }
}

// --- Load run results ---
if (!fs.existsSync(resultsPath)) {
  console.error(`Error: run_results.json not found at ${resultsPath}`);
  console.error('Run `dbt build` or `dbt run` first.');
  process.exit(1);
}

const runResults = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const results = runResults.results || [];

// --- Analyze ---
const rows = results
  .filter(r => r.execution_time && r.unique_id)
  .map(r => {
    const name = r.unique_id.split('.').pop();
    const type = r.unique_id.split('.')[0];
    const executionMs = r.execution_time * 1000;
    const { cost, unit, unitValue } = estimateCost(executionMs, opts.warehouse, opts.size);
    return {
      name,
      type,
      status: r.status,
      execution_s: r.execution_time.toFixed(2),
      cost_usd: cost,
      unit,
      unit_value: unitValue,
    };
  });

// Sort
rows.sort((a, b) =>
  opts.sortBy === 'cost' ? b.cost_usd - a.cost_usd : parseFloat(b.execution_s) - parseFloat(a.execution_s)
);

const totalCost = rows.reduce((s, r) => s + r.cost_usd, 0);
const totalSeconds = rows.reduce((s, r) => s + parseFloat(r.execution_s), 0);
const modelsOnly = rows.filter(r => r.type === 'model');
const testsOnly = rows.filter(r => r.type === 'test');

// --- Output ---
if (opts.format === 'json') {
  console.log(JSON.stringify({
    warehouse: opts.warehouse,
    size: opts.size,
    total_cost_usd: totalCost.toFixed(4),
    total_execution_s: totalSeconds.toFixed(2),
    rows,
  }, null, 2));
} else {
  console.log(`\ndbt Cost Estimate`);
  console.log(`Warehouse: ${opts.warehouse} (size: ${opts.size})`);
  console.log(`Run results: ${resultsPath}\n`);

  console.log(`Total execution time:  ${totalSeconds.toFixed(1)}s`);
  console.log(`Estimated total cost:  $${totalCost.toFixed(4)}`);
  console.log(`  Models:  ${modelsOnly.length} runs, $${modelsOnly.reduce((s,r)=>s+r.cost_usd,0).toFixed(4)}`);
  console.log(`  Tests:   ${testsOnly.length} runs, $${testsOnly.reduce((s,r)=>s+r.cost_usd,0).toFixed(4)}`);
  console.log(`\n⚠  Cost estimates are approximate. Actual costs depend on bytes scanned and concurrency.\n`);

  // Table header
  const headers = ['Name', 'Type', 'Status', 'Time(s)', 'Est. Cost ($)'];
  const colWidths = [
    Math.max(4, ...rows.map(r => r.name.length)),
    6, 8, 8, 14,
  ];
  console.log(headers.map((h, i) => h.padEnd(colWidths[i])).join(' | '));
  console.log(colWidths.map(w => '-'.repeat(w)).join('-+-'));

  rows.slice(0, 30).forEach(r => {
    const statusIcon = r.status === 'success' ? 'ok' : r.status === 'error' ? 'ERR' : r.status;
    const row = [r.name, r.type, statusIcon, r.execution_s, `$${r.cost_usd.toFixed(6)}`];
    console.log(row.map((v, i) => String(v).padEnd(colWidths[i])).join(' | '));
  });

  if (rows.length > 30) {
    console.log(`  ... and ${rows.length - 30} more (use --format json for full output)`);
  }

  // Top 5 expensive models
  console.log('\nTop 5 most expensive models:');
  modelsOnly.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i+1}. ${r.name} — ${r.execution_s}s — $${r.cost_usd.toFixed(6)}`);
  });
}
