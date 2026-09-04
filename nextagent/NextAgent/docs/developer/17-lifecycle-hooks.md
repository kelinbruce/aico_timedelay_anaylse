# Lifecycle Hook 开发指南

Lifecycle Hook 是 NextAgent 在请求生命周期固定位置提供的治理扩展点。你可以用它做三类事情：

- **观察**：记录审计、指标、trace、诊断采样，或写入带幂等键的外部观察系统。
- **改写**：在允许的 stage 上替换当前 stage 的有效输入或输出字段。
- **控制**：在策略不满足时拒绝、阻断，或在少数可恢复 stage 暂停并等待用户输入。

它不是插件发现系统，也不是脚本运行时。当前版本**不支持** hook 目录、`hook.json`、运行期动态加载、远端 hook、shell/script hook 或热加载。hook 代码必须在启动期由 app/plugin composition 显式装配为 TypeScript `LifecycleHook` 对象，Agent 只在 `agent.yaml.hooks` 中声明是否启用、如何排序、超时和配置。

> **外部（仓库外）开发者的交付路径**：修改 app composition 需要源码仓库权限。外部开发者交付自定义 hook 的**唯一受支持路径是插件**——用 `@nextagent/agent-plugin-sdk` 的 `defineLifecycleHook` 编写，打包成插件 artifact，在 system config 的 `nextAgent.system.plugins[]` 声明加载，再在 `agent.yaml.hooks` 中启用。完整流程见 [Agent Plugin 开发指南](./19-agent-plugins.md) 和 [Lifecycle Hook 细化开发指南](./23-lifecycle-hook-authoring-details.md)。仓库内（app-local）开发者才可直接从 `@nextagent/agent-runtime` 导入并在 composition 层装配。

API 的精确定义以 `@nextagent/agent-contracts/runtime`（类型契约）和 OpenSpec `lifecycle-hook-execution` 为准。`defineLifecycleHook(...)` 校验函数从 `@nextagent/agent-runtime` 导出。本文帮助你快速写出可运行、可维护的 hook。

## 最小可用示例

hook 作者通过 `defineLifecycleHook(...)` 定义一个 TypeScript 对象。下面的例子在最终输出发送给用户前加一个前缀（来自 `tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts`）：

```ts
import { defineLifecycleHook } from "@nextagent/agent-runtime";
import type { HookInput, HookResult } from "@nextagent/agent-contracts/runtime";

export const terminalPrefixHook = defineLifecycleHook({
  hookId: "custom.terminal-prefix",
  kind: "CUSTOM",
  supportedStages: ["BEFORE_AGENT_TERMINAL"] as const,
  effects: ["TRANSFORM"] as const,
  failureMode: "FAIL",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      prefix: { type: "string" }
    }
  },
  configure(config) {
    const prefix = typeof config["prefix"] === "string" ? config["prefix"] : "";
    return {
      execute(input: HookInput<"BEFORE_AGENT_TERMINAL">): HookResult<"BEFORE_AGENT_TERMINAL"> {
        return {
          outcome: "PASS",
          mutation: { finalContent: `${prefix}${input.boundary.finalContent}` }
        };
      }
    };
  },
  execute(input) {
    return {
      outcome: "PASS",
      mutation: { finalContent: input.boundary.finalContent }
    };
  }
});
```

几个关键点：

- `hookId` 是唯一稳定标识，也是 Agent 配置里引用 hook 的名字。
- `supportedStages` 决定 hook 能在哪些生命周期位置运行。
- `effects` 决定 hook 可以做什么，也决定运行时是并行观察还是串行影响型执行。
- `configure(config)` 只在启动期执行，适合把 Agent 级配置变成只读策略快照。运行期 `execute(input)` 不会收到 `config`，只能使用启动期闭包好的配置。
- **导入位置**：`defineLifecycleHook` 从 `@nextagent/agent-runtime` 导入；`HookInput` / `HookResult` / `LifecycleHook` 等类型从 `@nextagent/agent-contracts/runtime` 导入。

## 在 Agent 中启用 Hook

Agent package 作者在 `agent.yaml` 中使用 `hooks` 配置：

```yaml
hooks:
  - hookId: custom.terminal-prefix
    enabled: true
    stages: [BEFORE_AGENT_TERMINAL]
    order:
      priority: 20
    timeoutMs: 1000
    config:
      prefix: "[已治理] "
```

`AgentAssembly.hooks` 是 accepted Agent 的 activation 事实，每项**只能**包含 `hookId`、`enabled?`、`disabled?`、`stages?`、`order?`、`timeoutMs?`、`config?`。

配置规则：

- `CUSTOM` hook 只有当前 Agent 显式启用才生效。
- `SYSTEM` hook 默认对所有 Agent 生效，可以在当前 Agent 中用 `enabled: false` 或 `disabled: true` 关闭。
- `stages` 只能收窄到 hook 自己声明支持的 stage，不能扩大。
- `timeoutMs` 是当前 Agent 对该 hook 的运行时超时（正整数）。
- `config` 会在启动期按 hook 的 `configSchema` 校验，校验失败会阻止 AgentAssembly 发布。
- `SYSTEM` hook 的 `kind`、`effects`、`failureMode` 和系统顺序由框架拥有，Agent 配置**不能**覆盖。
- `CUSTOM` hook 的 `order` 可以用 `priority`、`before`、`after`；裸数字 order、枚举 slot、未知目标、跨 kind 目标、跨 effect group 目标（observe-only hook 指向 impact hook 或反之）、循环依赖和矛盾约束都会启动失败。
- observe-only hook 之间可以声明 `order.before` / `order.after`，但该 order 只用于 diagnostics evidence，**不影响**并行执行顺序。observe-only hook 不能声明指向 impact hook 的 order，反之亦然。
- 每个 lifecycle stage 的 effective hook 总数（enabled SYSTEM + enabled CUSTOM）不得超过框架默认上限 `maxHooksPerStage`（**默认 8**：4 observe-only + 4 impact），超限 assembly compile fail closed，runtime 不截断、不降级。`maxHooksPerStage` 是框架拥有值，**不是** Agent 配置项，无 per-Agent / per-stage override。

## Effects 怎么选

`effects` 是 hook 的权限声明，必须是非空唯一集合，取自 `OBSERVE` / `TRANSFORM` / `CONTROL`。不要多声明不需要的 effect。

| effect | 适合做什么 | 不能做什么 |
|---|---|---|
| `OBSERVE` | 审计、指标、trace、诊断采样、幂等外部通知 | 不能改写 boundary，不能阻断流程，不能创建 pending input |
| `TRANSFORM` | 替换当前 stage 允许的字段 | 不能覆盖 owner scope、agent scope、checkpoint、terminal commit、原始 provider/capability evidence |
| `CONTROL` | 返回 `DENY`、`BLOCK` 或受限 `PEND` | 不能偷偷改写业务对象；控制结果必须交给 runtime 解释 |

只声明 `OBSERVE` 的 hook 会进入**并行观察组**，失败和超时只产生观测降级，不改变请求真相。只要包含 `TRANSFORM` 或 `CONTROL`，hook 就进入**串行影响组**，按稳定顺序执行。

- observe-only hook 之间没有执行顺序保证，`order` 声明只用于 diagnostics evidence。
- observe-only hook 看到的是 stage entry boundary，**看不到** serial impact group 产生的 mutation。
- runtime 启动 observe-only hook（传入 stage entry boundary），执行 serial impact hook，并在 stage 返回前等待 observe hook settle 或超时。

## Outcome 怎么返回

`execute` 返回的 `outcome` 只能使用这些 canonical 值：

| outcome | 含义 |
|---|---|
| `PASS` | hook 已执行，允许继续；若声明了 `TRANSFORM`，可携带合法 mutation |
| `SKIP` | hook 进入了，但判断当前 run 不适用；**不能**携带 mutation 或 pending intent |
| `DENY` | 治理拒绝，例如违反策略；runtime 停止后续 impact hook 与 protected operation |
| `BLOCK` | 保护阻断，例如输出高风险泄漏；runtime 停止后续 impact hook 与 protected operation |
| `PEND` | 挂起并等待用户输入；只允许在三个 before stage 使用 |

合法组合约束：

- mutation 只在 hook 声明 `TRANSFORM` 且返回 `PASS` 时合法。
- `DENY` / `BLOCK` / `PEND` 只在 hook 声明 `CONTROL` 时合法；`TRANSFORM`-only hook 返回控制 outcome 视为非法结果，走 failure mode。
- `CONTROL`-only hook 返回 mutation 视为非法结果，走 failure mode。
- `DENY` / `BLOCK` / `PEND` 与 mutation 同时出现时，runtime **以控制结果为准**，不应用 mutation。

`PEND` 只支持以下三个 stage：

- `BEFORE_MODEL_INVOKE`
- `BEFORE_CAPABILITY_INVOKE`
- `BEFORE_AGENT_TERMINAL`

其它 stage 返回 `PEND` 视为非法结果，走 failure mode，且**不**创建 pending input truth。

## 9 个 Stage

| stage | owner | 触发位置 |
|---|---|---|
| `BEFORE_REQUEST_ACCEPT` | `agent-runtime` | 请求接受前 |
| `BEFORE_PLANNING` | `agent-core` | 每轮规划开始后、context assembly 和模型请求构造前 |
| `BEFORE_MODEL_INVOKE` | `agent-model` | 具体模型请求构造完成后、provider SDK 调用前 |
| `AFTER_MODEL_RESULT` | `agent-model` | provider result 归一化后、返回调用方前 |
| `BEFORE_CAPABILITY_INVOKE` | `agent-core` | tool call 已解析并构造 invocation request 后、checkpoint/start/invoke 前 |
| `AFTER_CAPABILITY_RESULT` | `agent-core` | capability raw result envelope 校验后、结果进入下游消费前 |
| `BEFORE_CONTEXT_COMPACT` | `agent-context-engine` | 真实 compaction 生成 summary 前 |
| `AFTER_CONTEXT_COMPACT` | `agent-context-engine` | summary draft 生成并基础校验后、持久化前 |
| `BEFORE_AGENT_TERMINAL` | `agent-core` | 最终内容形成后、final-content event 发送前 |

stage 由主流程推进到对应 lifecycle stage 时同步触发，**不得**通过后台补采、日志回放、离线任务或独立调度器补建。`agent-runtime` 不会从一个外层 `agent.execute()` wrapper 触发所有 stage；真实触发位置跟随具体 protected operation owner。

不要在 stage owner 之外补触发 hook。比如最终输出防泄漏应放在 `BEFORE_AGENT_TERMINAL`，**不是** `AFTER_MODEL_RESULT`——中间模型输出不一定是最终用户可见内容。

## 各 Stage 可改字段

mutation 只做"同名字段完整替换"。没有列出的字段不能改，**不能**使用 JSON Patch 或表达式 DSL。Unknown mutation fields、owner/agent overrides、runtime state mutation、JSON Patch、expression DSL、cross-stage mutation 都 fail closed。

| stage | 允许替换的字段 |
|---|---|
| `BEFORE_REQUEST_ACCEPT` | 无 mutation 字段 |
| `BEFORE_PLANNING` | `flowVariables`、`capabilityGeneratedMessages`、`capabilityContextPatch`、`maxRounds`、`maxCalls` |
| `BEFORE_MODEL_INVOKE` | `messages`、`tools`、`commonOptions`、`providerOptions`、`timeoutMs` |
| `AFTER_MODEL_RESULT` | `content`、`reasoning`、`toolCalls` |
| `BEFORE_CAPABILITY_INVOKE` | `arguments`、`timeoutMs` |
| `AFTER_CAPABILITY_RESULT` | `structuredPayload`、`generatedMessages`、`contextPatch` |
| `BEFORE_CONTEXT_COMPACT` | `targetBudgetUnits` |
| `AFTER_CONTEXT_COMPACT` | `content` |
| `BEFORE_AGENT_TERMINAL` | `finalContent`、`toolCalls` |

mutation 的 kind 判别字段由 stage 派生（runtime 在 validation 时推导），对应 `@nextagent/agent-contracts/runtime` 的 mutation 接口：

| stage | mutation 类型 | kind |
|---|---|---|
| `BEFORE_PLANNING` | `PlanningMutation` | `planning` |
| `BEFORE_MODEL_INVOKE` | `ModelInvokeMutation` | `model.invoke` |
| `AFTER_MODEL_RESULT` | `ModelResultMutation` | `model.result` |
| `BEFORE_CAPABILITY_INVOKE` | `CapabilityInvokeMutation` | `capability.invoke` |
| `AFTER_CAPABILITY_RESULT` | `CapabilityResultMutation` | `capability.result` |
| `BEFORE_CONTEXT_COMPACT` | `ContextCompactBeforeMutation` | `context.compact.before` |
| `AFTER_CONTEXT_COMPACT` | `ContextCompactAfterMutation` | `context.compact.after` |
| `BEFORE_AGENT_TERMINAL` | `AgentTerminalMutation` | `agent.terminal` |

字段语义说明：

- `BEFORE_PLANNING` 替换 `flowVariables` → 进入本轮 context assembly；替换 `capabilityGeneratedMessages` / `capabilityContextPatch` → 作为当前请求内已累积的能力结果上下文参与本轮模型请求构造；替换 `maxRounds` / `maxCalls` → 只影响后续 agent loop 步数预算，**不**修改已持久化的 request truth。
- `BEFORE_MODEL_INVOKE` 替换 `messages` → 必须返回完整的新 `messages` 列表，runtime 不做局部 patch；替换后字段会重新经过 owner 校验与下游消费路径。
- `BEFORE_AGENT_TERMINAL` 返回非空 `toolCalls` → agent-core **不**发送本次 final-content event，而是通过现有 tool loop 执行这些 tool calls 并继续下一轮 planning/model。hook-provided tool calls 必须通过当前 Agent binding、capability descriptor、routing constraints、subagent guard、capability input schema、`maxCalls` 和剩余 round budget 校验，并继续触发 `BEFORE_CAPABILITY_INVOKE` / `AFTER_CAPABILITY_RESULT`。**非空 `toolCalls` 与 `finalContent` replacement 不得出现在同一 mutation result**。

### BEFORE_MODEL_INVOKE 的敏感数据处理

`BEFORE_MODEL_INVOKE` 的 boundary 会暴露当前 effective `messages` 给 enabled hook code 在内存中读取，其中可能包含完整 prompt、对话历史、系统指令和 context assembly 结果。hook code **必须**把这些内容当作 in-memory sensitive prompt content 处理。`HOOK_INVOKED`、日志、指标、审计、control signal 和 safe diagnostics 仍然**禁止**输出 raw messages / raw prompt。

## SYSTEM 与 CUSTOM

`SYSTEM` hook 是框架内置治理默认项：

- 默认对所有 Agent 生效。
- 总是在同 stage 的 `CUSTOM` hook 之前执行。
- **必须**使用 `failureMode: "FAIL"`。
- **必须**有框架显式定义的系统顺序（`order.priority` 为安全整数）。
- 当前 Agent 可以显式关闭，但关闭是可审计的 Agent 级选择。

`CUSTOM` hook 是业务或客户集成扩展：

- 只有当前 Agent 在 `agent.yaml.hooks` 中启用才生效。
- 可使用 `order.priority`、`order.before`、`order.after` 在 custom 组内排序。
- 适合做客户系统通知、诊断摘要改写、工具参数治理、最终输出格式化等。

> **重要**：必须强制执行且不可绕过的安全边界**不要**只放在可关闭的 lifecycle hook 中，应放在 runtime guard、gateway、sandbox、risk policy 或 app composition boundary。risk policy enforcement **不**作为 lifecycle hook definition / Agent hook binding / hook executor plugin 注册，由其自己的 OpenSpec change 治理。

## 内置示例：system.output-redaction-guard

`system.output-redaction-guard` 是内置系统 hook（实现位于 `packages/agent-runtime/src/lifecycle/system-output-redaction-guard.ts`）：

- `kind: SYSTEM`
- `supportedStages: ["BEFORE_AGENT_TERMINAL"]`
- `effects: ["TRANSFORM", "CONTROL"]`
- `failureMode: "FAIL"`
- `order: { priority: 0 }`、`timeoutMs: 100`
- `configSchema`：`{ redactionToken: string, blockPrivateKeys: boolean }`

行为：

- 在最终内容发送给用户前扫描 `finalContent`。
- 命中私钥（`-----BEGIN ... PRIVATE KEY-----`）且 `blockPrivateKeys !== false` 时返回 `BLOCK`，`safeReason: "OUTPUT_REDACTION_GUARD_HIGH_RISK_SECRET"`，本次 final-content event 不发送。
- 安全脱敏时返回 `AgentTerminalMutation.finalContent`（脱敏后的内容），`safeReason: "OUTPUT_REDACTION_GUARD_REDACTED"`。
- 脱敏 pattern 覆盖：credential-like 文本、Bearer token、`sk-` token、手机号、本地/内部路径。IPv4 和 IPv6 作为业务内容保留原文，不参与该 hook 的默认脱敏。
- 默认 redaction token 为 `REDACTED`，可通过 config 的 `redactionToken` 自定义。

Agent 可通过 config 增加额外 pattern 或调整 block policy。config 只能表达策略数据，**不能**是脚本、表达式 DSL、远程策略 URL、owner/agent scope override、hook outcome 或 mutation payload。

> 该 hook **必须**运行在 `BEFORE_AGENT_TERMINAL`，**不能**作为 `AFTER_MODEL_RESULT` 替代，**不能** log raw findings 或 raw final content。

## 安全和观测要求

hook 能读取自己 stage 的 boundary，但观测输出必须安全。每次 hook invocation **必须**形成一条 timeline-only `HOOK_INVOKED` event，至少可追溯：`requestRunId`、`sessionId`、`requestId`、`hookId`、`agentId`、`agentVersion`、`stage`、hook kind、hook effects、execution strategy、invocation `status`、时间信息、`outcome`、`safeReason` 或 `error`、`mutationSummary`、ignored observe control diagnostic（适用时）。

安全约束：

- `HOOK_INVOKED`、日志、指标、审计、control signal 和 safe diagnostic **不得**输出 raw prompt、模型消息、模型输出、最终内容、工具参数、工具结果、附件内容、credential、token、手机号、客户标识、路径、完整 boundary 或完整 mutation。
- hook input **不**混入：`RequestRun` 全对象、通用 `requestContextId` 引用泄漏、`tenantId`/`subjectId` 裸字段、未经当前 stage 定义的 payload、raw prompt / raw model output / tool args/result / 附件正文 / secret / credential。
- `mutationSummary` 只在 runtime 实际应用 mutation 时产生；observe-only hook 返回的被忽略 mutation **不**产生 `mutationSummary`，只记 diagnostic code。`mutationSummary` 只能包含 stage-derived mutation kind 与被替换字段名、类型、数量、大小或 digest，**不含**字段值。
- observe 外部副作用必须有界、幂等，**不允许**把副作用结果读回当前流程来改变 protected operation。
- runtime 为每次 observe-only invocation 提供稳定 idempotency key（格式 `stageOccurrenceKey + ":" + hookId`），同一 stage occurrence 恢复重试时 key 不变，新 occurrence key 不同。
- boundary 是只读 contract。hook **不能**通过原地修改对象引用改变 owner 内部状态。
- `HOOK_INVOKED` 是 canonical timeline event，但 **timeline-only**，**不**默认投影为用户可见 stream event。`PEND` 由 `USER_INPUT_REQUIRED` event 携带 `pendingInputId` 关联；`DENY`/`BLOCK` 不新增单独 event，消费者按 `outcome` 字段过滤识别。
- runtime **不**暴露单独的 `HookInvocationEvent` contract、listener mechanism 或首版 hook invocation query API。

## Recovery 语义

请求从可恢复边界恢复时，runtime 从保存的 recoverable lifecycle coordinate 重新接入：

- 恢复坐标之前已完成的 stage **不**回放。
- 恢复落点的 protected operation 尚未完成时，该 stage 的 enabled hooks 使用 **frozen hook snapshot**（启动期冻结的 hook registration / definition / AgentAssembly activation snapshot）重新执行。
- `TRANSFORM` / `CONTROL` hook result 从恢复后的 stage boundary 重新计算，runtime **不**缓存或重放之前返回的 mutation/control output。
- runtime **不**为 impact hook result 提供 observe side-effect idempotency key。如果 hook 依赖外部读取（配置、策略、客户系统状态），必须自行通过 frozen config、版本化引用、hook-managed cache 或确定性/幂等读取保证恢复重执行一致性。
- pending input 被正式回答后，runtime 依据挂起前保存的 checkpoint 与 `nextLifecycleStage` 从最近可恢复 lifecycle stage 恢复，**不**从请求起点重新接受或重放已完成的前序 stage，且**沿用同一 `requestRunId` 与 request identity**（不因 pending-input resume 创建新 run 或递增 attempt）。

## Hook 失败处理

当 impact hook 超时、抛错、不可用或返回非法结果时，runtime 只按 `failureMode` 处理 hook 自身失败：

- `CONTINUE`：记录失败观测事实（如 `TIMEOUT` / `FAILED`）后继续主流程。
- `FAIL`：记录失败观测事实后终止主流程并进入失败路径。

约束：

- `SYSTEM` hooks **必须**用 `FAIL`。
- observe-only hook failures 和 timeouts 只产生 observation degradation，**不**用 failure mode 改变 request truth。
- runtime **不**静默吞掉 hook 失败，也**不**无限等待 hook 完成。
- 系统不产生"既未继续、也未失败、也未挂起"的不一致状态；hook 返回 `PEND` 但 pending input 无法创建时，显式暴露失败/降级结果，**不**伪装成已成功挂起。

## 常见错误

- 在 `agent.yaml` 中引用未注册的 `hookId`：启动失败。
- `config` 不符合 `configSchema`：启动失败（assembly compile fail closed）。
- `CUSTOM` hook 没有在当前 Agent 启用：不会执行。
- `SYSTEM` hook 试图在 Agent 配置中覆盖 `order` / `kind` / `effects` / `failureMode`：启动失败。
- `OBSERVE` hook 返回 mutation / `DENY` / `BLOCK` / `PEND`：结果被忽略并记录诊断，主流程继续。
- `TRANSFORM`-only hook 返回控制 outcome：视为非法结果，走 failure mode。
- `CONTROL`-only hook 返回 mutation：视为非法结果，走 failure mode。
- 在不支持 `PEND` 的 stage 返回 `PEND`：按非法结果处理，**不**创建 pending input。
- 返回未知 mutation 字段：按非法结果处理。
- 单 stage effective hook 数超过 `maxHooksPerStage`（默认 8）：assembly compile fail closed，runtime 不截断、不降级。
- `order` 跨 kind / 跨 effect group / 指向未知目标 / 循环 / 矛盾：启动失败。
- 依赖 hook 目录、`hook.json`、运行期动态 import、shell/script hook、远端 hook、热加载：当前版本**不支持**。

## 相关资源

- spec：`openspec/specs/lifecycle-hook-execution/spec.md`
- 实现：`packages/agent-runtime/src/lifecycle/`（`lifecycle-hook-validation.ts`、`system-output-redaction-guard.ts`、`lifecycle-hook-startup.ts`）
- 契约类型：`packages/agent-contracts/src/runtime/index.ts`（`LifecycleHook`、`HookInput`、`HookResult`、`BoundaryMutation` 及各 stage mutation 接口、`runtimeLifecycleStages`）
- 测试：`tests/agent-kernel/lifecycle-hook-*.test.ts`、`tests/contract/core-contracts.test.ts`
- [能力扩展](./05-capability-extension.md)
- [测试与调试](./11-testing-debugging.md) — Hook 测试方法
- [最佳实践](./15-best-practices.md) — Hook 设计反模式
