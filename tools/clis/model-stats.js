#!/usr/bin/env node
/**
 * model-stats.js — Display dbt project statistics from manifest.json
 *
 * Usage:
 *   node model-stats.js [manifest-path] [options]
 *
 * Options:
 *   --format json      Output as JSON
 *
 * Examples:
 *   node model-stats.js
 *   node model-stats.js target/manifest.json
 *   node model-stats.js --format json
 */

'use strict';

const fs = require('fs');

// --- Argument parsing ---
const args = process.argv.slice(2);
let manifestPath = 'target/manifest.json';
const opts = { format: 'table' };

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--format') opts.format = args[++i];
  else if (!args[i].startsWith('--')) manifestPath = args[i];
}

// --- Load manifest ---
if (!fs.existsSync(manifestPath)) {
  console.error(`Error: manifest not found at ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const nodes = manifest.nodes || {};
const sources = manifest.sources || {};

// --- Compute stats ---
const models = Object.values(nodes).filter(n => n.resource_type === 'model');
const tests = Object.values(nodes).filter(n => n.resource_type === 'test');
const seeds = Object.values(nodes).filter(n => n.resource_type === 'seed');
const snapshots = Object.values(nodes).filter(n => n.resource_type === 'snapshot');
const sourceList = Object.values(sources);

// Materialization breakdown
const materializations = {};
models.forEach(m => {
  const mat = m.config?.materialized || 'unknown';
  materializations[mat] = (materializations[mat] || 0) + 1;
});

// Schema breakdown
const schemas = {};
models.forEach(m => {
  const schema = m.schema || 'unknown';
  schemas[schema] = (schemas[schema] || 0) + 1;
});

// Tag frequency
const tags = {};
models.forEach(m => {
  (m.tags || []).forEach(tag => {
    tags[tag] = (tags[tag] || 0) + 1;
  });
});

// Documentation coverage
const modelWithDesc = models.filter(m => m.description?.trim()).length;
const allColumns = models.flatMap(m => Object.values(m.columns || {}));
const colWithDesc = allColumns.filter(c => c.description?.trim()).length;

// Test coverage
const testMap = {};
tests.forEach(t => {
  const attached = t.attached_node || t.depends_on?.nodes?.[0];
  if (attached) testMap[attached] = (testMap[attached] || 0) + 1;
});
const modelsWithTests = models.filter(m => testMap[m.unique_id] > 0).length;

// Test type breakdown
const testTypes = {};
tests.forEach(t => {
  const name = t.test_metadata?.name || t.name.split('.')[0];
  testTypes[name] = (testTypes[name] || 0) + 1;
});

// Package breakdown
const packages = {};
models.forEach(m => {
  const pkg = m.package_name || 'unknown';
  packages[pkg] = (packages[pkg] || 0) + 1;
});

// Largest models (by column count)
const modelsByColumns = [...models]
  .map(m => ({ name: m.name, columns: Object.keys(m.columns || {}).length, schema: m.schema }))
  .sort((a, b) => b.columns - a.columns)
  .slice(0, 10);

const stats = {
  metadata: {
    dbt_version: manifest.metadata?.dbt_version,
    generated_at: manifest.metadata?.generated_at,
    invocation_id: manifest.metadata?.invocation_id,
  },
  counts: {
    models: models.length,
    sources: sourceList.length,
    tests: tests.length,
    seeds: seeds.length,
    snapshots: snapshots.length,
    columns_documented: allColumns.length,
  },
  materializations,
  schemas: Object.fromEntries(
    Object.entries(schemas).sort(([,a],[,b]) => b - a)
  ),
  tags: Object.fromEntries(
    Object.entries(tags).sort(([,a],[,b]) => b - a)
  ),
  packages,
  coverage: {
    models_with_description: modelWithDesc,
    models_with_description_pct: models.length > 0 ? Math.round(modelWithDesc / models.length * 100) : 0,
    models_with_tests: modelsWithTests,
    models_with_tests_pct: models.length > 0 ? Math.round(modelsWithTests / models.length * 100) : 0,
    columns_with_description: colWithDesc,
    columns_with_description_pct: allColumns.length > 0 ? Math.round(colWithDesc / allColumns.length * 100) : 0,
  },
  top_test_types: Object.fromEntries(
    Object.entries(testTypes).sort(([,a],[,b]) => b - a).slice(0, 10)
  ),
  largest_models_by_columns: modelsByColumns,
};

// --- Output ---
if (opts.format === 'json') {
  console.log(JSON.stringify(stats, null, 2));
} else {
  console.log('\ndbt Project Statistics');
  console.log('======================');
  console.log(`Manifest:    ${manifestPath}`);
  console.log(`dbt version: ${stats.metadata.dbt_version || 'unknown'}`);
  console.log(`Generated:   ${stats.metadata.generated_at || 'unknown'}`);

  console.log('\nNode Counts:');
  console.log(`  Models:    ${stats.counts.models}`);
  console.log(`  Sources:   ${stats.counts.sources}`);
  console.log(`  Tests:     ${stats.counts.tests}`);
  console.log(`  Seeds:     ${stats.counts.seeds}`);
  console.log(`  Snapshots: ${stats.counts.snapshots}`);

  console.log('\nMaterializations:');
  Object.entries(stats.materializations).forEach(([mat, count]) => {
    console.log(`  ${mat.padEnd(15)} ${count}`);
  });

  console.log('\nSchemas (model count):');
  Object.entries(stats.schemas).slice(0, 10).forEach(([schema, count]) => {
    console.log(`  ${schema.padEnd(30)} ${count}`);
  });

  console.log('\nCoverage:');
  console.log(`  Models with description:  ${stats.coverage.models_with_description} / ${stats.counts.models} (${stats.coverage.models_with_description_pct}%)`);
  console.log(`  Models with tests:        ${stats.coverage.models_with_tests} / ${stats.counts.models} (${stats.coverage.models_with_tests_pct}%)`);
  console.log(`  Columns with description: ${stats.coverage.columns_with_description} / ${stats.counts.columns_documented} (${stats.coverage.columns_with_description_pct}%)`);

  if (Object.keys(stats.tags).length > 0) {
    console.log('\nTop Tags:');
    Object.entries(stats.tags).slice(0, 10).forEach(([tag, count]) => {
      console.log(`  ${tag.padEnd(25)} ${count}`);
    });
  }

  console.log('\nTop Test Types:');
  Object.entries(stats.top_test_types).forEach(([type, count]) => {
    console.log(`  ${type.padEnd(35)} ${count}`);
  });

  console.log('\nLargest Models (by documented columns):');
  stats.largest_models_by_columns.slice(0, 5).forEach((m, i) => {
    console.log(`  ${i+1}. ${m.name.padEnd(40)} ${m.columns} cols  (${m.schema})`);
  });
}
