## 背景与问题（Why）

NextAgent 的上下文窗口在运行期持续演化：每个用户回合由 context-engine 组装完整 messages 投递给模型（`BEFORE_MODEL_INVOKE`），当累积上下文超出预算时由 `summary-compression-orchestrator` 把前缀压缩成 SUMMARY 消息（`BEFORE_CONTEXT_COMPACT` / `AFTER_CONTEXT_COMPACT`）。当前可观测层出于安全投影只输出低基数元数据（`messageCount` / `toolCount` / token / duration），既有的 `developer-hook-trace` 插件虽能原样落盘 boundary，但不覆盖压缩 stage，也没有按 session 保留上下文演化的能力。

调试与回放「上下文变化流程」时缺少一个低侵入、可开关的记录手段：既看不到压缩前后 messages 的真实变更，也无法稳定拿到一个 session 最终投递给模型的完整 messages 与答案。需要一个 observe-only 的生命周期 hook 插件，按 session 记录压缩前后变更与最后一轮的 messages + 答案，且默认不激活、通过配置注册后才启用。

## 变更范围（What Changes）

- `agent-plugin-sdk` 新增 `context-monitor` 插件定义（plugin id `context-monitor`，hook id `context-monitor.context-evolution`），observe-only、`failureMode: CONTINUE`，支持 stage：`BEFORE_MODEL_INVOKE`、`AFTER_MODEL_RESULT`、`AFTER_CONTEXT_COMPACT`、`BEFORE_CONTEXT_COMPACT`、`BEFORE_AGENT_TERMINAL`。
- 插件按 `sessionId` 在内存维护「最新 messages」与「最新答案」，落盘策略：
  - 压缩发生：写一个 `compact-{sessionId}-{序号}.json`，含压缩前 messages（压缩时内存中的最新 `BEFORE_MODEL_INVOKE` 快照）、压缩后 messages（压缩后下一次 `BEFORE_MODEL_INVOKE` 的 messages）、summary 文本（`AFTER_CONTEXT_COMPACT.boundary.content`）。
  - 每个 run 终态（`BEFORE_AGENT_TERMINAL`）：覆盖写 `last-{sessionId}.json`，含最新 messages + 最新答案。
  - 平时每轮不落盘，只在内存覆盖更新。文件总数 = 1 + 压缩次数。
- 提供 caller-owned sink 与 file sink helper，含路径穿越防护（沿用 `developer-hook-trace` 的 `logFile` 必须落在 `logDirectory` 之下的约束）。
- 提供 `createContextMonitorPluginArtifact` 生成 `plugin.json` + 单文件 ESM `index.js`，可被现有 plugin loader 加载，不改 app/runtime/config schema。
- 本地运行时打包纳入产物到 `config/plugins/context-monitor/`，但 sample config 与默认 Agent **不**声明 `nextAgent.system.plugins[]`、**不**激活 hook——默认不开启，用户显式配置 + 重启后每个 session 自动记录。
- 不修改 `agent-core` / `agent-model` / `agent-context-engine` / `agent-contracts` 任何源码与 boundary 契约。

## Capability 影响（Capabilities）

### 新增 Capability
- `context-monitor-logging`: SDK 提供 observe-only 的 context-monitor 插件，按 session 记录压缩前后 messages 变更与最后一轮 messages + 答案，caller-owned sink、loader-compatible artifact、packaging-without-default-activation。

### 修改的 Capability
- 无。不改变现有 boundary 契约或运行时行为；复用 `ModelInvokeBoundary.messages`、`ModelResultBoundary`、`ContextCompactAfterBoundary.content`、`ContextCompactBeforeBoundary` 与 `AgentTerminalBoundary` 的现有字段。

## 影响范围（Impact）

- `packages/agent-plugin-sdk/src/context-monitor.ts`（新增）、`packages/agent-plugin-sdk/src/index.ts`（re-export）、`packages/agent-plugin-sdk/tests/context-monitor.test.ts`（新增）。
- `packages/agent-plugin-sdk/package.json`：新增 `./context-monitor` subpath export。
- 本地运行时打包脚本：纳入 `config/plugins/context-monitor/` 产物（`plugin.json` + `index.js`），不修改 `default-system.yaml` 的 `plugins[]`。
- 复用的现有契约：`ModelInvokeBoundary.messages`（`agent-contracts/src/runtime/index.ts:606`）、`ModelResultBoundary`（`:626`）、`ContextCompactAfterBoundary.content`（`:688`）、`ContextCompactBeforeBoundary`（`:677`，仅用于标记压缩点与计数）、`AgentTerminalBoundary`（`:698`）。
- 复用的现有加载路径：`plugin-loader.ts`、`create-app.ts` 的 `pluginSystem.plugins` → `buildStartupLifecycleHookRegistry` → `createLifecycleHookModelInvocationService`，以及 context-engine 的 `lifecycleHook` 注入。
- 验证：插件单测（stage 分发、压缩前后落盘、last 覆盖写、路径穿越防护、observe-only 不影响主流程）、artifact 生成与 loader 加载测试。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/context-monitor-logging/spec.md`：新增，归并 context-monitor 插件的 hook 形态、按 session 落盘策略（compact / last 文件语义、文件总数 = 1 + 压缩次数）、observe-only 与 `failureMode: CONTINUE`、caller-owned sink、artifact 形态、packaging-without-default-activation 行为契约。

长期背景：
- `openspec/overview.md`：补充 context-monitor 作为 SDK 提供的调试用上下文演化记录插件的长期背景条目。

设计视图：
- `openspec/designs/modules/agent-plugin-sdk.md`：修改，补充 `context-monitor` subpath 的设计落点（与 `developer-hook-trace` 并列的 observe-only 调试插件）。
- `openspec/designs/spec-to-design-map.md`：归档时补充 `context-monitor-logging` 的导航条目。

验证入口：
- `packages/agent-plugin-sdk/tests/context-monitor.test.ts`
- 本地运行时打包与 loader 加载相关测试。
