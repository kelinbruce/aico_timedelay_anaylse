# long-term-memory-management-contract Specification

## Purpose
定义长期记忆管理的唯一 Channel 端口、请求边界和可观察管理结果，避免 Web 或其他调用方绕过可信通道直接操作长期记忆事实。
## Requirements
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
