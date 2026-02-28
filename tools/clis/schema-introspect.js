#!/usr/bin/env node
/**
 * schema-introspect.js — Generate dbt sources YAML from a warehouse schema
 *
 * Reads a CSV export of table/column metadata and outputs dbt sources YAML.
 * Produce the CSV from your warehouse using the queries below, then pipe to this script.
 *
 * Snowflake:
 *   SELECT table_catalog, table_schema, table_name, column_name,
 *          ordinal_position, data_type, is_nullable, column_default
 *   FROM information_schema.columns
 *   WHERE table_schema = 'MY_SCHEMA'
 *   ORDER BY table_name, ordinal_position;
 *
 * BigQuery:
 *   SELECT table_catalog, table_schema, table_name, column_name,
 *          ordinal_position, data_type, is_nullable
 *   FROM <project>.INFORMATION_SCHEMA.COLUMNS
 *   WHERE table_schema = 'my_dataset';
 *
 * Usage:
 *   node schema-introspect.js <csv-file> [options]
 *   cat columns.csv | node schema-introspect.js -
 *
 * Options:
 *   --source-name <name>   dbt source name (default: derived from schema)
 *   --database <name>      Override database name
 *   --schema <name>        Override schema name
 *   --exclude <pattern>    Exclude tables matching pattern (regex)
 *   --include <pattern>    Only include tables matching pattern (regex)
 *
 * Examples:
 *   node schema-introspect.js columns.csv --source-name raw_fivetran
 *   node schema-introspect.js columns.csv --include "^order" --exclude "_backup$"
 */

'use strict';

const fs = require('fs');
const readline = require('readline');

// --- Argument parsing ---
const args = process.argv.slice(2);
let inputFile = null;
const opts = { sourceName: null, database: null, schema: null, exclude: null, include: null };

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--source-name') opts.sourceName = args[++i];
  else if (args[i] === '--database') opts.database = args[++i];
  else if (args[i] === '--schema') opts.schema = args[++i];
  else if (args[i] === '--exclude') opts.exclude = new RegExp(args[++i], 'i');
  else if (args[i] === '--include') opts.include = new RegExp(args[++i], 'i');
  else inputFile = args[i];
}

if (!inputFile) {
  console.error('Usage: node schema-introspect.js <csv-file>');
  console.error('       cat columns.csv | node schema-introspect.js -');
  process.exit(1);
}

// --- CSV parser (no dependencies) ---
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
  return lines.slice(1).map(line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
      else { current += char; }
    }
    values.push(current.trim());
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').replace(/"/g, '')]));
  });
}

// --- Read input ---
function processData(text) {
  const rows = parseCSV(text);

  // Group by table
  const tables = {};
  rows.forEach(row => {
    const tableName = (row.table_name || '').toLowerCase();
    const schemaName = opts.schema || row.table_schema || 'unknown';
    const dbName = opts.database || row.table_catalog || 'unknown';

    if (opts.include && !opts.include.test(tableName)) return;
    if (opts.exclude && opts.exclude.test(tableName)) return;

    if (!tables[tableName]) {
      tables[tableName] = { schema: schemaName, database: dbName, columns: [] };
    }
    tables[tableName].columns.push({
      name: row.column_name || '',
      data_type: row.data_type || '',
      nullable: (row.is_nullable || '').toUpperCase() === 'YES',
      position: parseInt(row.ordinal_position || '0', 10),
    });
  });

  // Sort columns by position
  Object.values(tables).forEach(t => t.columns.sort((a, b) => a.position - b.position));

  // Derive source name and schema from first table if not provided
  const firstTable = Object.values(tables)[0];
  const sourceName = opts.sourceName || (firstTable?.schema || 'raw').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const schemaName = opts.schema || firstTable?.schema || 'raw';
  const dbName = opts.database || firstTable?.database;

  // --- Generate dbt sources YAML ---
  const lines = [];
  lines.push('version: 2');
  lines.push('');
  lines.push('sources:');
  lines.push(`  - name: ${sourceName}`);
  if (dbName) lines.push(`    database: ${dbName.toLowerCase()}`);
  lines.push(`    schema: ${schemaName.toLowerCase()}`);
  lines.push(`    description: "TODO: describe this source"`);
  lines.push('');
  lines.push('    tables:');

  Object.entries(tables).forEach(([tableName, tableInfo]) => {
    lines.push(`      - name: ${tableName}`);
    lines.push(`        description: "TODO: describe ${tableName}"`);
    lines.push('        columns:');

    tableInfo.columns.forEach(col => {
      lines.push(`          - name: ${col.name.toLowerCase()}`);
      lines.push(`            description: "TODO: describe ${col.name.toLowerCase()}"`);

      // Suggest tests based on column name patterns
      const tests = [];
      const colLower = col.name.toLowerCase();
      if (colLower === 'id' || colLower.endsWith('_id') && !colLower.includes('foreign')) {
        if (colLower === 'id' || colLower === `${tableName}_id`) {
          tests.push('unique', 'not_null');
        } else {
          tests.push('not_null');
        }
      }
      if (!col.nullable) tests.push('not_null');
      if (tests.length > 0) {
        lines.push('            tests:');
        [...new Set(tests)].forEach(t => lines.push(`              - ${t}`));
      }
    });
  });

  console.log(lines.join('\n'));
  console.log('');
  console.log(`# Generated ${Object.keys(tables).length} table(s) from ${rows.length} columns`);
  console.log('# Review and fill in TODO descriptions before committing');
}

// Read from stdin or file
if (inputFile === '-') {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => data += chunk);
  process.stdin.on('end', () => processData(data));
} else {
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: file not found: ${inputFile}`);
    process.exit(1);
  }
  processData(fs.readFileSync(inputFile, 'utf8'));
}
