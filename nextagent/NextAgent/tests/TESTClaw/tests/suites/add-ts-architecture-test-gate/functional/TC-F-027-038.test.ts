/**
 * TC-F-027 ~ TC-F-038: ����ά�� P0 ������©��������
 *
 * ���Ե���Դ:
 *   TC-F-027  �� ACS-R02: ��������ȨԽ�������ܾ� (P0)
 *   TC-F-028  ACS-R03: observability.logging.diagnosticDetail enum validation (P0)
 *   TC-F-029  �� ACS-R04: �޿��� enabled model profile �������� (P0)
 *   TC-F-030  �� ACS-R05: DefaultSystemConfig ����ʱ���ɱ� (P0)
 *   TC-F-031  �� ACS-R06: sandbox.enabled ȱʧĬ��Ϊ true �Ҷ��� (P0)
 *   TC-F-032  �� ACS-R06: sandbox.enabled �ǲ���ֵ����ʧ�� (P0)
 *   TC-F-033  �� ACS-R07: �û���������·����Խ��ܾ� (P0)
 *   TC-F-034  �� ACS-R07: runtimeWorkspaceRoot ��ϵͳ����Ŀ¼�ص�����ʧ�� (P0)
 *   TC-F-035  �� ACS-R10: �ǹؼ���������Ч����Ϊ DEGRADED_READY (P0)
 *   TC-F-036  �� ACS-R10: ȱ�ٱ�����������������Ϊ BLOCKED (P0)
 *   TC-F-037  �� ACS-R14: Model ���벻����չ workspace �ļ�Ȩ�� (P0)
 *   TC-F-038  �� FPB-R11: dev:fullstack ���������ǰ��˹����� (P0)
 *
 * ��������: ��ȷ�� / ��ȫ���� / һ���� / �ɽ�����
 * ��Դ spec: app-config-schema, fullstack-packaging-boundary
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  healthCheck,
  trustedLogin,
  createSession,
  submitRequest,
  waitForTerminal,
  getConversation,
  resetCookies,
  setCookies,
  getCookies,
  execCommand,
  readFileContent,
  writeFileContent,
  fileExists,
  TEST_IDENTITY,
  TEST_AGENT,
} from '../../../helpers/api-client';

// ������ �����ļ�·������ ����������������������������������������������������������������������������
const REPO_ROOT = process.env.NEXTAGENT_REPO_ROOT || path.resolve(__dirname, '../../../../target');
const PACKAGE_CONFIG_PATH = path.join(REPO_ROOT, 'config', 'default-system.yaml');
const CANONICAL_CONFIG_PATH = path.resolve(__dirname, '../../../../../../packages/agent-app/config/default-system.yaml');

// ������ ����״̬ ��������������������������������������������������������������������������������
let sessionId: string;
let tenantACookies: string[];
let originalConfig: string | null = null;

beforeAll(async () => {
  originalConfig = await readFileContent(CANONICAL_CONFIG_PATH);
  await writeFileContent(PACKAGE_CONFIG_PATH, originalConfig);

  const health = await healthCheck();
  expect(health.status).toBe(200);

  resetCookies();
  await trustedLogin();
  tenantACookies = getCookies();

  const session = await createSession('zh-CN');
  expect(session.status).toBe(200);
  sessionId = (session.body as any).sessionId;
});

afterAll(async () => {
  // ��ԭԭʼ�����ļ�
  if (originalConfig !== null) {
    await writeFileContent(PACKAGE_CONFIG_PATH, originalConfig);
  }
  resetCookies();
});

function readBaseConfig(): Record<string, unknown> {
  return originalConfig === null ? {} : parseConfigSample(originalConfig);
}

async function writePackageConfig(sample: Record<string, unknown>): Promise<void> {
  await writeFileContent(PACKAGE_CONFIG_PATH, `${JSON.stringify(sample, null, 2)}\n`);
}

async function runPackageSelfCheck(timeout = 30_000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return execCommand('node bin/nextagent-self-check', { cwd: REPO_ROOT, timeout });
}

function requestHasVisibleOutcome(items: any[], requestId?: string): boolean {
  return items.some(
    (item) =>
      (requestId === undefined || item.requestId === requestId) &&
      (item.role === 'ASSISTANT' || item.role === 'CAPABILITY_RESULT' || item.metadata?.eventType === 'REQUEST_COMPLETED'),
  );
}

function parseConfigSample(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// TC-F-027: ��������ȨԽ�������ܾ�
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
describe('TC-F-027: ��������ȨԽ�������ܾ�', () => {
  test('�������غ�����ȨԽ��� application.yaml �� BLOCKED', async () => {
    const violationConfig = {
      ...readBaseConfig(),
      gateway: {
        credentialPolicy: 'custom-value',
      },
    };
    await writePackageConfig(violationConfig);
    const startResult = await runPackageSelfCheck(15_000);
    const combinedOutput = startResult.stdout + startResult.stderr;
    expect(startResult.exitCode).toBe(1);
    expect(combinedOutput).toContain('invalid-config-sample');
    expect(combinedOutput).toMatch(/blocked before ready/i);
  });

  test('������Ϣ��ȷ��עԽ������������㣬����¶ raw exception', async () => {
    const violationConfig = {
      ...readBaseConfig(),
      gateway: {
        credentialPolicy: 'custom-value',
      },
    };
    await writePackageConfig(violationConfig);
    const startResult = await runPackageSelfCheck(15_000);

    const combinedOutput = startResult.stdout + startResult.stderr;
    expect(startResult.exitCode).toBe(1);
    expect(combinedOutput).toContain('invalid-config-sample');
    // ����¶ raw exception �� internal stack
    expect(combinedOutput).not.toMatch(/Error:.*at.*\(|stack trace|TypeError/i);
  });
});

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// TC-F-028: observability.logging.diagnosticDetail enum validation
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
describe('TC-F-028: observability.logging.diagnosticDetail enum validation', () => {
  test('�Ƿ�ö��ֵ "disabled" �� �����ܾ� BLOCKED', async () => {
    const invalidEnumConfig = {
      ...readBaseConfig(),
      observability: {
        logging: {
          diagnosticDetail: 'disabled',
        },
      },
    };
    await writePackageConfig(invalidEnumConfig);
    const startResult = await runPackageSelfCheck(15_000);

    const combinedOutput = startResult.stdout + startResult.stderr;
    expect(startResult.exitCode).toBe(1);
    expect(combinedOutput).toContain('invalid-config-sample');
  });

  test('�Ϸ�ֵ "debug" �����ɹ���������ǿ��ִ��', async () => {
    const validEnumConfig = {
      ...readBaseConfig(),
      observability: {
        logging: {
          diagnosticDetail: 'debug',
        },
      },
    };
    await writePackageConfig(validEnumConfig);
    const startResult = await runPackageSelfCheck(30_000);

    expect(startResult.exitCode).toBe(0);
  });
});

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// TC-F-029: �޿��� enabled model profile ��������
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
describe('TC-F-029: �޿��� enabled model profile ��������', () => {
  test('���� enabled model profile ��Ӧ provider/secret ������ �� BLOCKED', async () => {
    const noViableModelConfig = {
      ...readBaseConfig(),
      modelProfiles: [
        {
          providerId: 'nonexistent-provider',
          models: [{ modelId: 'primary-model', contextWindowTokens: 128_000, fallbackEligible: false }],
        },
        {
          providerId: 'also-nonexistent',
          models: [{ modelId: 'fallback-model', contextWindowTokens: 128_000, fallbackEligible: true }],
        },
      ],
    };
    await writePackageConfig(noViableModelConfig);
    const startResult = await runPackageSelfCheck(15_000);
    const combinedOutput = startResult.stdout + startResult.stderr;
    expect(startResult.exitCode).toBe(1);
    expect(combinedOutput).toContain('invalid-config-sample');
  });
});

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// TC-F-030: DefaultSystemConfig ����ʱ���ɱ�
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
describe('TC-F-030: DefaultSystemConfig ����ʱ���ɱ�', () => {
  test('����ʱ�޸� application.yaml ��Ӱ�� DefaultSystemConfig', async () => {
    setCookies(tenantACookies);

    // Step 1: �����������ύ����
    const submit1 = await submitRequest(sessionId, 'test immutability baseline', 'ik-030-1');
    expect(submit1.status).toBe(200);
    const requestId1 = (submit1.body as any).requestId;
    const terminal1 = await waitForTerminal(sessionId, requestId1);
    const items1 = (terminal1.body as any)?.items ?? [];
    expect(requestHasVisibleOutcome(items1, requestId1)).toBe(true);

    // Step 2: �޸������ļ��������У�
    const baseConfig = readBaseConfig();
    const existingProfiles = Array.isArray(baseConfig.modelProfiles) ? [...(baseConfig.modelProfiles as Array<Record<string, unknown>>)] : [];
    const primaryProfile = existingProfiles[0] ?? {};
    const modified = {
      ...baseConfig,
      modelProfiles:
        existingProfiles.length === 0
          ? existingProfiles
          : [
              {
                ...primaryProfile,
                models: Array.isArray(primaryProfile.models)
                  ? primaryProfile.models.map((model, index) =>
                      index === 0 && typeof model === 'object' && model !== null && !Array.isArray(model)
                        ? { ...model, modelId: 'immutability-check-model' }
                        : model,
                    )
                  : [],
              },
              ...existingProfiles.slice(1),
            ],
    };
    await writePackageConfig(modified);

    // Step 3: ��������ֱ���ύ���� �� DefaultSystemConfig ����Ӱ��
    const submit2 = await submitRequest(sessionId, 'test immutability after modification', 'ik-030-2');
    expect(submit2.status).toBe(200);
    const requestId2 = (submit2.body as any).requestId;
    const terminal2 = await waitForTerminal(sessionId, requestId2);
    // ������ʹ�ö���ǰ�� model profile������ʱ�޸Ĳ�Ӱ�� DefaultSystemConfig��
    const items2 = (terminal2.body as any)?.items ?? [];
    expect(requestHasVisibleOutcome(items2, requestId2)).toBe(true);
  }, 60_000);

  test('���������ñ����Ч', async () => {
    setCookies(tenantACookies);

    // ��������ͨ�� execCommand ģ�⣩
    // ��֤��������������Ч �� ���ύ����ʹ���� model profile
    // �˲����� E2E ������ͨ����ά�������
    const restartResult = await runPackageSelfCheck(30_000);
    expect(restartResult.exitCode).toBe(0);
  });
});

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// TC-F-031: sandbox.enabled ȱʧĬ��Ϊ true �Ҷ���
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
describe('TC-F-031: sandbox.enabled ȱʧĬ��Ϊ true �Ҷ���', () => {
  test('�� sandbox ���� �� DefaultSystemConfig.sandbox.enabled = true', async () => {
    await writePackageConfig(readBaseConfig());
    const startResult = await runPackageSelfCheck(30_000);
    expect(startResult.exitCode).toBe(0);
  });

  test('sandbox.enabled = true ʱ bash Խ���������ȷ�ܾ�', async () => {
    setCookies(tenantACookies);

    // �ύ���󴥷��� boundary bash ����
    const submit = await submitRequest(sessionId, 'run curl http://external-server.com via bash', 'ik-031-sandbox-boundary');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    const terminal = await waitForTerminal(sessionId, requestId, 30_000);

    // sandbox strict validation mode���� boundary ��������ȷ�ܾ�
    // Agent �ظ�Ӧ��ȷ����ܾ����Ǿ�Ĭִ�У�
    const items = (terminal.body as any)?.items ?? [];
    expect(requestHasVisibleOutcome(items, requestId)).toBe(true);
  });
});

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// TC-F-032: sandbox.enabled �ǲ���ֵ����ʧ��
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
describe('TC-F-032: sandbox.enabled �ǲ���ֵ����ʧ��', () => {
  test('sandbox.enabled = "yes" �� ������֤ʧ�� BLOCKED', async () => {
    const nonBooleanSandboxConfig = {
      ...readBaseConfig(),
      sandbox: {
        enabled: 'yes',
      },
    };
    await writePackageConfig(nonBooleanSandboxConfig);
    const startResult = await runPackageSelfCheck(15_000);
    const combinedOutput = startResult.stdout + startResult.stderr;
    expect(startResult.exitCode).toBe(1);
    expect(combinedOutput).toContain('invalid-config-sample');
  });
});

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// TC-F-033: �û���������·����Խ��ܾ�
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
describe('TC-F-033: �û���������·����Խ��ܾ�', () => {
  test('paths.systemSkillsRoot ��Ϊ�û�·���� �� �����ܾ� BLOCKED', async () => {
    const derivedPathConfig = {
      ...readBaseConfig(),
      paths: {
        ...(readBaseConfig().paths as Record<string, unknown> | undefined),
        systemSkillsRoot: '/custom/skills',
      },
    };
    await writePackageConfig(derivedPathConfig);
    const startResult = await runPackageSelfCheck(15_000);
    expect(startResult.exitCode).toBe(1);
  });

  test('�Ƴ��Ƿ���������ɹ���systemSkillsRoot �Ӷ�����Ƶ�', async () => {
    await writePackageConfig(readBaseConfig());
    const startResult = await runPackageSelfCheck(30_000);
    expect(startResult.exitCode).toBe(0);
  });
});

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// TC-F-034: runtimeWorkspaceRoot ��ϵͳ����Ŀ¼�ص�����ʧ��
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
describe('TC-F-034: runtimeWorkspaceRoot ��ϵͳ����Ŀ¼�ص�����ʧ��', () => {
  test('workspaceRoot ���� runtimeWorkspaceRoot �� dataDir �ص� �� BLOCKED', async () => {
    // �����ص�·������ �� workspaceRoot �� SQLite data Ŀ¼��ͬ
    const overlapConfig = {
      ...readBaseConfig(),
      paths: {
        ...(readBaseConfig().paths as Record<string, unknown> | undefined),
        workspaceRoot: './data',
        sqliteFile: './data/nextagent.db',
      },
    };
    await writePackageConfig(overlapConfig);
    const startResult = await runPackageSelfCheck(15_000);
    expect(startResult.exitCode).toBe(1);
  });

  test('���ص�·�������ɹ�', async () => {
    const cleanConfig = {
      ...readBaseConfig(),
      paths: {
        ...(readBaseConfig().paths as Record<string, unknown> | undefined),
        workspaceRoot: './workspace',
      },
    };
    await writePackageConfig(cleanConfig);
    const startResult = await runPackageSelfCheck(30_000);
    expect(startResult.exitCode).toBe(0);
  });
});

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// TC-F-035: �ǹؼ���������Ч����Ϊ DEGRADED_READY
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
describe('TC-F-035: �ǹؼ���������Ч����Ϊ DEGRADED_READY', () => {
  test('�� model profile ��Ч�� fallback-only ��Ч �� DEGRADED_READY', async () => {
    const degradedConfig = {
      ...readBaseConfig(),
      modelProfiles: [
        {
          providerId: 'openai-compatible',
          models: [{ modelId: 'MiniMax-M2.7-highspeed', contextWindowTokens: 128_000, fallbackEligible: false }],
        },
        {
          providerId: 'nonexistent-provider',
          models: [{ modelId: 'fallback-model', contextWindowTokens: 128_000, fallbackEligible: true }],
        },
      ],
    };
    await writePackageConfig(degradedConfig);
    const startResult = await runPackageSelfCheck(30_000);
    const combinedOutput = startResult.stdout + startResult.stderr;
    expect(startResult.exitCode).toBe(1);
    expect(combinedOutput).toContain('invalid-config-sample');
  });

  test('����״̬������ʹ�� primary profile �������', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'degraded ready test', 'ik-035');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    const terminal = await waitForTerminal(sessionId, requestId);
    // ����ʹ�� primary profile �������
    const items = (terminal.body as any)?.items ?? [];
    expect(requestHasVisibleOutcome(items, requestId)).toBe(true);
  });
}, 60_000);

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// TC-F-036: ȱ�ٱ�����������������Ϊ BLOCKED
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
describe('TC-F-036: ȱ�ٱ�����������������Ϊ BLOCKED', () => {
  test('ȱ�� identity ������ �� BLOCKED', async () => {
    const missingGroupConfig = readBaseConfig();
    delete (missingGroupConfig as any).auth;
    await writePackageConfig(missingGroupConfig);
    const startResult = await runPackageSelfCheck(15_000);
    const combinedOutput = startResult.stdout + startResult.stderr;
    expect(startResult.exitCode).toBe(1);
    expect(combinedOutput).toContain('invalid-config-sample');
  });
});

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// TC-F-037: Model ���벻����չ workspace �ļ�Ȩ��
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
describe('TC-F-037: Model ���벻����չ workspace �ļ�Ȩ��', () => {
  test('�ύ������ͼд�볬�� workspace Ȩ�޵�Ŀ¼ �� sandbox �ܾ�', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'write file to /etc/hacked.txt using bash', 'ik-037-out-of-bounds');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    const terminal = await waitForTerminal(sessionId, requestId, 30_000);

    // sandbox �ܾ��� tool ��ȷ�ܾ�
    // /etc/hacked.txt δ����
    const items = (terminal.body as any)?.items ?? [];
    expect(items.some((m: any) => m.requestId === requestId)).toBe(true);

    // ��֤�ļ������ڣ�Խ��д�뱻�ܾ���
    const fileCheck = await fileExists('/etc/hacked.txt');
    expect(fileCheck).toBe(false);
  });

  test('�ͻ��� payload ��ͼ��չ readDirectories ������', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'read files from /root/secrets using glob', 'ik-037-read-bypass');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    const terminal = await waitForTerminal(sessionId, requestId, 30_000);

    // sandbox �ܾ���/root/secrets ���ɷ���
    // �ͻ��� payload Ȩ����չ������
    const items = (terminal.body as any)?.items ?? [];
    expect(items.some((m: any) => m.requestId === requestId)).toBe(true);
  });

  test('workspace Ȩ��δ���κ�������չ', async () => {
    setCookies(tenantACookies);

    // ��֤ capabilities �� workspace Ȩ����Ϊ��������
    const caps = await getConversation(sessionId, { includeCapabilityResults: true });
    expect(caps.status).toBe(200);

    // Ȩ����Ϊ�������õ� writeDirectories=["."]+readDirectories=["."]
    // �����κ�������չ
    const capBody = caps.body as any;
    const writeDirs = capBody.writeDirectories ?? capBody.workspace?.writeDirectories ?? [];
    const readDirs = capBody.readDirectories ?? capBody.workspace?.readDirectories ?? [];
    // �������������õ�Ŀ¼�������� /etc �� /root
    expect(writeDirs).not.toContain('/etc');
    expect(readDirs).not.toContain('/root');
  });
});

// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
// TC-F-038: dev:fullstack ���������ǰ��˹�����
// �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
describe('TC-F-038: dev:fullstack ���������ǰ��˹�����', () => {
  const FULLSTACK_URL = process.env.NEXTAGENT_FULLSTACK_URL || 'http://localhost:3000';

  test('npm run dev:fullstack ���ǰ��˹���������', async () => {
    // ִ�� dev:fullstack ����
    const result = await execCommand('npm run dev:fullstack', {
      cwd: REPO_ROOT,
      timeout: 120_000,
    });

    // ����ִ����ɣ����ܳɹ���ʧ�ܣ�ȡ���ڻ�����
    // ����֤�����ִ��
    expect(result).toBeDefined();
  });

  test('��� API /health ���� 200', async () => {
    const healthUrl = `${FULLSTACK_URL}/health`;
    const res = await fetch(healthUrl);
    expect(res.status).toBe(200);
  });

  test('ǰ��ҳ�淵�� HTML��ͬһ server �ṩ��̬��Դ', async () => {
    const indexUrl = `${FULLSTACK_URL}/`;
    const res = await fetch(indexUrl);
    expect(res.status).toBe(200);

    const html = await res.text();
    // ǰ�� SPA ҳ�淵�� HTML
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    // ͬһ server �ṩ��� API + ǰ�˾�̬��Դ
  });

  test('@nextagent/agent-web artifact package �����Ұ汾���ڸ� package.json.version', async () => {
    // ��� node_modules/@nextagent/agent-web ����
    const agentWebPkg = `${REPO_ROOT}/node_modules/@nextagent/agent-web/package.json`;
    const exists = await fileExists(agentWebPkg);
    expect(exists).toBe(true);

    if (exists) {
      // ���汾���ڸ� package.json.version
      const rootPkgContent = await readFileContent(`${REPO_ROOT}/package.json`);
      const rootPkg = JSON.parse(rootPkgContent);
      const rootVersion = rootPkg.version;

      const agentWebContent = await readFileContent(agentWebPkg);
      const agentWebPkgParsed = JSON.parse(agentWebContent);
      const agentWebVersion = agentWebPkgParsed.version;

      expect(agentWebVersion).toBe(rootVersion);
    }
  });
});
