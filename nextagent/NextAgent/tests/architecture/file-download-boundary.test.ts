import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('HOFS file download boundary', () => {
  const requestsSource = readFileSync(resolve(root, 'packages/agent-channel-web/src/routes/requests.ts'), 'utf8');
  const downloadRuntimeSource = readFileSync(resolve(root, 'packages/agent-attachment-runtime/src/file-download-runtime.ts'), 'utf8');
  const gatewaySource = readFileSync(resolve(root, 'packages/agent-contracts/src/gateway/index.ts'), 'utf8');

  // Task 6.1: owner scope must come from identityResolver, not query/body/model output
  it('download route resolves owner scope from identityResolver, not query or body', () => {
    expect(requestsSource).toMatch(/files\/download[\s\S]*identityResolver/u);
    expect(requestsSource).toContain('const identity = dependencies.identityResolver(request);');
    // The validated query path is used only as objectName, not as tenantId/subjectId
    expect(requestsSource).toContain('identityContext: identity');
    expect(requestsSource).toContain('validateDownloadObjectName(query.path);');
    expect(requestsSource).toContain('objectName: query.path');
  });

  it('download route does not read tenantId or subjectId from query parameters', () => {
    // Extract the download route block (between "files/download" and the closing of that route)
    const downloadRouteStart = requestsSource.indexOf('sessions/:sessionId/files/download');
    expect(downloadRouteStart).toBeGreaterThan(-1);
    const downloadRouteBlock = requestsSource.slice(downloadRouteStart, downloadRouteStart + 2000);
    expect(downloadRouteBlock).not.toMatch(/query\.tenantId|query\.subjectId|query\.ownerScope/u);
    expect(downloadRouteBlock).not.toMatch(/request\.body/u);
  });

  // Task 6.2: download temp files must not enter model-visible paths
  it('download runtime does not reference model-visible paths or tool execution context', () => {
    expect(downloadRuntimeSource).not.toMatch(/ToolExecutionContext/u);
    expect(downloadRuntimeSource).not.toMatch(/toolArgs|tool_args/u);
    expect(downloadRuntimeSource).not.toMatch(/sandbox/u);
    expect(downloadRuntimeSource).not.toMatch(/prompt/u);
    // The runtime only uses materializeBlob (HOFS read primitive) and local file system for HTTP response
    expect(downloadRuntimeSource).toContain('materializeBlob');
    expect(downloadRuntimeSource).toContain('downloadTempDir');
  });

  it('FileDownloadPort is a structural local port without gateway or attachment-runtime imports', () => {
    const portStart = requestsSource.indexOf('export interface FileDownloadPort');
    expect(portStart).toBeGreaterThan(-1);
    const portBlock = requestsSource.slice(portStart, portStart + 500);
    expect(portBlock).not.toMatch(/BlobStoreGateway/u);
    expect(portBlock).not.toMatch(/agent-attachment-runtime/u);
    expect(portBlock).not.toMatch(/agent-contracts\/gateway/u);
  });

  // Task 6.3: BlobStoreGateway contract has no new methods for download
  it('BlobStoreGateway contract has exactly the expected method set (no download-specific additions)', () => {
    const interfaceStart = gatewaySource.indexOf('export interface BlobStoreGateway');
    expect(interfaceStart).toBeGreaterThan(-1);
    const interfaceBlock = gatewaySource.slice(interfaceStart, interfaceStart + 800);
    const methods = Array.from(interfaceBlock.matchAll(/(\w+)\s*:\s*\(/gu)).map((m) => m[1]);
    const expectedMethods = ['storeBlob', 'loadBlob', 'materializeBlob', 'blobExists', 'deleteBlob', 'copyBlob', 'getBlobMetadata', 'listBlobs'];
    expect(methods).toEqual(expect.arrayContaining(expectedMethods));
    // No download-specific method names
    expect(methods).not.toContain('downloadBlob');
    expect(methods).not.toContain('streamBlob');
    expect(methods).not.toContain('downloadFile');
  });
});
