#!/usr/bin/env node
/**
 * test-results.js — Parse and summarize dbt test results from run_results.json
 *
 * Usage:
 *   node test-results.js [run-results-path] [options]
 *
 * Options:
 *   --status <status>  Filter by status: fail|warn|pass|error
 *   --model <name>     Filter to tests for a specific model
 *   --format json      Output as JSON
 *   --fail-fast        Exit 1 if any tests failed (useful in CI)
 *
 * Examples:
 *   node test-results.js
 *   node test-results.js --status fail
 *   node test-results.js --model fct_orders --status fail
 *   node test-results.js --fail-fast
 */

'use strict';

const fs = require('fs');

// --- Argument parsing ---
const args = process.argv.slice(2);
let resultsPath = 'target/run_results.json';
const opts = { status: null, model: null, format: 'table', failFast: false };

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--status') opts.status = args[++i];
  else if (args[i] === '--model') opts.model = args[++i];
  else if (args[i] === '--format') opts.format = args[++i];
  else if (args[i] === '--fail-fast') opts.failFast = true;
  else if (!args[i].startsWith('--')) resultsPath = args[i];
}

// --- Load run results ---
if (!fs.existsSync(resultsPath)) {
  console.error(`Error: run_results.json not found at ${resultsPath}`);
  console.error('Run `dbt test` first.');
  process.exit(1);
}

const runResults = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const results = runResults.results || [];

// --- Filter and process test results ---
const testResults = results
  .filter(r => {
    // Only test nodes
    if (!r.unique_id?.startsWith('test.')) return false;
    if (opts.status && r.status !== opts.status) return false;
    if (opts.model) {
      return (r.unique_id || '').toLowerCase().includes(opts.model.toLowerCase());
    }
    return true;
  })
  .map(r => {
    const parts = r.unique_id.split('.');
    const testName = parts[parts.length - 1] || r.unique_id;

    // Parse test name to extract model and column
    // Format: test.project.test_type_model_column__args
    const modelMatch = testName.match(/^(not_null|unique|accepted_values|relationships|expect_\w+|dbt_\w+)_(.+)$/);
    const testType = modelMatch ? modelMatch[1] : testName.split('_')[0];

    // Extract message from failures
    const message = r.message || (r.failures > 0 ? `${r.failures} failure(s)` : '');

    return {
      test_name: testName,
      test_type: testType,
      status: r.status,
      failures: r.failures || 0,
      execution_s: r.execution_time?.toFixed(2) || '0',
      message: message.substring(0, 100),
      unique_id: r.unique_id,
    };
  });

// Sort: failures first, then by name
testResults.sort((a, b) => {
  const statusOrder = { error: 0, fail: 1, warn: 2, pass: 3 };
  return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4) || a.test_name.localeCompare(b.test_name);
});

// Summary counts
const statusCounts = testResults.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] || 0) + 1;
  return acc;
}, {});

// Test type breakdown
const typeBreakdown = testResults.reduce((acc, r) => {
  acc[r.test_type] = (acc[r.test_type] || 0) + 1;
  return acc;
}, {});

// --- Output ---
if (opts.format === 'json') {
  console.log(JSON.stringify({
    summary: statusCounts,
    total: testResults.length,
    test_types: typeBreakdown,
    results: testResults,
  }, null, 2));
} else {
  const total = testResults.length;
  const passed = statusCounts.pass || 0;
  const failed = statusCounts.fail || 0;
  const errored = statusCounts.error || 0;
  const warned = statusCounts.warn || 0;

  console.log('\ndbt Test Results');
  console.log(`Total: ${total}  |  ✅ Pass: ${passed}  |  ❌ Fail: ${failed}  |  💥 Error: ${errored}  |  ⚠️  Warn: ${warned}`);

  if (total > 0) {
    const passRate = Math.round(passed / total * 100);
    console.log(`Pass rate: ${passRate}%`);
  }

  // Show non-passing tests by default, all if filtered
  const showAll = opts.status || opts.model;
  const displayRows = showAll ? testResults : testResults.filter(r => r.status !== 'pass');

  if (displayRows.length > 0) {
    console.log('');
    const headers = ['Test', 'Status', 'Failures', 'Time(s)', 'Message'];
    const colWidths = [
      Math.max(4, ...displayRows.map(r => r.test_name.length), 50),
      8, 10, 8,
      Math.min(60, Math.max(7, ...displayRows.map(r => r.message.length))),
    ];

    console.log(headers.map((h, i) => h.padEnd(colWidths[i])).join(' | '));
    console.log(colWidths.map(w => '-'.repeat(w)).join('-+-'));

    displayRows.slice(0, 100).forEach(r => {
      const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : r.status === 'error' ? '💥' : '⚠️';
      const row = [
        r.test_name.substring(0, colWidths[0]),
        `${icon} ${r.status}`,
        r.failures || '-',
        r.execution_s,
        r.message.substring(0, colWidths[4]),
      ];
      console.log(row.map((v, i) => String(v).padEnd(colWidths[i])).join(' | '));
    });

    if (displayRows.length > 100) {
      console.log(`  ... ${displayRows.length - 100} more (use --format json for full output)`);
    }

    if (!showAll && (failed > 0 || errored > 0)) {
      console.log('\n(Only showing non-passing tests. Use --status pass to see all.)');
    }
  } else if (!showAll) {
    console.log('\nAll tests passed!');
  }

  // Test type breakdown
  console.log('\nTest Type Breakdown:');
  Object.entries(typeBreakdown)
    .sort(([,a],[,b]) => b - a)
    .slice(0, 10)
    .forEach(([type, count]) => {
      console.log(`  ${type.padEnd(30)} ${count}`);
    });
}

// Exit code for CI
if (opts.failFast && ((statusCounts.fail || 0) + (statusCounts.error || 0)) > 0) {
  process.exit(1);
}
