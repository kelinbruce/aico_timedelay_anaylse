'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const SRC_DIR = path.join(__dirname, '..', 'docs', 'apis', 'openapi');
const OUT_DIR = path.join(__dirname, '..', 'docs', 'apis', 'swagger');

function loadYaml(rel) {
  const p = path.join(SRC_DIR, rel);
  return yaml.load(fs.readFileSync(p, 'utf8'));
}

function jsonPtrEscape(s) {
  return s.replace(/~/g, '~0').replace(/\//g, '~1');
}

// 鈹€鈹€ oneOf merging helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

// Merge multiple schema variants into a single Swagger 2.0-compatible schema.
// Strategy depends on the variant types:
//  - all primitive (number/integer/string/boolean): pick the "widest" type
//    and document the rest in description. For query-param contexts (string
//    variants), use type:string with merged constraints.
//  - all objects: merge properties, union required, union enum values.
//  - mixed: fall back to description-only.
function mergeOneOf(variants, parentNode) {
  if (variants.length === 0) return { type: 'string' };
  if (variants.length === 1) return convertSchema(variants[0]);

  // Check if all variants are primitive types
  const allPrimitives = variants.every((v) => !v.type || ['string', 'number', 'integer', 'boolean', 'null'].includes(v.type));
  const hasNull = variants.some((v) => v.type === 'null');
  const nonNull = variants.filter((v) => v.type !== 'null');

  if (hasNull && nonNull.length === 1) {
    // oneOf [T, null] -> T with x-nullable
    const v = convertSchema(nonNull[0]);
    if (v.$ref) {
      const r = { allOf: [{ $ref: v.$ref }], 'x-nullable': true };
      if (parentNode && parentNode.description) r.description = parentNode.description;
      return r;
    }
    const r = { ...v, 'x-nullable': true };
    if (parentNode && parentNode.description) r.description = parentNode.description;
    return r;
  }

  if (allPrimitives) {
    // For primitive variants, merge into a single schema.
    // If any variant is 'string', use 'string' as the base type (query params
    // are always strings in HTTP). Otherwise pick the first type.
    const stringVariant = nonNull.find((v) => v.type === 'string');
    const numberVariant = nonNull.find((v) => v.type === 'number' || v.type === 'integer');
    const booleanVariant = nonNull.find((v) => v.type === 'boolean');

    if (stringVariant && (numberVariant || booleanVariant)) {
      // number|string or boolean|string -> use string with constraints
      const typesDesc = nonNull.map((v) => v.type).join(' or ');
      const out = { type: 'string', description: `Accepts ${typesDesc}${hasNull ? ' (nullable)' : ''}` };
      // Merge string constraints
      if (stringVariant.maxLength) out.maxLength = stringVariant.maxLength;
      if (stringVariant.minLength) out.minLength = stringVariant.minLength;
      if (stringVariant.pattern) out.pattern = stringVariant.pattern;
      // If there's an enum on the string variant, keep it
      if (stringVariant.enum) out.enum = stringVariant.enum;
      if (hasNull) out['x-nullable'] = true;
      return out;
    }

    // Same-type variants (e.g. two string variants) - merge
    if (nonNull.every((v) => v.type === nonNull[0].type)) {
      const base = convertSchema(nonNull[0]);
      // Merge constraints from all variants
      for (let i = 1; i < nonNull.length; i++) {
        const v = nonNull[i];
        if (v.enum) base.enum = [...(base.enum || []), ...v.enum];
        if (v.maxLength && (!base.maxLength || v.maxLength > base.maxLength)) base.maxLength = v.maxLength;
        if (v.minLength && (!base.minLength || v.minLength < base.minLength)) base.minLength = v.minLength;
      }
      if (hasNull) base['x-nullable'] = true;
      return base;
    }

    // Fallback: no type, just description
    const typesDesc = nonNull.map((v) => v.type).join(' or ');
    return { description: `Accepts ${typesDesc}${hasNull ? ' (nullable)' : ''}` };
  }

  // All object variants - merge into one schema
  const allObjects = nonNull.every((v) => v.type === 'object' || v.properties || v.$ref);
  if (allObjects) {
    const merged = { type: 'object', properties: {}, required: [] };
    for (const v of nonNull) {
      const converted = convertSchema(v);
      // If it's a $ref, we can't easily merge - use allOf
      if (converted.$ref) {
        return { allOf: nonNull.map(convertSchema) };
      }
      if (converted.properties) {
        for (const [propName, propSchema] of Object.entries(converted.properties)) {
          if (merged.properties[propName]) {
            // Merge same-named property from multiple variants
            const existing = merged.properties[propName];
            // Merge enum values
            if (propSchema.enum && existing.enum) {
              existing.enum = [...new Set([...existing.enum, ...propSchema.enum])];
            } else if (propSchema.enum) {
              existing.enum = propSchema.enum;
            }
            // For arrays: remove maxItems that only applies to one variant
            if (existing.type === 'array' && propSchema.type === 'array') {
              if (existing.maxItems === 0 && propSchema.maxItems === undefined) delete existing.maxItems;
              if (propSchema.maxItems === 0 && existing.maxItems === undefined) {
              } // keep as is
              // Merge items
              if (propSchema.items && !existing.items) existing.items = propSchema.items;
              else if (existing.items && propSchema.items && existing.items.$ref) {
                // Keep the variant with $ref items (more specific)
              }
            }
            // Merge other fields
            for (const k of Object.keys(propSchema)) {
              if (k !== 'enum' && k !== 'maxItems' && k !== 'items' && !(k in existing)) {
                existing[k] = propSchema[k];
              }
            }
          } else {
            merged.properties[propName] = propSchema;
          }
        }
      }
      if (converted.required) {
        merged.required = [...new Set([...merged.required, ...converted.required])];
      }
      if (converted.additionalProperties !== undefined) {
        merged.additionalProperties = converted.additionalProperties;
      }
    }
    // Don't force all fields required - only the intersection
    // Actually for union types, keep all required from all variants
    // since the response could be either variant
    if (merged.required.length === 0) delete merged.required;
    if (hasNull) merged['x-nullable'] = true;
    return merged;
  }

  // Fallback: use allOf
  return { allOf: nonNull.map(convertSchema) };
}

// Recursively convert an OpenAPI 3.1 schema fragment to Swagger 2.0.
function convertSchema(node) {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map(convertSchema);
  if (typeof node !== 'object') return node;

  // Handle $ref
  if (node.$ref && typeof node.$ref === 'string') {
    return { $ref: node.$ref.replace('#/components/schemas/', '#/definitions/') };
  }

  // Handle oneOf
  if (node.oneOf) {
    return mergeOneOf(node.oneOf, node);
  }

  // Handle anyOf (treat same as oneOf for Swagger 2.0)
  if (node.anyOf) {
    return mergeOneOf(node.anyOf, node);
  }

  // Handle allOf (supported in Swagger 2.0)
  if (node.allOf) {
    return { allOf: node.allOf.map(convertSchema) };
  }

  const out = {};

  // Copy standard Swagger 2.0 schema fields
  const standardKeys = [
    'type',
    'format',
    'title',
    'description',
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
    'required',
    'items',
    'properties',
    'additionalProperties',
    'allOf',
  ];
  for (const k of standardKeys) {
    if (k in node) {
      // Convert boolean exclusiveMinimum/exclusiveMaximum to numeric
      if (k === 'exclusiveMinimum' && typeof node[k] === 'boolean') {
        if (typeof node.minimum === 'number') {
          out.minimum = node.minimum + (node[k] ? 1 : 0); // approx
        }
        // Skip boolean exclusiveMinimum in Swagger 2.0
      } else if (k === 'exclusiveMaximum' && typeof node[k] === 'boolean') {
        if (typeof node.maximum === 'number') {
          out.maximum = node.maximum - (node[k] ? 1 : 0); // approx
        }
      } else {
        out[k] = convertSchema(node[k]);
      }
    }
  }

  // Convert minProperties (non-standard in Swagger 2.0)
  if (node.minProperties !== undefined) {
    out['x-minProperties'] = node.minProperties;
  }

  // Convert nullable
  if (node.nullable === true) {
    out['x-nullable'] = true;
  }

  // Convert const to enum
  if ('const' in node && node.const !== undefined) {
    out.enum = [node.const];
  }

  // Convert type: 'null'
  if (node.type === 'null') {
    out.type = 'string';
    out['x-nullable'] = true;
  }

  // Fix empty items schema
  if (out.type === 'array' && out.items && Object.keys(out.items).length === 0) {
    out.items = { type: 'string' };
  }

  // Simplify additionalProperties that had oneOf
  if (out.additionalProperties && typeof out.additionalProperties === 'object') {
    const ap = out.additionalProperties;
    if (ap.allOf && ap.allOf.length > 1) {
      // Simplify to true - Swagger 2.0 cannot express union map values
      out.additionalProperties = true;
    } else if (ap['x-oneOf'] || ap['x-anyOf']) {
      out.additionalProperties = { type: 'string', description: 'Map value (string or string array)' };
    }
  }

  // Copy non-standard fields as x- extensions (skip OpenAPI 3.x only keywords)
  const skipKeys = [
    'oneOf',
    'anyOf',
    'allOf',
    'not',
    'const',
    'nullable',
    'minProperties',
    'maxProperties',
    'discriminator',
    'writeOnly',
    'readOnly',
    'deprecated',
    'example',
    'xml',
    'externalDocs',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'content',
    'requestBody',
    'components',
    'servers',
  ];
  for (const k of Object.keys(node)) {
    if (!out.hasOwnProperty(k) && !skipKeys.includes(k)) {
      out[k] = convertSchema(node[k]);
    }
  }

  return out;
}

// Convert a parameter (OpenAPI 3.1 style -> Swagger 2.0 style)
function convertParam(param) {
  const out = {};
  for (const k of ['name', 'in', 'description']) {
    if (k in param) out[k] = param[k];
  }
  out.required = param.required || false;
  if (param.in === 'body') {
    // Body parameters use schema in Swagger 2.0
    if (param.schema) out.schema = convertSchema(param.schema);
    return out;
  }
  // Non-body parameters: flatten schema fields onto the parameter object.
  // Swagger 2.0 does NOT support `schema` on query/path/header/formData params.
  if (param.schema) {
    const schema = convertSchema(param.schema);
    // If schema is a $ref, keep it - post-processing will inline it.
    if (schema.$ref) {
      out.schema = schema;
      return out;
    }
    const paramFields = [
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
    for (const k of paramFields) {
      if (k in schema) out[k] = schema[k];
    }
    for (const k of Object.keys(schema)) {
      if (!paramFields.includes(k) && !(k in out)) {
        out[k] = schema[k];
      }
    }
  }
  return out;
}

// Convert responses
function convertResponses(responses) {
  const out = {};
  for (const [code, resp] of Object.entries(responses)) {
    out[code] = {};
    if (resp.description) out[code].description = resp.description;
    if (resp.headers) {
      out[code].headers = {};
      for (const [hName, hDef] of Object.entries(resp.headers)) {
        out[code].headers[hName] = {};
        if (hDef.description) out[code].headers[hName].description = hDef.description;
        if (hDef.schema) out[code].headers[hName].schema = convertSchema(hDef.schema);
        // Copy other valid header fields
        for (const k of ['type', 'format', 'enum', 'default']) {
          if (k in hDef) out[code].headers[hName][k] = hDef[k];
        }
      }
    }
    if (resp.content) {
      for (const [mime, contentDef] of Object.entries(resp.content)) {
        if (mime === 'application/json' && contentDef.schema) {
          out[code].schema = convertSchema(contentDef.schema);
        } else if (mime === 'text/event-stream' && contentDef.schema) {
          out[code].schema = convertSchema(contentDef.schema);
        } else if (mime === 'application/octet-stream' && contentDef.schema) {
          out[code].schema = { type: 'file' };
        }
      }
    }
  }
  return out;
}

// Convert a single operation (get/post/put/delete/patch)
function convertOperation(op) {
  const out = {};
  for (const k of ['operationId', 'summary', 'description', 'tags']) {
    if (k in op) out[k] = op[k];
  }

  const params = [];

  // Convert path/query/header parameters (already in Swagger 2.0 format)
  if (op.parameters) {
    for (const p of op.parameters) {
      params.push(convertParam(p));
    }
  }

  // Convert requestBody -> body parameter
  if (op.requestBody) {
    const rb = op.requestBody;
    const content = rb.content || {};
    // Check for multipart/form-data
    if (content['multipart/form-data']) {
      const schema = convertSchema(content['multipart/form-data'].schema);
      out.consumes = ['multipart/form-data'];
      if (schema && schema.properties) {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          const fp = {
            name: propName,
            in: 'formData',
            required: (schema.required || []).includes(propName),
          };
          if (propSchema.format === 'binary' || propSchema.type === 'file') {
            fp.type = 'file';
          } else {
            // Inline simple schema fields
            for (const k of ['type', 'format', 'enum', 'description', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'default']) {
              if (k in propSchema) fp[k] = propSchema[k];
            }
          }
          params.push(fp);
        }
      }
    } else if (content['application/json']) {
      params.push({
        name: 'body',
        in: 'body',
        required: rb.required !== false,
        schema: convertSchema(content['application/json'].schema),
      });
    }
  }

  if (params.length > 0) out.parameters = params;
  out.responses = convertResponses(op.responses || {});
  return out;
}

// Convert a path item
function convertPathItem(pathItem) {
  const out = {};
  for (const method of ['get', 'post', 'put', 'delete', 'patch', 'head', 'options']) {
    if (pathItem[method]) {
      out[method] = convertOperation(pathItem[method]);
    }
  }
  if (pathItem.parameters) {
    out.parameters = pathItem.parameters.map(convertParam);
  }
  return out;
}

// Convert paths object
function convertPaths(paths) {
  const out = {};
  for (const [pathStr, pathItem] of Object.entries(paths)) {
    out[pathStr] = convertPathItem(pathItem);
  }
  return out;
}

// 鈹€鈹€ module mapping 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const MODULES = [
  { tag: 'Runtime', pathFile: 'paths/runtime.yaml', schemaFile: 'schemas/runtime.yaml', outFile: 'runtime.yaml' },
  { tag: 'Auth', pathFile: 'paths/auth.yaml', schemaFile: 'schemas/auth.yaml', outFile: 'auth.yaml' },
  { tag: 'Session', pathFile: 'paths/session.yaml', schemaFile: 'schemas/session.yaml', outFile: 'session.yaml' },
  { tag: 'RequestCommand', pathFile: 'paths/request-command.yaml', schemaFile: 'schemas/request-command.yaml', outFile: 'request-command.yaml' },
  { tag: 'Stream', pathFile: 'paths/stream.yaml', schemaFile: 'schemas/stream.yaml', outFile: 'stream.yaml' },
  { tag: 'Conversation', pathFile: 'paths/conversation.yaml', schemaFile: 'schemas/conversation.yaml', outFile: 'conversation.yaml' },
  { tag: 'Annotation', pathFile: 'paths/annotation.yaml', schemaFile: 'schemas/annotation.yaml', outFile: 'annotation.yaml' },
  { tag: 'BackgroundTask', pathFile: 'paths/background-task.yaml', schemaFile: 'schemas/background-task.yaml', outFile: 'background-task.yaml' },
  { tag: 'Share', pathFile: 'paths/share.yaml', schemaFile: 'schemas/share.yaml', outFile: 'share.yaml' },
  { tag: 'Attachment', pathFile: 'paths/attachment.yaml', schemaFile: 'schemas/attachment.yaml', outFile: 'attachment.yaml' },
  { tag: 'Skill', pathFile: 'paths/skill.yaml', schemaFile: 'schemas/skill.yaml', outFile: 'skill.yaml' },
  { tag: 'Question', pathFile: 'paths/question.yaml', schemaFile: 'schemas/question.yaml', outFile: 'question.yaml' },
  { tag: 'CronTask', pathFile: 'paths/cron-task.yaml', schemaFile: 'schemas/cron-task.yaml', outFile: 'cron-task.yaml' },
  { tag: 'SessionActivity', pathFile: 'paths/session-activity.yaml', schemaFile: 'schemas/session-activity.yaml', outFile: 'session-activity.yaml' },
  { tag: 'Memory', pathFile: 'paths/memory.yaml', schemaFile: 'schemas/memory.yaml', outFile: 'memory.yaml' },
];

// 鈹€鈹€ main 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function main() {
  // Create output directory
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Load main openapi.yaml for metadata
  const mainSpec = loadYaml('openapi.yaml');

  // 鈹€鈹€ common.yaml 鈹€鈹€
  const commonSchemas = loadYaml('schemas/common.yaml');
  const commonOut = {
    swagger: '2.0',
    info: {
      title: 'Common Definitions',
      version: mainSpec.info ? mainSpec.info.version : '1.0.0',
      description: 'Shared error response schemas used across all NextAgent API modules.',
    },
    host: 'localhost:3000',
    basePath: '/',
    schemes: ['https'],
    definitions: {},
  };
  for (const [name, schema] of Object.entries(commonSchemas)) {
    commonOut.definitions[name] = convertSchema(schema);
  }
  const commonYaml = yaml.dump(commonOut, { lineWidth: 120, noRefs: true, quotingType: '"' });
  fs.writeFileSync(path.join(OUT_DIR, 'common.yaml'), commonYaml, 'utf8');
  console.log('Wrote common.yaml');

  // 鈹€鈹€ per-module files 鈹€鈹€
  const indexPaths = {};
  const indexDefinitions = {};

  for (const mod of MODULES) {
    const pathsData = loadYaml(mod.pathFile);
    const schemaData = loadYaml(mod.schemaFile);

    const modulePaths = convertPaths(pathsData);
    const moduleDefs = {};
    for (const [name, schema] of Object.entries(schemaData)) {
      moduleDefs[name] = convertSchema(schema);
    }

    // Write module file with Swagger 2.0 metadata header
    const moduleOut = {
      swagger: '2.0',
      info: {
        title: mod.outFile.replace('.yaml', '') + ' API',
        version: mainSpec.info ? mainSpec.info.version : '1.0.0',
        description: mainSpec.info ? mainSpec.info.description : '',
      },
      host: 'localhost:3000',
      basePath: '/',
      schemes: ['https'],
    };
    if (Object.keys(modulePaths).length > 0) moduleOut.paths = modulePaths;
    if (Object.keys(moduleDefs).length > 0) moduleOut.definitions = moduleDefs;

    const moduleYaml = yaml.dump(moduleOut, { lineWidth: 120, noRefs: true, quotingType: '"' });
    fs.writeFileSync(path.join(OUT_DIR, mod.outFile), moduleYaml, 'utf8');
    console.log(`Wrote ${mod.outFile} (${Object.keys(modulePaths).length} paths, ${Object.keys(moduleDefs).length} defs)`);

    // Build index references
    for (const pathStr of Object.keys(modulePaths)) {
      indexPaths[pathStr] = { $ref: `./${mod.outFile}#/paths/${jsonPtrEscape(pathStr)}` };
    }
    for (const defName of Object.keys(moduleDefs)) {
      indexDefinitions[defName] = { $ref: `./${mod.outFile}#/definitions/${jsonPtrEscape(defName)}` };
    }
  }

  // Add common definitions to index
  for (const defName of Object.keys(commonOut.definitions)) {
    indexDefinitions[defName] = { $ref: `./common.yaml#/definitions/${jsonPtrEscape(defName)}` };
  }

  // 鈹€鈹€ index.yaml 鈹€鈹€
  const index = {
    swagger: '2.0',
    info: mainSpec.info,
    host: 'localhost:3000',
    basePath: '/',
    schemes: ['https'],
    tags: mainSpec.tags,
    paths: indexPaths,
    definitions: indexDefinitions,
  };
  const indexYaml = yaml.dump(index, { lineWidth: 120, noRefs: true, quotingType: '"' });
  fs.writeFileSync(path.join(OUT_DIR, 'index.yaml'), indexYaml, 'utf8');
  console.log(`Wrote index.yaml (${Object.keys(indexPaths).length} paths, ${Object.keys(indexDefinitions).length} defs)`);
  console.log('Done!');
}

main();
