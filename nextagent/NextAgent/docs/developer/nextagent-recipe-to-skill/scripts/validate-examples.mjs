import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSkillFrontmatter } from '@nextagent/agent-capability';
import { RecipeDefinitionSchema } from '@nextagent/agent-contracts/core';
import { createWorkflowNodeCatalog } from '@nextagent/agent-workflow/nodes';
import { Ajv } from 'ajv/dist/ajv.js';
import { load as loadYaml } from 'js-yaml';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(scriptDirectory, '..');
const guide = readFileSync(join(skillRoot, 'references', 'development-guide.md'), 'utf8');

const validateRecipe = new Ajv({ allErrors: true, strict: false }).compile(RecipeDefinitionSchema);
const checks = [];

run('conversion skill manifest', () => {
  parseAcceptedSkill('nextagent-recipe-to-skill', readFileSync(join(skillRoot, 'SKILL.md'), 'utf8'));
});

const embeddedSkill = run('embedded recipe Skill manifest', () =>
  parseAcceptedSkill('ran-alarm-diagnosis', extract('example', 'recipe-embedded-skill', 'markdown')),
);
const describedSkill = run('description and tools Skill manifest', () =>
  parseAcceptedSkill('config-audit', extract('example', 'description-tools-skill', 'markdown')),
);
const embeddedRecipe = run('embedded recipe schema', () => parseAcceptedRecipe('recipe-embedded-reference'));
const blockedRecipe = run('workflow-only recipe schema', () => parseAcceptedRecipe('workflow-required-recipe'));

const embeddedReport = extract('example-report', 'recipe-embedded', 'text');
const describedReport = extract('example-report', 'description-and-tools', 'text');
const blockedReport = extract('example-report', 'workflow-required', 'text');

run('black-box report contract', () => {
  for (const report of [embeddedReport, describedReport, blockedReport]) {
    for (const field of ['Black-box effect:', 'Effective tool calls:', 'Workflow effect:', 'Explicit non-effects:']) {
      assert.ok(report.includes(field), `report is missing ${field}`);
    }
  }
});

run('embedded node coverage and tool invariant', () => {
  const rows = mappingRows(embeddedReport, 6);
  const recipeNodeIds = Object.keys(embeddedRecipe.flowGraph.nodes).sort();
  assert.deepEqual(
    rows.map((columns) => columns[0]).sort(),
    recipeNodeIds,
  );
  assert.deepEqual(toolTargets(rows), embeddedSkill.frontmatter.allowedTools ?? []);
  assert.ok(embeddedReport.includes('Derived allowed-tools: none'));
});

run('described tool invariant', () => {
  const rows = mappingRows(describedReport, 3);
  assert.deepEqual(toolTargets(rows).sort(), [...(describedSkill.frontmatter.allowedTools ?? [])].sort());
  assert.deepEqual(toolTargets(rows).sort(), ['Grep', 'Read']);
});

run('workflow-only conversion is blocked', () => {
  const nodeTypes = Object.values(blockedRecipe.flowGraph.nodes).map((node) => node.type);
  assert.ok(nodeTypes.includes('PARALLEL'));
  assert.ok(blockedReport.includes('Result: RECIPE_REQUIRES_WORKFLOW'));
  assert.ok(blockedReport.includes('Generated files: none'));
});

run('node catalog mapping assumptions', () => {
  const registered = new Set(Object.keys(createWorkflowNodeCatalog().handlers));
  for (const nodeType of ['RESTFUL', 'PYTHON', 'AGENT']) {
    assert.ok(registered.has(nodeType), `${nodeType} handler must remain registered`);
  }
  for (const nodeType of ['TOOL', 'SKILL', 'ROUTER']) {
    assert.ok(!registered.has(nodeType), `${nodeType} gained a handler; review the conversion mapping`);
  }
});

console.log(`Validation summary: ${checks.length}/${checks.length} checks passed`);
console.log('Observed matrix: embedded=2 files/no tool calls; described=1 file/Read+Grep; parallel=blocked/0 files');

function extract(markerKind, label, language) {
  const marker = `<!-- ${markerKind}: ${label} -->`;
  const markerAt = guide.indexOf(marker);
  assert.notEqual(markerAt, -1, `missing ${marker}`);
  const headerAt = guide.indexOf(`\`\`\`${language}`, markerAt);
  const start = guide.indexOf('\n', headerAt) + 1;
  const end = guide.indexOf('\n```', start);
  assert.ok(headerAt >= 0 && start > 0 && end >= 0, `missing fenced block for ${label}`);
  return guide.slice(start, end);
}

function parseAcceptedSkill(candidateName, source) {
  const parsed = parseSkillFrontmatter({
    frontmatterSource: source,
    safeCandidateName: candidateName,
    providerId: 'recipe-to-skill-validation',
  });
  assert.equal(parsed.outcome, 'accepted', JSON.stringify(parsed.diagnostics));
  assert.deepEqual(parsed.diagnostics, []);
  return parsed;
}

function parseAcceptedRecipe(label) {
  const recipe = loadYaml(extract('example', label, 'yaml'));
  assert.equal(validateRecipe(recipe), true, JSON.stringify(validateRecipe.errors));
  return recipe;
}

function mappingRows(report, columnCount) {
  const rows = report
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('  ') && line.includes('|'))
    .map((line) => line.trim().split('|').map((value) => value.trim()));
  assert.ok(rows.length > 0, 'mapping rows are missing');
  for (const row of rows) {
    assert.equal(row.length, columnCount, `unexpected mapping row: ${row.join(' | ')}`);
  }
  return rows;
}

function toolTargets(rows) {
  return rows
    .filter((columns) => columns.includes('TOOL_CALL'))
    .map((columns) => columns[columns.indexOf('TOOL_CALL') + 1]);
}

function run(name, operation) {
  const result = operation();
  checks.push(name);
  console.log(`PASS ${name}`);
  return result;
}
