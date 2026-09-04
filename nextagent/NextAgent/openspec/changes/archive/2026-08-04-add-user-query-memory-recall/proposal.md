# 用户 Query 主动长期记忆召回

## Why

当前长期记忆的 `search_memory` 和 `get_memory_detail` 是模型按需调用的工具。对于综合问答，模型在首轮推理前未必会主动检索与当前用户问题有关的跨会话记忆，导致已学习的事实、偏好或历史结论不能稳定参与本轮回答。

NOEMate 1.0 在软件流程中直接查询长期记忆。NextAgent 的综合问答不复用该流程，因此需要在每个已接受用户 Query 的首轮模型调用前执行一次受控的软件召回：以可信用户 Query 检索 L1，对全部候选读取 L2，并在最终模型输入预算允许时加入请求私有上下文。

首会话加载用户特征是独立能力。本变更不替代或扩大该机制；主动召回只处理与当前 Query 相关的记忆。

## Goals

- 允许 Agent 通过 `hooks[]` 显式启用 `user-query-memory-recall`，并只在首个 `BEFORE_MODEL_INVOKE` 模型调用执行主动召回。
- 使用可信根用户消息执行一次跨类型 L1 检索，并对全部候选读取 L2；L1 固定使用 `limit=10`、`minConfidence=0.3` 且不传类型过滤。
- 在既有上下文装配、历史压缩和 render 完成后，按最终模型输入预算整体选择完整 L2、完整 L1 摘要或不注入。
- 通过可信 Owner Scope 和 Agent Scope 隔离检索、详情读取和注入结果，不向通用 Hook 或 plugin SDK 暴露 Owner Scope。
- L1 或任一 L2 失败、超时、取消或不可用时零注入且不重试；主动召回不得阻断模型调用、用户回复或 RequestRun 终态提交。

## Non-goals

- 不改变 `add_memory` 的指令性学习语义，也不自动写入、更新或删除记忆。
- 不替代首会话用户特征加载，不自动加载全部用户特征，也不合并两条路径。
- 不改变模型自主调用 `search_memory`、`get_memory_detail` 的工具能力。
- 不引入多类别并行检索、模型重排序、跨请求缓存或新的 Web API。
- 不把召回结果持久化为会话消息、时间线正文、模型工具调用记录或尝试事实内容。
- 不让主动召回参与后续模型重试、fallback 或 tool round；这些调用只复用原有上下文且不得再次读取记忆。

## What Changes

- Agent 可显式启用用户 Query 主动记忆召回；未启用时模型输入和长期记忆读取行为保持不变。
- 已启用 Agent 在首轮模型调用前使用可信根用户 Query 执行一次跨类型 L1 检索，并对全部候选读取 L2。
- 系统在最终模型输入预算内依次选择完整 L2、完整 L1 或不注入；召回内容仅作为低权限背景进入本次模型调用。
- 同一进程中，同一 RequestRun 的 fallback、续写和 tool round 不得再次读取或注入；Hook 使用有界的 RequestRun 尝试集合判断已尝试状态。
- 召回读取和模型输入同时受 Owner Scope 与 Agent Scope 约束，且不向通用 Hook、插件或用户可见历史暴露受保护内容。
- 任何读取、取消或预算失败均零注入、不重试，并继续原模型调用和终态提交。

## Function 影响（OpenSpec Capabilities）

- 修改 Function `FN-4.3 装配上下文`（`context-engine`）：定义最终模型输入的 L2/L1 整体预算准入和请求私有投影；涉及性能/容量、可靠性/恢复和安全。
- 修改 Function `FN-4.1 调用模型`（`model-invocation-contract`）：向受信 `BEFORE_MODEL_INVOKE` 边界透传已解析的模型窗口预算，且不改变 provider 请求或模型可见输入。
- 修改 Function `FN-8.2 检索和写入记忆`（`memory-tools`）：定义主动召回与模型工具路径的隔离，以及 L1/L2 读取边界；涉及性能/容量和可靠性/恢复。
- 修改 Function `FN-10.1 注册和执行钩子`（`lifecycle-hook-execution`）：定义受信终末 Hook 的激活、执行顺序、作用域和观测隔离；涉及安全和审计/可追溯性。

## Feature 影响

- 修改 Feature `F-4.3 自动上下文窗口`：首轮最终模型输入可在既有压缩后纳入受控的 Query 相关记忆。
- 修改 Feature `F-8.2 长期记忆`：长期记忆除模型工具检索外，支持受控的非模型主动召回消费者。

## Impact

- 涉及 Agent assembly/configuration、模型调用前生命周期边界、`agent-context-engine` 的预算准入、`agent-memory` 和 `agent-app` composition。
- `ModelInvokeBoundary` 增加只读的模型窗口事实；`messages` mutation 继续使用现有字段，不新增跨阶段候选或 `ContextAssembly` 字段。
- 不新增浏览器或 HTTP 接口；`agent-channel-web` 不拥有或展示长期记忆原文。
- 需要保持 Agent Scope、Owner Scope、取消传播、请求私有内容和安全观测的一致性，并通过 OpenSpec 严格校验。
