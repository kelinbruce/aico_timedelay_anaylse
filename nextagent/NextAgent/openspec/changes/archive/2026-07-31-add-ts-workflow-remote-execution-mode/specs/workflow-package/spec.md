## MODIFIED Requirements

### Requirement: Composition Wiring

`agent-app` 启动时 MUST 创建并注入 `WorkflowExecutionService`。`agent-app` MUST 按 `WorkflowExecutionMode` 选择 local 或 remote `WorkflowExecutionService` 实现，默认 `"local"`。当模式为 `"remote"` 时，`agent-app` MUST 注入 `WorkflowRemoteExecutionGateway` 依赖并构造 remote 实现；当依赖缺失时启动 MUST 失败。

#### Scenario: Successful Composition
- **WHEN** 所有依赖可用
- **THEN** workflow service MUST 被成功创建并注入

#### Scenario: Wiring Failure
- **WHEN** factory 或 wiring 失败
- **THEN** 启动 MUST 失败

#### Scenario: Local Mode Default Composition
- **WHEN** 启动配置未指定 `WorkflowExecutionMode`
- **THEN** `agent-app` MUST 构造 local `WorkflowExecutionService` 实现
- **AND** 注入到 `agent-core` 的服务 MUST 满足 `WorkflowExecutionService` 端口契约

#### Scenario: Remote Mode Composition
- **WHEN** 启动配置指定 `WorkflowExecutionMode` 为 `"remote"` 且 `WorkflowRemoteExecutionGateway` 依赖可用
- **THEN** `agent-app` MUST 构造 remote `WorkflowExecutionService` 实现
- **AND** 注入到 `agent-core` 的服务 MUST 满足同一 `WorkflowExecutionService` 端口契约

#### Scenario: Remote Mode Without Gateway
- **WHEN** 启动配置指定 `"remote"` 但 `WorkflowRemoteExecutionGateway` 依赖缺失
- **THEN** 启动 MUST 失败

#### Scenario: Remote Workflow-Execution Without Endpoint (UDS Mode)
- **WHEN** a gateway selection entry has adapterKind `workflow-execution` with `deploymentMode` `"REMOTE"` and no `endpoint`, and a `WorkflowRemoteExecutionGateway` dependency is injected
- **THEN** `agent-app` MUST construct the remote `WorkflowExecutionService` using the injected gateway
- **AND** config validation MUST NOT block startup for the missing endpoint

#### Scenario: Remote Workflow-Execution Without Endpoint And Without Gateway
- **WHEN** a gateway selection entry has adapterKind `workflow-execution` with `deploymentMode` `"REMOTE"` and no `endpoint`, and no `WorkflowRemoteExecutionGateway` dependency is injected
- **THEN** startup MUST fail

#### Scenario: Custom Factory Overrides Mode Selection
- **WHEN** 启动配置同时提供了 `workflowExecutionServiceFactory` 和 `workflowExecutionMode`
- **THEN** `agent-app` MUST 使用 `workflowExecutionServiceFactory` 构造的实例
- **AND** MUST NOT 按 `workflowExecutionMode` 选择默认实现
