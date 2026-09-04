import { frontendHostingPlugin, type FrontendHostingManifest } from '@nextagent/agent-app-frontend-hosting';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextAgentApp } from '../composition/composition-contracts.js';
import type { ProductHostCompositionInput } from '../composition/create-app.js';
import { localDevWorkbenchFrontendScripts } from '../local-runtime-package/local-runtime-bindings.js';

export async function completeWithFrontendProductComposition(app: NextAgentApp, input: ProductHostCompositionInput): Promise<void> {
  const manifest = await input.resolveFrontendHostingManifest();
  assertSameVersion(input.productVersion, readFrontendPackageVersion(manifest));
  await app.server.register(frontendHostingPlugin, {
    manifest,
    indexHtmlScripts: input.indexHtmlScripts ?? (input.useDefaultWorkbenchScripts ? localDevWorkbenchFrontendScripts() : []),
  });
}

export function readFrontendPackageVersion(manifest: unknown): string {
  const packageRoot = (manifest as Partial<FrontendHostingManifest>).packageRoot;
  if (typeof packageRoot !== 'string' || packageRoot.length === 0) {
    throw new Error('@nextagent/agent-web hosting manifest must include packageRoot.');
  }
  const frontendPackage = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { name?: string; version?: string };
  if (frontendPackage.name !== '@nextagent/agent-web' || typeof frontendPackage.version !== 'string' || frontendPackage.version.length === 0) {
    throw new Error('@nextagent/agent-web package manifest is invalid.');
  }
  return frontendPackage.version;
}

export function assertSameVersion(productVersion: string, frontendVersion: string): void {
  if (productVersion !== frontendVersion) {
    throw new Error(`Fullstack product version mismatch: root=${productVersion}, @nextagent/agent-web=${frontendVersion}.`);
  }
}
