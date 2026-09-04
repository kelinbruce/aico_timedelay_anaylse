# FN-3.5 Agent 选择策略

> 能力域 D3 Agent 装配与主链路 · 子域 [D3.1 智能体装配](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-3.1](../../../features/D3-Agent装配与主链路/D3.1-智能体装配/F-3.1-装配智能体.md) |
| 主规格 | `agent-selection-policy` |
| 接口 | 请求入口层 agent 选择策略（`AgentSelectionPolicy`），runtime createSession 同步调用 |

## 描述

请求入口层决定由哪个 agent 处理当前请求。接收 channel boundary 提取的 hosted-agent selection 原始值（header `x-agent-id`），经格式校验和可信 `AgentAssemblyRegistry` 校验后产出 agentId 并绑定到 session。默认实现为显式选择（header agentId -> fallback `activeAgentId`），接口预留集成服务定制扩展点。Web channel 和 task channel 的 createSession 统一调用，保证多 channel 行为一致。

该策略与 agent-internal routing policy（`AgentRoutingConfig`，决定 agent 内部走 skill/workflow/model-loop）是两个不同层级的策略，不可混用。

## 前置条件

- 请求已通过 channel boundary 的 identity 解析和 header 提取。
- `AgentAssemblyRegistry` 已初始化且包含至少一个 user-invocable agent。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| hosted-agent selection 原始值 | 否 | channel boundary 从 header `x-agent-id` 提取的原始字符串，未经格式校验 |
| `defaultRouteAgentId` | 是 | 来自 `hostedAgent.activeAgentId` 配置的可信默认 agent |

## 输出

选择的 `agentId` 和选择原因的 safe reason code。safe reason code 通过 structured log 记录（event: `agent.selection.resolved`，字段: `agentId`、`safeReason`），不进入 Web API response、SSE、WebSocket、timeline、audit event 或 `ObservabilityObservationEvent`。校验通过后 agentId 绑定到 session 并持久化。

## 处理过程

1. Agent Selection Policy 在 `RuntimeSessionPort.createSession` 调用链中同步执行，位于 channel boundary identity 解析和 header 提取之后、session 持久化之前。
2. 原始值存在且满足 agentId 格式约束（safeId 正则） -> 选择该 agentId，产出 safe reason code `HEADER_AGENT_ID_SELECTED`。
3. 原始值缺失或为空 -> 选择 `defaultRouteAgentId`，产出 safe reason code `DEFAULT_ACTIVE_AGENT`。
4. 原始值存在但不满足格式约束 -> 拒绝请求，返回 safe validation error，不 fallback。
5. 产出 agentId 后调用 `AgentAssemblyRegistry.active(agentId)` 校验该 agentId 对应一个存在且 `userInvocable=true` 的 assembly。校验通过后绑定到 session 并持久化；校验失败返回 missing-assembly safe failure，不静默 fallback。
6. session 一旦绑定 agentId，后续所有请求使用 `session.agentId`，不再从 header 解析。该不变量闭合 agent scope 信任链：header（选择请求） -> AgentSelectionPolicy 格式校验 + assemblyRegistry 校验（可信） -> session 绑定（持久化） -> 后续用 `session.agentId`。
7. 集成服务可提供自定义 `AgentSelectionPolicy` 实现替换默认显式选择，但自定义实现必须接收相同输入契约、产出相同结果契约，且不得从请求体、模型输出、capability 参数或客户端 metadata 获取 agentId。

## 结果

- 选择成功且 assembly 校验通过：agentId 绑定到 session 并持久化，后续请求按 `session.agentId` 隔离。
- header 值无效：safe validation error，不 fallback。
- 选择的 agent 不存在或不可调用：missing-assembly safe failure，不 fallback。
- 已绑定 session 的后续请求：使用 `session.agentId`，忽略 header 覆盖。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 选择模式 | 显式选择（header `x-agent-id`）；未指定时 fallback 到 `activeAgentId`；接口支持集成服务定制；Web channel 和 task channel 统一调用 | `agent-selection-policy`：`Agent 选择策略在 session 创建前决定请求路由到哪个 agent`、`Agent Selection Policy 接口可扩展支持集成服务定制` |
| agentId 信任链 | header 原始值 -> AgentSelectionPolicy 格式校验 -> assemblyRegistry.active 校验 -> session 绑定 -> 后续用 `session.agentId`；session 绑定后不再从 header 取 | `agent-selection-policy`：`Agent Selection Policy 校验选择的 agentId 可用后才绑定到 session` |
| safe reason code | `HEADER_AGENT_ID_SELECTED` 或 `DEFAULT_ACTIVE_AGENT`；非持久化运行时诊断值，只通过 structured log 记录，不进入 Web response | `agent-selection-policy`：`Agent 选择策略在 session 创建前决定请求路由到哪个 agent` |
