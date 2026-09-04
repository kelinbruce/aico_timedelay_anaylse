# sandbox-deny-by-default-adapter Specification

## Purpose
Defines the fail-closed safety net for dynamic execution: when no real sandbox adapter (restricted local, remote) is available, the system assembles a deny-by-default adapter that rejects all execution requests with standardized `SandboxExecutionResult` without any host-side execution.

## Requirements

### Requirement: Dynamic execution always enters the sandbox gateway boundary

系统 SHALL 要求所有 shell、python、脚本和模型生成代码的动态执行请求先形成 `SandboxExecutionRequest` 并通过 `SandboxGatewayPort` 提交。调用方 MUST NOT 在 deny-by-default / unavailable 路径上直接调用宿主 shell、Python runtime、child process、文件系统或环境变量。

#### Scenario: A dynamic command still enters the gateway when execution is disabled
- **WHEN** 某个 capability、hook、policy 或 script 调用点请求执行 shell 或 python
- **THEN** 该请求先形成 `SandboxExecutionRequest`
- **AND** 通过 `SandboxGatewayPort` 提交
- **AND** 不会因为当前是 deny-by-default 路径而绕过 gateway

### Requirement: The app composes a deny-by-default or unavailable adapter when real sandbox capability is absent

当 local 运行态的 restricted local sandbox 被禁用、未配置、不可用或平台不受支持，或远端 sandbox gateway 未启用、未配置或不可用，或配置明确禁用动态执行时，`agent-app` SHALL 装配 deny-by-default / unavailable sandbox adapter 作为当前运行态的唯一合法兜底值。Local 运行态 MAY 使用 restricted local sandbox 作为默认 `SandboxGatewayPort` 实现；该默认实现可用时不属于 deny-by-default 路径。

#### Scenario: Missing real sandbox configuration selects the deny-by-default adapter
- **WHEN** 应用启动且未发现可用的 restricted local sandbox、remote sandbox 或其他明确可执行 sandbox adapter
- **THEN** `agent-app` 装配 deny-by-default / unavailable adapter
- **AND** 动态执行路径不会进入宿主直接执行

### Requirement: Deny-by-default adapter returns a standardized sandbox result without host-side execution

deny-by-default / unavailable adapter MUST 返回标准化 `SandboxExecutionResult`，并满足：

- `executionId` 与请求一致；
- 不产生真实宿主执行；
- 通过 `safeError` 或等价安全结果表达 deny / unavailable 原因；
- 不伪造命令成功的 `exitCode`、`stdout` 或 `stderr`；
- `durationMs` 只表示拒绝/不可用处理耗时。

#### Scenario: Denied execution returns a safe result instead of running the command
- **WHEN** deny-by-default adapter 收到一条动态执行请求
- **THEN** 返回标准化 `SandboxExecutionResult`
- **AND** 结果包含安全拒绝或不可用信息
- **AND** 不启动真实 shell、python 或脚本执行

### Requirement: Deny and unavailable reasons are deterministic and machine-readable

deny-by-default / unavailable adapter SHALL 只基于当前请求与已装配运行态给出稳定原因分类。首版至少覆盖：

- disabled
- unconfigured
- unsupported-platform
- remote-unavailable
- prerequisite-missing

#### Scenario: Unsupported platform yields a stable deny reason
- **WHEN** 当前平台不在首版支持范围内
- **THEN** adapter 返回 `unsupported-platform` 或等价稳定 reason
- **AND** 不暴露宿主环境探测细节

### Requirement: Failure and degradation remain fail-closed and non-bypassable

当 deny-by-default adapter 自身异常、safe error 生成失败、配置缺失、远端 gateway 不可达或上游取消发生时，系统 MUST fail closed。系统 MUST NOT 静默丢弃，也 MUST NOT 回落到宿主直接执行。

#### Scenario: Adapter exception does not trigger host fallback
- **WHEN** deny-by-default adapter 在处理请求时抛出异常
- **THEN** 系统返回安全失败结果并留下 degradation 证据
- **AND** 不尝试直接在宿主执行该命令

#### Scenario: Remote sandbox unavailability does not pretend success
- **WHEN** 当前运行态期望远端 sandbox gateway 但该依赖不可达
- **THEN** 系统返回 unavailable 安全结果
- **AND** 不静默跳过本次动态执行
- **AND** 不假装命令已经成功执行

### Requirement: Deny-by-default results remain consumable by downstream governance and observability

每次 deny/unavailable 结果 SHALL 保持 machine-readable、可追溯和 owner-safe，使 capability、policy、audit、logging、metrics、health/readiness 和 release gate 能消费该结果，而不需要访问 raw 宿主细节。

#### Scenario: Downstream consumers can diagnose denial without raw host details
- **WHEN** 上游 capability 或治理链路收到 deny-by-default 结果
- **THEN** 它们可以使用 `executionId`、`requestRunId`、owner scope、`executable` 和稳定 deny reason 进行关联
- **AND** 不需要读取宿主路径、环境变量值或凭据
