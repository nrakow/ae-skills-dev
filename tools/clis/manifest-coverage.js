#!/usr/bin/env node
/**
 * manifest-coverage.js — Analyze dbt test and documentation coverage
 *
 * Usage:
 *   node manifest-coverage.js [manifest-path] [options]
 *
 * Options:
 *   --threshold <n>    Fail (exit 1) if coverage below this % (default: none)
 *   --format json      Output as JSON
 *   --layer <name>     Filter to a specific layer (staging, intermediate, marts)
 *   --show-missing     List models and columns missing tests/docs
 *
 * Examples:
 *   node manifest-coverage.js
 *   node manifest-coverage.js --layer marts --threshold 80
 *   node manifest-coverage.js --show-missing --format json
 */

'use strict';

const fs = require('fs');

// --- Argument parsing ---
const args = process.argv.slice(2);
let manifestPath = 'target/manifest.json';
const opts = { threshold: null, format: 'table', layer: null, showMissing: false };

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--threshold') opts.threshold = parseFloat(args[++i]);
  else if (args[i] === '--format') opts.format = args[++i];
  else if (args[i] === '--layer') opts.layer = args[++i];
  else if (args[i] === '--show-missing') opts.showMissing = true;
  else if (!args[i].startsWith('--')) manifestPath = args[i];
}

// --- Load manifest ---
if (!fs.existsSync(manifestPath)) {
  console.error(`Error: manifest not found at ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const nodes = manifest.nodes || {};

// --- Analyze models ---
const models = Object.values(nodes).filter(node => {
  if (node.resource_type !== 'model') return false;
  if (opts.layer) {
    // Match by path prefix or schema
    const pathParts = (node.original_file_path || '').split('/');
    return pathParts.includes(opts.layer) || node.schema?.includes(opts.layer);
  }
  return true;
});

// Build test map: model -> tested column names
const testMap = {};
Object.values(nodes).forEach(node => {
  if (node.resource_type !== 'test') return;
  const attached = node.attached_node || node.depends_on?.nodes?.[0];
  if (!attached) return;
  const col = node.test_metadata?.kwargs?.column_name;
  if (!testMap[attached]) testMap[attached] = { model: new Set(), columns: new Set() };
  testMap[attached].model.add(node.name);
  if (col) testMap[attached].columns.add(col.toLowerCase());
});

// --- Compute coverage per model ---
const results = models.map(m => {
  const modelId = m.unique_id;
  const columns = Object.values(m.columns || {});
  const tests = testMap[modelId] || { model: new Set(), columns: new Set() };

  const colCount = columns.length;
  const docCount = columns.filter(c => c.description && c.description.trim()).length;
  const testedColCount = columns.filter(c => tests.columns.has(c.name.toLowerCase())).length;

  const missingDocs = columns.filter(c => !c.description?.trim()).map(c => c.name);
  const missingTests = columns.filter(c => !tests.columns.has(c.name.toLowerCase())).map(c => c.name);

  return {
    model: m.name,
    schema: m.schema,
    materialized: m.config?.materialized || '-',
    col_count: colCount,
    doc_count: docCount,
    doc_pct: colCount > 0 ? Math.round((docCount / colCount) * 100) : 0,
    test_count: testedColCount,
    test_pct: colCount > 0 ? Math.round((testedColCount / colCount) * 100) : 0,
    model_tests: tests.model.size,
    model_described: !!(m.description?.trim()),
    missing_docs: missingDocs,
    missing_tests: missingTests,
  };
});

// --- Summary stats ---
const totalModels = results.length;
const modelsWithDesc = results.filter(r => r.model_described).length;
const avgDocPct = totalModels > 0
  ? Math.round(results.reduce((s, r) => s + r.doc_pct, 0) / totalModels)
  : 0;
const avgTestPct = totalModels > 0
  ? Math.round(results.reduce((s, r) => s + r.test_pct, 0) / totalModels)
  : 0;
const modelsWithTests = results.filter(r => r.model_tests > 0 || r.test_count > 0).length;

// --- Output ---
if (opts.format === 'json') {
  console.log(JSON.stringify({
    summary: { totalModels, modelsWithDesc, modelsWithTests, avgDocPct, avgTestPct },
    models: results,
  }, null, 2));
} else {
  console.log(`\ndbt Coverage Report`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Layer: ${opts.layer || 'all'}\n`);

  console.log('Summary:');
  console.log(`  Total models:          ${totalModels}`);
  console.log(`  Models with desc:      ${modelsWithDesc} / ${totalModels} (${Math.round(modelsWithDesc/totalModels*100)||0}%)`);
  console.log(`  Models with tests:     ${modelsWithTests} / ${totalModels} (${Math.round(modelsWithTests/totalModels*100)||0}%)`);
  console.log(`  Avg column doc %:      ${avgDocPct}%`);
  console.log(`  Avg column test %:     ${avgTestPct}%`);

  // Per-model table
  const rows = results.sort((a, b) => a.doc_pct - b.doc_pct);
  const header = ['Model', 'Schema', 'Cols', 'Doc%', 'Test%', 'ModelTests', 'Described'];
  const widths = header.map((h, i) => {
    const vals = rows.map(r => String([r.model, r.schema, r.col_count, r.doc_pct+'%', r.test_pct+'%', r.model_tests, r.model_described?'✓':'✗'][i]));
    return Math.max(h.length, ...vals.map(v => v.length));
  });

  console.log('\n' + header.map((h, i) => h.padEnd(widths[i])).join(' | '));
  console.log(widths.map(w => '-'.repeat(w)).join('-+-'));
  rows.forEach(r => {
    const row = [r.model, r.schema, r.col_count, r.doc_pct+'%', r.test_pct+'%', r.model_tests, r.model_described?'yes':'NO'];
    console.log(row.map((v, i) => String(v).padEnd(widths[i])).join(' | '));
  });

  if (opts.showMissing) {
    console.log('\n--- Missing Documentation ---');
    results.filter(r => r.missing_docs.length > 0).forEach(r => {
      console.log(`  ${r.model}: ${r.missing_docs.join(', ')}`);
    });

    console.log('\n--- Missing Tests ---');
    results.filter(r => r.missing_tests.length > 0).forEach(r => {
      console.log(`  ${r.model}: ${r.missing_tests.join(', ')}`);
    });
  }

  if (opts.threshold !== null) {
    const overallCoverage = (avgDocPct + avgTestPct) / 2;
    if (overallCoverage < opts.threshold) {
      console.log(`\nFAIL: Coverage ${overallCoverage.toFixed(1)}% is below threshold ${opts.threshold}%`);
      process.exit(1);
    } else {
      console.log(`\nPASS: Coverage ${overallCoverage.toFixed(1)}% meets threshold ${opts.threshold}%`);
    }
  }
}
