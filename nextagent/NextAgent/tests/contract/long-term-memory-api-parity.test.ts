import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

interface OpenApiOperation {
  readonly operationId?: string;
}

interface OpenApiSchema {
  readonly required?: readonly string[];
  readonly enum?: readonly string[];
}

interface LongTermMemoryOpenApi {
  readonly openapi: string;
  readonly paths: Readonly<Record<string, Readonly<Record<string, OpenApiOperation>>>>;
  readonly components: {
    readonly schemas: Readonly<Record<string, OpenApiSchema>>;
  };
}

const baselineYamlPath = resolve(
  'openspec/changes/archive/2026-07-31-refine-long-term-memory-store-gateway-contract/references/long-term-memory-api.yaml',
);
const batchCreateYamlPath = resolve(
  'openspec/changes/archive/2026-08-11-add-long-term-memory-batch-create/references/long-term-memory-batch-create-api.yaml',
);
const gatewaySourcePath = resolve('packages/agent-contracts/src/gateway/index.ts');

function loadContract(path: string): LongTermMemoryOpenApi {
  return load(readFileSync(path, 'utf8'), { json: false }) as LongTermMemoryOpenApi;
}

describe('long-term memory OpenAPI parity', () => {
  it('strictly parses the baseline and batch-create OpenAPI sources and exposes exactly thirteen operations', () => {
    const contracts = [loadContract(baselineYamlPath), loadContract(batchCreateYamlPath)];
    const operations = contracts.flatMap((contract) =>
      Object.entries(contract.paths).flatMap(([path, pathItem]) =>
        Object.entries(pathItem)
          .filter((entry): entry is [string, OpenApiOperation & { readonly operationId: string }] => entry[1].operationId !== undefined)
          .map(([method, operation]) => `${method.toUpperCase()} ${path} ${operation.operationId}`),
      ),
    );

    expect(contracts.every((contract) => contract.openapi === '3.0.0')).toBe(true);
    expect(operations).toEqual([
      'POST /rest/naie/memory/v2/long-term-mem saveLongTermMemory',
      'GET /rest/naie/memory/v2/long-term-mem listLongTermMemory',
      'POST /rest/naie/memory/v2/long-term-mem/manual manualSaveLongTermMemory',
      'GET /rest/naie/memory/v2/long-term-mem/{memoryId}/record getLongTermMemory',
      'GET /rest/naie/memory/v2/long-term-mem/{memoryId} getLongTermMemoryDetail',
      'DELETE /rest/naie/memory/v2/long-term-mem/{memoryId} deleteLongTermMemory',
      'PATCH /rest/naie/memory/v2/long-term-mem/{memoryId} mutateLongTermMemory',
      'POST /rest/naie/memory/v2/long-term-mem/search searchLongTermMemory',
      'POST /rest/naie/memory/v2/long-term-mem/{memoryId}/publish publishLongTermMemory',
      'POST /rest/naie/memory/v2/long-term-mem/{memoryId}/unpublish unpublishLongTermMemory',
      'GET /rest/naie/memory/v2/long-term-mem/shared listPublishedLongTermMemory',
      'POST /rest/naie/memory/v2/long-term-mem/shared/copy copyPublishedMemory',
      'POST /rest/naie/memory/v2/long-term-mem/batch batchCreateLongTermMemory',
    ]);
  });

  it('locks request, response, and durable enum required fields', () => {
    const schemas = loadContract(baselineYamlPath).components.schemas;
    const batchSchemas = loadContract(batchCreateYamlPath).components.schemas;

    expect(schemas['SaveLongTermMemoryReq']?.required).toEqual([
      'tenantId',
      'userId',
      'agentId',
      'knowledgeSourceType',
      'memoryType',
      'briefIndex',
      'content',
      'confidence',
      'source',
    ]);
    expect(schemas['ManualSaveLongTermMemoryReq']?.required).toEqual([
      'tenantId',
      'userId',
      'agentId',
      'knowledgeSourceType',
      'memoryType',
      'briefIndex',
      'content',
    ]);
    expect(schemas['SearchLongTermMemoryReq']?.required).toEqual(['tenantId', 'userId', 'agentId', 'queryText', 'minConfidence', 'limit', 'offset']);
    expect(schemas['CopyLongTermMemoryReq']?.required).toEqual(['memoryIds', 'tenantId', 'userId', 'agentId']);
    expect(schemas['LongTermMemoryRecord']?.required).toEqual([
      'memoryId',
      'tenantId',
      'userId',
      'agentId',
      'memoryInstance',
      'memoryType',
      'knowledgeSourceType',
      'sharingState',
      'state',
      'briefIndex',
      'content',
      'labels',
      'confidence',
      'version',
      'accessCount',
      'recallCount',
      'extractionCount',
      'isPinned',
      'archivedAt',
      'archiveReason',
      'source',
      'createTime',
      'updateTime',
    ]);
    expect(schemas['LongTermMemorySummary']?.required).toEqual([
      'memoryId',
      'memoryType',
      'knowledgeSourceType',
      'state',
      'briefIndex',
      'content',
      'labels',
      'confidence',
      'isPinned',
      'createTime',
      'updateTime',
      'version',
    ]);
    expect(schemas['SearchItemPage']?.required).toEqual(['items', 'total', 'offset', 'limit']);
    expect(schemas['VersionedUpdateResult']?.required).toEqual(['status']);
    expect(schemas['MemoryType']?.enum).toEqual(['FACTUAL', 'CONCEPTUAL', 'PROCEDURAL', 'USER_CHARACTERISTICS']);
    expect(schemas['KnowledgeSourceType']?.enum).toEqual(['LEARNED', 'CONFIGURED', 'SYSTEM_DEFAULT']);
    expect(schemas['SharingState']?.enum).toEqual(['PRIVATE', 'SHARED', 'FORK']);
    expect(schemas['MemoryState']?.enum).toEqual(['ACTIVE', 'ARCHIVED']);
    expect(batchSchemas['BatchCreateLongTermMemoryReq']?.required).toEqual(['tenantId', 'userId', 'agentId', 'items']);
    expect(batchSchemas['BatchCreateLtmItem']?.required).toEqual(['memoryType', 'knowledgeSourceType', 'briefIndex', 'content']);
    expect(batchSchemas['BatchCreateLtmResult']?.required).toEqual(['successCount', 'failCount', 'memoryIds']);
  });

  it('keeps only the three YAML gateway groups and the documented userId-subjectId mapping', () => {
    const source = readFileSync(gatewaySourcePath, 'utf8');
    const bindings = source.match(/export interface LongTermMemoryGatewayBindings \{[\s\S]*?\n\}/u)?.[0] ?? '';
    const store = source.match(/export interface LongTermMemoryStoreGateway \{[\s\S]*?\n\}/u)?.[0] ?? '';
    const retriever = source.match(/export interface LongTermMemoryRetrieverGateway \{[\s\S]*?\n\}/u)?.[0] ?? '';
    const sharing = source.match(/export interface LongTermMemorySharingGateway \{[\s\S]*?\n\}/u)?.[0] ?? '';
    const record = source.match(/export interface LongTermMemoryRecord extends OwnerScoped \{[\s\S]*?\n\}/u)?.[0] ?? '';

    expect(bindings).toContain('readonly store: LongTermMemoryStoreGateway');
    expect(bindings).toContain('readonly retriever: LongTermMemoryRetrieverGateway');
    expect(bindings).toContain('readonly sharing: LongTermMemorySharingGateway');
    expect(store.match(/^  [a-zA-Z]+LongTermMemory:\s*\(/gmu)).toHaveLength(7);
    expect(retriever.match(/^  (search|get)LongTermMemory/gmu)).toHaveLength(2);
    expect(sharing.match(/^  (publish|unpublish|listPublished|copyPublished)/gmu)).toHaveLength(4);
    expect(record).toContain('extends OwnerScoped');
    expect(record).not.toContain('userId');
    expect(source).not.toMatch(
      /countLongTermMemory|batchLongTermMemory|transitionLongTermMemoryState|adjustLongTermMemoryConfidence|markLongTermMemoryAccessed/u,
    );
    expect(source).not.toMatch(/readonly mutation:/u);
  });
});
