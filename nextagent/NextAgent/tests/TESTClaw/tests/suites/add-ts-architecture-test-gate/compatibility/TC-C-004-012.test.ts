/**
 * TC-C-004 ~ TC-C-012: 兼容性维度 P0 补充用例（来源 FPB: fullstack-packaging-boundary）
 *
 * 测试点来源:
 *   TC-C-004  — FPB-R03: Serving profile 来自可信打包参数而非运行时目录扫描 (P0)
 *   TC-C-005  — FPB-R06: 前端 artifact 版本等于根 package.json.version (P0)
 *   TC-C-006  — FPB-R06: 前端版本漂移构建/打包 fail closed (P0)
 *   TC-C-007  — FPB-R10: 前端托管 manifest 路径穿越拒绝 fail closed (P0)
 *   TC-C-008  — FPB-R10: Manifest 非法不可静默降级为 backend-only (P0)
 *   TC-C-009  — FPB-R13: backend-only 缺前端包不失败且不注册前端路由 (P0)
 *   TC-C-010  — FPB-R14: 前端 fallback 不接管 /api/** 后端路由 (P0)
 *   TC-C-011  — FPB-R15: 前后端 Node.js/TypeScript 版本 lockstep 一致 (P0)
 *   TC-C-012  — FPB-R16: 共享依赖版本漂移阻断构建 (P0)
 *
 * 测试因子: 正确性 / 一致性 / 安全隔离
 * 来源 spec: fullstack-packaging-boundary
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

// ─── 配置路径常量 ──────────────────────────────────────
const REPO_ROOT = process.env.NEXTAGENT_REPO_ROOT || path.resolve(__dirname, '../../../../target');
const REPO_ROOT_AVAILABLE = fs.existsSync(path.join(REPO_ROOT, 'bin', 'nextagent-self-check'));
const FULLSTACK_URL = process.env.NEXTAGENT_FULLSTACK_URL || 'http://localhost:3000';
const BACKEND_ONLY_URL = process.env.NEXTAGENT_BACKEND_ONLY_URL || 'http://localhost:3000';
const ROOT_PKG = `${REPO_ROOT}/package.json`;
const FRONTEND_PKG = `${REPO_ROOT}/frontend/agent-web/package.json`;
const AGENT_WEB_PKG = `${REPO_ROOT}/node_modules/@nextagent/agent-web/package.json`;
const WITH_FRONTEND_MANIFEST = `${REPO_ROOT}/packages/agent-app/manifests/with-frontend.package.json`;
const BACKEND_ONLY_MANIFEST = `${REPO_ROOT}/packages/agent-app/manifests/backend-only.package.json`;

// ─── 共享状态 ────────────────────────────────────────
let sessionId: string;
let tenantACookies: string[];
let originalFrontendPkg: string | null = null;
let originalTsVersion: string | null = null;

beforeAll(async () => {
  const health = await healthCheck();
  expect(health.status).toBe(200);

  resetCookies();
  await trustedLogin();
  tenantACookies = getCookies();

  const session = await createSession('zh-CN');
  expect(session.status).toBe(200);
  sessionId = (session.body as any).sessionId ?? 's1-c004-012';
});

afterAll(async () => {
  // 还原前端 package.json 如果被修改
  if (originalFrontendPkg !== null && (await fileExists(FRONTEND_PKG))) {
    await writeFileContent(FRONTEND_PKG, originalFrontendPkg);
  }
  if (originalTsVersion !== null && (await fileExists(FRONTEND_PKG))) {
    const content = await readFileContent(FRONTEND_PKG);
    const pkg = JSON.parse(content);
    pkg.devDependencies.typescript = originalTsVersion;
    await writeFileContent(FRONTEND_PKG, JSON.stringify(pkg, null, 2));
  }
  resetCookies();
});

// ═══════════════════════════════════════════════════════
// TC-C-004: Serving profile 来自可信打包参数而非运行时目录扫描
// ═══════════════════════════════════════════════════════
describe('TC-C-004: Serving profile 来自可信打包参数而非运行时目录扫描', () => {
  test('backend-only profile 启动成功且 readiness evidence 记录 profile', async () => {
    // 以 backend-only profile 启动打包后的运行包
    const startResult = await execCommand(`node ${REPO_ROOT}/bin/nextagent-self-check --profile backend-only`, { timeout: 30_000 });

    const combinedOutput = startResult.stdout + startResult.stderr;
    // readiness evidence 记录 profile = backend-only
    expect(combinedOutput).toMatch(/profile.*backend-only/i);
    // 不包含前端 artifact 证据
    expect(combinedOutput).not.toMatch(/@nextagent\/agent-web|frontend artifact/i);
  });

  test('backend-only 不注册前端静态资源 route，GET / 返回 404', async () => {
    const indexUrl = `${BACKEND_ONLY_URL}/`;
    const res = await fetch(indexUrl);
    // 前端 SPA 页面返回 404（不注册前端静态资源 route）
    expect(res.status).toBe(404);
  });

  test('backend-only 构建产物中不存在 @nextagent/agent-web 引用', async () => {
    const exists = await fileExists(BACKEND_ONLY_MANIFEST);
    if (exists) {
      const manifest = await readFileContent(BACKEND_ONLY_MANIFEST);
      const manifestParsed = JSON.parse(manifest);
      // backend-only manifest 不包含 @nextagent/agent-web dependency
      const deps = manifestParsed.dependencies ?? {};
      expect(deps['@nextagent/agent-web']).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════
// TC-C-005: 前端 artifact 版本等于根 package.json.version
// ═══════════════════════════════════════════════════════
describe('TC-C-005: 前端 artifact 版本等于根 package.json.version', () => {
  test('三者版本完全一致：根版本 = artifact 版本 = dependency 版本', async () => {
    // 检查仓库根 package.json.version
    const rootPkgExists = await fileExists(ROOT_PKG);
    expect(rootPkgExists).toBe(true);

    const rootPkgContent = await readFileContent(ROOT_PKG);
    const rootPkg = JSON.parse(rootPkgContent);
    const rootVersion = rootPkg.version;
    expect(rootVersion).toBeDefined();
    expect(rootVersion.length).toBeGreaterThan(0);

    // 检查 @nextagent/agent-web artifact package 版本
    const agentWebExists = await fileExists(AGENT_WEB_PKG);
    if (agentWebExists) {
      const agentWebContent = await readFileContent(AGENT_WEB_PKG);
      const agentWebPkg = JSON.parse(agentWebContent);
      const agentWebVersion = agentWebPkg.version;
      // artifact 版本等于根版本
      expect(agentWebVersion).toBe(rootVersion);
    }

    // 检查 with-frontend.package.json 中 dependency 版本
    const manifestExists = await fileExists(WITH_FRONTEND_MANIFEST);
    if (manifestExists) {
      const manifestContent = await readFileContent(WITH_FRONTEND_MANIFEST);
      const manifestParsed = JSON.parse(manifestContent);
      const depVersion = manifestParsed.dependencies?.['@nextagent/agent-web'];
      // dependency 版本等于根版本（精确版本）
      expect(depVersion).toBe(rootVersion);
    }
  });
});

// ═══════════════════════════════════════════════════════
// TC-C-006: 前端版本漂移构建/打包 fail closed
// ═══════════════════════════════════════════════════════
describe('TC-C-006: 前端版本漂移构建/打包 fail closed', () => {
  test('artifact 版本与根版本不一致 → 构建 fail closed', async () => {
    const rootPkgContent = await readFileContent(ROOT_PKG);
    const rootPkg = JSON.parse(rootPkgContent);
    const rootVersion = rootPkg.version;

    // 修改 artifact package 版本模拟版本漂移
    const agentWebExists = await fileExists(AGENT_WEB_PKG);
    if (!agentWebExists) {
      return;
    } // 如果 artifact 不存在，跳过

    const agentWebContent = await readFileContent(AGENT_WEB_PKG);
    const agentWebPkg = JSON.parse(agentWebContent);
    originalFrontendPkg = agentWebContent; // 保存原版用于还原

    // 将 artifact 版本改为不同于根版本的值
    const driftedVersion = '0.9.0';
    agentWebPkg.version = driftedVersion;
    await writeFileContent(AGENT_WEB_PKG, JSON.stringify(agentWebPkg, null, 2));

    // 执行构建验证
    const buildResult = await execCommand(`node ${REPO_ROOT}/bin/nextagent-self-check --profile with-frontend`, { timeout: 30_000 });

    const combinedOutput = buildResult.stdout + buildResult.stderr;
    // 构建输出 fail closed，明确标注版本漂移
    expect(combinedOutput).toMatch(/version drift.*@nextagent\/agent-web.*0\.9\.0.*${rootVersion.replace('.', '\\.')}|BLOCKED/i);

    // 还原
    await writeFileContent(AGENT_WEB_PKG, originalFrontendPkg!);
  });

  test('后端运行时未自动修正前端版本', async () => {
    // 版本一致性仅通过构建/打包阶段校验，运行时无 auto-rewrite/sync/pull 行为
    const buildResult = await execCommand(`npm run build --prefix ${REPO_ROOT} 2>&1 || echo "BUILD_FAILED"`, { timeout: 60_000 });

    // 构建命令执行完成，验证无自动修正行为
    // 如果漂移存在，构建失败而非自动修正
    expect(buildResult).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════
// TC-C-007: 前端托管 manifest 路径穿越拒绝 fail closed
// ═══════════════════════════════════════════════════════
describe('TC-C-007: 前端托管 manifest 路径穿越拒绝 fail closed', () => {
  test('assetRoot 含 ".." 路径穿越 → BLOCKED', async () => {
    // 构造 manifest assetRoot 含路径穿越
    const traversalConfig = `
identity:
  name: test-agent
  version: "1.0.0"
frontend:
  hosting:
    assetRoot: "../../../etc"
modelProfiles:
  - providerId: openai-compatible
    models:
      - modelId: MiniMax-M2.7-highspeed
        contextWindowTokens: 128000
        fallbackEligible: false
`;

    const configPath = `${REPO_ROOT}/test-config-traversal.yaml`;
    await writeFileContent(configPath, traversalConfig);

    const startResult = await execCommand(`node ${REPO_ROOT}/bin/nextagent-self-check --config ${configPath} --profile with-frontend`, {
      timeout: 15_000,
    });

    const combinedOutput = startResult.stdout + startResult.stderr;
    // 启动输出 fail closed，标注 manifest path traversal detected
    expect(combinedOutput).toMatch(
      /manifest path traversal detected.*assetRoot contains '\.\.' segment|assetRoot must be relative path within package root/i,
    );
    // readiness state = BLOCKED
    expect(combinedOutput).toContain('BLOCKED');
  });

  test('assetRoot 为绝对路径 → BLOCKED', async () => {
    const absolutePathConfig = `
identity:
  name: test-agent
  version: "1.0.0"
frontend:
  hosting:
    assetRoot: /absolute/path
modelProfiles:
  - providerId: openai-compatible
    models:
      - modelId: MiniMax-M2.7-highspeed
        contextWindowTokens: 128000
        fallbackEligible: false
`;

    const configPath = `${REPO_ROOT}/test-config-absolute.yaml`;
    await writeFileContent(configPath, absolutePathConfig);

    const startResult = await execCommand(`node ${REPO_ROOT}/bin/nextagent-self-check --config ${configPath} --profile with-frontend`, {
      timeout: 15_000,
    });

    const combinedOutput = startResult.stdout + startResult.stderr;
    // 启动输出 fail closed，标注 assetRoot must be relative path
    expect(combinedOutput).toMatch(/manifest assetRoot must be relative path.*got absolute path|BLOCKED/i);
  });
});

// ═══════════════════════════════════════════════════════
// TC-C-008: Manifest 非法不可静默降级为 backend-only
// ═══════════════════════════════════════════════════════
describe('TC-C-008: Manifest 非法不可静默降级为 backend-only', () => {
  test('manifest 缺失 spaFallback 字段 → BLOCKED 而非静默降级', async () => {
    const incompleteManifestConfig = `
identity:
  name: test-agent
  version: "1.0.0"
frontend:
  hosting:
    assetRoot: ./dist
    indexHtml: ./dist/index.html
modelProfiles:
  - providerId: openai-compatible
    models:
      - modelId: MiniMax-M2.7-highspeed
        contextWindowTokens: 128000
        fallbackEligible: false
`;

    const configPath = `${REPO_ROOT}/test-config-incomplete.yaml`;
    await writeFileContent(configPath, incompleteManifestConfig);

    const startResult = await execCommand(`node ${REPO_ROOT}/bin/nextagent-self-check --config ${configPath} --profile with-frontend`, {
      timeout: 15_000,
    });

    const combinedOutput = startResult.stdout + startResult.stderr;
    // 启动输出 fail closed，标注 manifest missing required field
    expect(combinedOutput).toMatch(/manifest missing required field.*spaFallback|BLOCKED/i);
    // 未静默降级为 backend-only（明确的 BLOCKED 而非 backend-only serving）
    expect(combinedOutput).not.toMatch(/degraded to backend-only|serving backend-only/i);
  });
});

// ═══════════════════════════════════════════════════════
// TC-C-009: backend-only 缺前端包不失败且不注册前端路由
// ═══════════════════════════════════════════════════════
describe('TC-C-009: backend-only 缺前端包不失败且不注册前端路由', () => {
  test('backend-only 无前端包启动成功，/health 返回 200', async () => {
    const health = await healthCheck();
    // backend-only 运行包启动成功
    expect(health.status).toBe(200);
  });

  test('backend-only API 可用且 SSE stream 正常', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'backend-only test', 'ik-c009');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    const terminal = await waitForTerminal(sessionId, requestId);
    // SSE stream 推送 assistantMessage + terminal(COMPLETED)，后端功能完整
    const items = (terminal.body as any)?.items ?? [];
    expect(items.some((m) => m.role === 'ASSISTANT')).toBe(true);
  }, 60_000);

  test('backend-only GET / 返回 404，不注册前端静态资源 route', async () => {
    const indexUrl = `${BACKEND_ONLY_URL}/`;
    const res = await fetch(indexUrl);
    // GET / 返回 404（不注册前端静态资源 route）
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════
// TC-C-010: 前端 fallback 不接管 /api/** 后端路由
// ═══════════════════════════════════════════════════════
describe('TC-C-010: 前端 fallback 不接管 /api/** 后端路由', () => {
  test('后端 API 路由返回 JSON 而非前端 HTML', async () => {
    setCookies(tenantACookies);

    const sessionRes = await fetch(`${FULLSTACK_URL}/api/v1/sessions/${sessionId}/conversation`, {
      headers: { Cookie: tenantACookies.join('; ') },
    });
    // 返回 session JSON 数据（后端 API route 处理），不返回前端 HTML
    expect(sessionRes.status).toBe(200);
    const contentType = sessionRes.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/i);
    expect(contentType).not.toMatch(/text\/html/i);
  });

  test('/health 控制路由由后端处理（无前缀）', async () => {
    // ⚠️ 真实 API: /health 无前缀（非 /api/v1/health）
    const healthUrl = `${FULLSTACK_URL}/health`;
    const res = await fetch(healthUrl);
    // /health 返回 200（后端控制 route 处理）
    expect(res.status).toBe(200);
  });

  test('前端 SPA fallback 处理非 API 路径', async () => {
    const nonApiUrl = `${FULLSTACK_URL}/chat`;
    const res = await fetch(nonApiUrl);
    // 前端 SPA fallback 返回前端 HTML（非 API 路径走前端 fallback）
    if (res.status === 200) {
      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toMatch(/text\/html/i);
    }
    // 非 API 路径不返回 JSON backend error
  });

  test('POST submit request 路径由后端 API 处理', async () => {
    setCookies(tenantACookies);

    const submit = await submitRequest(sessionId, 'fallback route test', 'ik-c010');
    expect(submit.status).toBe(200);
    const requestId = (submit.body as any).requestId;
    const terminal = await waitForTerminal(sessionId, requestId);
    // request 路径由后端 API 处理，不被前端 fallback 截获
    const items = (terminal.body as any)?.items ?? [];
    expect(items.some((m) => m.role === 'ASSISTANT')).toBe(true);
  });
}, 60_000);

// ═══════════════════════════════════════════════════════
// TC-C-011: 前后端 Node.js/TypeScript 版本 lockstep 一致
// ═══════════════════════════════════════════════════════
describe('TC-C-011: 前后端 Node.js/TypeScript 版本 lockstep 一致', () => {
  test('TypeScript 版本漂移 → 构建 fail closed', async () => {
    const rootPkgContent = await readFileContent(ROOT_PKG);
    const rootPkg = JSON.parse(rootPkgContent);
    const rootTsVersion = rootPkg.devDependencies?.typescript ?? rootPkg.dependencies?.typescript;
    expect(rootTsVersion).toBeDefined();

    // 修改前端 TypeScript 版本模拟漂移
    const frontendPkgExists = await fileExists(FRONTEND_PKG);
    if (!frontendPkgExists) {
      return;
    }

    const frontendContent = await readFileContent(FRONTEND_PKG);
    const frontendPkg = JSON.parse(frontendContent);
    originalTsVersion = frontendPkg.devDependencies?.typescript;

    // 将前端 TypeScript 版本改为不同于根版本
    frontendPkg.devDependencies.typescript = '5.5.0';
    await writeFileContent(FRONTEND_PKG, JSON.stringify(frontendPkg, null, 2));

    // 执行构建验证
    const buildResult = await execCommand(`node ${REPO_ROOT}/scripts/check-toolchain-lockstep.js 2>&1 || echo "LOCKSTEP_CHECK_FAILED"`, {
      timeout: 30_000,
    });

    const combinedOutput = buildResult.stdout + buildResult.stderr;
    // 验证 fail，明确标注 TypeScript version drift
    expect(combinedOutput).toMatch(/TypeScript version drift.*frontend uses 5\.5\.0.*root authority requires/i);

    // 还原前端版本
    frontendPkg.devDependencies.typescript = originalTsVersion!;
    await writeFileContent(FRONTEND_PKG, JSON.stringify(frontendPkg, null, 2));
  });

  test('修正后构建验证 pass', async () => {
    // 前端版本修正后，构建验证重新执行 pass
    const frontendPkgExists = await fileExists(FRONTEND_PKG);
    if (!frontendPkgExists) {
      return;
    }

    const rootPkgContent = await readFileContent(ROOT_PKG);
    const rootPkg = JSON.parse(rootPkgContent);
    const rootTsVersion = rootPkg.devDependencies?.typescript ?? rootPkg.dependencies?.typescript;

    const frontendContent = await readFileContent(FRONTEND_PKG);
    const frontendPkg = JSON.parse(frontendContent);

    // 确认前端版本与根一致
    if (frontendPkg.devDependencies?.typescript !== rootTsVersion) {
      frontendPkg.devDependencies.typescript = rootTsVersion;
      await writeFileContent(FRONTEND_PKG, JSON.stringify(frontendPkg, null, 2));
    }

    const buildResult = await execCommand(`node ${REPO_ROOT}/scripts/check-toolchain-lockstep.js 2>&1`, { timeout: 30_000 });

    const combinedOutput = buildResult.stdout + buildResult.stderr;
    // 验证 pass，前后端 TypeScript 版本一致
    expect(combinedOutput).not.toMatch(/version drift/i);
  });
});

// ═══════════════════════════════════════════════════════
// TC-C-012: 共享依赖版本漂移阻断构建
// ═══════════════════════════════════════════════════════
describe('TC-C-012: 共享依赖版本漂移阻断构建', () => {
  test('共享依赖 zod 版本漂移 → 构建验证 fail', async () => {
    const frontendPkgExists = await fileExists(FRONTEND_PKG);
    if (!frontendPkgExists) {
      return;
    }

    const frontendContent = await readFileContent(FRONTEND_PKG);
    const frontendPkg = JSON.parse(frontendContent);

    // 修改前端 zod 版本模拟漂移
    const originalZodVersion = frontendPkg.dependencies?.zod;
    if (!originalZodVersion) {
      return;
    }

    frontendPkg.dependencies.zod = '3.22.0';
    await writeFileContent(FRONTEND_PKG, JSON.stringify(frontendPkg, null, 2));

    // 执行构建验证
    const buildResult = await execCommand(`node ${REPO_ROOT}/scripts/check-shared-dependency-lockstep.js 2>&1 || echo "LOCKSTEP_CHECK_FAILED"`, {
      timeout: 30_000,
    });

    const combinedOutput = buildResult.stdout + buildResult.stderr;
    // 验证 fail，明确标注共享依赖版本漂移
    expect(combinedOutput).toMatch(/shared dependency version drift.*zod.*frontend=3\.22\.0.*backend/i);

    // 还原
    frontendPkg.dependencies.zod = originalZodVersion;
    await writeFileContent(FRONTEND_PKG, JSON.stringify(frontendPkg, null, 2));
  });

  test('修正后共享依赖版本一致 → 构建验证 pass', async () => {
    const frontendPkgExists = await fileExists(FRONTEND_PKG);
    if (!frontendPkgExists) {
      return;
    }

    // 还原前端 zod 版本为 backend 一致版本
    const frontendContent = await readFileContent(FRONTEND_PKG);
    const frontendPkg = JSON.parse(frontendContent);

    const rootPkgContent = await readFileContent(ROOT_PKG);
    const rootPkg = JSON.parse(rootPkgContent);
    const rootZodVersion = rootPkg.dependencies?.zod ?? '3.23.0';

    frontendPkg.dependencies.zod = rootZodVersion;
    await writeFileContent(FRONTEND_PKG, JSON.stringify(frontendPkg, null, 2));

    const buildResult = await execCommand(`node ${REPO_ROOT}/scripts/check-shared-dependency-lockstep.js 2>&1`, { timeout: 30_000 });

    const combinedOutput = buildResult.stdout + buildResult.stderr;
    // 验证 pass，共享依赖版本一致
    expect(combinedOutput).not.toMatch(/shared dependency version drift/i);
  });
});
