'use strict';

/**
 * Post-processing script to fix Swagger 2.0 parameter incompatibility.
 *
 * In Swagger 2.0, non-body parameters (query, path, header, formData) must
 * define type/format/maxLength etc. directly on the parameter object, NOT
 * inside a nested `schema:` key. The conversion script incorrectly kept the
 * OpenAPI 3.x `schema:` wrapper for non-body parameters.
 *
 * This script reads each module file, flattens `schema:` into the parameter
 * object for non-body params, and writes the file back.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const SWAGGER_DIR = path.join(__dirname, '..', 'docs', 'apis', 'swagger');

const PARAM_FIELDS = [
  'type',
  'format',
  'default',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'enum',
  'multipleOf',
  'items',
  'collectionFormat',
  'allowEmptyValue',
  'x-nullable',
  'x-minProperties',
];

function flattenParam(param) {
  if (!param.schema || param.in === 'body') return param;

  const schema = param.schema;
  const out = {};
  for (const k of ['name', 'in', 'description', 'required']) {
    if (k in param) out[k] = param[k];
  }
  for (const k of PARAM_FIELDS) {
    if (k in schema) out[k] = schema[k];
  }
  if (schema.$ref) {
    out.schema = { $ref: schema.$ref };
  }
  for (const k of Object.keys(schema)) {
    if (!PARAM_FIELDS.includes(k) && k !== '$ref' && !(k in out)) {
      out[k] = schema[k];
    }
  }
  return out;
}

function fixOperation(op) {
  if (!op.parameters) return op;
  op.parameters = op.parameters.map((p) => {
    if (p.in === 'body' || !p.schema) return p;
    return flattenParam(p);
  });
  return op;
}

function fixPathItem(pathItem) {
  for (const method of ['get', 'post', 'put', 'delete', 'patch', 'head', 'options']) {
    if (pathItem[method]) fixOperation(pathItem[method]);
  }
  if (pathItem.parameters) {
    pathItem.parameters = pathItem.parameters.map((p) => {
      if (p.in === 'body' || !p.schema) return p;
      return flattenParam(p);
    });
  }
  return pathItem;
}

function main() {
  const files = fs.readdirSync(SWAGGER_DIR).filter((f) => f.endsWith('.yaml') && f !== 'index.yaml' && f !== 'common.yaml');
  let totalFixed = 0;

  for (const file of files) {
    const fp = path.join(SWAGGER_DIR, file);
    const raw = fs.readFileSync(fp, 'utf8');
    const doc = yaml.load(raw);
    if (!doc || !doc.paths) continue;

    let fixedCount = 0;
    for (const [pathStr, pathItem] of Object.entries(doc.paths)) {
      if (typeof pathItem !== 'object') continue;
      fixPathItem(pathItem);
      for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
        if (pathItem[method] && pathItem[method].parameters) {
          for (const p of pathItem[method].parameters) {
            if (p.in !== 'body' && !p.schema) fixedCount++;
          }
        }
      }
    }

    const out = yaml.dump(doc, { lineWidth: 120, noRefs: true, quotingType: '"' });
    fs.writeFileSync(fp, out, 'utf8');
    console.log('Fixed ' + file + ': ' + fixedCount + ' non-body params flattened');
    totalFixed += fixedCount;
  }

  console.log('\nTotal: ' + totalFixed + ' non-body parameters fixed across ' + files.length + ' files');
}

main();
