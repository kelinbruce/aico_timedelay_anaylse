# builtin-tool-framework Specification Delta

## Function

- **所属 Function**：`FN-5.1 管理能力目录`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Tool dependencies are optional and controlled

The Tool framework SHALL define optional controlled Tool dependencies. The supported dependency names SHALL include `sandbox`, `workspaceFiles`, `skillSources`, and `approval`. Tools MAY declare required dependency names in metadata. The catalog SHALL verify required dependencies before a Tool becomes executable. `todoState` MUST NOT be a supported dependency name；TodoWrite 不再声明 required dependency。

Tool implementations MUST NOT receive workspace root, host absolute paths, sandbox internals, gateway-local private implementations, host process APIs, runtime-private state objects, channel-private state objects, or model-supplied scope identity through Tool input or `CapabilityInvocationRequest`.

The Tool-facing sandbox dependency SHALL expose narrow `runShell` and `runPython` operations. The Tool-facing `workspaceFiles` dependency SHALL expose governed read, write, glob, and run cleanup operations. The Tool-facing `skillSources` dependency SHALL expose governed Skill resource access. The reserved `approval` dependency SHALL provide readiness evidence only when a complete runtime-owned approval integration is present.

Tool metadata SHALL NOT be used as the owner of capability-specific observability projection semantics. Tool metadata MAY expose model-facing descriptor facts, schema, dependency requirements, replay policy, and disclosure policy. Low-cardinality diagnostics for built-in Tools SHALL be derived by runtime, gateway, or observability owners from safe result shapes and trusted execution facts.

**需求类别**：功能性需求

#### Scenario: Required dependency must be available

- **WHEN** Tool metadata declares a required dependency
- **AND** the capability subsystem does not provide that dependency
- **THEN** that Tool MUST NOT become executable
- **AND** the catalog MUST expose an unavailable descriptor with a safe availability reason.

#### Scenario: Workspace root is not exposed to Tool

- **WHEN** a Tool needs workspace file access
- **THEN** it MUST use the controlled `workspaceFiles` dependency
- **AND** it MUST NOT receive or derive workspace root from request arguments, client metadata, model output, or capability invocation payload.

#### Scenario: Sandbox dependency is interface-only in the framework

- **WHEN** this framework exposes the `sandbox` dependency
- **THEN** it exposes only the Tool-facing `runShell` and `runPython` interface
- **AND** it does not implement sandbox execution
- **AND** it does not require `agent-capability` to import the gateway contract.

#### Scenario: Tool metadata does not own observability projection

- **WHEN** a built-in Tool needs low-cardinality diagnostics
- **THEN** runtime, gateway, or observability owners MUST derive those diagnostics from safe result shapes and trusted execution facts
- **AND** Tool metadata MUST NOT define a Tool-specific observability projector.

#### Scenario: TodoWrite uses scoped todo state dependency

- **WHEN** the `TodoWrite` Tool needs to read or replace a todo list
- **THEN** it MUST use checkpoint-backed `flowVariables.todoWriteState` through the controlled execution context
- **AND** it MUST pass trusted `ToolExecutionContext` facts to that dependency
- **AND** it MUST NOT receive todo scope, session id, agent id, owner id, runtime lifecycle object, channel projection object, or persistence implementation from model input.

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：移除 `todoState` 受控 Tool dependency，TodoWrite 不再声明 required dependency。
- **依据 Requirements**：`Tool dependencies are optional and controlled`

### 规格

- **规格项**：Tool dependency 名单
- **变更类型**：修改
- **原规格值**：`sandbox`、`workspaceFiles`、`skillSources`、`approval`、`todoState`
- **目标规格值**：`sandbox`、`workspaceFiles`、`skillSources`、`approval`（移除 `todoState`）
- **依据 Requirements**：`Tool dependencies are optional and controlled`

### 接口

- **变更类型**：修改
- **目标内容**：移除 `todoState` 从 `ToolDependencyName`/`ToolDependencies`；TodoWrite descriptor 移除 `requiredDependencies: ['todoState']`。
- **依据 Requirements**：`Tool dependencies are optional and controlled`
