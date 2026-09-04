import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalConfiguredNextAgentApp, createLocalConfiguredNextAgentAppAsync } from '../composition/create-local-configured-app.js';
import type { CreateNextAgentAppOptions, NextAgentApp } from '../composition/create-app.js';

export const localConfiguredAuthPackageProfile = 'local-configured-auth' as const;

export interface LocalConfiguredAuthCandidateEvidence {
  readonly profile: typeof localConfiguredAuthPackageProfile;
  readonly productVersion: string;
  readonly localAuth: 'included';
}

export function createLocalConfiguredAuthCandidateEvidence(productVersion = readRootProductVersion()): LocalConfiguredAuthCandidateEvidence {
  return { profile: localConfiguredAuthPackageProfile, productVersion, localAuth: 'included' };
}

export function createLocalConfiguredAuthNextAgentApp(options?: CreateNextAgentAppOptions): NextAgentApp {
  return createLocalConfiguredNextAgentApp(options);
}

if (isMain()) {
  const app = await createLocalConfiguredNextAgentAppAsync();
  await app.start();
}

function readRootProductVersion(): string {
  const rootPackage = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
  if (typeof rootPackage.version !== 'string' || rootPackage.version.length === 0) {
    throw new Error('Root package.json version is required for local configured auth candidate evidence.');
  }
  return rootPackage.version;
}

function isMain(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
