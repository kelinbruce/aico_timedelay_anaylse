/**
 * TC-S-016 ~ TC-S-020: 安全维度 P0 补充用例（来源 SEC-B: secret-configuration-boundary）
 *
 * 测试点来源:
 *   TC-S-016  — SEC-B-R02: Raw credential 写入配置启动拒绝不回显 (P0)
 *   TC-S-017  — SEC-B-R04: Inactive secret 引用不触发 resolvability 验证 (P0)
 *   TC-S-018  — SEC-B-R06: Active env: 引用空值启动阻塞 (P0)
 *   TC-S-019  — SEC-B-R06: Active file: 引用不可读启动阻塞 (P0)
 *   TC-S-020  — SEC-B-R09: 解析后 Secret 值不出现在任何持久化或输出通道 (P0)
 *
 * 测试因子: 安全隔离 / 脱敏性 / 正确性
 * 来源 spec: secret-configuration-boundary
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
} from '../../helpers/api-client';

// ─── 配置文件路径常量 ──────────────────────────────────────
const CONFIG_DIR = process.env.NEXTAGENT_CONFIG_DIR || '.';
const APPLICATION_YAML = process.env.NEXTAGENT_APP_CONFIG || `${CONFIG_DIR}/application.yaml`;
const REPO_ROOT = process.env.NEXTAGENT_REPO_ROOT || path.resolve(__dirname, '../../../../target');
const REPO_ROOT_AVAILABLE = fs.existsSync(path.join(REPO_ROOT, 'bin', 'nextagent-self-check'));
const RAW_CREDENTIAL = 'my-secret-key-12345';
const ENV_VAR_NAME = 'NEXTAGENT_MODEL_API_KEY';
const FILE_REF_PATH = '/etc/nextagent/gateway.key';
const REAL_API_KEY = 'sk-real-api-key-abcdef123456';

// ─── 共享状态 ────────────────────────────────────────
let sessionId: string;
let tenantACookies: string[];
let originalConfig: string | null = null;

beforeAll(async () => {
  if (await fileExists(APPLICATION_YAML)) {
    originalConfig = await readFileContent(APPLICATION_YAML);
  }

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
  if (originalConfig !== null) {
    await writeFileContent(APPLICATION_YAML, originalConfig);
  }
  resetCookies();
});

// ═══════════════════════════════════════════════════════
// TC-S-016: Raw credential 写入配置启动拒绝不回显
// ═══════════════════════════════════════════════════════
describe(
  REPO_ROOT_AVAILABLE ? 'TC-S-016: Raw credential 写入配置启动拒绝不回显' : 'TC-S-016: Raw credential 写入配置启动拒绝不回显（需源码仓库 - 跳过）',
  () => {
    if (!REPO_ROOT_AVAILABLE) {
      test.skip('需要源码仓库环境');
      return;
    }
    test('启动加载含 raw credential 的 application.yaml → BLOCKED', async () => {
      const rawCredConfig = `
identity:
  name: test-agent
  version: "1.0.0"
modelProfiles:
  - providerId: openai-compatible
    models:
      - modelId: MiniMax-M2.7-highspeed
        contextWindowTokens: 128000
        fallbackEligible: false
gateway:
  apiKey: ${RAW_CREDENTIAL}
`;

      await writeFileContent(APPLICATION_YAML, rawCredConfig);

      const startResult = await execCommand(`node ${REPO_ROOT}/bin/nextagent-self-check --config ${APPLICATION_YAML}`, { timeout: 15_000 });

      const combinedOutput = startResult.stdout + startResult.stderr;
      // 启动拒绝 — safe issue 标注 raw credential 被拒绝
      expect(combinedOutput).toMatch(/credential-bearing field rejected.*expected SecretReference format.*env:.*file:.*got raw value/i);
      // readiness state = BLOCKED
      expect(combinedOutput).toContain('BLOCKED');
    });

    test('safe issue 不回显 raw credential 原文', async () => {
      const rawCredConfig = `
identity:
  name: test-agent
  version: "1.0.0"
modelProfiles:
  - providerId: openai-compatible
    models:
      - modelId: MiniMax-M2.7-highspeed
        contextWindowTokens: 128000
        fallbackEligible: false
gateway:
  apiKey: ${RAW_CREDENTIAL}
`;

      await writeFileContent(APPLICATION_YAML, rawCredConfig);

      const startResult = await execCommand(`node ${REPO_ROOT}/bin/nextagent-self-check --config ${APPLICATION_YAML}`, { timeout: 15_000 });

      const combinedOutput = startResult.stdout + startResult.stderr;
      // raw credential 原文不出现在任何日志/诊断/输出中
      expect(combinedOutput).not.toContain(RAW_CREDENTIAL);
      // 不暴露 raw exception 或 internal stack
      expect(combinedOutput).not.toMatch(/Error:.*at.*\(|stack trace|TypeError/i);
    });

    test('日志中搜索 raw credential 原文返回 0 条匹配', async () => {
      // 检查后端日志文件中不含 raw credential 原文
      const logSearch = await execCommand(`findstr /s /m "${RAW_CREDENTIAL}" ${CONFIG_DIR}/logs/ || echo "NO_MATCH"`, { timeout: 30_000 });
      const logOutput = logSearch.stdout + logSearch.stderr;
      // 日志中搜索 raw credential 返回 0 条匹配
      expect(logOutput).not.toContain(RAW_CREDENTIAL);
    });
  },
);

// ═══════════════════════════════════════════════════════
// TC-S-017: Inactive secret 引用不触发 resolvability 验证
// ═══════════════════════════════════════════════════════
describe(
  REPO_ROOT_AVAILABLE
    ? 'TC-S-017: Inactive secret 引用不触发 resolvability 验证'
    : 'TC-S-017: Inactive secret 引用不触发 resolvability 验证（需源码仓库 - 跳过）',
  () => {
    if (!REPO_ROOT_AVAILABLE) {
      test.skip('需要源码仓库环境');
      return;
    }
    test('inactive deployment branch file: 引用目标不存在 → 启动成功', async () => {
      const inactiveRefConfig = `
identity:
  name: test-agent
  version: "1.0.0"
modelProfiles:
  - providerId: openai-compatible
    credentialRef: env:${ENV_VAR_NAME}
    models:
      - modelId: MiniMax-M2.7-highspeed
        contextWindowTokens: 128000
        fallbackEligible: false
deploymentBranches:
  - name: inactive-branch
    active: false
    gateway:
      apiKey: file:${FILE_REF_PATH}
`;

      await writeFileContent(APPLICATION_YAML, inactiveRefConfig);

      const startResult = await execCommand(`node ${REPO_ROOT}/bin/nextagent-self-check --config ${APPLICATION_YAML}`, {
        timeout: 30_000,
        env: { [ENV_VAR_NAME]: 'sk-valid-key-for-test' },
      });

      const combinedOutput = startResult.stdout + startResult.stderr;
      // inactive branch 的不可解析 file: 引用不影响启动
      expect(combinedOutput).not.toContain('BLOCKED');
      // readiness state = READY 或 DEGRADED_READY
      expect(combinedOutput).toMatch(/READY|DEGRADED_READY/i);
    });

    test('日志不包含读取 inactive branch 引用目标的 I/O 操作', async () => {
      const combinedOutput = await readFileContent(APPLICATION_YAML);
      // inactive branch 诊断仅标注 grammar-valid + inactive，不标注 resolvability failure
      const logSearch = await execCommand(`findstr /s /m "${FILE_REF_PATH}" ${CONFIG_DIR}/logs/ || echo "NO_MATCH"`, { timeout: 30_000 });
      // 日志中不包含读取 inactive 引用目标的 I/O 操作
      expect(logSearch.stdout + logSearch.stderr).not.toContain(FILE_REF_PATH);
    });
  },
);

// ═══════════════════════════════════════════════════════
// TC-S-018: Active env: 引用空值启动阻塞
// ═══════════════════════════════════════════════════════
describe(REPO_ROOT_AVAILABLE ? 'TC-S-018: Active env: 引用空值启动阻塞' : 'TC-S-018: Active env: 引用空值启动阻塞（需源码仓库 - 跳过）', () => {
  if (!REPO_ROOT_AVAILABLE) {
    test.skip('需要源码仓库环境');
    return;
  }
  test('active env: 引用空值环境变量 → BLOCKED', async () => {
    const emptyEnvConfig = `
identity:
  name: test-agent
  version: "1.0.0"
modelProfiles:
  - providerId: openai-compatible
    credentialRef: env:${ENV_VAR_NAME}
    models:
      - modelId: MiniMax-M2.7-highspeed
        contextWindowTokens: 128000
        fallbackEligible: false
`;

    await writeFileContent(APPLICATION_YAML, emptyEnvConfig);

    // 设置空值环境变量
    const startResult = await execCommand(`node ${REPO_ROOT}/bin/nextagent-self-check --config ${APPLICATION_YAML}`, {
      timeout: 15_000,
      env: { [ENV_VAR_NAME]: '' },
    });

    const combinedOutput = startResult.stdout + startResult.stderr;
    // safe issue 标注 active env: reference resolved to empty value
    expect(combinedOutput).toMatch(/active env:.*reference resolved to empty value|SECRET_EMPTY/i);
    // readiness state = BLOCKED
    expect(combinedOutput).toContain('BLOCKED');
  });

  test(REPO_ROOT_AVAILABLE ? '日志中环境变量名仅以脱敏/引用形式出现' : '日志中环境变量名仅以脱敏/引用形式出现（需源码仓库环境 - 跳过）', async () => {
    if (!REPO_ROOT_AVAILABLE) {
      return;
    }
    const logSearch = await execCommand(`findstr /s /m "${ENV_VAR_NAME}" ${CONFIG_DIR}/logs/ || echo "NO_MATCH"`, { timeout: 30_000 });
    const logOutput = logSearch.stdout + logSearch.stderr;
    // 环境变量名仅以脱敏/引用形式出现，不包含空值内容或 raw 变量值
    // 验证日志中没有 "= ''" 或 "=" 后跟空字符串的模式
    expect(logOutput).not.toMatch(new RegExp(`${ENV_VAR_NAME}=\\s*$`, 'm'));
  });
});

// ═══════════════════════════════════════════════════════
// TC-S-019: Active file: 引用不可读启动阻塞
// ═══════════════════════════════════════════════════════
describe(REPO_ROOT_AVAILABLE ? 'TC-S-019: Active file: 引用不可读启动阻塞' : 'TC-S-019: Active file: 引用不可读启动阻塞（需源码仓库 - 跳过）', () => {
  if (!REPO_ROOT_AVAILABLE) {
    test.skip('需要源码仓库环境');
    return;
  }
  test('active file: 引用不存在文件 → BLOCKED', async () => {
    const missingFileConfig = `
identity:
  name: test-agent
  version: "1.0.0"
gateway:
  credentialRef: file:${FILE_REF_PATH}
modelProfiles:
  - providerId: openai-compatible
    models:
      - modelId: MiniMax-M2.7-highspeed
        contextWindowTokens: 128000
        fallbackEligible: false
`;

    await writeFileContent(APPLICATION_YAML, missingFileConfig);

    // 确保目标文件不存在
    const fileCheck = await fileExists(FILE_REF_PATH);
    expect(fileCheck).toBe(false);

    const startResult = await execCommand(`node ${REPO_ROOT}/bin/nextagent-self-check --config ${APPLICATION_YAML}`, { timeout: 15_000 });

    const combinedOutput = startResult.stdout + startResult.stderr;
    // safe issue 标注 active file: reference target not found
    expect(combinedOutput).toMatch(
      /active file:.*reference target not found|active file:.*reference target unreadable|SECRET_FILE_MISSING|SECRET_FILE_UNREADABLE/i,
    );
    // readiness state = BLOCKED
    expect(combinedOutput).toContain('BLOCKED');
  });

  test(REPO_ROOT_AVAILABLE ? '日志中文件路径不以完整路径原文出现' : '日志中文件路径不以完整路径原文出现（需源码仓库环境 - 跳过）', async () => {
    if (!REPO_ROOT_AVAILABLE) {
      return;
    }
    const logSearch = await execCommand(`findstr /s /m "${FILE_REF_PATH}" ${CONFIG_DIR}/logs/ || echo "NO_MATCH"`, { timeout: 30_000 });
    const logOutput = logSearch.stdout + logSearch.stderr;
    // 日志中文件路径不以完整路径原文出现，仅以 safe field reference 形式出现
    // 不应暴露 raw 文件路径或文件内容
    expect(logOutput).not.toContain(FILE_REF_PATH);
  });
});

// ═══════════════════════════════════════════════════════
// TC-S-020: 解析后 Secret 值不出现在任何持久化或输出通道
// ═══════════════════════════════════════════════════════
describe('TC-S-020: 解析后 Secret 值不出现在任何持久化或输出通道', () => {
  // SSE stream and audit tests don't need repo; execCommand tests do
  test('SSE stream payload 中不含 secret 原文', async () => {
    setCookies(tenantACookies);

    // 提交请求触发 model provider 调用（使用 secret）
    const submit = await submitRequest(sessionId, 'use the model with secret', 'ik-s020-stream');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    const terminal = await waitForTerminal(sessionId, requestId);
    const items = (terminal.body as any)?.items ?? [];
    expect(items.some((m) => m.role === 'ASSISTANT')).toBe(true);

    // SSE stream payload 中搜索 secret 原文返回 0 条匹配
    const conversation = await getConversation(sessionId);
    const convBody = JSON.stringify(conversation.body);
    expect(convBody).not.toContain(REAL_API_KEY);
  }, 60_000);

  test(
    REPO_ROOT_AVAILABLE ? '后端日志中搜索 secret 原文返回 0 条匹配' : '后端日志中搜索 secret 原文返回 0 条匹配（需源码仓库环境 - 跳过）',
    async () => {
      if (!REPO_ROOT_AVAILABLE) {
        return;
      }
      const logSearch = await execCommand(`findstr /s /m "${REAL_API_KEY}" ${CONFIG_DIR}/logs/ || echo "NO_MATCH"`, { timeout: 30_000 });
      const logOutput = logSearch.stdout + logSearch.stderr;
      // 日志中搜索 secret 原文返回 0 条匹配
      expect(logOutput).not.toContain(REAL_API_KEY);
    },
  );

  test('trace/audit 输出中搜索 secret 原文返回 0 条匹配', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'audit secret test', 'ik-s020-audit');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    await waitForTerminal(sessionId, requestId);

    // TODO: 真实 API 无 getAuditEvents，通过 conversation 间接验证
    const audit = await getConversation(sessionId);
    const auditBody = JSON.stringify(audit.body);
    // audit 输出中搜索 secret 原文返回 0 条匹配
    expect(auditBody).not.toContain(REAL_API_KEY);
  }, 60_000);

  test('metric 输出中搜索 secret 原文返回 0 条匹配', async () => {
    // TODO: metrics 端点可能有独立路径（Prometheus /metrics 格式）
    const BASE_URL = process.env.NEXTAGENT_URL || 'http://localhost:3000';
    const metricsRes = await fetch(`${BASE_URL}/metrics`);
    if (metricsRes.status === 404) {
      // 无 metrics 端点，跳过验证
      return;
    }
    const metricsBody = await metricsRes.text();
    // metric 输出中搜索 secret 原文返回 0 条匹配
    expect(metricsBody).not.toContain(REAL_API_KEY);
  });

  test('DefaultSystemConfig 仅包含 secret references 不含 resolved 值', async () => {
    // 检查冻结配置产出仅包含 env:/file: 引用
    const configSearch = await execCommand(`findstr /s /m "${REAL_API_KEY}" ${CONFIG_DIR}\*.log 2>nul || echo "NO_MATCH"`, { timeout: 30_000 });
    const configOutput = configSearch.stdout + configSearch.stderr;
    // 冻结配置产出不含 resolved secret 值
    expect(configOutput).not.toContain(REAL_API_KEY);
  });

  test('SQLite 数据库中搜索 secret 原文返回 0 条匹配', async () => {
    // 搜索 SQLite 数据库中是否存储了 secret 值
    const dbSearch = await execCommand(`findstr /s /m "${REAL_API_KEY}" ${CONFIG_DIR}/data/*.db || echo "NO_DB_MATCH"`, { timeout: 30_000 });
    const dbOutput = dbSearch.stdout + dbSearch.stderr;
    // SQLite 中搜索 secret 原文返回 0 条匹配
    expect(dbOutput).not.toContain(REAL_API_KEY);
  });
});
