import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNextAgentApp, createNextAgentAppAsync, type CreateNextAgentAppOptions, type NextAgentApp } from '../index.js';

export const backendOnlyPackageProfile = 'backend-only' as const;

export interface BackendOnlyCandidateEvidence {
  readonly profile: typeof backendOnlyPackageProfile;
  readonly productVersion: string;
  readonly frontendHosting: 'excluded';
}

export function createBackendOnlyCandidateEvidence(productVersion = readRootProductVersion()): BackendOnlyCandidateEvidence {
  return { profile: backendOnlyPackageProfile, productVersion, frontendHosting: 'excluded' };
}

export function createBackendOnlyNextAgentApp(options?: CreateNextAgentAppOptions): NextAgentApp {
  return createNextAgentApp(options);
}

export function createBackendOnlyNextAgentAppAsync(options?: CreateNextAgentAppOptions): Promise<NextAgentApp> {
  return createNextAgentAppAsync(options);
}

if (isMain()) {
  const app = await createBackendOnlyNextAgentAppAsync();
  await app.start();
}

function readRootProductVersion(): string {
  const rootPackage = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
  if (typeof rootPackage.version !== 'string' || rootPackage.version.length === 0) {
    throw new Error('Root package.json version is required for backend-only candidate evidence.');
  }
  return rootPackage.version;
}

function isMain(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
