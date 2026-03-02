#!/usr/bin/env node
/**
 * skill-index.js — Generate skills/index.json from SKILL.md frontmatter.
 *
 * Usage:
 *   node tools/clis/skill-index.js
 *   node tools/clis/skill-index.js --output path/to/index.json
 *   node tools/clis/skill-index.js --pretty   # pretty-print JSON
 *
 * Reads every skills/<name>/SKILL.md, parses YAML frontmatter, and writes
 * a machine-readable index for agent skill routing.
 *
 * No external dependencies — uses only Node.js built-ins (fs, path).
 */

'use strict';

const fs = require('fs');
const path = require('path');

// --- CLI args ---
const args = process.argv.slice(2);
const pretty = args.includes('--pretty');
const outputIdx = args.indexOf('--output');
const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : path.join(__dirname, '../../skills/index.json');

// --- YAML frontmatter parser (handles strings, arrays, scalars) ---
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result = {};
  const lines = yaml.split('\n');
  let currentKey = null;
  let currentArray = null;

  for (const line of lines) {
    // Array item
    if (/^  - (.+)$/.test(line)) {
      const value = line.replace(/^  - /, '').trim().replace(/^["']|["']$/g, '');
      if (currentArray !== null) {
        result[currentKey].push(value);
      }
      continue;
    }

    // Key: value line
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*): *(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim().replace(/^["']|["']$/g, '');

      if (val === '' || val === null) {
        // Next lines may be array items
        result[currentKey] = [];
        currentArray = currentKey;
      } else {
        result[currentKey] = val;
        currentArray = null;
      }
      continue;
    }

    // Empty line — stop array accumulation
    if (line.trim() === '') {
      currentArray = null;
    }
  }

  return result;
}

// --- Main ---
const skillsDir = path.join(__dirname, '../../skills');
const skillDirs = fs.readdirSync(skillsDir).filter(name => {
  const skillPath = path.join(skillsDir, name);
  return fs.statSync(skillPath).isDirectory() &&
    fs.existsSync(path.join(skillPath, 'SKILL.md'));
});

const index = skillDirs.map(dirName => {
  const skillFile = path.join(skillsDir, dirName, 'SKILL.md');
  const content = fs.readFileSync(skillFile, 'utf8');
  const fm = parseFrontmatter(content);

  if (!fm || !fm.name) {
    process.stderr.write(`Warning: no valid frontmatter in skills/${dirName}/SKILL.md\n`);
    return null;
  }

  // Normalize array fields
  const arrayFields = ['triggers', 'reads_first', 'consumes', 'cli_tools', 'produces', 'validates_with'];
  for (const field of arrayFields) {
    if (fm[field] && !Array.isArray(fm[field])) {
      fm[field] = [fm[field]];
    }
  }

  return {
    name: fm.name,
    description: fm.description || '',
    triggers: fm.triggers || [],
    reads_first: fm.reads_first || [],
    consumes: fm.consumes || [],
    cli_tools: fm.cli_tools || [],
    produces: fm.produces || [],
    min_dbt_version: fm.min_dbt_version || null,
    validates_with: fm.validates_with || [],
    path: `skills/${dirName}/SKILL.md`,
  };
}).filter(Boolean);

// Sort alphabetically by name
index.sort((a, b) => a.name.localeCompare(b.name));

const output = { generated_at: new Date().toISOString(), skills: index };
const json = pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output);

fs.writeFileSync(outputPath, json + '\n');
process.stdout.write(`Wrote ${index.length} skills to ${outputPath}\n`);
