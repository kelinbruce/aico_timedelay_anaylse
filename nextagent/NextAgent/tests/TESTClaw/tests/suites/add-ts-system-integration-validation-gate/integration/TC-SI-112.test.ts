import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writePassingCaseEvidence } from '../helpers/case-evidence.js';
import { createExternalConsumerRoot, externalNextAgentArtifactsRoot, hashDirectoryTree } from '../helpers/external-consumer-root.js';
import { withRunScope } from '../helpers/run-scope.js';

describe('TC-SI-112 packed external ESM consumer', () => {
  it('compiles and runs public exports while rejecting a private subpath', async () => {
    const externalPackagesRoot = requiredExternalPackagesRoot();
    const artifactsRoot = externalNextAgentArtifactsRoot(externalPackagesRoot);
    const inputHashBefore = await hashDirectoryTree(artifactsRoot);

    await withRunScope(
      {
        outputBase: process.env.TESTCLAW_SYSTEM_INTEGRATION_OUTPUT_ROOT,
      },
      async (scope) => {
        const consumer = await createExternalConsumerRoot({
          externalPackagesRoot,
          tempBase: scope.tempRoot,
        });
        try {
          await writeConsumerFiles(consumer.root);
          const compiler = path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
          const compile = await runProcess(process.execPath, [compiler, '-p', 'tsconfig.json'], consumer.root);
          if (compile.code !== 0) {
            throw new Error(`public-consumer-compile-failed:${diagnosticCodes(compile)}`);
          }
          expect(compile.stderr).toBe('');

          const runtime = await runProcess(process.execPath, [path.join(consumer.root, 'dist', 'index.js')], consumer.root);
          expect(runtime.code).toBe(0);
          expect(runtime.stderr).toBe('');
          expect(runtime.stdout.trim()).toBe('{"ok":true}');

          const privateImport = await runProcess(
            process.execPath,
            [
              compiler,
              '--noEmit',
              '--skipLibCheck',
              '--target',
              'ES2022',
              '--module',
              'NodeNext',
              '--moduleResolution',
              'NodeNext',
              'private-import.ts',
            ],
            consumer.root,
          );
          expect(privateImport.code).not.toBe(0);

          await writePassingCaseEvidence({
            evidenceRoot: scope.evidenceRoot,
            caseId: 'TC-SI-112',
            observations: {
              publicTypeScriptCompilePassed: true,
              publicNodeImportPassed: true,
              declarationRuntimeParityObserved: true,
              privateSubpathRejected: true,
            },
          });
        } finally {
          await consumer.cleanup();
        }
      },
    );

    expect(await hashDirectoryTree(artifactsRoot)).toBe(inputHashBefore);
  }, 60_000);
});

async function writeConsumerFiles(root: string): Promise<void> {
  await Promise.all([
    writeFile(path.join(root, 'package.json'), `${JSON.stringify({ name: 'testclaw-external-consumer', private: true, type: 'module' })}\n`, 'utf8'),
    writeFile(
      path.join(root, 'tsconfig.json'),
      `${JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          outDir: 'dist',
        },
        files: ['index.ts'],
      })}\n`,
      'utf8',
    ),
    writeFile(
      path.join(root, 'index.ts'),
      [
        "import { createRemoteOtlpMetricExporter } from '@nextagent/agent-remote-deployment';",
        "import { createUnsupportedRemoteAuditSinkAdapter, remoteGatewayReferenceAdapterKinds } from '@nextagent/agent-platform-gateway-remote';",
        'const audit = createUnsupportedRemoteAuditSinkAdapter();',
        "const ok = typeof createRemoteOtlpMetricExporter === 'function'",
        "  && typeof audit.writeAuditEvent === 'function'",
        '  && remoteGatewayReferenceAdapterKinds.length > 0;',
        'console.log(JSON.stringify({ ok }));',
        '',
      ].join('\n'),
      'utf8',
    ),
    writeFile(
      path.join(root, 'private-import.ts'),
      [
        "import { createUnsupportedRemoteAuditSinkAdapter } from '@nextagent/agent-platform-gateway-remote/dist/audit-sink.js';",
        'void createUnsupportedRemoteAuditSinkAdapter;',
        '',
      ].join('\n'),
      'utf8',
    ),
  ]);
}

async function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  return {
    code,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}

function requiredExternalPackagesRoot(): string {
  const value = process.env.NEXTAGENT_EXTERNAL_PACKAGES_ROOT;
  if (value === undefined || value.trim().length === 0) {
    throw new Error('external-packages-root-unavailable');
  }
  return path.resolve(value);
}

function diagnosticCodes(result: { readonly stdout: string; readonly stderr: string }): string {
  const codes = [...`${result.stdout}\n${result.stderr}`.matchAll(/\bTS\d{4}\b/gu)].map((match) => match[0]);
  return [...new Set(codes)].sort().join('-') || 'unknown';
}
