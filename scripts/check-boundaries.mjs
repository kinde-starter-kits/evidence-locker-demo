#!/usr/bin/env node
// Boundary gate: packages/agents must never reach into the app or Convex.
//
// It may talk to the app ONLY through @evidence-locker/api-client (HTTP + bearer).
// This script fails (exit 1) if any source file under packages/agents imports
// `convex`, `apps/web`, or any `_generated` code — whether by bare specifier or
// relative path.

import {readdirSync, readFileSync} from 'node:fs';
import {join, extname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const target = join(repoRoot, 'packages', 'agents');

const FORBIDDEN = [
  {label: 'convex', test: (s) => /(^|\/)convex(\/|$)/.test(s)},
  {label: 'apps/web', test: (s) => /(^|\/)apps\/web(\/|$)/.test(s)},
  {label: '_generated', test: (s) => s.includes('_generated')}
];

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Collect every source file under a directory, skipping node_modules/dist/dotdirs. */
function collect(dir) {
  const files = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collect(full));
    } else if (SOURCE_EXTS.has(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

// Matches `import ... from 'x'`, `export ... from 'x'`, bare `import 'x'`,
// and `import('x')` / `require('x')`.
const SPECIFIER_RE =
  /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const violations = [];

for (const file of collect(target)) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(SPECIFIER_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (!specifier) continue;
    for (const rule of FORBIDDEN) {
      if (rule.test(specifier)) {
        violations.push({file: relative(repoRoot, file), specifier, rule: rule.label});
      }
    }
  }
}

if (violations.length > 0) {
  console.error('✖ Boundary check FAILED — packages/agents may not import the app or Convex.\n');
  for (const v of violations) {
    console.error(`  ${v.file}: forbidden import "${v.specifier}" (matched rule: ${v.rule})`);
  }
  console.error('\nAgents reach the app only through @evidence-locker/api-client.');
  process.exit(1);
}

console.log('✓ Boundary check passed — packages/agents imports nothing from convex/apps/web/_generated.');
