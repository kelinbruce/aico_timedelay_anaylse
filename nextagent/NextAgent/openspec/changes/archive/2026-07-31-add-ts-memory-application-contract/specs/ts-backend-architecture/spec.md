## MODIFIED Requirements

### Requirement: [TS] Memory Lifecycle 边界

TS 后端 MUST（必须）通过 `agent-memory` 承载长期记忆、自学习、记忆生命周期、长期记忆检索和面向 Channel 的长期记忆 application service。`agent-contracts/channel` SHALL 定义 Channel-facing `LongTermMemoryManagementPort`；`agent-contracts/gateway` SHALL 继续定义 persistence/remote service ports。Context Engine 或 Channel 不得直接实现长期记忆抽取、promotion、decay、curation、dreaming、sharing transaction 或 memory storage behavior；`agent-app` 只负责 composition/wiring。

设计入口：`openspec/designs/spec-to-design-map.md`

#### Scenario: Context Engine 只消费可披露记忆

- **WHEN** 后续 memory change 使 `agent-context-engine` 需要把长期记忆纳入模型输入
- **THEN** 它通过 `agent-memory` public boundary 获取 owner-scoped 长期记忆检索结果
- **AND** context assembly 仍负责 window budget、language/locale、query policy 和 disclosure control
- **AND** `agent-context-engine` 不直接导入 memory implementation private paths 或长期记忆 Gateway ports

#### Scenario: Web Channel 只消费 Channel Management Port

- **WHEN** `agent-channel-web` 接收长期记忆管理请求
- **THEN** 它 MUST 通过 `agent-contracts/channel` 的 `LongTermMemoryManagementPort` 委托业务操作
- **AND** Channel MUST NOT import、receive or invoke `LongTermMemoryGatewayBindings`、Store/Retriever/Sharing Gateway ports or Gateway Records
- **AND** Channel 只负责 transport schema、trusted identity/Agent Scope 注入、cancellation、safe error/status 和 public DTO projection
- **AND** `agent-memory` application service MUST implement the management port and delegate to Gateway ports
- **AND** `agent-app` MUST only compose and wire the service

#### Scenario: Memory lifecycle 不阻塞 terminal commit

- **WHEN** 交互、执行结果或后台任务触发自学习、知识抽取、promotion、decay、curation 或 dreaming
- **THEN** 这些行为属于 `agent-memory` lifecycle boundary
- **AND** 失败不得破坏 request terminal durable-write boundary
- **AND** 写入 memory gateway 时必须携带 owner scope 和 audit refs 的接入位置

#### Scenario: Memory provider 实现不泄漏

- **WHEN** 本地运行或 PaaS 部署选择不同 memory store、retrieval provider 或 learning implementation
- **THEN** provider details 保持在 `agent-memory` 或 platform gateway adapter 内部
- **AND** context、runtime、channel 和 core 不依赖具体 store driver、index SDK、Gateway Record 或 extraction algorithm type
- **AND** contracts 只通过 `agent-contracts/channel` 暴露 management contract、通过 `agent-contracts/gateway` 暴露 persistence/remote contract，不暴露 provider implementation

### Requirement: [TS] Package 边界强制

TS 后端 MUST（必须）用 TypeScript project references、package `exports` 和 automated dependency graph checks 强制 package 边界。Architecture verification 必须拒绝 upward dependencies、contract-to-implementation dependencies、framework leakage into `agent-contracts`、cross-package private imports，以及 Channel 绕过 owning application port 直连长期记忆 Gateway。

设计入口：`openspec/designs/spec-to-design-map.md`

#### Scenario: Contract package 不能导入实现

- **WHEN** `agent-contracts` 导入 runtime、channel、app、memory implementation、local gateway、remote gateway、model implementation、capability implementation、PaaS sandbox SDK、Fastify、SQLite、Kysely、OpenTelemetry SDK 或 provider SDK packages
- **THEN** architecture verification command 失败

#### Scenario: Private imports 被阻止

- **WHEN** 一个 package 通过 `../other-package/src/*` 或任何非 exported path 导入另一个 package
- **THEN** architecture verification command 失败

#### Scenario: Channel 直连长期记忆 Gateway 被阻止

- **WHEN** `agent-channel-web` source 或 package dependency 导入 `agent-contracts/gateway` 的长期记忆 Record、Request、Query、write options、Store/Retriever/Sharing port 或 `LongTermMemoryGatewayBindings`
- **THEN** architecture verification command 失败
- **AND** Channel MUST consume only `agent-contracts/channel.LongTermMemoryManagementPort` for long-term memory management operations

#### Scenario: Memory Application Service 使用受控 Channel Contract 依赖

- **WHEN** `agent-memory` 实现长期记忆 management application service
- **THEN** it MAY import `LongTermMemoryManagementPort` and related management DTOs from `agent-contracts/channel`
- **AND** it MAY import Store、Retriever and Sharing ports from `agent-contracts/gateway`
- **AND** it MUST NOT import `agent-channel-web` implementation or app composition private paths
