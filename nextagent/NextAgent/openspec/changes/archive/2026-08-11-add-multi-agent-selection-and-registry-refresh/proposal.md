## Why

产品通过 pub 机制注册新的 local agent 后，用户无法在运行时指定该 agent 创建会话并路由到对应资源。当前系统只有一个 `hostedAgent.activeAgentId` 配置值，所有请求固定路由到该 agent；`AgentAssemblyRegistry` 在启动时扫描一次 `agentsRoot` 构建固定数组，进程启动后新增的 agent 目录不会进入 registry 和 capability catalog。这导致产品每注册一个新 agent 就必须重启进程，且无法在同一进程中让多个产品 agent 并存服务。

该问题对平台集成方和最终用户均有可观察影响：平台集成方 pub 注册新 agent 后必须重启进程才能让该 agent 可用，无法实现热部署；最终用户无法通过请求指定与哪个 agent 对话，所有请求被路由到默认 agent，产品 agent 的独立配置无法生效。`web-skill-catalog` 已明确记录此限制，当前版本使用 `activeAgentId` 作为 Agent Scope，此为单 Agent 模式限制，未来支持多 Agent 时需改为 session-bound `agentId`。

此外，Web channel 和 task channel 的非 session 内端点（cron-tasks、category-questions、frequent-questions、question-associations、annotations/favorite-turns、memory、listSessions）底层 contract 已包含 `agentId` 字段并按 agentId 隔离，但两个 channel 入口全部硬用 `dependencies.defaultAgentId`，未从请求 header 解析 agentId，导致产品 agent 无法使用这些功能。

## 术语

| 术语 | 含义 |
|---|---|
| Agent Selection Policy | 请求入口层的 agent 选择策略，决定由哪个 agent 处理当前请求。与已有的 agent-internal routing policy（`AgentRoutingConfig`，决定 agent 内部走 skill/workflow/model-loop）是两个不同层级的策略。 |
| hosted-agent selection | channel boundary 解析的 agent 选择信号，类似 identity 从 auth boundary 解析。它是选择请求，不是覆盖当前 Agent。 |
| session-bound agentId | createSession 时绑定到 session 并持久化的 agentId。后续请求使用 `session.agentId`，不再从 header 取。 |

## 目标与非目标（Goals / Non-Goals）

**目标：**

进程启动后 pub 新增的 local agent 能被 `AgentAssemblyRegistry` 和 capability catalog 自动发现，无需重启进程。用户通过请求 header 指定 agentId 创建 session 后，该 session 的所有后续操作自动路由到对应 agent 的资源。多个产品 agent 可在同一进程中并存服务，互不干扰。agent 选择策略抽象为可扩展接口，定义在共享契约层，Web channel 和 task channel 的 createSession 统一调用，保证多 channel 行为一致。两个 channel 所有携带 `agentId` 参数的端点均从 header `x-agent-id` 解析 agentId，不传 header 时行为与当前完全一致。

**非目标：**

不实现自动 agent 路由（如按租户、按意图自动选择 agent）。第一版只支持显式选择（header 指定 agentId），接口预留扩展点但不提前实现自动路由。不改变 agent 内部 routing policy（`AgentRoutingConfig` / `DefaultAgentRoutingPolicy`）的行为和契约。不改变 `activeAgentId` 配置的语义和加载机制，`activeAgentId` 仍作为默认 fallback agent。不改变 session 创建后的 agentId 绑定语义，session 一旦绑定 agentId 不可变更。不实现 `default-system.yaml` 的热重载，config 仍是启动时加载。不修改 `skill-catalog-query-port` 的 `defaultAgentId` 用法（该限制由 `web-skill-catalog` spec 已记录，后续单独修复）。listSessions 未传 header 时保持当前行为（按 `defaultRouteAgentId` 过滤），不扩展为跨 agent 查询。subagent 目录（`agents/{parentAgentId}/subagents/`）的新增不在 fingerprint 覆盖范围，pub 新增 subagent 需修改 parent agent.yaml 或重启进程触发重建。

## What Changes

### 新增

- Agent Selection Policy 接口：新增入口层 agent 选择策略接口，定义在 `agent-contracts`（两个 channel 共享的契约层）。在 `RuntimeSessionPort.createSession` 调用链中同步执行，决定当前请求路由到哪个 agent。默认实现为显式选择（header agentId -> fallback `activeAgentId`），接口预留集成服务定制扩展点。Web channel 和 task channel 的 createSession 统一调用此接口，保证多 channel 行为一致。
- AgentAssemblyRegistry 动态刷新：registry 支持在运行时检测 `agentsRoot` 下顶层 agent 目录的新增/删除/修改，并在 active/require/list 方法调用时同步重建编译后的 assembly 集合。刷新后 capability catalog 的 discovery 链路自动看到新 agent。

### 修改

- RuntimeCreateSessionCommand 新增可选 `agentId` 字段：createSession 时接受外部指定的 agentId 原始值，runtime 调用 `AgentSelectionPolicy.resolve` 做格式校验和决策，再经 `assemblyRegistry.active(agentId)` 校验存在且 user-invocable 后绑定到 session。未指定时 fallback 到 `defaultRouteAgentId`。
- Web channel 和 task channel 的 createSession 从 header `x-agent-id` 提取原始值传给 `RuntimeCreateSessionCommand.agentId`，由 runtime 统一调用 AgentSelectionPolicy 做格式校验和决策。两个 channel 的 createSession 行为由 AgentSelectionPolicy 统一约束。
- Web channel 所有携带 `agentId` 参数的非 session 内端点从 header `x-agent-id` 解析 agentId（格式校验 + brand + fallback 在 channel 层完成，不走 AgentSelectionPolicy）。包括 cron-tasks、category-questions、frequent-questions、question-associations、annotations/favorite-turns、memory 和 listSessions。底层 contract 已有 `agentId` 字段，只改 channel 入口解析。
- listSessions 查询在 header 指定 agentId 时按该 agentId 过滤，未指定时保持当前行为（按 `defaultRouteAgentId` 过滤）。
- AgentAssemblyRegistry Lookup Semantics 扩展：registry 的 `active` 和 `require` 方法支持任意已注册 agentId 的查找；`listTopLevelLocalAgentAssemblies` 等 discovery 方法在 registry 刷新后返回更新的 assembly 集合。
- workspaceFileExtensionPolicies 从静态 Map 改为从 `assemblyRegistry.require()` 动态获取，使刷新后新增的 agent 能正确解析 workspace file extension policy。

## Feature 影响（Features）

### 修改的 Feature

- `F-3.1 智能体装配与主链路`：用户价值从单 agent 固定路由扩展为多 agent 并存、按需选择；Function 组成新增 Agent Selection Policy，修改 Agent Package Assembly 的 registry 刷新能力。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- `FN-3.5 Agent 选择策略` -> `specs/agent-selection-policy/spec.md`
  - 功能边界：请求入口层决定由哪个 agent 处理当前请求；接收 channel boundary 的 hosted-agent selection 信号，经格式校验和可信 assemblyRegistry 校验后产出 agentId；默认实现为显式选择，接口预留集成服务定制扩展点；Web channel 和 task channel 的 createSession 统一调用。
  - 系统质量属性：安全（agentId 信任链闭合）、可维护性（策略可扩展、多 channel 一致）、审计/可追溯性（选择结果可记录）

### 修改的 Function

- `FN-3.2 编译智能体装配` -> `specs/agent-package-assembly/spec.md`
  - 功能边界：registry 从启动时固定数组扩展为支持运行时动态刷新；刷新后 capability catalog discovery 链路自动看到新 agent。
  - 系统质量属性：可靠性/恢复（刷新失败不影响已有 agent）、可维护性（无需重启即可发现新 agent）、可测试性（刷新行为可验证）
  - 映射说明：canonical spec = `specs/agent-package-assembly/spec.md`

- legacy spec `web-channel-api-contract` -> `specs/web-channel-api-contract/spec.md`
  - 功能边界：所有携带 `agentId` 参数的 Web channel 端点接受 header `x-agent-id` 作为 hosted-agent selection 信号；createSession 路径的信号由 runtime AgentSelectionPolicy 校验，非 session 内端点在 channel 层解析。
  - 系统质量属性：安全（agent scope 信任链闭合）、可测试性（header 解析可验证）
  - 映射说明：legacy spec 无已确认 Function 映射；本次只修改 `Web channel public API MUST have complete request specifications` 一个 Requirement，不创建新 Function 或新 spec

## 影响范围（Impact）

对 actor 的影响：最终用户可通过请求 header 指定 agentId 与不同产品 agent 对话，不传 header 时行为不变。平台集成方 pub 注册新 agent 后无需重启进程即可使用，可通过实现自定义 AgentSelectionPolicy 实现自动路由。Agent 开发者配置的 capabilityBindings、modelIds、prompt profile 在 session 绑定后对该 session 生效。产品 agent 的 cron-tasks、category-questions、frequent-questions、question-associations、annotations/favorite-turns、memory 等功能均可通过 header 指定 agentId 使用。

对公共 API 的影响：Web channel 和 task channel 所有携带 `agentId` 参数的端点新增可选 header `x-agent-id`。`RuntimeCreateSessionCommand` 新增可选 `agentId` 字段。其他 session 内端点不受影响，已有 `requireSession` -> `session.agentId` 机制自动隔离。

对配置和运维的影响：`default-system.yaml` 的 `hostedAgent.activeAgentId` 语义不变，仍作为默认 fallback agent。不需要新增配置项。

对受影响代码的影响：`agent-contracts/runtime` 的 `RuntimeCreateSessionCommand` 加 `agentId?` 字段；`agent-contracts/agent-assembly` 新增 `AgentSelectionPolicy` 接口；`agent-runtime/lifecycle/submit` 的 `createSession` 调用 AgentSelectionPolicy + assembly 校验、`listSessions` 支持动态 agentId；`agent-channel-web/routes/requests` 所有携带 agentId 的端点从 header 解析 agentId；`agent-channel-web/routes/memory` 从 header 解析 agentId；`agent-channel-task/routes` 的 createSession 从 header 解析 agentId；`agent-app/composition/assembly-composition` 的 baseRegistry 改为可变引用 + fingerprint 扩展 + 重建；`agent-app/composition/capability-composition` 的 workspaceFileExtensionPolicies 动态化；`agent-app/composition/channel-composition` 注入 AgentSelectionPolicy；新增 `agent-app/src/composition/agent-selection-policy.ts` 默认实现。

对测试的影响：新增 header 指定 agentId 创建 session + submit + 数据隔离测试（Web channel 和 task channel）；新增 registry 动态刷新测试（pub 新 agent 后 catalog 可发现）；新增 agent selection policy 扩展点测试；新增非 session 内端点（cron-tasks、memory 等）header 指定 agentId 的隔离测试。
