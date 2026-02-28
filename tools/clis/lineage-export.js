#!/usr/bin/env node
/**
 * lineage-export.js — Export dbt lineage to multiple graph formats
 *
 * Usage:
 *   node lineage-export.js [manifest-path] [options]
 *
 * Options:
 *   --format <fmt>    Output format: dot|mermaid|csv|d3 (default: mermaid)
 *   --out <file>      Write to file instead of stdout
 *   --only-models     Exclude sources from graph
 *   --exclude-tests   Exclude test nodes (default: true)
 *   --tag <tag>       Only include models with this tag and their dependencies
 *
 * Examples:
 *   node lineage-export.js --format mermaid > lineage.md
 *   node lineage-export.js --format dot --out lineage.dot
 *   node lineage-export.js --format csv --out lineage.csv
 *   node lineage-export.js --format d3 --out lineage.json
 */

'use strict';

const fs = require('fs');

// --- Argument parsing ---
const args = process.argv.slice(2);
let manifestPath = 'target/manifest.json';
const opts = { format: 'mermaid', out: null, onlyModels: false, tag: null };

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--format') opts.format = args[++i];
  else if (args[i] === '--out') opts.out = args[++i];
  else if (args[i] === '--only-models') opts.onlyModels = true;
  else if (args[i] === '--tag') opts.tag = args[++i];
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
const allNodes = { ...nodes, ...sources };

// --- Build edges ---
const edges = [];
const nodeSet = new Set();

// Find tagged model IDs if filtering
let taggedIds = null;
if (opts.tag) {
  taggedIds = new Set(
    Object.values(nodes)
      .filter(n => n.resource_type === 'model' && (n.tags || []).includes(opts.tag))
      .map(n => n.unique_id)
  );
}

// Collect edges from model depends_on
for (const [id, node] of Object.entries(nodes)) {
  if (!['model', 'snapshot', 'seed'].includes(node.resource_type)) continue;
  if (opts.tag && taggedIds && !taggedIds.has(id)) continue;

  const deps = node.depends_on?.nodes || [];
  deps.forEach(dep => {
    if (!allNodes[dep]) return;
    const depNode = allNodes[dep];
    if (opts.onlyModels && depNode.resource_type === 'source') return;
    edges.push({ from: dep, to: id });
    nodeSet.add(dep);
    nodeSet.add(id);
  });

  if (deps.length === 0) nodeSet.add(id);
}

// Node metadata
function getMeta(id) {
  const node = allNodes[id];
  if (!node) return { name: id, type: 'unknown', schema: '' };
  if (node.resource_type === 'source') {
    return { name: `${node.source_name}.${node.name}`, type: 'source', schema: node.schema || '' };
  }
  return {
    name: node.name,
    type: node.resource_type,
    schema: node.schema || '',
    materialized: node.config?.materialized || '',
  };
}

// Safe node ID for graph formats
function safeId(id) {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

// --- Format output ---
let output = '';

if (opts.format === 'mermaid') {
  const lines = ['```mermaid', 'flowchart LR'];

  // Node definitions with styles
  nodeSet.forEach(id => {
    const meta = getMeta(id);
    const sid = safeId(id);
    if (meta.type === 'source') {
      lines.push(`  ${sid}["📥 ${meta.name}"]:::source`);
    } else if (meta.materialized === 'table') {
      lines.push(`  ${sid}["📊 ${meta.name}"]:::table`);
    } else if (meta.materialized === 'incremental') {
      lines.push(`  ${sid}["⚡ ${meta.name}"]:::incremental`);
    } else {
      lines.push(`  ${sid}["🔄 ${meta.name}"]:::view`);
    }
  });

  lines.push('');
  edges.forEach(e => {
    lines.push(`  ${safeId(e.from)} --> ${safeId(e.to)}`);
  });

  lines.push('');
  lines.push('  classDef source fill:#7ED321,color:#fff,stroke:#5BA318');
  lines.push('  classDef table fill:#4A90D9,color:#fff,stroke:#2E6DA3');
  lines.push('  classDef incremental fill:#F5A623,color:#fff,stroke:#C77D00');
  lines.push('  classDef view fill:#9B59B6,color:#fff,stroke:#7D3C98');
  lines.push('```');
  output = lines.join('\n');

} else if (opts.format === 'dot') {
  const lines = ['digraph dbt_lineage {', '  rankdir=LR;', '  node [shape=box, style=filled, fontname="Helvetica", fontcolor="white"];', ''];

  const colors = { source: '#7ED321', model: '#4A90D9', snapshot: '#9B59B6', seed: '#F5A623' };
  nodeSet.forEach(id => {
    const meta = getMeta(id);
    const color = colors[meta.type] || '#AAAAAA';
    lines.push(`  "${id}" [label="${meta.name}", fillcolor="${color}"];`);
  });

  lines.push('');
  edges.forEach(e => lines.push(`  "${e.from}" -> "${e.to}";`));
  lines.push('}');
  output = lines.join('\n');

} else if (opts.format === 'csv') {
  const lines = ['from_node,to_node,from_type,to_type,from_name,to_name,from_schema,to_schema'];
  edges.forEach(e => {
    const fromMeta = getMeta(e.from);
    const toMeta = getMeta(e.to);
    lines.push([e.from, e.to, fromMeta.type, toMeta.type, fromMeta.name, toMeta.name, fromMeta.schema, toMeta.schema].join(','));
  });
  output = lines.join('\n');

} else if (opts.format === 'd3') {
  // D3.js force graph format
  const nodeList = Array.from(nodeSet).map((id, i) => {
    const meta = getMeta(id);
    return { id: safeId(id), originalId: id, name: meta.name, type: meta.type, schema: meta.schema, index: i };
  });
  const nodeIndex = Object.fromEntries(nodeList.map((n, i) => [n.originalId, i]));

  const linkList = edges.map(e => ({
    source: safeId(e.from),
    target: safeId(e.to),
  }));

  output = JSON.stringify({
    nodes: nodeList,
    links: linkList,
    metadata: {
      generated: new Date().toISOString(),
      dbt_version: manifest.metadata?.dbt_version,
      node_count: nodeList.length,
      edge_count: linkList.length,
    }
  }, null, 2);
}

// --- Write output ---
if (opts.out) {
  fs.writeFileSync(opts.out, output + '\n', 'utf8');
  process.stderr.write(`Written to ${opts.out}\n`);
  process.stderr.write(`Nodes: ${nodeSet.size}, Edges: ${edges.length}\n`);
} else {
  console.log(output);
}
