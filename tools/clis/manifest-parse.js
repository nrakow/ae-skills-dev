#!/usr/bin/env node
/**
 * manifest-parse.js — Parse dbt manifest.json and display model info
 *
 * Usage:
 *   node manifest-parse.js [manifest-path] [options]
 *
 * Options:
 *   --model <name>     Filter to a specific model name
 *   --tag <tag>        Filter by dbt tag
 *   --schema <schema>  Filter by schema
 *   --format json      Output as JSON instead of table
 *   --columns          Include column-level details
 *
 * Examples:
 *   node manifest-parse.js
 *   node manifest-parse.js target/manifest.json --tag critical
 *   node manifest-parse.js --model fct_orders --columns
 */

'use strict';

const fs = require('fs');
const path = require('path');

// --- Argument parsing ---
const args = process.argv.slice(2);
let manifestPath = 'target/manifest.json';
const opts = { model: null, tag: null, schema: null, format: 'table', columns: false };

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model') opts.model = args[++i];
  else if (args[i] === '--tag') opts.tag = args[++i];
  else if (args[i] === '--schema') opts.schema = args[++i];
  else if (args[i] === '--format') opts.format = args[++i];
  else if (args[i] === '--columns') opts.columns = true;
  else if (!args[i].startsWith('--')) manifestPath = args[i];
}

// --- Load manifest ---
if (!fs.existsSync(manifestPath)) {
  console.error(`Error: manifest not found at ${manifestPath}`);
  console.error('Run `dbt compile` or `dbt build` first, or provide the path as an argument.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const nodes = manifest.nodes || {};
const sources = manifest.sources || {};

// --- Filter models ---
const models = Object.values(nodes).filter(node => {
  if (node.resource_type !== 'model') return false;
  if (opts.model && !node.name.includes(opts.model)) return false;
  if (opts.tag && !(node.tags || []).includes(opts.tag)) return false;
  if (opts.schema && node.schema !== opts.schema) return false;
  return true;
});

if (models.length === 0) {
  console.log('No models matched the given filters.');
  process.exit(0);
}

// --- Output ---
if (opts.format === 'json') {
  const output = models.map(m => ({
    name: m.name,
    schema: m.schema,
    database: m.database,
    materialized: m.config?.materialized,
    tags: m.tags,
    description: m.description,
    columns: opts.columns ? m.columns : undefined,
    depends_on: m.depends_on?.nodes,
    path: m.original_file_path,
  }));
  console.log(JSON.stringify(output, null, 2));
} else {
  // Table format
  const rows = models.map(m => ({
    Name: m.name,
    Schema: m.schema,
    Materialized: m.config?.materialized || '-',
    Tags: (m.tags || []).join(', ') || '-',
    Columns: Object.keys(m.columns || {}).length,
    Description: (m.description || '-').substring(0, 60),
  }));

  // Print table
  const cols = Object.keys(rows[0]);
  const widths = cols.map(col =>
    Math.max(col.length, ...rows.map(r => String(r[col]).length))
  );
  const sep = widths.map(w => '-'.repeat(w)).join('-+-');
  const header = cols.map((col, i) => col.padEnd(widths[i])).join(' | ');

  console.log(`\ndbt Manifest: ${manifestPath}`);
  console.log(`dbt version: ${manifest.metadata?.dbt_version || 'unknown'}`);
  console.log(`Invocation: ${manifest.metadata?.invocation_id || 'unknown'}\n`);
  console.log(header);
  console.log(sep);
  rows.forEach(row => {
    console.log(cols.map((col, i) => String(row[col]).padEnd(widths[i])).join(' | '));
  });
  console.log(`\n${models.length} model(s) shown.`);

  if (opts.columns) {
    models.forEach(m => {
      console.log(`\n--- Columns: ${m.name} ---`);
      const colData = Object.values(m.columns || {});
      if (colData.length === 0) {
        console.log('  (no columns documented)');
      } else {
        colData.forEach(col => {
          const tests = (col.tests || []).map(t => typeof t === 'string' ? t : Object.keys(t)[0]).join(', ');
          console.log(`  ${col.name.padEnd(40)} ${(col.data_type || '').padEnd(20)} ${tests || ''}`);
        });
      }
    });
  }
}
