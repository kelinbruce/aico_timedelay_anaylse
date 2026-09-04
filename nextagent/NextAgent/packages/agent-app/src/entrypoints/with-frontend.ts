import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type NextAgentApp } from '../index.js';
import { runProductCompositionAsync, type CreateComposedAppOptions, type ProductHostCompositionInput } from '../composition/create-app.js';
import { assertSameVersion, readFrontendPackageVersion } from './with-frontend-finalizer.js';

export const withFrontendPackageProfile = 'with-frontend' as const;

export interface WithFrontendCandidateEvidence {
  readonly profile: typeof withFrontendPackageProfile;
  readonly productVersion: string;
  readonly frontendPackageName: '@nextagent/agent-web';
  readonly frontendPackageVersion: string;
}

interface FrontendHostingModule {
  resolveFrontendHostingManifest?: () => unknown;
}

export interface CreateWithFrontendNextAgentAppOptions extends CreateComposedAppOptions {
  readonly productVersion?: string;
  readonly resolveFrontendHostingManifest?: () => Promise<unknown> | unknown;
  readonly indexHtmlScripts?: readonly string[];
}

export async function createWithFrontendCandidateEvidence(productVersion = readRootProductVersion()): Promise<WithFrontendCandidateEvidence> {
  const frontendPackageVersion = readFrontendPackageVersion(await resolveFrontendHostingManifest());
  assertSameVersion(productVersion, frontendPackageVersion);
  return {
    profile: withFrontendPackageProfile,
    productVersion,
    frontendPackageName: '@nextagent/agent-web',
    frontendPackageVersion,
  };
}

export async function createWithFrontendNextAgentApp(options: CreateWithFrontendNextAgentAppOptions = {}): Promise<NextAgentApp> {
  const productHostInput: ProductHostCompositionInput = {
    productVersion: options.productVersion ?? readRootProductVersion(),
    resolveFrontendHostingManifest: options.resolveFrontendHostingManifest ?? resolveFrontendHostingManifest,
    ...(options.indexHtmlScripts === undefined ? {} : { indexHtmlScripts: options.indexHtmlScripts }),
    useDefaultWorkbenchScripts: options.trustedLocalWebExtensionRegistration === undefined,
  };
  return (await runProductCompositionAsync(options, { channelAuthProfile: 'DEFAULT_WEB', frontendHostingProfile: 'WITH_FRONTEND' }, productHostInput))
    .app;
}

export async function resolveFrontendHostingManifest(): Promise<unknown> {
  const frontendHosting = (await import('@nextagent/agent-web/hosting')) as FrontendHostingModule;
  if (typeof frontendHosting.resolveFrontendHostingManifest !== 'function') {
    throw new Error('@nextagent/agent-web/hosting must export resolveFrontendHostingManifest().');
  }
  return frontendHosting.resolveFrontendHostingManifest();
}

if (isMain()) {
  const configFile = process.env['NEXTAGENT_APPLICATION_CONFIG'];
  const app = await createWithFrontendNextAgentApp(configFile === undefined ? {} : { configFile });
  await app.start();
}

function readRootProductVersion(): string {
  const rootPackage = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
  if (typeof rootPackage.version !== 'string' || rootPackage.version.length === 0) {
    throw new Error('Root package.json version is required for with-frontend startup.');
  }
  return rootPackage.version;
}

function isMain(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
