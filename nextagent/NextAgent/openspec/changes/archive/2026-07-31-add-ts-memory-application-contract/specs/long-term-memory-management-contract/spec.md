## ADDED Requirements

### Requirement: 长期记忆管理提供唯一 Channel 端口

系统 SHALL 通过 `@nextagent/agent-contracts/channel` 暴露 `LongTermMemoryManagementPort`，供 Web Channel 调用长期记忆管理能力。该 port SHALL 精确定义 save、list、manual save、get、delete、mutate、search、detail、publish、unpublish、list published 和 copy published 12 个 operation。

#### Scenario: Channel 通过 Management Port 调用记忆操作

- **WHEN** Web Channel 处理任一长期记忆 HTTP operation
- **THEN** Channel MUST 调用 `LongTermMemoryManagementPort` 的对应 method
- **AND** Channel MUST NOT 直接调用 `LongTermMemoryStoreGateway`、`LongTermMemoryRetrieverGateway`、`LongTermMemorySharingGateway` 或 `LongTermMemoryGatewayBindings`

#### Scenario: Management Port 的公开方法集合保持固定

- **WHEN** contract tests 枚举 `LongTermMemoryManagementPort` 的公开 method
- **THEN** method 集合 MUST 与 save、list、manual save、get、delete、mutate、search、detail、publish、unpublish、list published 和 copy published 一一对应
- **AND** port MUST NOT 增加 count、batch、transition、adjust、access 或其他兼容别名

### Requirement: Management DTO 与 Gateway Record 保持分层

`agent-contracts/channel` SHALL 定义 long-term-memory-management command、query、view、page 和 result。Gateway `*Record`、Gateway Request/Query/Result、write options 和 `LongTermMemoryGatewayBindings` MUST NOT 成为 management method 的参数或返回类型，也 MUST NOT 直接进入 Web response。现有 Web response 所需的 `tenantId`、`userId` 和 `agentId` SHALL 由 Channel 从本次调用的可信 management scope 投影，其中 `userId` 映射自 `subjectId`。

#### Scenario: Application Service 返回 Management View

- **WHEN** `agent-memory` application service 从 Gateway 读取 Record 或 query projection
- **THEN** service MUST 将结果映射为 `agent-contracts/channel` owning 的 management view、page 或 result
- **AND** Channel MUST 只消费 management view、page 或 result，再投影 public Web DTO

#### Scenario: Architecture Verification 阻止 Gateway 类型泄漏

- **WHEN** architecture verification 检查 management port signature 和 `agent-channel-web` 记忆 route dependency
- **THEN** 任何 Gateway Record、Request、Query、Result、write options、port 或 bindings 泄漏 MUST 使验证失败
- **AND** `agent-contracts/channel` MUST NOT import `agent-contracts/gateway`

### Requirement: Management 调用使用可信 Scope 和取消上下文

每个长期记忆 management command/query SHALL 携带由完整 `IdentityContext` 和独立 `agentId` 组成的可信 `LongTermMemoryManagementScope`。`IdentityContext` SHALL 原样来自 channel/auth boundary，`agentId` SHALL 来自 trusted hosted-Agent selection 或 app composition。`agent-memory` SHALL 只把 `identityContext.tenantId`、`identityContext.subjectId` 和 `agentId` 映射到 Gateway scope；`displayName` MUST NOT 进入 Gateway 请求、记忆响应或诊断。所有 12 个 management methods SHALL 接收可选 `AbortSignal`；application service SHALL 在调用 Gateway 前检查取消状态。客户端 query/body、模型输出、Capability 参数或 metadata MUST NOT 覆盖 Owner Scope 或 Agent Scope。

#### Scenario: Channel 注入可信 Scope

- **WHEN** 已认证的长期记忆 HTTP 请求进入 Channel
- **THEN** Channel MUST 从 trusted identity resolver 获取完整 `IdentityContext` 并作为 `identityContext` 传给 management port
- **AND** Channel MUST 从 trusted Agent resolver/composition 获取 `agentId`
- **AND** request body/query 中的 `tenantId`、`subjectId`、`userId` 或 `agentId` MUST 导致 schema validation failure 或请求拒绝，且 management port MUST NOT 被调用

#### Scenario: Application service 收敛 Gateway owner scope

- **WHEN** management command 携带包含 `tenantId`、`subjectId` 和 `displayName` 的可信 `IdentityContext`
- **THEN** application service MUST 把 `tenantId`、`subjectId` 和独立 `agentId` 映射到 Gateway request
- **AND** Gateway request、management result 和 REST response MUST NOT 包含 `displayName`

#### Scenario: 客户端断开传播取消

- **WHEN** 客户端在长期记忆 management operation 完成前断开连接
- **THEN** Channel MUST abort 传给 `LongTermMemoryManagementPort` 的 signal
- **AND** application service MUST 在 Gateway 调用开始前观察该 signal，并在已取消时不调用 Gateway
- **AND** Gateway 调用开始后 application service MUST NOT 承诺当前 Gateway contract 未定义的中途取消
- **AND** local atomic persistence transaction MUST preserve transaction consistency rather than promise mid-transaction abort

### Requirement: Application Service 统一委托和安全错误

`agent-memory` SHALL 提供 `LongTermMemoryManagementPort` 的产品实现，并在内部组合 selected Store、Retriever 和 Sharing Gateway ports。Application service MUST 保持 Gateway 的 scope、CAS、幂等、物理删除、检索 telemetry 和 sharing transaction 语义。Gateway 返回的 `SafeError` SHALL 保持 presentation-safe；raw adapter/provider/storage error MUST NOT 穿透 management port。

#### Scenario: Operation 委托到唯一 Gateway Owner

- **WHEN** management port 收到合法 operation
- **THEN** `agent-memory` MUST 将其映射到且只映射到一个对应 Store、Retriever 或 Sharing Gateway method
- **AND** Gateway operation MUST NOT 被 Channel、`agent-app` 和 application service 重复调用

#### Scenario: SafeError 不泄漏原始错误

- **WHEN** Gateway operation 返回 `SafeError` 或 adapter 抛出内部错误
- **THEN** management port MUST 返回 presentation-safe `SafeError`
- **AND** 返回结果、日志、metric、trace 和 audit MUST NOT 包含 raw provider/storage error、credential、token、路径或 memory content

### Requirement: Management Boundary 由 Composition 显式启用

`agent-app` SHALL 是构造和注入 `LongTermMemoryManagementPort` 的唯一 composition owner。`agent-app` SHALL 只选择 Gateway bindings、调用 `agent-memory` public factory并传递返回 port；MUST NOT 承担 management DTO mapping、Record projection、记忆业务校验或 route delegation。只有 selected Gateway bindings 可用且 application service 构造成功时，Web Channel 才 SHALL 接收 management port。

#### Scenario: 可用依赖启用记忆 Routes

- **WHEN** app composition 已获得 selected Store、Retriever 和 Sharing Gateway bindings
- **THEN** app MUST 调用 `agent-memory` factory 构造一个 `LongTermMemoryManagementPort`
- **AND** app MUST 只把该 port 注入 Web Channel
- **AND** 12 个长期记忆 routes MUST 委托该 port

#### Scenario: 缺少依赖不产生半可用直连

- **WHEN** selected Gateway bindings 缺失、歧义或不可用
- **THEN** app MUST NOT 向 Channel 注入 management port
- **AND** Channel MUST NOT 回退为直接调用 Gateway、disabled adapter 或 process-local mock
