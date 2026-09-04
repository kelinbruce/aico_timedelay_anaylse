import {
  checkLocalRuntimePackageLayout,
  createLocalRuntimePackageEvidence,
  parseBuiltInConfig,
  readLocalRuntimePackageManifest,
  safeDiagnosticMessage,
  startLocalRuntimePackage,
  stopLocalRuntimePackage,
  validateLocalRuntimePackageConfigSample,
  type HealthProof,
} from '@nextagent/agent-platform-gateway-local/testing';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dump as stringifyYaml } from 'js-yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { recordCaseResult } from './case-inventory.js';

const EXPECTED_CONTENT_SECURITY_POLICY = [`default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`].join('; ');

const candidateRoot = process.env.NEXTAGENT_RELEASE_CANDIDATE_ROOT;
const reportDir = process.env.NEXTAGENT_RELEASE_CHECK_DIR;
const managedRoots = new Set<string>();
const gateDescribe = candidateRoot === undefined || reportDir === undefined ? describe.skip : describe;

afterAll(async () => {
  if (candidateRoot !== undefined && managedRoots.has(candidateRoot)) {
    await stopLocalRuntimePackage(candidateRoot).catch(() => {});
  }
});

gateDescribe('e2e-P0-19 illegal config fail-closed', () => {
  it('rejects illegal candidate config with safe diagnostic', async () => {
    assertCandidateRoot();
    const startedAt = new Date().toISOString();
    const configPath = join(candidateRoot!, 'config', 'default-system.yaml');
    const originalConfig = readFileSync(configPath, 'utf8');
    try {
      const broken = parseBuiltInConfig(originalConfig) as Record<string, unknown>;
      broken.paths = { workspaceRoot: 'data' };
      writeFileSync(configPath, stringifyYaml(broken), 'utf8');

      const diagnostics = validateLocalRuntimePackageConfigSample(candidateRoot!);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe('invalid-config-sample');
      expect(diagnostics[0]?.message).toContain('Workspace root must not point to package system directory data.');
      expect(diagnostics[0]?.message).not.toContain(candidateRoot!);

      await expect(startLocalRuntimePackage(candidateRoot!)).rejects.toThrow(/cannot start/u);
      const startupProof = readFileSync(join(candidateRoot!, 'run', 'startup-proof.json'), 'utf8');
      expect(startupProof).toContain('invalid-config-sample');
      expect(startupProof).not.toContain(candidateRoot!);

      recordCaseResult('e2e-P0-19', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (error) {
      recordCaseResult('e2e-P0-19', 'FAILED', {
        safeReason: safeDiagnosticMessage(error, candidateRoot!),
        startedAt,
        endedAt: new Date().toISOString(),
      });
      throw error;
    } finally {
      writeFileSync(configPath, originalConfig, 'utf8');
      await stopLocalRuntimePackage(candidateRoot!).catch(() => {});
    }
  }, 30_000);
});

gateDescribe('e2e-P0-20 health readiness', () => {
  it('starts the actual candidate and writes qualification-consumable evidence', async () => {
    assertCandidateRoot();
    const startedAt = new Date().toISOString();
    try {
      managedRoots.add(candidateRoot!);
      await startLocalRuntimePackage(candidateRoot!);
      const manifest = readLocalRuntimePackageManifest(candidateRoot!);
      const config = parseBuiltInConfig(readFileSync(join(candidateRoot!, 'config', 'default-system.yaml'), 'utf8')) as {
        channel?: { port?: number };
        modelProfiles?: Array<{
          providerId?: string;
          baseUrl?: string;
          credentialRef?: string;
          models?: Array<{ modelId?: string }>;
        }>;
      };
      expect(config.modelProfiles?.[0]).toMatchObject({
        providerId: 'openai-compatible',
        models: [{ modelId: 'env:OPENAI_MODEL_NAME' }],
      });
      expect(existsSync(join(candidateRoot!, 'agents', 'default-agent', 'agent.yaml'))).toBe(true);
      const port = config.channel?.port;
      expect(typeof port).toBe('number');

      const sessions = await fetch(`http://127.0.0.1:${port}/api/v1/sessions`);
      expect(sessions.status).toBe(200);
      const packageEvidence = createLocalRuntimePackageEvidence(candidateRoot!);
      const healthProof = JSON.parse(readFileSync(join(candidateRoot!, 'run', 'health-readiness-proof.json'), 'utf8')) as HealthProof;
      expect(packageEvidence.candidateId).toBe(manifest.candidateId);
      expect(healthProof.primaryStatus).toBe('PASSED');
      expect(healthProof.deepStatus).toBe('PASSED');
      writeReleasePackageArtifacts(packageEvidence, healthProof);

      recordCaseResult('e2e-P0-20', 'PASSED', {
        startedAt,
        endedAt: new Date().toISOString(),
        evidenceRefs: packageEvidence.evidenceRefs,
      });
    } catch (error) {
      recordCaseResult('e2e-P0-20', 'FAILED', {
        safeReason: safeDiagnosticMessage(error, candidateRoot!),
        startedAt,
        endedAt: new Date().toISOString(),
      });
      throw error;
    } finally {
      await stopLocalRuntimePackage(candidateRoot!).catch(() => {});
    }
  }, 30_000);
});

gateDescribe('e2e-P0-25 fullstack route precedence', () => {
  it('serves SPA routes from the with-frontend candidate while preserving backend route precedence', async () => {
    assertCandidateRoot();
    const startedAt = new Date().toISOString();
    try {
      const manifest = readLocalRuntimePackageManifest(candidateRoot!);
      expect(manifest.packageProfile).toBe('with-frontend');
      expect(existsSync(join(candidateRoot!, 'node_modules', '@nextagent', 'agent-web', 'hosting.js'))).toBe(true);
      expect(existsSync(join(candidateRoot!, 'node_modules', '@nextagent', 'agent-web', 'hosting-manifest.json'))).toBe(true);
      expect(existsSync(join(candidateRoot!, 'node_modules', '@nextagent', 'agent-web', 'dist', 'index.html'))).toBe(true);

      managedRoots.add(candidateRoot!);
      await startLocalRuntimePackage(candidateRoot!);
      const config = parseBuiltInConfig(readFileSync(join(candidateRoot!, 'config', 'default-system.yaml'), 'utf8')) as {
        channel?: { port?: number };
      };
      const port = config.channel?.port;
      expect(typeof port).toBe('number');

      const home = await fetch(`http://127.0.0.1:${port}/`);
      expect(home.status).toBe(200);
      expect(home.headers.get('content-type')).toContain('text/html');
      expect(home.headers.get('content-security-policy')).toBe(EXPECTED_CONTENT_SECURITY_POLICY);
      const homeHtml = await home.text();
      expect(homeHtml).toContain('<!doctype html');

      const fallback = await fetch(`http://127.0.0.1:${port}/telecom/ran/overview`);
      expect(fallback.status).toBe(200);
      expect(fallback.headers.get('content-type')).toContain('text/html');
      expect(await fallback.text()).toBe(homeHtml);

      const preludeLoader = await fetch(`http://127.0.0.1:${port}/febs/v1/assets/prelude-loader`);
      expect(preludeLoader.status).toBe(200);
      expect(preludeLoader.headers.get('content-type')).toContain('text/javascript');
      const preludeLoaderSource = await preludeLoader.text();
      expect(preludeLoaderSource).toContain('window.Prel');
      expect(preludeLoaderSource).toContain('/piu/AIAgentPIU.js');
      expect(preludeLoaderSource).not.toContain('<!doctype html');

      const api = await fetch(`http://127.0.0.1:${port}/api/v1/sessions`);
      expect(api.status).toBe(200);
      expect(api.headers.get('content-type')).toContain('application/json');
      const page = (await api.json()) as { entries: unknown[] };
      expect(Array.isArray(page.entries)).toBe(true);

      const missingApi = await fetch(`http://127.0.0.1:${port}/api/v1/unknown`);
      expect(missingApi.status).toBe(404);
      expect(missingApi.headers.get('content-type')).toContain('application/json');
      const missingApiBody = await missingApi.text();
      expect(missingApiBody).toContain('Route not found');
      expect(missingApiBody).not.toContain('<!doctype html');

      recordCaseResult('e2e-P0-25', 'PASSED', { startedAt, endedAt: new Date().toISOString() });
    } catch (error) {
      recordCaseResult('e2e-P0-25', 'FAILED', {
        safeReason: safeDiagnosticMessage(error, candidateRoot!),
        startedAt,
        endedAt: new Date().toISOString(),
      });
      throw error;
    } finally {
      await stopLocalRuntimePackage(candidateRoot!).catch(() => {});
    }
  }, 30_000);
});

gateDescribe('e2e-P0-26 manifest evidence integrity', () => {
  it('verifies the actual candidate manifest, layout, and mandatory evidence refs', async () => {
    assertCandidateRoot();
    const startedAt = new Date().toISOString();
    try {
      const manifest = readLocalRuntimePackageManifest(candidateRoot!);
      expect(manifest.candidateId.length).toBeGreaterThan(0);
      expect(checkLocalRuntimePackageLayout(candidateRoot!)).toEqual([]);
      expect(existsSync(join(candidateRoot!, 'candidate-manifest.json'))).toBe(true);
      expect(existsSync(join(candidateRoot!, 'run', 'config-validation-evidence.json'))).toBe(true);
      expect(existsSync(join(candidateRoot!, 'run', 'startup-proof.json'))).toBe(true);
      expect(existsSync(join(candidateRoot!, 'run', 'health-readiness-proof.json'))).toBe(true);
      expect(existsSync(join(candidateRoot!, 'config', 'plugins', 'developer-hook-trace', 'plugin.json'))).toBe(true);
      expect(existsSync(join(candidateRoot!, 'config', 'plugins', 'developer-hook-trace', 'index.js'))).toBe(true);
      expect(existsSync(join(candidateRoot!, 'config', 'plugins', 'northbound-output-normalization-hook', 'plugin.json'))).toBe(true);
      expect(existsSync(join(candidateRoot!, 'config', 'plugins', 'northbound-output-normalization-hook', 'index.js'))).toBe(true);
      const config = parseBuiltInConfig(readFileSync(join(candidateRoot!, 'config', 'default-system.yaml'), 'utf8')) as {
        readonly nextAgent?: { readonly system?: { readonly plugins?: unknown } };
      };
      expect(config.nextAgent?.system?.plugins).toEqual([{ pluginId: 'developer-hook-trace', path: 'plugins/developer-hook-trace', required: true }]);

      const packageEvidence = createLocalRuntimePackageEvidence(candidateRoot!);
      expect(packageEvidence.manifestRef).toBe('candidate-manifest.json');
      expect(packageEvidence.evidenceRefs).toContain('run/config-validation-evidence.json');
      expect(packageEvidence.evidenceRefs).toContain('run/startup-proof.json');
      expect(packageEvidence.evidenceRefs).toContain('run/health-readiness-proof.json');

      recordCaseResult('e2e-P0-26', 'PASSED', {
        startedAt,
        endedAt: new Date().toISOString(),
        evidenceRefs: packageEvidence.evidenceRefs,
      });
    } catch (error) {
      recordCaseResult('e2e-P0-26', 'FAILED', {
        safeReason: safeDiagnosticMessage(error, candidateRoot!),
        startedAt,
        endedAt: new Date().toISOString(),
      });
      throw error;
    }
  }, 30_000);
});

function assertCandidateRoot() {
  expect(candidateRoot).toBeTruthy();
  expect(reportDir).toBeTruthy();
}

function writeReleasePackageArtifacts(packageEvidence: ReturnType<typeof createLocalRuntimePackageEvidence>, healthProof: HealthProof) {
  writeFileSync(join(reportDir!, 'package-candidate-evidence.json'), JSON.stringify(packageEvidence, null, 2), 'utf8');
  writeFileSync(join(reportDir!, 'health-proof.json'), JSON.stringify(healthProof, null, 2), 'utf8');
}
