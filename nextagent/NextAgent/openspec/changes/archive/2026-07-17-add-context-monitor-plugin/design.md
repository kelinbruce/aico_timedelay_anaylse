## 背景和现状

NextAgent 已具备配置驱动的生命周期 hook 插件体系：`agent-app` 启动时 `loadPluginRegistrySnapshotSync` 读取 `systemConfig.pluginSystem.plugins`，把每个插件的 `hooks` 并入 `buildStartupLifecycleHookRegistry`；模型调用经 `createLifecycleHookModelInvocationService`（`agent-model/src/invocation/lifecycle-hook-wrapper.ts`）包裹，压缩经 `summary-compression-orchestrator` 的 `lifecycleHook.invoke` 调用。各 stage 的 boundary 已定义于 `agent-contracts/src/runtime/index.ts`：

- `ModelInvokeBoundary`（`:606`）已携带完整 `messages`（`lifecycle-hook-wrapper.ts:49` 原样 `Object.freeze([...request.messages])`）。
- `ModelResultBoundary`（`:626`）携带 `content` / `reasoning` / `toolCalls`。
- `ContextCompactAfterBoundary`（`:688`）携带 summary `content`；`ContextCompactBeforeBoundary`（`:677`）仅携带 `contextItemCount` / `targetBudgetUnits`，**不含 messages**。
- `AgentTerminalBoundary`（`:698`）在 run 终态前触发（`default-agent.ts:339`）。

`agent-plugin-sdk` 已有同形态的 observe-only 调试插件 `developer-hook-trace`（`src/developer-hook-trace.ts`）：caller-owned sink、NDJSON formatter、file sink 路径穿越防护、`createDeveloperHookTracePluginArtifact` 生成 `plugin.json` + 单文件 ESM `index.js`、打包纳入产物但默认不激活。本 change 复用这一成熟范式。

约束：不改 `agent-core` / `agent-model` / `agent-context-engine` / `agent-contracts` 源码与 boundary 契约；插件须 observe-only、`failureMode: CONTINUE`；默认不激活。

## 目标和非目标

目标：
- 提供 `context-monitor` 插件，按 session 记录上下文演化：压缩前后 messages 变更 + 最后一轮 messages + 答案。
- 默认不开启，配置注册 + 重启后每个 session 自动记录。
- 零侵入：不修改任何 core 包源码与 boundary 契约。

非目标：
- 不做实时推送 / web 可视化（落盘文件即可）。
- 不记录每轮 messages（最后一轮已覆盖全部历史）。
- 不改变压缩决策或任何运行时行为。
- 不扩展 `ContextCompactBeforeBoundary` 契约以携带 messages。

## 设计决策

### 决策 1：以 observe-only lifecycle hook 插件实现，而非改契约或包 port

采用：在 `agent-plugin-sdk` 新增 `context-monitor` 插件，订阅 `BEFORE_MODEL_INVOKE` / `AFTER_MODEL_RESULT` / `AFTER_CONTEXT_COMPACT` / `BEFORE_CONTEXT_COMPACT` / `BEFORE_AGENT_TERMINAL`，复用现有 boundary 字段。

放弃的备选：
- 扩展 `ContextCompactBeforeBoundary` 携带 covered/retained messages：侵入 `agent-contracts` + orchestrator，破坏安全投影边界，且 messages 内容仍需从快照取，收益不抵成本。
- 在 composition 层包裹 `ContextEnginePort.assemble`：压缩发生在 assemble 内部，port wrapper 只能看到 assemble 入参出参，拿不到压缩前的中间 messages 列表，无法满足「压缩前」诉求。

### 决策 2：压缩前/后快照的捕获时机

压缩发生在 assemble 阶段，先于当回合 `BEFORE_MODEL_INVOKE`。时序为：

```
上一回合: BEFORE_MODEL_INVOKE(mem.latest = H_prev) → … → BEFORE_AGENT_TERMINAL(写 last)
本回合:   assemble → BEFORE_CONTEXT_COMPACT → AFTER_CONTEXT_COMPACT(summary)
        → BEFORE_MODEL_INVOKE(mem.latest 仍 = H_prev)  ← 压缩后 messages 在此可得
```

- 压缩前 messages = `AFTER_CONTEXT_COMPACT` 时刻的内存最新快照（= 上一回合 `BEFORE_MODEL_INVOKE` 的 `H_prev`）。
- 压缩后 messages = 压缩后下一次 `BEFORE_MODEL_INVOKE.boundary.messages`。
- summary 文本 = `AFTER_CONTEXT_COMPACT.boundary.content`。

实现：`AFTER_CONTEXT_COMPACT` 时把 `{pre: deepCopy(mem.latest), summary}` 压入 session 的 pending 队列；下一次 `BEFORE_MODEL_INVOKE` 消费队首，写 `compact-{sessionId}-{序号}.json`（含 pre/post/summary），再更新 `mem.latest`。用队列而非单标志，以容纳同一 assemble 内可能的多次压缩。

语义说明：压缩前快照 `H_prev` 不含本回合新用户消息 U 与 planning 注入消息 P。这是可接受的——U/P 属于「新输入」而非「被压缩内容」，且 U/P 落在压缩后 retained tail 中，pre/post diff 不会将其误判为 dropped；dropped = pre ∖ post 恰好是被压缩丢弃的前缀，summary = post 中新增的 role=SUMMARY 条目。

### 决策 3：平时不落盘，只在内存覆盖；按事件分文件

内存按 `sessionId` 维护 `{ latestMessages, latestAnswer, pendingCompactions[], compactSeq }`。`BEFORE_MODEL_INVOKE` 覆盖 `latestMessages`，`AFTER_MODEL_RESULT` 覆盖 `latestAnswer`，均不落盘。落盘仅两类事件：压缩（写 compact 文件）、终态（覆盖写 last 文件）。文件总数 = 1 + 压缩次数。

`BEFORE_AGENT_TERMINAL` 每 run 触发一次（追问 = 新 run，再触发一次），覆盖写 `last-{sessionId}.json`，磁盘始终只剩最新回合的 messages + 答案——符合「最后一次请求覆盖前面全部」。

### 决策 4：配置门控而非运行时控制文件

采用：默认 `default-system.yaml` 不声明 `nextAgent.system.plugins[]`，插件不加载；用户加一行 + 重启即启用。

放弃的备选：控制文件（`touch` 切换）动态开关——用户明确偏好配置门控 + 重启，更简单、无运行时 IO 探测开销。

### 决策 5：artifact 为自包含单文件 ESM bundle

沿用 `developer-hook-trace` 的 `developerHookTracePluginBundle` 模式：生成的 `index.js` 内联全部逻辑，通过 `process.getBuiltinModule("node:fs")` 访问 fs，`hostExternals: []`，符合 `plugin-loader.ts` 的 `artifactType: "esm-bundle"` 校验，无需新增 host external 或 build 步骤。

## 质量属性设计

- **安全**：observe-only、不返回 mutation、`failureMode: CONTINUE`；sink 抛错被 catch 后仍返回 PASS；file sink 复用 `assertLogFileStaysUnderDirectory` 路径穿越防护。落盘内容为完整上下文原文（含潜在 PII），由 operator 控制的 `logDirectory` 承载，默认不激活—— operator 须自行保证日志目录的访问控制。验证入口：`tests/context-monitor.test.ts` 的 sink 失败与路径穿越场景。
- **性能/容量**：内存状态每 session 一份、覆盖写、有界；磁盘写仅在压缩与终态发生，非每轮；无新外部依赖。验证入口：单测覆盖「非压缩轮不落盘」。
- **可靠性/恢复**：sink 失败隔离，不影响主流程；进程强杀可能丢失未写的 last 文件（调测场景可接受），compact 文件在压缩后下一次模型调用即落盘，损失窗口小。验证入口：sink 失败场景。
- **可维护性**：与 `developer-hook-trace` 同构，单一职责、单一文件 + 测试。
- **可测试性**：内联形态 `createContextMonitorPlugin({ log })` 接 fake sink 做纯逻辑测试；artifact 形态经 loader 加载测试。验证入口：`tests/context-monitor.test.ts`、loader 加载测试。
- **审计/可追溯性**：落盘 JSON 文件本身即审计产物，文件名带 sessionId + 序号。

## 验证映射

| 约束（MUST/SHALL） | 对应 task | 验证入口 |
|---|---|---|
| 插件 id/hook id/stages/observe-only/`failureMode: CONTINUE` | T1 | `context-monitor.test.ts` hook 形态场景 |
| 压缩写 compact 文件含 pre/post/summary | T2 | compact 落盘场景 |
| 终态覆盖写 last 文件、追问覆盖 | T3 | last 覆盖写场景 |
| 非压缩轮不落盘 | T2 | 非压缩轮场景 |
| 文件总数 = 1 + 压缩次数 | T2/T3 | 多压缩 + 终态合计场景 |
| sink 失败仍 PASS、不影响主流程 | T4 | sink 失败场景 |
| file sink 路径穿越防护 | T5 | 路径穿越场景 |
| artifact 生成 `plugin.json`+`index.js`、loader 兼容、无 overwrite 失败 closed | T6 | artifact 生成 + loader 加载测试 |
| 打包纳入产物但默认不激活 | T7 | 打包候选校验 |

## 文档承载决策

- 行为契约（hook 形态、落盘策略、observe-only、artifact、默认不激活）：`openspec/specs/context-monitor-logging/spec.md` 主承载。
- 模块设计（`context-monitor` subpath 与 `developer-hook-trace` 并列）：`openspec/designs/modules/agent-plugin-sdk.md` 主承载。
- 跨模块流程（stage 时序、与 loader/ lifecycle 注入的衔接）：本 design.md 在归档时提炼到 `openspec/designs/modules/agent-plugin-sdk.md`。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍

- [风险] 压缩前快照 `H_prev` 不含本回合 U/P → 缓解：语义可接受，diff 不误判（见决策 2）。
- [风险] `TraceableSummaryGenerationPort` 若被 `createLifecycleHookModelInvocationService` 包裹，summary 生成会产生额外 `BEFORE_MODEL_INVOKE` 噪声 → 缓解：实现期确认；必要时按 `stepId` / `modelProfileId` / `purpose` 过滤。
- [风险] 进程强杀丢失 last 文件 → 缓解：调测场景可接受；compact 文件早落盘。
- [风险] 同一 assemble 多次压缩 → 缓解：pending 用队列。
- [取舍] 完整上下文原文落盘的 PII 风险 → 取舍：默认不激活，operator 自管日志目录访问控制。

## 迁移计划

无迁移。新增插件，默认不激活。回滚：从 `nextAgent.system.plugins[]` 移除该条目并重启。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/context-monitor-logging/spec.md`：新增，承载全部行为契约。
- `openspec/overview.md`：补充 context-monitor 调试插件长期背景条目。
- `openspec/designs/modules/agent-plugin-sdk.md`：补充 `context-monitor` subpath 设计落点与 stage 时序衔接。
- `openspec/designs/spec-to-design-map.md`：补充 `context-monitor-logging` 导航条目。

## 待确认问题

1. `TraceableSummaryGenerationPort` 是否经 `createLifecycleHookModelInvocationService` 包裹？若是，需在插件内过滤 summary 生成的 `BEFORE_MODEL_INVOKE`。
2. 同一 assemble 内多次压缩的实测频率，以确认队列深度是否需要上限。
