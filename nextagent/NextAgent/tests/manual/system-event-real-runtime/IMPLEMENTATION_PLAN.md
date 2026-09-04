# System Event Real Runtime Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `DEGRADATION_NOTICE` 与 `CONTEXT_COMPACTED` 提供不进入默认产品装配的 MiniMax/真实 Runtime 人工集成验收路径，并证明 live、history 与正式前端 artifact 的呈现闭合。

**Architecture:** 测试目录持有受控失败 Tool plugin、专用 Agent、两套配置和验证脚本。脚本只使用现有 session/request/SSE/history HTTP API，并以已安装的正式 `@nextagent/agent-web` artifact 启动页面检查；MiniMax 凭据仍由既有 launcher 从 Keychain 注入。`HOOK_DEGRADED` 不进入真实 Runtime 场景。

**Tech Stack:** Node.js 22 ESM、Vitest、Fastify public API、SSE、Playwright、YAML、MiniMax launcher。

---

## 文件结构

- `tests/manual/system-event-real-runtime/README.md`：人工启动顺序、场景参数、预期证据和清理方式。
- `tests/manual/system-event-real-runtime/IMPLEMENTATION_PLAN.md`：仅供该测试资产实施追踪，不承载产品契约。
- `tests/manual/system-event-real-runtime/config/degradation.yaml`：失败 Tool 场景 overlay 与隔离数据目录。
- `tests/manual/system-event-real-runtime/config/context-compaction.yaml`：上下文整理场景 overlay 与隔离数据目录。
- `tests/manual/system-event-real-runtime/config/agents/system-event-degradation-agent/agent.yaml`：只绑定验证 Tool 的专用 Agent。
- `tests/manual/system-event-real-runtime/config/agents/system-event-context-agent/agent.yaml`：禁用 Tool 调用的上下文验证 Agent。
- `tests/manual/system-event-real-runtime/config/plugins/system-event-failure/plugin.json`：测试 plugin manifest。
- `tests/manual/system-event-real-runtime/config/plugins/system-event-failure/index.js`：返回合法 `FAILED` Capability result 的受控 Tool。
- `tests/manual/system-event-real-runtime/verify-support.mjs`：HTTP、SSE、history、终态等待与安全输出的纯辅助函数。
- `tests/architecture/system-event-real-runtime-support.test.ts`：对验证辅助函数做确定性测试。
- `tests/manual/system-event-real-runtime/verify.mjs`：运行两个真实 Runtime 场景并检查正式前端 artifact。
- `tests/architecture/system-event-real-runtime-fixture-isolation.test.ts`：验证 fixture contract、默认装配/发布路径不引用 fixture、后端不产生 `HOOK_DEGRADED`。

### Task 1: 先建立 fixture contract 与隔离门禁

**Files:**
- Create: `tests/architecture/system-event-real-runtime-fixture-isolation.test.ts`
- Test: `tests/architecture/system-event-real-runtime-fixture-isolation.test.ts`

- [ ] **Step 1: 编写失败测试**

测试动态加载 `config/plugins/system-event-failure/index.js`，要求 provider 解析 `system_event_failure_probe`，调用后得到：

```ts
expect(result).toMatchObject({
  status: 'FAILED',
  structuredPayload: {},
  generatedMessages: [],
  artifactRefs: [],
  safeError: {
    code: 'SYSTEM_EVENT_SCENARIO_FAILED',
    category: 'INTERNAL',
    retryable: false,
  },
});
```

同一测试递归检查 `packages/agent-app/config`、`packages/agent-core/src/builtin-agents`、`scripts/pack-local-runtime.mjs` 与三个 package manifest 不包含 `system-event-real-runtime`、`system-event-failure` 或 `system-event-*-agent`；另检查 `packages/agent-core/src`、`packages/agent-runtime/src`、`packages/agent-channel-web/src` 不包含 `HOOK_DEGRADED`。

- [ ] **Step 2: 验证 RED**

Run: `npx vitest run --config vitest.config.architecture.ts tests/architecture/system-event-real-runtime-fixture-isolation.test.ts`

Expected: FAIL，原因是测试 plugin 和专用配置尚不存在。

### Task 2: 实现最小受控失败 fixture 与专用配置

**Files:**
- Create: `tests/manual/system-event-real-runtime/config/plugins/system-event-failure/plugin.json`
- Create: `tests/manual/system-event-real-runtime/config/plugins/system-event-failure/index.js`
- Create: `tests/manual/system-event-real-runtime/config/agents/system-event-degradation-agent/agent.yaml`
- Create: `tests/manual/system-event-real-runtime/config/agents/system-event-context-agent/agent.yaml`
- Create: `tests/manual/system-event-real-runtime/config/degradation.yaml`
- Create: `tests/manual/system-event-real-runtime/config/context-compaction.yaml`

- [ ] **Step 1: 实现 plugin manifest 与 provider**

Plugin 使用无 import 的 ESM bundle，只暴露一个 EAGER TOOL descriptor。Executor 返回上述合法失败结果；不得读取环境变量、文件、SQLite 或凭据。

- [ ] **Step 2: 实现场景配置**

`degradation.yaml` 使用独立端口和 workspace/log 目录，加载测试 plugin，并选择只绑定 `system_event_failure_probe` 的 Agent。验证请求携带现有 `modelOptions.toolChoice=REQUIRED`。

`context-compaction.yaml` 使用另一个独立端口和 workspace/log 目录，选择无 Capability binding 的 Agent，并把 MiniMax profile 的 context window/output limit 收窄到测试资产定义的值；验证请求携带现有 `modelOptions.toolChoice=NONE`。

- [ ] **Step 3: 验证 GREEN**

Run: `npx vitest run --config vitest.config.architecture.ts tests/architecture/system-event-real-runtime-fixture-isolation.test.ts`

Expected: PASS，fixture 返回合法失败结果，产品默认装配和后端 canonical vocabulary 均未引用测试身份。

### Task 3: 先测试公共 API/SSE/history 辅助函数

**Files:**
- Create: `tests/architecture/system-event-real-runtime-support.test.ts`
- Create: `tests/manual/system-event-real-runtime/verify-support.mjs`

- [ ] **Step 1: 编写失败测试**

用内存 `Response` 覆盖：

```ts
expect(parseSseFrames('event: DEGRADATION_NOTICE\ndata: {"eventType":"DEGRADATION_NOTICE"}\n\n')).toEqual([
  { event: 'DEGRADATION_NOTICE', data: { eventType: 'DEGRADATION_NOTICE' } },
]);
expect(selectRunEvents(events, 'run-1').every((event) => event.runId === 'run-1')).toBe(true);
expect(redactEvidence({ code: 'SYSTEM_EVENT_SCENARIO_FAILED', credential: 'secret' })).toEqual({
  code: 'SYSTEM_EVENT_SCENARIO_FAILED',
});
```

同时覆盖分页 history 合并、终态识别、缺少目标事件时报错，以及日志证据不接收 credential/token/key 字段。

- [ ] **Step 2: 验证 RED**

Run: `npx vitest run --config vitest.config.architecture.ts tests/architecture/system-event-real-runtime-support.test.ts`

Expected: FAIL，原因是 `verify-support.mjs` 尚不存在。

- [ ] **Step 3: 实现最小辅助函数**

实现 `requestJson`、`openSse`、`parseSseFrames`、`waitForRunTerminal`、`loadAllRunEvents`、`requireEvent` 和 `safeEvidence`。所有请求只访问传入的 `baseUrl`；不得访问文件系统数据库或 credential 环境变量。

- [ ] **Step 4: 验证 GREEN**

Run: `npx vitest run --config vitest.config.architecture.ts tests/architecture/system-event-real-runtime-support.test.ts`

Expected: PASS。

### Task 4: 实现真实 Runtime 与正式前端 artifact 验证脚本

**Files:**
- Create: `tests/manual/system-event-real-runtime/verify.mjs`
- Create: `tests/manual/system-event-real-runtime/README.md`

- [ ] **Step 1: 实现 degradation 场景**

脚本创建 session、先连接 SSE，再通过 `POST /api/v1/sessions/:sessionId/requests` 提交带 `toolChoice=REQUIRED` 的请求。它必须断言 live 与 `GET /api/v1/sessions/:sessionId/runs/:runId/events` 均包含同一 run 的 `DEGRADATION_NOTICE`，且 code 与 fixture 一致。

- [ ] **Step 2: 实现 context-compaction 场景**

脚本在同一 session 先提交测试资产生成的有界长电信告警文本并等待 terminal，再提交短追问。它必须断言第二个 run 的 live 与 history 均包含 `CONTEXT_COMPACTED`。

- [ ] **Step 3: 实现 UI 检查**

脚本通过 `createRequire(frontend/agent-web/package.json)` 加载 Playwright，打开当前服务的正式 local host artifact。对 degradation 断言固定业务标题/摘要、code 默认不可见、主动展开后可见、完整运行图语义一致；对 context-compaction 断言 live-only 短暂提示出现、过程条目为信息语义，刷新后 durable 条目保留但短暂提示不重播。

- [ ] **Step 4: 写 README**

README 明确：先设置 `NEXTAGENT_APPLICATION_CONFIG` 指向相应 overlay，再用既有 MiniMax launcher 启动；另一个终端运行 `node tests/manual/system-event-real-runtime/verify.mjs --scenario <name> --base-url <url>`。端口、窗口、输入规模、prompt 和错误码只记录在该测试目录。

### Task 5: 真实 MiniMax 验证与 change 收口

**Files:**
- Modify: `openspec/changes/refine-system-event-business-language/tasks.md`

- [ ] **Step 1: 启动并验证 degradation**

先检查目标端口 owner，再设置测试 overlay，通过既有 MiniMax launcher 启动隔离服务。运行 degradation 脚本并保存安全坐标与事件结论，不保存模型输入、输出或 credential。

- [ ] **Step 2: 启动并验证 context-compaction**

停止当前任务自己启动的 degradation 服务后，以 context overlay 启动第二个隔离服务并运行验证脚本。

- [ ] **Step 3: 完成确定性与产品门禁**

Run:

```text
npx vitest run --config vitest.config.architecture.ts tests/architecture/system-event-real-runtime-fixture-isolation.test.ts tests/architecture/system-event-real-runtime-support.test.ts
cd frontend/agent-web && npm run build
cd frontend/agent-web && npm run build:vite:modes
cd frontend/agent-web && npm run test:e2e -- tests/e2e/system-event-business-language.spec.cjs
openspec validate refine-system-event-business-language --strict
openspec validate --all --strict
git diff --check
```

Expected: 目标测试、前端 build/e2e 与目标 change 校验通过；全量 OpenSpec 不新增失败项。

- [ ] **Step 4: 更新 tasks 并提交**

只有在各任务的实际命令和结果均已取得后，才勾选 1.10–1.13 与 2.1。提交信息使用 `test(runtime): add real system event verification`。

## 自审

- Spec coverage：两类 canonical durable event 由真实 Runtime、SSE、history 和正式 UI 覆盖；`HOOK_DEGRADED` 仅由现有 compatibility E2E 与新增负向门禁覆盖。
- Placeholder scan：无 TBD/TODO；每项都有精确文件、命令和预期结果。
- Type consistency：统一使用 public `sessionId`、`requestId`、`runId`、`eventType`、`payload` 与既有 `modelOptions.toolChoice`。
- Scope：不修改 `packages/` 产品代码、Gateway、contract、生产 API、默认 Agent、默认配置或打包逻辑。
