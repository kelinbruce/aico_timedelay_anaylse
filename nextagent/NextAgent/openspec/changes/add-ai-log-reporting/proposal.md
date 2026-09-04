## Why

电信网络智能体的对话请求需要满足外部合规审计要求，向 CloudSop 上报 AI 日志，记录每次对话请求的用户输入和系统输出。CloudSop 是外部合规审计系统，需要接收到用户原始文本输入和最终 assistant 输出（截断），用于事后审计和内容溯源。

现有仓库不具备 AI 日志的上报通道：`opLog` 路由声明机制只是声明层（路由 config + opLogIdentity），没有消费 hook、没有 sink、没有 HTTP client。本次 change 新建 AI 日志专用的 gateway port 接口和上报通道，并定义合规审计受控外部边界的安全例外。

## 目标与非目标

### 目标

- run 到达终态时向 CloudSop 上报一条 AI 日志，记录对话 ID、使用的模型和知识检索标记、用户原始文本输入和系统输出（截断）。
- 所有终态（COMPLETED/FAILED/CANCELED）都上报，合规审计人员可以事后追溯每次对话的输入和输出。
- 只在 REMOTE 部署下启用，LOCAL 部署跳过。
- 上报失败不影响业务流程。

### 非目标

- 不修改常规 opLog 声明机制 — 现有路由 config + opLogIdentity 保持不变，另一个 repo 的 remote 包自己 hook onResponse 做采集和上报。
- 不上报 AI 系统版本信息 — 该信息可从 CloudSop 管理页面或后台获取和追踪。
- 不引入 Redis 或其他跨实例状态传递方式 — 多实例 recovery 场景下模型名和 km 标记可能缺失，AI 日志仍会上报但资源名称为空，这是可接受的降级。
- 不修改 redaction-policy 的既有安全约束 — 通过新增受控例外通道定义合规审计边界。
- 不在本 repo 实现 CloudSop HTTP 调用 — `OperationLogGatewayPort` 的 HTTP 实现由另一个 repo 直接实现接口，本 repo 只定义接口和辅助函数。

## What Changes

- 新增 `OperationLogGatewayPort` 接口（AI 日志专用），定义在 `agent-contracts/gateway`，暴露 `writeAiLog(entry)` 方法。
- 新增 `OperationLogEntry` 类型，为完整 CloudSop 请求体。
- `agent-app` composition 层新增辅助函数（`truncate`、`buildResourceName`、`formatAiLogDetail`、`resolveAuditLocale`），在 `postTerminalCallback` 闭包中组装 AI 日志 entry 并通过注入的 `OperationLogGatewayPort` 上报。`agent-app` 不依赖 `agent-platform-gateway-remote`；port 实例由外部 entrypoint 注入。
- `agent-channel-web` 扩展 `extractRequestHeaders` 捕获客户端 IP。
- `agent-app` composition 层在 REMOTE 模式下接收外部注入的 `OperationLogGatewayPort` 实例，注册 timeline listener 收集模型名和 km 标记，在 `postTerminalCallback` 闭包中组装 AI 日志 entry 并上报。

## Function 影响（OpenSpec Capabilities）

| 变更类型 | Function | canonical name | 对应 spec | 变化边界 | 系统质量属性 |
|---|---|---|---|---|---|
| 新增 | `FN-7.8` | 上报 AI 日志 | `ai-log-reporting` | 新增 AI 日志合规审计上报通道：terminal commit 后 fire-and-forget 上报，包含用户输入和系统输出（截断），定义 CloudSop 受控安全例外 | 安全、可靠性/恢复 |

## 影响范围

- Agent 与平台集成：CloudSop 合规审计通道在 REMOTE 部署下启用，LOCAL 部署跳过。
- 安全边界：新增受控例外通道，允许向 CloudSop 上报用户原始文本输入和最终 assistant 输出（截断至 1024）。
- 受影响代码：`agent-contracts`、`agent-channel-web`、`agent-app` composition。`agent-app` 通过注入的 `OperationLogGatewayPort` 上报，不直接依赖 `agent-platform-gateway-remote`。不修改 `agent-runtime`、`agent-core` 或 `agent-capability`。
- 另一个 repo：实现 `OperationLogGatewayPort` 接口，包括 CloudSop HTTP 调用、认证、请求体序列化和超时控制，通过 composition 层注入。
