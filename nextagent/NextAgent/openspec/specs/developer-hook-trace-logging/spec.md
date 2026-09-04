# developer-hook-trace-logging Specification

## Purpose

Define the SDK-owned developer hook trace plugin, NDJSON formatter, caller-owned sink, loader-compatible artifact and package-scoped default activation behavior for backend-capable local release packages.
## Requirements
### Requirement: SDK provides developer hook trace plugin definition

`agent-plugin-sdk` SHALL provide a `developer-hook-trace` plugin definition that can be constructed without changing other packages. The plugin SHALL contribute an observe-only lifecycle hook named `developer-hook-trace.loop-raw-boundary`.

The hook SHALL support only `BEFORE_PLANNING`, `BEFORE_MODEL_INVOKE`, `AFTER_MODEL_RESULT`, `BEFORE_CAPABILITY_INVOKE`, `AFTER_CAPABILITY_RESULT`, and `BEFORE_AGENT_TERMINAL`. The hook SHALL NOT return mutation and SHALL use `failureMode: CONTINUE`.

#### Scenario: Developer hook trace plugin exposes the expected hook
- **WHEN** SDK code creates the developer hook trace plugin
- **THEN** the plugin id MUST be `developer-hook-trace`
- **AND** the plugin MUST expose hook `developer-hook-trace.loop-raw-boundary`
- **AND** the hook MUST be observe-only and support the six loop boundary stages

### Requirement: SDK developer hook trace logging is observe-only

The SDK hook SHALL not change request truth. If plugin options disable logging, the hook SHALL return `PASS` without calling the sink. If the sink throws, the hook SHALL catch the error and return `PASS`.

#### Scenario: Disabled or failing sink does not affect hook outcome
- **WHEN** logging is disabled
- **THEN** the hook MUST return `PASS` without writing an entry
- **WHEN** the caller-provided sink throws
- **THEN** the hook MUST still return `PASS`

### Requirement: Local runtime packaging includes developer hook trace artifact with local release default activation

Local runtime packaging SHALL include the generated `developer-hook-trace` plugin artifact under `config/plugins/developer-hook-trace/`.

For backend-capable local `pack:release` candidates, packaging SHALL declare `developer-hook-trace` in the packaged `config/default-system.yaml` sample using `nextAgent.system.plugins[]` with `path: "plugins/developer-hook-trace"` and `required: true`. Packaging SHALL also activate `developer-hook-trace.loop-raw-boundary` in the packaged `agents/default-agent/agent.yaml` for the supported raw loop boundary stages.

This default activation is package-staging scoped. Packaging MUST NOT modify the repository built-in default Agent source definition, MUST NOT change non-packaged development startup defaults, and MUST NOT enable `context-monitor` by default.

#### Scenario: Packaged backend-capable runtime contains developer hook trace default configuration
- **WHEN** local `pack:release` stages a backend-capable package
- **THEN** the candidate MUST contain `config/plugins/developer-hook-trace/plugin.json`
- **AND** the candidate MUST contain `config/plugins/developer-hook-trace/index.js`
- **AND** the packaged `config/default-system.yaml` MUST declare `nextAgent.system.plugins[]` entry `{ pluginId: "developer-hook-trace", path: "plugins/developer-hook-trace", required: true }`
- **AND** the packaged `agents/default-agent/agent.yaml` MUST activate `developer-hook-trace.loop-raw-boundary`
- **AND** packaging MUST NOT modify the source `packages/agent-core/src/builtin-agents/default-agent/agent.yaml`.

### Requirement: Developer hook trace 使用既有执行坐标关联内部失败诊断

显式启用的 `developer-hook-trace` entry MUST 保留对应 hook boundary 已提供的 `agentId`、`agentVersion`、`sessionId`、`requestId`、`runId`、`hookInvocationId`、`stepId`、`modelProfileId`、`toolCallId`、`capabilityId` 和 `capabilityInvocationId`。字段不存在时 formatter MUST 省略该字段，不得从默认 Agent、全局配置、raw payload 或相邻 entry 推断。

Model boundary entry 与 `model.provider.failure_captured` MUST 能通过 `agentId`、`sessionId`、`requestId`、`runId` 和 model step/hook stage 坐标关联。Capability boundary entry 与 `capability.execution.exception_captured` MUST 能通过 `agentId`、`sessionId`、`requestId`、`runId`、`toolCallId` 和 `capabilityId` 关联。

现有 hook stage 与触发时机 MUST 保持不变：BEFORE entry 保存实际进入 owner 的 raw input；只有主流程已经产生相应 AFTER boundary 时才保存 raw result。Model SafeError、Capability `FAILED/TIMED_OUT` 或 thrown exception 没有 AFTER boundary 时，系统 MUST NOT 为 developer trace 补造 entry、补造 raw output 或额外调用 lifecycle hook。失败诊断 MUST 使用已存在的 BEFORE entry、owner diagnostic 和 canonical safe failure。

本 requirement 不允许 developer hook trace entry 进入 operational writer，也不允许 runtime exception diagnostic 复制 raw model request/result 或 raw Capability arguments/result。

#### Scenario: Model raw boundary 与 provider failure 可关联

- **WHEN**显式启用的 developer hook trace 写入 `BEFORE_MODEL_INVOKE`
- **AND**同一 model invocation 随后产生 `model.provider.failure_captured`
- **THEN**两个 artifact MUST 共享同一可信 run 坐标
- **AND**排障人员无需按 raw prompt、模型输出或异常 message 做关联

#### Scenario: Capability raw boundary 与执行失败可关联

- **WHEN**显式启用的 developer hook trace 写入 `BEFORE_CAPABILITY_INVOKE`
- **AND**同一调用随后产生 `capability.execution.exception_captured`
- **THEN**两个 artifact MUST 共享同一可信 run、toolCall 和 capability 坐标

#### Scenario: 可选坐标缺失时不伪造

- **WHEN**一个受支持 hook boundary 不包含 toolCall 或 capability invocation 坐标
- **THEN** formatter MUST 省略缺失字段
- **AND** entry MUST 仍保留 boundary 提供的其它可信坐标

#### Scenario: Model 失败没有 AFTER boundary

- **WHEN** `BEFORE_MODEL_INVOKE` 已写入且 model owner 随后返回 SafeError 或抛出异常
- **THEN** developer trace MUST 保留 BEFORE raw request 和 step 坐标
- **AND** MUST 通过这些坐标关联 owner diagnostic 与 canonical safe failure
- **AND** MUST NOT 补造 `AFTER_MODEL_RESULT` 或不存在的 raw result

#### Scenario: Capability 失败没有 AFTER boundary

- **WHEN** `BEFORE_CAPABILITY_INVOKE` 已写入且 Capability 随后返回 `FAILED/TIMED_OUT` 或抛出异常
- **THEN** developer trace MUST 保留 BEFORE raw arguments、toolCall 和 capability 坐标
- **AND** MUST 通过这些坐标关联 owner diagnostic或安全 failure result
- **AND** MUST NOT 补造 `AFTER_CAPABILITY_RESULT` 或复制 rejected output
