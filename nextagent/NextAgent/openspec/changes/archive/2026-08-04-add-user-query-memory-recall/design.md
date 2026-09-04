## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-4.3 装配上下文` | 在既有装配和压缩完成后，对首轮召回内容执行 L2/L1 整体预算准入并投影到最终模型输入。 | `context-engine` | [`FN-4.3 装配上下文`](#fn-43-装配上下文) |
| `FN-4.1 调用模型` | 将已解析的模型窗口预算传递给 `BEFORE_MODEL_INVOKE` 的受信 Hook，且不向 provider 或模型暴露该字段。 | `model-invocation-contract` | [`FN-4.1 调用模型`](#fn-41-调用模型) |
| `FN-8.2 检索和写入记忆` | 提供与模型工具隔离、受双重作用域保护且全有或全无的 L1/L2 读取服务。 | `memory-tools` | [`FN-8.2 检索和写入记忆`](#fn-82-检索和写入记忆) |
| `FN-10.1 注册和执行钩子` | 增加在普通 Hook 之后执行的受信终末 Hook，并隔离作用域、结果和观测面。 | `lifecycle-hook-execution` | [`FN-10.1 注册和执行钩子`](#fn-101-注册和执行钩子) |
| `FN-11.1 恢复运行状态` | 为主动召回提供 scoped、原子且不可重试的 RequestRun 尝试事实。 | `runtime-recovery-idempotency-guard` | [`FN-11.1 恢复运行状态`](#fn-111-恢复运行状态) |

## `FN-4.1 调用模型`

### 目标与规范依据

主动召回的最终输入准入需要已解析的模型窗口预算；该预算属于可信框架元数据，不属于 provider 参数或模型可见内容。

### 修改方案

1. `ModelInvocationRequest` 增加可选正整数 `contextWindowTokens`，`agent-core` 从已解析的 `ResolvedModelConfiguration` 传入，`agent-model` 在每个 `BEFORE_MODEL_INVOKE` 边界原样透传。
2. 生命周期 Hook 可以读取该字段但不得 mutation；provider adapter 不得映射为 provider-native 参数、header 或模型消息。
3. 缺失该字段保持兼容；受信主动召回 Hook 采用零注入降级。

### 验证关注点

- 模型调用 request schema 拒绝非法窗口值。
- Hook 边界和下游 wrapper 保留同一窗口值。
- 外部依赖接口守卫和接口汇总同步记录该新增可选字段。

## `FN-4.3 装配上下文`

### 目标与规范依据

启用 Agent 的首轮模型输入可以使用与可信根用户 Query 相关的跨会话记忆。召回内容不得挤占既有必要上下文或预留输出预算；依赖失败或预算不足时保持原模型输入。

#### 本 Function 的目标 Requirements

canonical spec：`context-engine`

- `ADDED`：`首轮用户 Query 主动记忆召回进入最终模型输入`
- `ADDED`：`主动记忆召回使用最终输入预算整体降级`

### 当前实现

- `DefaultAgent` 在 Context Engine `assemble`、历史压缩和 `render` 后构造 `ModelInvocationRequest`；model lifecycle wrapper 在实际模型调用前构造 `BEFORE_MODEL_INVOKE` 的 `ModelInvokeBoundary`。
- `ModelInvokeBoundary` 已包含最终 `messages`、`tools`、`commonOptions` 和模型 profile，但没有模型窗口大小。
- `BEFORE_MODEL_INVOKE` mutation 已允许替换 `messages`；因此不需要通过 `PlanningBoundary`、`CapabilityGeneratedMessage` 或 `ContextAssembly` 传递召回候选。
- Context Engine 已提供统一 token estimator 和模型窗口减预留输出预算的计算规则。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 基于最终模型输入做准入 | Hook 可取得最终消息，但没有窗口事实或主动召回准入器 | 缺少可复用的最终输入补充内容预算判断。 |
| L2 放不下时整体降级 L1 | 现有 Hook 只负责通用 mutation | 缺少固定的 L2、L1、无上下文三态选择。 |
| 不改变 ContextAssembly | 当前 planning 方案需要跨阶段候选 | 应在模型调用前直接完成准入和消息投影。 |

### 修改方案

1. Context Engine 导出最小的 `RenderedContextSupplementAdmission` 应用服务。输入为最终 `ModelMessage[]`、最终工具列表、`contextWindowTokens`、`maxOutputTokens`、完整 L2 片段和完整 L1 片段；输出仅为 `L2_CONTEXT`、`L1_CONTEXT` 或 `NO_CONTEXT` 及对应的新增消息。
2. 准入服务复用 Context Engine 的 `TokenEstimator`。可用输入预算固定为 `contextWindowTokens - maxOutputTokens`；先估算既有最终消息和工具，再整体评估新增 L2 消息。L2 超限时整体评估 L1；L1 仍超限时不返回消息。L1/L2 均不得截断、拆分或触发第二次历史压缩。
3. `ModelInvocationRequest` 和每个 `BEFORE_MODEL_INVOKE` 的 `ModelInvokeBoundary` 增加只读可选 `contextWindowTokens`，由模型调用路径从本次已解析的模型配置必须透传。该字段不是 mutation 字段，Hook 不得修改模型窗口；兼容调用方缺失该值时，受信 Hook 直接零注入。
4. 召回投影使用一条来源明确的 `USER` 消息，插入最终根用户消息之前。固定框架声明内容来自长期记忆且仅作为相关背景，记忆正文不得取得 SYSTEM 权限。未选中候选时保持原 `messages` 对象内容不变。
5. Hook 仅在 `ModelInvokeBoundary.stepId` 为 `turn-1` 时尝试召回，并以有界的进程内 `requestRunId` 集合作为同一请求执行中的唯一尝试判定；fallback、续写与后续 tool round 返回无 mutation。该集合不跨进程或跨实例持久化；Hook 不重新 assemble、不重新 render，也不重新读取 L1/L2。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | `主动记忆召回使用最终输入预算整体降级` | 只对最终输入做两次有界估算，不触发再次压缩或装配。 | L2、L1 均整体准入，预算不足不改变消息。 |
| 安全 | `首轮用户 Query 主动记忆召回进入最终模型输入` | 记忆以 USER 权限和固定来源框架进入模型输入。 | 记忆正文不能覆盖系统指令，且不进入持久化消息。 |

## `FN-8.2 检索和写入记忆`

### 目标与规范依据

保留模型工具路径，同时为受信终末 Hook 提供一次受控的非模型读取操作。两个路径复用 memory core 的检索、排序和详情授权，不共享工具 descriptor 或模型可见工具 schema。

#### 本 Function 的目标 Requirements

canonical spec：`memory-tools`

- `MODIFIED`：`Memory tools architecture boundaries`
- `ADDED`：`主动召回的 L2 读取有界、响应取消且全有或全无`

### 当前实现

- `LongTermMemoryRetrieverGateway` 已提供 `searchLongTermMemory` 和 `getLongTermMemoryDetail`，并使用 Owner Scope 与 Agent Scope。
- `search_memory` 和 `get_memory_detail` 通过模型工具调用；非模型消费者被要求直接依赖 gateway public port 或 owning-change application service。
- gateway 方法没有独立 `AbortSignal` 参数，因此取消只能阻止后续分发和忽略已完成后的结果；不得声称能中断底层不可取消 I/O。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 一次跨类型 L1 与全部 L2 | 现有模型工具分开暴露两个操作 | 缺少内部组合服务。 |
| L2 最大并发 3、失败全无 | gateway 只提供单条详情读取 | 缺少有界调度和批次失败语义。 |
| 不经过模型工具 | 工具 port 已存在 | 需要明确独立的应用服务入口。 |

### 修改方案

1. 在 `agent-memory` 增加 `UserQueryMemoryRecallService`。输入只包含可信 Owner Scope、Agent Scope、非空 `queryText` 和 `AbortSignal`；检索参数固定为不传 `categoryFilter`、`limit=10`、`minConfidence=0.3`。
2. 服务保持 L1 排序并对全部候选读取 L2，最大并发为 `3`。父 signal 取消或任一 L2 失败后停止分发未开始任务，等待已开始调用结束并返回单一无上下文结果。服务不重试 L1/L2，不返回部分详情。
3. 服务复用 `LongTermMemoryRetrieverGateway` 的现有 DTO、ACTIVE、作用域和不可披露语义，不调用 `LongTermMemoryToolPort`、tool descriptor、Capability executor 或 capability invocation。
4. 服务返回请求内只读的 L1 摘要和 L2 详情，不持久化结果。L1 未命中直接返回无上下文且不调用 L2。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | `主动召回的 L2 读取有界、响应取消且全有或全无` | 一次 L1、最多 10 次 L2、最大并发 3。 | 实际最大在途数和每个候选调用次数。 |
| 可靠性/恢复 | `主动召回的 L2 读取有界、响应取消且全有或全无` | 任一失败停止分发并返回无上下文，不重试。 | 不返回部分详情且调用方继续模型路径。 |

## `FN-10.1 注册和执行钩子`

### 目标与规范依据

通用 Hook 保持最小输入和 plugin 隔离；`user-query-memory-recall` 通过 app composition 注册为受信终末 Hook，并在同阶段普通 Hook 完成后执行，使记忆正文不会暴露给其他 Hook。

#### 本 Function 的目标 Requirements

canonical spec：`lifecycle-hook-execution`

- `MODIFIED`：`Hook inputs are stage-scoped, minimal, and authority-safe`
- `MODIFIED`：`Every hook invocation produces a timeline-only observability fact`

### 当前实现

- runtime 内部 invocation request 已有可信 Owner Scope，但普通 `HookInput` 不包含该字段。
- SYSTEM Hook 当前固定在 CUSTOM Hook 前执行；impact Hook mutation 会传递给后续 Hook。
- 所有 Hook 共用 `RuntimeLifecycleHookExecutor`，不存在普通 Hook 执行完毕后的受信终末阶段。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 受信 Hook 使用双重作用域 | 普通 Hook 无 Owner Scope | 缺少 app-composed 受信输入。 |
| 记忆结果不暴露给其他 Hook | 普通 mutation 会传递给后续 Hook | 缺少终末执行位置。 |
| 仍由 Agent `hooks[]` 激活 | CUSTOM Hook 可按 assembly materialize | 受信实现必须复用 activation 而不进入普通 executor。 |

### 修改方案

1. `agent-runtime` 增加仅供 public package export 使用的 `TrustedTerminalLifecycleHookExecutor`。它只支持 `BEFORE_MODEL_INVOKE`，输入由 runtime 的 `HookExecutionScope` 构造，包含可信 Owner Scope、Agent Scope、RequestRun 坐标和普通 Hook 处理后的 `ModelInvokeBoundary`。
2. `LifecycleHookStageExecutor` 根据 app composition 提供的受信 Hook ID 集合，将已 materialize 且已激活的受信 Hook 从普通执行列表中分离。它先完成普通 observe/impact Hook，再调用受信终末 Hook；受信结果生效后不再执行其他 Hook。
3. 受信 Hook 只允许返回 `PASS` 或 `SKIP`，以及现有 `messages` mutation。该 mutation 使用现有白名单和边界规范化，但不会作为输入传给其他 Hook。
4. `HOOK_INVOKED` 只记录 Hook ID、stage、状态、结果、耗时和枚举化安全原因；`user-query-memory-recall` 额外记录 runtime 校验后的 `candidateCount`、`detailCount` 和 `contextDisposition`，用于定位无命中、L2 读取失败与预算降级。受信 Hook 的 mutation 不产生 `mutationSummary`，Query、Owner Scope、记忆正文、记忆 ID 和模型消息不得进入 timeline、日志、metric、trace 或 audit。
5. 通用 `HookInput`、plugin SDK、Agent YAML schema 和普通 Hook 排序规则不变。受信 Hook 未注册、未激活、阶段不匹配或执行失败时均不得降级为带 Owner Scope 的普通 Hook；失败按 `CONTINUE` 语义使用原模型输入。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Hook inputs are stage-scoped, minimal, and authority-safe` | 受信 executor 只由 app composition 注入并固定终末执行。 | plugin Hook 无 Owner Scope 且看不到召回 mutation。 |
| 审计/可追溯性 | `Every hook invocation produces a timeline-only observability fact` | 保留安全状态事实，排除召回内容和 mutation 摘要。 | 实际序列化 payload 不含受保护值。 |

## 跨 Function 协作与端到端流程

```text
accepted user Query
  -> Context Engine assemble / compression / render
  -> ordinary BEFORE_MODEL_INVOKE hooks
  -> trusted terminal user-query-memory-recall hook
  -> verify initial model stage occurrence and claim in-process RequestRun attempt
  -> resolve trusted root USER message
  -> L1 search (limit=10, minConfidence=0.3, no category filter)
  -> all L2 detail reads (max concurrency=3)
  -> final-input admission: full L2 -> full L1 -> none
  -> apply messages mutation when admission selects context
  -> first model invocation
```

`agent-app` 是唯一 composition root，负责组合受信 Hook、Session Message Store、召回服务和预算准入服务。Agent YAML 只选择是否激活以及阶段，不提供 Query、scope、检索参数或模型预算。

受信 Hook 以 `messageId=requestId` 从 Session Message Store 读取根消息，并校验 owner、agent、session、request、run、`USER` 角色及非空正文。`flowVariables`、Agent YAML、客户端 metadata、历史消息和模型输出均不能成为 `queryText`。

首会话用户特征加载和模型自主 memory tools 保持不变。主动召回仅在 `ModelInvokeBoundary.stepId=turn-1` 的 `BEFORE_MODEL_INVOKE` 执行；Hook 以有界的 `requestRunId` 尝试集合阻止同一进程内的 fallback、续写和后续 tool round 重复读取，也不重新注入本次召回内容。

## 备选方案与取舍

- 未选择 `BEFORE_PLANNING + privateMutation`：需要扩展 PlanningBoundary、ContextAssembly 和跨阶段完成 port，并产生二次装配失败路径；对于只进入首轮最终模型输入的需求属于过度设计。
- 未选择 Context Engine 直接读取记忆：会让 Context Engine 承担外部记忆 I/O、幂等和双重作用域编排，破坏 owner 边界。
- 未选择 RequestRun 内存缓存：隐藏可变状态需要额外清理、并发和泄露控制，且恢复语义更复杂。
- 未选择新的 RequestRun 持久化 attempt gateway：远端 gateway 必须提供同等可用实现才可作为 Hook 前置条件；受信 Hook 的有界进程内尝试集合可覆盖同一请求执行中的 fallback 和后续轮次，避免新增远端依赖。
- 选择受信终末 `BEFORE_MODEL_INVOKE`：复用现有 `messages` mutation，以最终输入做预算判断，数据只存在于当前调用栈，是满足需求的最小路径。

## 验证策略（Verification Strategy）

- `agent-memory` 测试覆盖固定 L1 参数、全部 L2、最大并发 3、取消、失败全无和双重作用域。
- `agent-context-engine` 测试覆盖最终消息与工具估算、L2/L1/无上下文整体准入和不截断。
- runtime characterization/integration 测试覆盖普通 Hook 先执行、受信 Hook 最后执行、plugin 不见 Owner Scope/召回 mutation，以及安全 `HOOK_INVOKED`。
- Agent Core/app 集成测试覆盖可信根消息、显式 activation、首轮注入、fallback 和 tool round 零读取、失败后模型调用和 terminal commit 不受阻断。
- architecture 测试阻止 Context Engine 导入 memory gateway、主动召回经过 Tool/Capability 路径或通用 Hook 输入增加 Owner Scope。

## 长期基线刷新计划（Baseline Promotion Plan）

- stable specs：更新 `context-engine`、`memory-tools`、`lifecycle-hook-execution`。
- Functions：更新 `FN-4.3`、`FN-8.2`、`FN-10.1`。
- Features：更新 `F-4.3`、`F-8.2`。
- overview：更新综合问答主动召回范围。
- architecture：更新受信终末 Hook 与主动记忆召回端到端设计。
- modules：更新 `agent-app`、`agent-context-engine`、`agent-memory`、`agent-runtime`。
- ADR：无；沿用 app composition、双重作用域和非模型 gateway access 原则。
- spec-to-design-map：更新上述 specs 的导航。

## 风险与取舍（Risks / Trade-offs）

- 每个启用 Query 增加一次外部读取，可能提高首 token 延迟；通过一次 L1、最多 10 次 L2、并发 3 和无重试限制影响。
- 召回内容只进入首轮模型调用；模型 fallback 或 tool round 不保留该临时消息。这与“首轮主动召回且不重试”的范围一致，避免持久化敏感结果。
- 不再以持久化事实覆盖进程恢复或跨实例重放；恢复后重新开始首轮模型调用可以再次读取长期记忆，且不会复用旧调用的临时召回消息。
- 主动读取可能与模型后续自主调用 memory tools 重叠；当前不增加跨路径缓存或去重。

## 待确认问题（Open Questions）

无。
