import { apiClient } from './apiClient.ts';
import type { CapabilityPresentationResponse } from '../state/capabilityPresentationStore.ts';
import type { CapabilityPresentationResource, CapabilityProcessKind } from '../features/chat/process/capabilityProcessTitle.ts';

const localeTagPattern = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/;
const controlCharacterPattern = /\p{Cc}/u;

export async function loadCapabilityPresentationResources(sessionId: string, signal: AbortSignal): Promise<CapabilityPresentationResponse> {
  const value = await apiClient.get<unknown>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/capability-presentation-resources`, { signal });
  return parseCapabilityPresentationResources(value);
}

export function parseCapabilityPresentationResources(value: unknown): CapabilityPresentationResponse {
  if (!isExactRecord(value, ['resources']) || !Array.isArray(value.resources)) {
    throw invalidResponse();
  }
  const resources: CapabilityPresentationResource[] = [];
  const identities = new Set<string>();
  for (const candidate of value.resources) {
    const resource = parseResource(candidate);
    const identity = `${resource.capabilityKind}:${resource.capabilityId}`;
    if (identities.has(identity)) {
      throw invalidResponse();
    }
    identities.add(identity);
    resources.push(resource);
  }
  return { resources };
}

function parseResource(value: unknown): CapabilityPresentationResource {
  if (!isExactRecord(value, ['capabilityKind', 'capabilityId', 'displayName', 'locales'])) {
    throw invalidResponse();
  }
  const capabilityKind = parseKind(value.capabilityKind);
  const capabilityId = parseText(value.capabilityId, 256);
  const displayName = parseText(value.displayName, 256);
  const locales = value.locales === undefined ? undefined : parseLocales(value.locales);
  return { capabilityKind, capabilityId, displayName, ...(locales === undefined ? {} : { locales }) };
}

function parseLocales(value: unknown): NonNullable<CapabilityPresentationResource['locales']> {
  if (!isExactRecord(value, ['language']) || !isRecord(value.language) || Object.keys(value.language).length === 0) {
    throw invalidResponse();
  }
  const language: Record<string, { readonly displayName: string }> = {};
  for (const [locale, content] of Object.entries(value.language)) {
    if (locale.length < 2 || locale.length > 35 || !localeTagPattern.test(locale) || !isExactRecord(content, ['displayName'])) {
      throw invalidResponse();
    }
    language[locale] = { displayName: parseText(content.displayName, 256) };
  }
  return { language };
}

function parseKind(value: unknown): CapabilityProcessKind {
  if (value === 'TOOL' || value === 'SKILL' || value === 'AGENT' || value === 'WORKFLOW') {
    return value;
  }
  throw invalidResponse();
}

function parseText(value: unknown, maxCodePoints: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || Array.from(value).length > maxCodePoints || controlCharacterPattern.test(value)) {
    throw invalidResponse();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExactRecord(value: unknown, allowedKeys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => allowedKeys.includes(key));
}

function invalidResponse(): Error {
  return new Error('Invalid capability presentation resources response.');
}
