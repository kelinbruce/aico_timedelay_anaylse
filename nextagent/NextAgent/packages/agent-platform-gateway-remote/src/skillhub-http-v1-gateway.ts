import type { AgentId, AgentVersion, CapabilityId, SecretReference, SubjectId, TenantId } from '@nextagent/agent-common';
import type { ExecutionCorrelationPort } from '@nextagent/agent-contracts/observability';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export interface SkillHubRemoteGatewayFactory {
  create: (input: SkillHubRemoteGatewayFactoryInput) => SkillHubRemoteGatewayAdapter;
}

export interface SkillHubRemoteGatewayFactoryInput {
  readonly gatewayId: string;
  readonly endpoint?: string;
  readonly credentialRef?: SecretReference | string;
}

export interface SkillHubRemoteGatewayAdapter {
  listCandidates: (input: SkillHubRemoteListInput, signal: AbortSignal) => Promise<SkillHubRemoteListResult>;
  fetchContent: (input: SkillHubRemoteContentInput, signal: AbortSignal) => Promise<SkillHubRemoteContentResult>;
}

export interface SkillHubRemoteListInput {
  readonly tenantId: TenantId | string;
  readonly subjectId: SubjectId | string;
  readonly agentId: AgentId | string;
  readonly agentVersion: AgentVersion | string;
  readonly agentAssemblyRef: string;
  readonly requestedCapabilityId?: CapabilityId | string;
}

export interface SkillHubRemoteContentInput {
  readonly tenantId: TenantId | string;
  readonly subjectId: SubjectId | string;
  readonly agentId: AgentId | string;
  readonly agentVersion: AgentVersion | string;
  readonly agentAssemblyRef: string;
  readonly contentRef: string;
  readonly stagingRoot: string;
}

export type SkillHubRemoteListResult =
  | { readonly status: 'ok'; readonly candidates: readonly SkillHubRemoteCandidate[] }
  | { readonly status: 'failed'; readonly reasonCode: 'unavailable' | 'timeout' | 'unauthorized' | 'invalid-response'; readonly message: string };

export type SkillHubRemoteContentResult =
  | {
      readonly status: 'ok';
      readonly stagingRoot: string;
      readonly stagedFolder: string;
      readonly contentVersion?: string;
      readonly contentHash?: string;
    }
  | {
      readonly status: 'failed';
      readonly reasonCode: 'download-failed' | 'unavailable' | 'timeout' | 'unauthorized' | 'invalid-response';
      readonly message: string;
    };

export interface SkillHubRemoteCandidate {
  readonly skillId: string;
  readonly contentRef: string;
  readonly contentVersion?: string;
  readonly contentHash?: string;
  readonly agentId?: AgentId | string;
  readonly agentVersion?: AgentVersion | string;
  readonly agentAssemblyRef?: string;
}

export interface FetchSkillHubRemoteGatewayFactoryOptions {
  readonly fetch?: FetchLike;
  readonly credentialResolver?: (credentialRef: SecretReference | string) => Promise<string>;
  readonly executionCorrelation?: ExecutionCorrelationPort;
}

type FetchLike = (
  input: string,
  init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string; readonly signal?: AbortSignal },
) => Promise<FetchLikeResponse>;

const maxNormalizedPackageBytes = 256 * 1024;
const maxNormalizedPackageFiles = 128;

interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<unknown>;
}

interface ExtractedSkillHubFile {
  readonly path: string;
  readonly content: string;
}

export function createFetchSkillHubRemoteGatewayFactory(options: FetchSkillHubRemoteGatewayFactoryOptions = {}): SkillHubRemoteGatewayFactory {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    create(input) {
      return new FetchSkillHubRemoteGatewayAdapter(input, fetchImpl, options.credentialResolver, options.executionCorrelation);
    },
  };
}

class FetchSkillHubRemoteGatewayAdapter implements SkillHubRemoteGatewayAdapter {
  constructor(
    private readonly config: SkillHubRemoteGatewayFactoryInput,
    private readonly fetchImpl: FetchLike,
    private readonly credentialResolver?: (credentialRef: SecretReference | string) => Promise<string>,
    private readonly executionCorrelation?: ExecutionCorrelationPort,
  ) {}

  async listCandidates(input: SkillHubRemoteListInput, signal: AbortSignal): Promise<SkillHubRemoteListResult> {
    try {
      if (this.config.endpoint === undefined || this.config.endpoint.trim().length === 0) {
        return { status: 'failed', reasonCode: 'unavailable', message: 'SkillHub remote gateway is unavailable.' };
      }
      const response = await this.fetchImpl(`${trimSlash(this.config.endpoint)}/skills/search`, {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify(input),
        signal,
      });
      if (!response.ok) {
        return {
          status: 'failed',
          reasonCode: response.status === 401 || response.status === 403 ? 'unauthorized' : 'unavailable',
          message: 'SkillHub remote access failed safely.',
        };
      }
      const body = await response.json();
      if (!isCandidateList(body)) {
        return { status: 'failed', reasonCode: 'invalid-response', message: 'SkillHub remote access failed safely.' };
      }
      return { status: 'ok', candidates: body.candidates.map(normalizeCandidate) };
    } catch (error) {
      return {
        status: 'failed',
        reasonCode: isTimeoutFailure(error, signal) ? 'timeout' : 'unavailable',
        message: 'SkillHub remote access failed safely.',
      };
    }
  }

  async fetchContent(input: SkillHubRemoteContentInput, signal: AbortSignal): Promise<SkillHubRemoteContentResult> {
    try {
      if (this.config.endpoint === undefined || this.config.endpoint.trim().length === 0) {
        return { status: 'failed', reasonCode: 'unavailable', message: 'SkillHub remote gateway is unavailable.' };
      }
      const response = await this.fetchImpl(`${trimSlash(this.config.endpoint)}/skills/package`, {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({
          tenantId: input.tenantId,
          subjectId: input.subjectId,
          agentId: input.agentId,
          agentVersion: input.agentVersion,
          agentAssemblyRef: input.agentAssemblyRef,
          packageRef: input.contentRef,
        }),
        signal,
      });
      if (!response.ok) {
        return {
          status: 'failed',
          reasonCode: response.status === 401 || response.status === 403 ? 'unauthorized' : 'download-failed',
          message: 'SkillHub package download failed safely.',
        };
      }
      const body = await response.json();
      const download = packageBytesFromResponse(body);
      if (download === undefined) {
        return { status: 'failed', reasonCode: 'invalid-response', message: 'SkillHub package download failed safely.' };
      }
      if (download.packageHash !== undefined) {
        const computedHash = createHash('sha256').update(download.packageBytes).digest('hex');
        if (computedHash !== download.packageHash) {
          return { status: 'failed', reasonCode: 'invalid-response', message: 'SkillHub package integrity check failed.' };
        }
      }
      const stagedFolder = await materializeZipPackage(input.stagingRoot, input.contentRef, download.packageBytes);
      if (stagedFolder === undefined) {
        return { status: 'failed', reasonCode: 'invalid-response', message: 'SkillHub package download failed safely.' };
      }
      return {
        status: 'ok',
        stagingRoot: input.stagingRoot,
        stagedFolder,
        ...(download.packageVersion === undefined ? {} : { contentVersion: download.packageVersion }),
        ...(download.packageHash === undefined ? {} : { contentHash: download.packageHash }),
      };
    } catch (error) {
      return {
        status: 'failed',
        reasonCode: isTimeoutFailure(error, signal) ? 'timeout' : 'download-failed',
        message: 'SkillHub package download failed safely.',
      };
    }
  }

  private async headers(): Promise<Record<string, string>> {
    const headers = { 'content-type': 'application/json' };
    if (this.config.credentialRef === undefined || this.credentialResolver === undefined) {
      return this.executionCorrelation?.outboundHeaders(headers) ?? headers;
    }
    const credential = await this.credentialResolver(this.config.credentialRef);
    const authenticated = { ...headers, authorization: `Bearer ${credential}` };
    return this.executionCorrelation?.outboundHeaders(authenticated) ?? authenticated;
  }
}

async function materializeZipPackage(stagingRoot: string, contentRef: string, packageBytes: Uint8Array): Promise<string | undefined> {
  const extracted = extractZipPackage(packageBytes);
  if (extracted === undefined) {
    return undefined;
  }
  const stagedFolder = join(stagingRoot, `${contentRef.replace(/[^A-Za-z0-9._-]/gu, '_')}.tmp-${randomUUID()}`);
  await rm(stagedFolder, { recursive: true, force: true });
  await mkdir(stagedFolder, { recursive: true });
  try {
    for (const entry of extracted) {
      const target = resolve(stagedFolder, entry.path);
      if (!isPathInside(stagedFolder, target)) {
        await rm(stagedFolder, { recursive: true, force: true });
        return undefined;
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.content, 'utf8');
    }
  } catch (error) {
    await rm(stagedFolder, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return stagedFolder;
}

function extractZipPackage(packageBytes: Uint8Array): readonly ExtractedSkillHubFile[] | undefined {
  try {
    return extractZipPackageUnsafe(packageBytes);
  } catch {
    return undefined;
  }
}

function extractZipPackageUnsafe(packageBytes: Uint8Array): readonly ExtractedSkillHubFile[] | undefined {
  const archive = Buffer.from(packageBytes);
  if (archive.length > maxNormalizedPackageBytes) {
    return undefined;
  }
  const eocdOffset = findEndOfCentralDirectory(archive);
  if (eocdOffset === undefined) {
    return undefined;
  }
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0 || centralOffset + centralSize > archive.length) {
    return undefined;
  }
  const files: ExtractedSkillHubFile[] = [];
  const seen = new Set<string>();
  let cursor = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== 0x02014b50) {
      return undefined;
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const nextCursor = cursor + 46 + nameLength + extraLength + commentLength;
    if (nextCursor > archive.length || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      return undefined;
    }
    const rawPath = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor = nextCursor;
    if ((flags & 0x1) !== 0 || !isSupportedCompressionMethod(method) || isUnsafeZipFileType(rawPath, externalAttributes)) {
      return undefined;
    }
    const isDirectory = rawPath.endsWith('/');
    const safePath = normalizePackagePath(rawPath);
    if (safePath === undefined) {
      return undefined;
    }
    if (isDirectory) {
      continue;
    }
    if (seen.has(safePath)) {
      return undefined;
    }
    seen.add(safePath);
    const compressed = readLocalFileData(archive, localOffset, compressedSize);
    if (compressed === undefined) {
      return undefined;
    }
    const content = method === 0 ? compressed : inflateRawSync(compressed);
    if (content.length !== uncompressedSize) {
      return undefined;
    }
    totalBytes += content.length;
    if (files.length + 1 > maxNormalizedPackageFiles || totalBytes > maxNormalizedPackageBytes) {
      return undefined;
    }
    files.push({ path: safePath, content: content.toString('utf8') });
  }
  return files.length > 0 ? files : undefined;
}

function findEndOfCentralDirectory(archive: Buffer): number | undefined {
  const minOffset = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  return undefined;
}

function isSupportedCompressionMethod(method: number): boolean {
  return method === 0 || method === 8;
}

function isUnsafeZipFileType(path: string, externalAttributes: number): boolean {
  const unixMode = externalAttributes >>> 16;
  const fileType = unixMode & 0o170000;
  return fileType !== 0 && fileType !== 0o100000 && !(path.endsWith('/') && fileType === 0o040000);
}

function normalizePackagePath(path: string): string | undefined {
  if (isUnsafePackagePath(path)) {
    return undefined;
  }
  const normalized = normalize(path).replace(/\\/gu, '/');
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function readLocalFileData(archive: Buffer, localOffset: number, compressedSize: number): Buffer | undefined {
  if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) {
    return undefined;
  }
  const nameLength = archive.readUInt16LE(localOffset + 26);
  const extraLength = archive.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  return dataEnd > archive.length ? undefined : archive.subarray(dataStart, dataEnd);
}

function isUnsafePackagePath(path: string): boolean {
  const normalized = normalize(path).replace(/\\/gu, '/');
  const segmentPath = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const parts = segmentPath.split('/');
  return (
    path.trim().length === 0 ||
    path.startsWith('/') ||
    /^[A-Za-z]:/u.test(path) ||
    segmentPath.length === 0 ||
    segmentPath === '..' ||
    segmentPath.startsWith('../') ||
    parts.some((part) => part === '' || part === '..' || part.startsWith('.') || /[\u0000-\u001f]/u.test(part) || /[<>:"|?*]/u.test(part))
  );
}

function isPathInside(parent: string, target: string): boolean {
  const relativePath = relative(resolve(parent), resolve(target));
  return relativePath === '' || (relativePath.length > 0 && !relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/u, '');
}

interface RawSkillHubRemoteCandidate {
  readonly skillId: string;
  readonly packageRef: string;
  readonly packageVersion?: string;
  readonly packageHash?: string;
  readonly agentId?: AgentId | string;
  readonly agentVersion?: AgentVersion | string;
  readonly agentAssemblyRef?: string;
}

function isCandidateList(value: unknown): value is { readonly candidates: readonly RawSkillHubRemoteCandidate[] } {
  return (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray((value as { readonly candidates?: unknown }).candidates) &&
    (value as { readonly candidates: readonly unknown[] }).candidates.every(isCandidate)
  );
}

function isCandidate(value: unknown): value is RawSkillHubRemoteCandidate {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    nonEmptyString(item.skillId) &&
    nonEmptyString(item.packageRef) &&
    optionalString(item.packageVersion) &&
    optionalString(item.packageHash) &&
    optionalString(item.agentId) &&
    optionalString(item.agentVersion) &&
    optionalString(item.agentAssemblyRef)
  );
}

function normalizeCandidate(candidate: RawSkillHubRemoteCandidate): SkillHubRemoteCandidate {
  return {
    skillId: candidate.skillId,
    contentRef: candidate.packageRef,
    ...(candidate.packageVersion === undefined ? {} : { contentVersion: candidate.packageVersion }),
    ...(candidate.packageHash === undefined ? {} : { contentHash: candidate.packageHash }),
    ...(candidate.agentId === undefined ? {} : { agentId: candidate.agentId }),
    ...(candidate.agentVersion === undefined ? {} : { agentVersion: candidate.agentVersion }),
    ...(candidate.agentAssemblyRef === undefined ? {} : { agentAssemblyRef: candidate.agentAssemblyRef }),
  };
}

function packageBytesFromResponse(
  value: unknown,
): { readonly packageBytes: Uint8Array; readonly packageVersion?: string; readonly packageHash?: string } | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  if (!nonEmptyString(item.packageBytesBase64) || !optionalString(item.packageVersion) || !optionalString(item.packageHash)) {
    return undefined;
  }
  const packageBytes = decodeBase64(item.packageBytesBase64);
  if (packageBytes === undefined) {
    return undefined;
  }
  const packageVersion = item.packageVersion;
  const packageHash = item.packageHash;
  return {
    packageBytes,
    ...(typeof packageVersion === 'string' ? { packageVersion } : {}),
    ...(typeof packageHash === 'string' ? { packageHash } : {}),
  };
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function decodeBase64(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length % 4 !== 0) {
    return undefined;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.length > 0 && decoded.toString('base64') === value ? decoded : undefined;
}

function isTimeoutFailure(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError');
}
