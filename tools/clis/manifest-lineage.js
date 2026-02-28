#!/usr/bin/env node
/**
 * manifest-lineage.js — Export dbt lineage graph from manifest.json
 *
 * Usage:
 *   node manifest-lineage.js [manifest-path] [options]
 *
 * Options:
 *   --model <name>     Show lineage for a specific model
 *   --upstream         Include upstream dependencies (default: true)
 *   --downstream       Include downstream dependents
 *   --depth <n>        Max traversal depth (default: 5)
 *   --format dot       Output as Graphviz DOT (default)
 *   --format json      Output as JSON adjacency list
 *   --format text      Output as indented text tree
 *
 * Examples:
 *   node manifest-lineage.js --model fct_orders --format text
 *   node manifest-lineage.js --model fct_orders --downstream --depth 3
 *   node manifest-lineage.js > lineage.dot && dot -Tsvg lineage.dot > lineage.svg
 */

'use strict';

const fs = require('fs');

// --- Argument parsing ---
const args = process.argv.slice(2);
let manifestPath = 'target/manifest.json';
const opts = { model: null, upstream: true, downstream: false, depth: 5, format: 'dot' };

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model') opts.model = args[++i];
  else if (args[i] === '--upstream') opts.upstream = true;
  else if (args[i] === '--downstream') opts.downstream = true;
  else if (args[i] === '--depth') opts.depth = parseInt(args[++i], 10);
  else if (args[i] === '--format') opts.format = args[++i];
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

// Build adjacency maps
const upstreamMap = {};   // node -> [upstream nodes]
const downstreamMap = {}; // node -> [downstream nodes]

for (const [id, node] of Object.entries(nodes)) {
  if (!['model', 'test', 'snapshot', 'seed'].includes(node.resource_type)) continue;
  const deps = (node.depends_on?.nodes || []).filter(d => allNodes[d]);
  upstreamMap[id] = deps;
  deps.forEach(dep => {
    if (!downstreamMap[dep]) downstreamMap[dep] = [];
    downstreamMap[dep].push(id);
  });
}

// Resolve starting node
function findNode(name) {
  const matches = Object.keys(nodes).filter(id => {
    const n = nodes[id];
    return n.resource_type === 'model' && (n.name === name || id.endsWith(`.${name}`));
  });
  return matches[0] || null;
}

// BFS traversal
function traverse(startId, direction, maxDepth) {
  const visited = new Set();
  const edges = [];
  const queue = [[startId, 0]];
  visited.add(startId);

  while (queue.length > 0) {
    const [current, depth] = queue.shift();
    if (depth >= maxDepth) continue;

    const neighbors = direction === 'upstream'
      ? (upstreamMap[current] || [])
      : (downstreamMap[current] || []);

    for (const neighbor of neighbors) {
      const edge = direction === 'upstream'
        ? [neighbor, current]
        : [current, neighbor];
      edges.push(edge);
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([neighbor, depth + 1]);
      }
    }
  }
  return { visited, edges };
}

// Get node label (short name)
function label(id) {
  const node = allNodes[id];
  if (!node) return id;
  if (node.resource_type === 'source') return `${node.source_name}.${node.name}`;
  return node.name;
}

// Get node type for styling
function nodeType(id) {
  const node = allNodes[id];
  if (!node) return 'unknown';
  return node.resource_type;
}

// --- Main logic ---
let allEdges = [];
let allVisited = new Set();

if (opts.model) {
  const startId = findNode(opts.model);
  if (!startId) {
    console.error(`Model '${opts.model}' not found in manifest.`);
    process.exit(1);
  }
  allVisited.add(startId);

  if (opts.upstream) {
    const result = traverse(startId, 'upstream', opts.depth);
    result.edges.forEach(e => allEdges.push(e));
    result.visited.forEach(v => allVisited.add(v));
  }
  if (opts.downstream) {
    const result = traverse(startId, 'downstream', opts.depth);
    result.edges.forEach(e => allEdges.push(e));
    result.visited.forEach(v => allVisited.add(v));
  }
} else {
  // Full graph — all model-to-model edges
  for (const [id, deps] of Object.entries(upstreamMap)) {
    deps.forEach(dep => allEdges.push([dep, id]));
    allVisited.add(id);
    deps.forEach(d => allVisited.add(d));
  }
}

// Deduplicate edges
const edgeSet = new Set(allEdges.map(([a, b]) => `${a}|||${b}`));
const edges = Array.from(edgeSet).map(s => s.split('|||'));

// --- Output formats ---
if (opts.format === 'dot') {
  const typeColors = {
    model: '#4A90D9',
    source: '#7ED321',
    seed: '#F5A623',
    snapshot: '#9B59B6',
    test: '#E74C3C',
  };

  console.log('digraph dbt_lineage {');
  console.log('  rankdir=LR;');
  console.log('  node [shape=box, style=filled, fontname="Helvetica"];');
  console.log('');

  allVisited.forEach(id => {
    const type = nodeType(id);
    const color = typeColors[type] || '#AAAAAA';
    const lbl = label(id).replace(/"/g, '\\"');
    const border = opts.model && id === findNode(opts.model) ? ', penwidth=3' : '';
    console.log(`  "${id}" [label="${lbl}", fillcolor="${color}", fontcolor="white"${border}];`);
  });

  console.log('');
  edges.forEach(([from, to]) => {
    console.log(`  "${from}" -> "${to}";`);
  });
  console.log('}');

} else if (opts.format === 'json') {
  const adjacency = {};
  allVisited.forEach(id => {
    adjacency[label(id)] = {
      id,
      type: nodeType(id),
      upstream: (upstreamMap[id] || []).filter(d => allVisited.has(d)).map(label),
      downstream: (downstreamMap[id] || []).filter(d => allVisited.has(d)).map(label),
    };
  });
  console.log(JSON.stringify(adjacency, null, 2));

} else if (opts.format === 'text') {
  // Print tree starting from root nodes (nodes with no upstream in the visited set)
  const hasUpstream = new Set(edges.map(([, to]) => to));
  const roots = Array.from(allVisited).filter(id => !hasUpstream.has(id));

  const printed = new Set();
  function printTree(id, indent) {
    const lbl = label(id);
    const type = nodeType(id);
    const marker = printed.has(id) ? ' (see above)' : '';
    console.log(`${'  '.repeat(indent)}${type === 'source' ? '[src]' : '[mdl]'} ${lbl}${marker}`);
    if (!printed.has(id)) {
      printed.add(id);
      const children = edges.filter(([from]) => from === id).map(([, to]) => to);
      children.forEach(child => printTree(child, indent + 1));
    }
  }

  console.log(opts.model ? `Lineage tree for: ${opts.model}\n` : 'Full lineage tree:\n');
  roots.forEach(root => printTree(root, 0));
}
