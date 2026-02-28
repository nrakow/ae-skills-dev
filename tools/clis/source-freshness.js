#!/usr/bin/env node
/**
 * source-freshness.js — Parse dbt sources.json freshness results and report status
 *
 * Usage:
 *   node source-freshness.js [sources-path] [options]
 *
 * Options:
 *   --warn-only        Exit 0 even if sources are past error threshold
 *   --format json      Output as JSON
 *   --source <name>    Filter to a specific source name
 *
 * Examples:
 *   node source-freshness.js
 *   node source-freshness.js target/sources.json
 *   node source-freshness.js --source raw_fivetran
 *   node source-freshness.js --format json | jq '.[] | select(.status == "error")'
 */

'use strict';

const fs = require('fs');

// --- Argument parsing ---
const args = process.argv.slice(2);
let sourcesPath = 'target/sources.json';
const opts = { warnOnly: false, format: 'table', source: null };

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--warn-only') opts.warnOnly = true;
  else if (args[i] === '--format') opts.format = args[++i];
  else if (args[i] === '--source') opts.source = args[++i];
  else if (!args[i].startsWith('--')) sourcesPath = args[i];
}

// --- Load sources freshness ---
if (!fs.existsSync(sourcesPath)) {
  console.error(`Error: sources.json not found at ${sourcesPath}`);
  console.error('Run `dbt source freshness` first.');
  process.exit(1);
}

const sourcesData = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
const results = sourcesData.results || [];

// --- Process results ---
function formatAge(seconds) {
  if (seconds == null) return 'unknown';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

const rows = results
  .filter(r => {
    if (opts.source) {
      const sourceName = r.unique_id?.split('.')?.[2] || '';
      return sourceName === opts.source;
    }
    return true;
  })
  .map(r => {
    const parts = r.unique_id?.split('.') || [];
    const sourceName = parts[2] || '-';
    const tableName = parts[3] || '-';
    const age = r.max_loaded_at_time_ago_in_s;
    const warnAfter = r.criteria?.warn_after?.count
      ? `${r.criteria.warn_after.count}${r.criteria.warn_after.period?.charAt(0) || 'h'}`
      : '-';
    const errorAfter = r.criteria?.error_after?.count
      ? `${r.criteria.error_after.count}${r.criteria.error_after.period?.charAt(0) || 'h'}`
      : '-';

    return {
      source: sourceName,
      table: tableName,
      status: r.status || 'unknown',
      age: formatAge(age),
      age_seconds: age,
      max_loaded_at: r.max_loaded_at ? new Date(r.max_loaded_at).toISOString().replace('T', ' ').substring(0, 19) : 'never',
      warn_after: warnAfter,
      error_after: errorAfter,
    };
  });

// Sort by status severity then age
const statusOrder = { error: 0, warn: 1, pass: 2, unknown: 3 };
rows.sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3) || (b.age_seconds ?? 0) - (a.age_seconds ?? 0));

// --- Output ---
if (opts.format === 'json') {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const errorCount = rows.filter(r => r.status === 'error').length;
  const warnCount = rows.filter(r => r.status === 'warn').length;
  const passCount = rows.filter(r => r.status === 'pass').length;

  console.log('\ndbt Source Freshness Report');
  console.log(`Sources: ${rows.length}  |  ❌ Error: ${errorCount}  |  ⚠️  Warn: ${warnCount}  |  ✅ Pass: ${passCount}\n`);

  const headers = ['Source', 'Table', 'Status', 'Age', 'Last Loaded', 'Warn After', 'Error After'];
  const colWidths = headers.map((h, i) => {
    const vals = rows.map(r => String([r.source, r.table, r.status, r.age, r.max_loaded_at, r.warn_after, r.error_after][i]));
    return Math.max(h.length, ...vals.map(v => v.length));
  });

  console.log(headers.map((h, i) => h.padEnd(colWidths[i])).join(' | '));
  console.log(colWidths.map(w => '-'.repeat(w)).join('-+-'));

  rows.forEach(r => {
    const icon = r.status === 'error' ? '❌' : r.status === 'warn' ? '⚠️ ' : r.status === 'pass' ? '✅' : '❓';
    const row = [r.source, r.table, `${icon} ${r.status}`, r.age, r.max_loaded_at, r.warn_after, r.error_after];
    console.log(row.map((v, i) => String(v).padEnd(colWidths[i])).join(' | '));
  });

  if (errorCount > 0 && !opts.warnOnly) {
    console.log(`\n${errorCount} source(s) past error threshold. Run dbt source freshness to investigate.`);
    process.exit(1);
  } else if (errorCount > 0) {
    console.log(`\n${errorCount} source(s) past error threshold (--warn-only: exiting 0).`);
  } else if (warnCount > 0) {
    console.log(`\n${warnCount} source(s) past warn threshold.`);
  } else {
    console.log('\nAll sources are fresh.');
  }
}
