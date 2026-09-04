#!/usr/bin/env node
/**
 * TESTClaw Test Linter — Static checker for test code quality
 *
 * Scans all .spec.ts and .test.ts files under tests/suites/ for
 * known error patterns that cause runtime failures. Returns non-zero
 * exit code if any errors are found.
 *
 * Usage:
 *   node scripts/lint-tests.mjs              # Check all
 *   node scripts/lint-tests.mjs --fix        # Auto-fix where possible
 *   node scripts/lint-tests.mjs --suite ui-interaction  # Check one suite only
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const suitesDir = path.resolve(rootDir, 'tests', 'suites');

// ─── Rule definitions ───────────────────────────────────────────────

const RULES = [
  {
    id: 'PW001',
    severity: 'error',
    message: 'test.describe.skip() second arg must be object, not string',
    pattern: /test\.describe\.skip\(\s*"[^"]*"\s*,\s*"/,
    fix: fixDescribeSkipStringDetail,
    appliesTo: '.spec.ts',
  },
  {
    id: 'PW002',
    severity: 'error',
    message: 'request.newContext() is not available in Playwright test runner',
    pattern: /request\.newContext\(/,
    fix: null, // Cannot auto-fix; needs manual rewrite
    appliesTo: '.spec.ts',
  },
  {
    id: 'PW003',
    severity: 'error',
    message: 'request.create() is not available in Playwright test runner',
    pattern: /request\.create\(\)/,
    fix: null,
    appliesTo: '.spec.ts',
  },
  {
    id: 'PW004',
    severity: 'error',
    message: 'Direct fetch() not available in Playwright, use request fixture instead',
    pattern: /\bfetch\(\s*["`]/,
    fix: null,
    appliesTo: '.spec.ts',
  },
  {
    id: 'PW005',
    severity: 'error',
    message: 'page.goto() must use HashRouter prefix /#/ (e.g. /#/chat not /chat)',
    pattern: /page\.goto\(\s*["'`]\/(?!#\/)/,
    fix: fixHashRouter,
    appliesTo: '.spec.ts',
  },
  {
    id: 'PW006',
    severity: 'warning',
    message: 'Non-existent API route: /api/arch/*, /api/marketplace/*, /api/capability',
    pattern: /\/api\/(arch|marketplace|capability)\//,
    fix: null,
    appliesTo: '.spec.ts',
  },
  {
    id: 'VT001',
    severity: 'error',
    message: 'it.skip() bad syntax: second arg has colon inside quotes (e.g. "TC_XXX": desc")',
    pattern: /it\.skip\(\s*"[^"]*"\s*,\s*"[^"]*":\s/,
    fix: fixItSkipBadSyntax,
    appliesTo: '.test.ts',
  },
  {
    id: 'API001',
    severity: 'error',
    message: "Submit uses 'content' field but real API uses 'inputText'",
    pattern: /(?:data|body)\s*:\s*\{[^}]*(?:content\s*:|\"content\"|'content')[^}]*\}/s,
    // More targeted: look for { content: or { "content":
    check: (content) => {
      // Match request.post bodies with content field
      const lines = content.split('\n');
      const bad = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          (line.includes('data:') || line.includes('body:')) &&
          line.includes('content') &&
          !line.includes('inputText') &&
          !line.includes('contentType') &&
          !line.includes('Content-Type') &&
          !line.includes('content-') &&
          !line.includes('// content')
        ) {
          bad.push(i + 1);
        }
      }
      return bad;
    },
    fix: fixContentToInputText,
    appliesTo: '.spec.ts',
  },
  {
    id: 'API002',
    severity: 'warning',
    message: 'PUT /api/v1/sessions/:id/title endpoint does not exist (returns 404)',
    pattern: /\/sessions\/[^/]+\/title/,
    fix: null,
    appliesTo: '.spec.ts',
  },
];

// ─── Fix functions ──────────────────────────────────────────────────

function fixDescribeSkipStringDetail(content, filePath) {
  // test.describe.skip("reason string", "title", () => {
  // → test.describe.skip("title [skip: reason string]", () => {
  let fixed = content;
  let count = 0;
  fixed = fixed.replace(/test\.describe\.skip\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*\(\)\s*=>\s*\{/g, (_, reason, title) => {
    count++;
    return `test.describe.skip("${title} [skip: ${reason}]", () => {`;
  });
  return { content: fixed, count };
}

function fixHashRouter(content, filePath) {
  // page.goto("/chat") → page.goto("/#/chat")
  // page.goto("/chat/xxx") → page.goto("/#/chat/xxx")
  // But NOT page.goto("/#/chat") (already correct) or page.goto("http://...")
  let fixed = content;
  let count = 0;
  fixed = fixed.replace(/page\.goto\(\s*["'`]\/(?!#\/)([^"'`]+)["'`]/g, (match, path) => {
    count++;
    return match.replace(`/${path}`, `/#/${path}`);
  });
  return { content: fixed, count };
}

function fixItSkipBadSyntax(content, filePath) {
  // it.skip("reason", "TC_XXX": description", async () => {
  // → it.skip("reason - TC_XXX: description", async () => {
  let fixed = content;
  let count = 0;
  fixed = fixed.replace(/it\.skip\(\s*"([^"]+)"\s*,\s*"([^"]+)":\s*([^,]+),\s*async\s*\(\)\s*=>\s*\{/g, (_, reason, tcId, desc) => {
    count++;
    return `it.skip("${reason} - ${tcId}: ${desc}", async () => {`;
  });
  // Also handle cases where desc has closing quote already
  fixed = fixed.replace(/it\.skip\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*:\s*([^"]+)"\s*,\s*async\s*\(\)\s*=>\s*\{/g, (_, reason, tcId, desc) => {
    count++;
    return `it.skip("${reason} - ${tcId}: ${desc}", async () => {`;
  });
  return { content: fixed, count };
}

function fixContentToInputText(content, filePath) {
  let fixed = content;
  let count = 0;
  const lines = content.split('\n');
  const newLines = lines.map((line, i) => {
    if (
      (line.includes('data:') || line.includes('body:')) &&
      line.includes('content') &&
      !line.includes('inputText') &&
      !line.includes('contentType') &&
      !line.includes('Content-Type') &&
      !line.includes('content-') &&
      !line.includes('// content')
    ) {
      count++;
      return line.replace(/content/, 'inputText');
    }
    return line;
  });
  return { content: newLines.join('\n'), count };
}

// ─── Scanner ────────────────────────────────────────────────────────

function walkDir(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

function lintFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(rootDir, filePath);
  const findings = [];

  for (const rule of RULES) {
    // Skip rules that don't apply to this file type
    if (rule.appliesTo && !filePath.endsWith(rule.appliesTo)) continue;

    if (rule.check) {
      // Custom check function
      const badLines = rule.check(content);
      if (badLines && badLines.length > 0) {
        for (const line of badLines) {
          findings.push({
            rule: rule.id,
            severity: rule.severity,
            message: rule.message,
            file: relPath,
            line,
          });
        }
      }
    } else if (rule.pattern) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (rule.pattern.test(lines[i])) {
          findings.push({
            rule: rule.id,
            severity: rule.severity,
            message: rule.message,
            file: relPath,
            line: i + 1,
          });
        }
      }
    }
  }

  return findings;
}

function fixFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  let fixed = content;
  let totalFixes = 0;

  for (const rule of RULES) {
    if (!rule.fix) continue;
    if (rule.appliesTo && !filePath.endsWith(rule.appliesTo)) continue;

    // Check if this rule has findings for this file
    const hasFinding = rule.pattern ? rule.pattern.test(content) : rule.check ? rule.check(content).length > 0 : false;

    if (hasFinding) {
      const result = rule.fix(fixed, filePath);
      if (result.count > 0) {
        fixed = result.content;
        totalFixes += result.count;
        console.log(`  [${rule.id}] Fixed ${result.count} occurrence(s)`);
      }
    }
  }

  if (totalFixes > 0) {
    fs.writeFileSync(filePath, fixed, 'utf8');
  }

  return totalFixes;
}

// ─── Main ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const doFix = args.includes('--fix');
const suiteFilter = args.find((a) => a.startsWith('--suite='))?.split('=')[1];

// Collect files
let files = [];
if (suiteFilter) {
  const suiteDir = path.join(suitesDir, suiteFilter);
  files.push(...walkDir(suiteDir, '.spec.ts'));
  files.push(...walkDir(suiteDir, '.test.ts'));
} else {
  files.push(...walkDir(suitesDir, '.spec.ts'));
  files.push(...walkDir(suitesDir, '.test.ts'));
}

console.log(`\nTESTClaw Test Linter`);
console.log(`Scanning ${files.length} test files...\n`);

if (doFix) {
  let totalFixes = 0;
  for (const file of files) {
    const n = fixFile(file);
    totalFixes += n;
  }
  console.log(`\nTotal fixes applied: ${totalFixes}`);
  if (totalFixes > 0) {
    console.log('Re-running lint to check for remaining issues...\n');
  }
}

// Always run lint check (even after fix, to show remaining)
let allFindings = [];
for (const file of files) {
  allFindings.push(...lintFile(file));
}

// Group by rule
const byRule = {};
for (const f of allFindings) {
  if (!byRule[f.rule]) byRule[f.rule] = [];
  byRule[f.rule].push(f);
}

// Report
const errors = allFindings.filter((f) => f.severity === 'error');
const warnings = allFindings.filter((f) => f.severity === 'warning');

console.log(`\n${'='.repeat(60)}`);
console.log(`Lint Results: ${errors.length} errors, ${warnings.length} warnings`);
console.log(`${'='.repeat(60)}\n`);

if (allFindings.length === 0) {
  console.log('All checks passed. No issues found.\n');
  process.exit(0);
}

for (const [ruleId, findings] of Object.entries(byRule)) {
  const first = findings[0];
  const icon = first.severity === 'error' ? '✗' : '⚠';
  console.log(`${icon} [${ruleId}] ${first.message} (${findings.length} files)`);
  const filesSet = [...new Set(findings.map((f) => f.file))];
  for (const f of filesSet.slice(0, 10)) {
    const lines = findings.filter((x) => x.file === f).map((x) => x.line);
    console.log(`    ${f}:${lines.join(',')}`);
  }
  if (filesSet.length > 10) {
    console.log(`    ... and ${filesSet.length - 10} more files`);
  }
  console.log();
}

if (errors.length > 0) {
  console.log(`\nFound ${errors.length} errors. Fix with: node scripts/lint-tests.mjs --fix`);
  console.log('(Not all issues can be auto-fixed. Manual review needed for PW002, PW003, PW004, PW006, API002.)\n');
  process.exit(1);
} else {
  process.exit(0);
}
