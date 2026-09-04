# 测试与调试

这一篇讲怎么测 Tool / Skill / Lifecycle Hook / Context，以及怎么调试 Agent 的执行过程。后端测试用 Vitest，前端 E2E 用 Playwright，命令都走 npm scripts。

## 测试框架

NextAgent 使用以下测试基础设施，全部位于仓库根的 `tests/` 与各 package 的 `tests/` 目录：

| 层级 | 框架 | 位置 |
|------|------|------|
| 单元测试 | Vitest 4 | `packages/*/tests/**/*.test.ts` |
| 契约测试 | Vitest 4 | `tests/contract/**/*.test.ts` |
| 架构边界测试 | Vitest 4 + dependency-cruiser | `tests/architecture/**/*.test.ts` |
| Agent Kernel 测试 | Vitest 4 | `tests/agent-kernel/**/*.test.ts` |
| 冒烟测试 | Vitest 4 | `tests/smoke/**/*.test.ts` |
| E2E 门禁 | Vitest 4（release 配置） | `tests/e2e/**`（alpha-kernel-gate、security、resilience、release-package、product-journey、p1-p2-scenario-gate） |
| 二进制包黑盒 | Vitest 4 + Playwright | `tests/TESTClaw/`（独立工程） |

配置文件：

- `vitest.config.ts` — 默认配置，include `packages/*/tests/**/*.test.ts`（排除 8 个 package 的 tests 目录与 `*.contract.test.ts`）、`tests/capability-source-configuration/**`、`tests/smoke/**`；exclude `tests/TESTClaw/architecture/agent-kernel/contract/e2e`；`testTimeout: 15_000`。
- `vitest.config.release.ts` — 发布门禁配置，include `packages/*/tests/**/*.test.ts` 与 `tests/**/*.test.ts`，exclude `*.contract.test.ts`、`TESTClaw/architecture/capability-source-configuration/contract` 及 `tests/smoke/daily-happy-path.test.ts`，`setupFiles: ./tests/setup.ts`，用于 E2E gate。
- `vitest.config.contract.ts` — 契约测试配置，include `tests/contract/**/*.test.ts` 与 `packages/*/tests/**/*.contract.test.ts`，由 `npm run test:contract` 调用。
- `vitest.config.architecture.ts` — 架构 vitest 测试配置，include `tests/architecture/**/*.test.ts`，由 `npm run lint:architecture` 调用。
- `dependency-cruiser.config.cjs` — 架构边界规则，由 `lint:architecture` 调用。

测试工具包 `@nextagent/agent-test-kit`（`packages/agent-test-kit/src/index.ts`）提供 `createIdentityFixture()`、`createSafeErrorFixture()`、`createAgentErrorFixture()`、`createStreamEnvelopeFixture()`、`classifyArchitectureImport()` 等通用 fixture。

## 运行测试

> **适用范围**：本节命令假设你在源码仓库根目录（拥有完整 npm workspaces 与 `tests/` 目录）。**使用运行包交付的外部部署方/二开者无法运行这些命令**，你的验证路径是：解包目录下 `node bin/nextagent-self-check`（配置校验）→ `node bin/nextagent-start` 启动 → `GET /api/v1/health/deep` 健康检查 → 用 curl 跑一轮 sessions → requests → stream 主链路（见[快速上手](./01-quickstart.md)）。插件开发者可用 `@nextagent/agent-test-kit` 的 `createPluginTestHarness` 在自己的项目里做单测（见 [Agent Plugin 开发指南](./19-agent-plugins.md)）。

所有命令定义在根 `package.json` 的 `scripts` 中：

```bash
# 全部后端测试（默认 vitest 配置，--maxWorkers=8）
npm test

# 仅契约测试
npm run test:contract

# 发布级测试：build + npm test + test:contract + release 配置 vitest(--maxWorkers=2) + lint
npm run test:release

# 指定模块测试（vitest 路径过滤，匹配 packages/<pkg>/tests/）
npx vitest run packages/agent-runtime
npx vitest run packages/agent-core

# 指定单个测试文件
npx vitest run tests/contract/core-contracts.test.ts

# Watch 模式（开发期）
npx vitest packages/agent-capability
```

E2E 门禁脚本（每个对应一个 `scripts/run-*-gate.mjs`）：

```bash
# Alpha Kernel Gate（最小内核主链路）
npm run test:e2e:alpha-kernel

# P1/P2 Scenario Gate（conversation share、human pending、memory、workflow routing、child agent routing 等）
npm run test:e2e:p1-p2-scenario-gate

# Release Package Gate（本地运行包组装与启动）
npm run test:e2e:release-package

# Product Journey Gate（端到端业务旅程）
npm run test:e2e:product-journey

# 全量发布 E2E：product-journey + security/resilience release 配置 + p1-p2-scenario-gate + release-package
npm run test:e2e:release
```

前端测试（`frontend/agent-web/` 独立工程）：

```bash
cd frontend/agent-web
npm run build             # TypeScript --noEmit
npm test                  # Vitest
npm run build:vite:modes  # 多 target Vite 构建校验
npm run test:e2e          # Playwright smoke
```

完整的前端安装、Mock、构建、targeted test 和故障定位说明见[前端开发指南](../frontend/development.md)。

TESTClaw 黑盒测试（针对已打包的二进制包，详见 `tests/TESTClaw/README.md`）：

```bash
# 打包 TESTClaw 测试用二进制包
npm run pack:testclaw
# 进入 tests/TESTClaw 安装依赖后运行 .\scripts\run-tests.ps1 -All
```

## Tool 测试

Tool 实现位于 `packages/agent-capability`，测试位于 `packages/agent-capability/tests/`。Tool 通过统一 capability 框架注册与调用，测试时直接构造 invocation 请求并断言 `CapabilityInvocationResult`。

测试要点：

- 准备 Tool 实现并注册到 capability catalog。
- 构造 `CapabilityInvocationRequest`（含 `invocationId`、`capabilityId`、`arguments`、`MessageId`、`runId` 等）。
- 调用 executor 并断言 `status`（`SUCCESS` / `FAILED`）、`structuredPayload`、`errorCode`。
- 异常路径：让 Tool 抛错，断言结果为 `FAILED` 且 `errorCode` 为规范化错误码（如 `TOOL_EXECUTION_FAILED`）。
- 事件发射：断言 timeline 上出现 `CAPABILITY_STARTED` → `CAPABILITY_RESULT_DELTA` → `CAPABILITY_COMPLETED`。

参考真实测试：`packages/agent-capability/tests/`（如 `skill-manifest.test.ts`、capability source 相关测试）。

## Skill 测试

Skill 由 `SKILL.md`（front-matter + 正文）声明，由 builtin / local / skillhub / agent-owned source 加载。测试位于 `packages/agent-capability/tests/` 与 `tests/architecture/`（边界测试）。

测试要点：

- Skill 加载：验证 front-matter 解析（`name`、`description`、`when_to_use`、`allowed-tools`、`version`）。
- Skill 执行：通过 Skill tool 调用，断言 `CapabilityInvocationResult.structuredPayload`。
- 进度事件：断言 `CAPABILITY_RESULT_DELTA` 被发射。
- 边界测试：`tests/architecture/builtin-skill-source-packaging.test.ts`、`local-skill-source-boundary.test.ts`、`skillhub-source-boundary.test.ts` 验证 source 加载边界与打包约束。

## Hook 测试

Lifecycle Hook 通过 `defineLifecycleHook(...)` 定义（从 `@nextagent/agent-runtime` 导入），在启动期由 app composition 装配（`createNextAgentTestApp({ lifecycleHooks: [...] })`），并冻结为 snapshot。Agent 通过 `agent.yaml.hooks` 声明启用、stage 收窄、排序、超时和配置。

最小示例（来自 `tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts`）：

```ts
import { defineLifecycleHook } from "@nextagent/agent-runtime";
import type { HookInput, HookResult } from "@nextagent/agent-contracts/runtime";

const terminalHook = defineLifecycleHook({
  hookId: "custom.terminal-prefix",
  kind: "CUSTOM",
  supportedStages: ["BEFORE_AGENT_TERMINAL"] as const,
  effects: ["TRANSFORM"] as const,
  failureMode: "FAIL",
  configSchema: { type: "object", additionalProperties: false, properties: { prefix: { type: "string" } } },
  configure(config) {
    const prefix = typeof config["prefix"] === "string" ? config["prefix"] : "";
    return {
      execute(input) {
        return { outcome: "PASS", mutation: { finalContent: `${prefix}${input.boundary.finalContent}` } };
      }
    };
  },
  execute(input) {
    return { outcome: "PASS", mutation: { finalContent: input.boundary.finalContent } };
  }
});
```

测试要点：

- stage 在正确 owner 位置触发；mutation 进入后续 protected operation。
- `DENY` / `BLOCK` 阻止后续流程；`PEND` 只在 `BEFORE_MODEL_INVOKE` / `BEFORE_CAPABILITY_INVOKE` / `BEFORE_AGENT_TERMINAL` 三个 stage 创建 pending input。
- `HOOK_INVOKED` timeline event 只输出安全摘要（`mutationSummary` 仅含字段名/类型/数量/大小，不含字段值）。
- observe-only hook 返回 mutation/control 被忽略并记诊断码。
- 启动期 schema 校验失败会阻止 AgentAssembly 发布。

完整 stage、可改字段、Outcome 语义见 [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md)。契约校验测试见 `tests/contract/core-contracts.test.ts`。

## Context Engine 测试

`agent-context-engine` 负责 context assembly、prompt template selection、window selection 与 compaction。测试位于 `packages/agent-context-engine/tests/` 与 `tests/architecture/context-assembly-contracts.test.ts`。

测试要点：

- 构造 `ContextAssemblyRequest`（`sessionId`、`rootMessageId`、`requestContextId`、`runId`、`stepId`、`language`、`purpose`）。
- 断言 `RenderedModelInput.messages`：首条为 system（prompt template），后续为历史对话与附件引用。
- 验证 purpose-aware template 选择（`prompt-template-assembly` spec）。
- 验证 compaction 输入预算（`BEFORE_CONTEXT_COMPACT` 的 `targetBudgetUnits`）。

## 调试工具

### 1. 日志查看

NextAgent 使用 Pino 结构化日志，日志文件写入 `paths.logDirectory`（默认 `logs/`）：

- `logs/nextagent-operational.log.<sequence>.jsonl` — runtime diagnostic 与 observation-derived trajectory 共用的 operational log family，通过 `surface` 区分
- `logs/nextagent-metrics.<date>.<sequence>.ndjson` 与 `logs/nextagent-audit.<date>.<sequence>.ndjson` — 各自独立的 metrics / audit 输出，不属于 operational log

每条 operational 日志携带稳定 `event`、文本 `level`、`surface`、`component`、`serviceVersion` 及适用的 `sessionId` / `requestId` / `runId`。日志始终执行安全脱敏；`observability.logging.diagnosticDetail=debug` 只增加已批准的低风险诊断字段，不输出 raw prompt、模型输出、credential 等高敏内容。

```bash
# 按关键字过滤（traceId / runId / 事件类型）
grep -E '"event":"request\.(accepted|completed|failed)"' logs/nextagent-operational.log.*.jsonl
grep -E '"event":"capability\.(started|completed|failed)"' logs/nextagent-operational.log.*.jsonl
grep -E '"event":"hook\.' logs/nextagent-operational.log.*.jsonl
grep -E '"level":"(error|warn)"' logs/nextagent-operational.log.*.jsonl
```

### 2. ExecutionTrace 诊断

每个 accepted run 固化 `agentId` / `agentVersion` / `agentAssemblyRef`，并在 timeline 上记录：

- 模型调用记录（调用次数、延迟、token 用量）
- 能力调用记录（capabilityId、参数摘要、结果摘要、耗时）
- Hook 执行记录（hookId、stage、outcome、mutationSummary）
- 决策点记录（直接回答 vs 调用工具）

通过 timeline 投影消费这些事实，不要从 raw prompt 或模型输出反推。

### 3. SessionMessage 检查

```bash
# 查看会话历史（已过滤 visible=false）
curl http://127.0.0.1:3000/api/v1/sessions/{sessionId}/conversation

# visible=false 表示被重试/编辑替换的隐藏消息
# 客户端应使用此 API 而非自行重建历史
```

### 4. SSE 事件监控

```bash
# 实时监控流式事件（默认端口 3000）
curl -N http://127.0.0.1:3000/api/v1/sessions/{sessionId}/stream \
  | grep "^data:" | cut -d: -f2- | python -m json.tool
```

> SSE 只保证实时传输，`LLM_CONTENT_DELTA` / `CAPABILITY_RESULT_DELTA` 不持久化。历史完整内容通过 `conversation` API 获取（`role=ASSISTANT` / `role=CAPABILITY_RESULT`）。

## 调试流程建议

### 问题：Skill 没有被模型调用

1. 检查 `agent.yaml` 的 `capabilityBindings` 是否包含该 Skill。
2. 检查 Skill 是否被正确加载（source：builtin / local / skillhub / agent-owned）。
3. 检查 `SKILL.md` 的 `description` 与 `when_to_use` 是否足够清晰。
4. 查看 Context Engine 日志，确认 Skill descriptor 是否进入本轮模型请求的 `tools`。
5. 检查 routing constraint 与 capability catalog 搜索结果。

### 问题：Tool 执行返回异常

1. 编写单元测试隔离 Tool 实现（`packages/agent-capability/tests/`）。
2. 检查 `inputSchema` 与模型期望是否一致。
3. 检查 sandbox deny-by-default 策略是否拦截了该执行。
4. 查看 `CAPABILITY_COMPLETED` 事件中的 `errorCode`。

### 问题：Hook 未生效

1. 检查 hook 是否在启动期通过 app composition 装配（非目录扫描）。
2. 检查 `agent.yaml.hooks` 中 `enabled: true` 且 stage 收窄正确。
3. 检查 `CUSTOM` hook 的 `order` 是否合法（不跨 kind / 跨 effect group）。
4. 查看 `HOOK_INVOKED` 事件中的 `status` 与 `outcome`。

## 代码位置

| 组件 | 路径 |
|------|------|
| Tool / Skill 测试 | `packages/agent-capability/tests/` |
| Hook 定义与验证 | `packages/agent-runtime/src/lifecycle/` |
| Hook kernel 测试 | `tests/agent-kernel/lifecycle-hook-*.test.ts` |
| Context Engine 测试 | `packages/agent-context-engine/tests/` |
| 架构边界测试 | `tests/architecture/` |
| 契约测试 | `tests/contract/` |
| E2E 门禁脚本 | `scripts/run-*-gate.mjs` |
| 测试工具包 | `packages/agent-test-kit/src/index.ts` |
| 黑盒包测试框架 | `tests/TESTClaw/`（独立工程） |

## 相关资源

- [Skill 与 Tool 开发](./04-skill-tool-development.md) — 实现指南
- [能力扩展](./05-capability-extension.md) — Hook 测试
- [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md) — stage、Outcome、mutation
- [常见问题排查](./14-troubleshooting-faq.md) — 排错
- 测试架构设计：`openspec/designs/architecture/testing.md`
- 测试相关 specs：`openspec/specs/ts-architecture-test-gate/`、`ts-contract-test-gate/`、`ts-e2e-alpha-kernel-gate/`、`ts-e2e-product-journey-gate/`、`ts-e2e-security-gate/`、`ts-e2e-resilience-gate/`、`ts-e2e-release-package-gate/`、`ts-e2e-p1-p2-scenario-gate/`、`testclaw-test-framework/`
