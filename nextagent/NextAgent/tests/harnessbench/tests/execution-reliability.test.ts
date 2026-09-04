import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHarnessConfig } from '../harness-runner.mjs';
import { buildHarnessCandidateConfig } from '../nextagent-cli.mjs';
import { buildHarnessTaskEnvironment, prepareHarnessPythonToolchain, resolvePythonExecutable } from '../run.mjs';

describe('HarnessBench execution reliability configuration', () => {
  it('keeps the candidate model call and execution boundary budgets fixed', () => {
    const config = buildHarnessCandidateConfig({ port: 3210, modelId: 'candidate-model' });
    const harness = buildHarnessConfig({
      command: 'node',
      cliPath: 'nextagent-cli.mjs',
      modelId: 'candidate-model',
      taskTimeoutSeconds: 1200,
      terminalTimeoutSeconds: 1080,
    });

    expect(config).toMatchObject({ modelProfiles: [{ models: [{ maxOutputTokens: 16_384, timeoutMs: 540_000 }] }] });
    expect(config.sandbox.enabled).toBe(false);
    expect(harness.models.nextagent.timeout_sec).toBe(1200);
    expect(harness.models.nextagent.args).toContain('1080000');
  });

  it('uses the local mock endpoint even when the caller provides an external template', () => {
    const previous = process.env.HARNESSBENCH_PUBLIC_URL_TEMPLATE;
    process.env.HARNESSBENCH_PUBLIC_URL_TEMPLATE = 'https://external.invalid/{local_url}';
    try {
      const env = buildHarnessTaskEnvironment({
        baseEnvironment: process.env,
        upstreamRoot: 'upstream',
        appConfigPath: 'app.json',
        providerBaseUrl: 'https://provider.invalid/v1',
        credential: 'test-key',
        modelId: 'candidate-model',
        graderBaseUrl: 'https://grader.invalid/v1',
        graderCredential: 'grader-key',
        graderModelId: 'grader-model',
      });
      expect(env.HARNESSBENCH_PUBLIC_URL_TEMPLATE).toBe('{local_url}');
    } finally {
      if (previous === undefined) {
        delete process.env.HARNESSBENCH_PUBLIC_URL_TEMPLATE;
      } else {
        process.env.HARNESSBENCH_PUBLIC_URL_TEMPLATE = previous;
      }
    }
  });

  it.runIf(process.platform === 'win32')('binds upstream python3 to the selected interpreter without mutating the caller environment', async () => {
    const runRoot = await mkdtemp(join(tmpdir(), 'nextagent-harnessbench-python-runtime-'));
    const selectedPython = process.env.HARNESSBENCH_PYTHON?.trim() || 'python';
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
    const baseEnvironment = { ...process.env, [pathKey]: 'C:\\conflicting-python-path' };
    const originalEnvironment = { ...baseEnvironment };
    try {
      const pythonExecutable = await resolvePythonExecutable(selectedPython);
      const toolchain = await prepareHarnessPythonToolchain({ pythonExecutable, runRoot, baseEnvironment });
      if (toolchain === undefined) {
        throw new Error('Windows HarnessBench Python toolchain was not created.');
      }
      const env = buildHarnessTaskEnvironment({
        baseEnvironment,
        pythonCommandRoot: toolchain.commandRoot,
        pythonHome: toolchain.pythonHome,
        upstreamRoot: 'upstream',
        appConfigPath: 'app.json',
        providerBaseUrl: 'https://provider.invalid/v1',
        credential: 'test-key',
        modelId: 'candidate-model',
        graderBaseUrl: 'https://grader.invalid/v1',
        graderCredential: 'grader-key',
        graderModelId: 'grader-model',
      });

      expect(env[pathKey]).toBe(`${toolchain.commandRoot};${baseEnvironment[pathKey]}`);
      expect(env.PYTHONHOME).toBe(toolchain.pythonHome);
      expect(baseEnvironment).toEqual(originalEnvironment);
    } finally {
      await rm(runRoot, { recursive: true, force: true });
    }
  });

  it('rejects an unsafe Python executable before creating a command alias', async () => {
    await expect(
      prepareHarnessPythonToolchain({
        pythonExecutable: 'relative/python.exe',
        runRoot: 'run-root',
        baseEnvironment: {},
        platform: 'win32',
      }),
    ).rejects.toThrow(/absolute path/u);
  });
});
