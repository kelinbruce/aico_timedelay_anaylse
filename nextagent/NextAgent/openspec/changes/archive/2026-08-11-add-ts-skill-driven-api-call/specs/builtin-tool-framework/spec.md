## MODIFIED Requirements

### Requirement: ApiCallPort Tool 依赖

Tool framework SHALL 将 `apiCallPort` 识别为一个受控的 Tool 依赖名。`ToolDependencyName` 类型 MUST 包含 `"apiCallPort"`。`ToolDependencies` 接口 MUST 包含一个可选的 `apiCallPort?: ApiCallPort` 字段。`ApiCallPort` 接口 MUST 由 `agent-capability` 拥有，并 MUST 暴露 API 调用操作而不耦合 HTTP 实现细节。生产实现 MUST 由 `agent-platform-gateway-remote` 提供并通过 `agent-app` 组合注入。

#### Scenario: 缺少依赖时需要 apiCallPort 的 Tool 不可用

- **WHEN** 某 Tool 在 `requiredDependencies` 中声明 `apiCallPort`
- **AND** capability 子系统没有提供 `apiCallPort` 依赖
- **THEN** 该 Tool MUST NOT 变为可执行
- **AND** catalog MUST 以一个安全的可用性原因暴露不可用的 descriptor

#### Scenario: ApiCallPort 在 framework 中只是接口

- **WHEN** 该 framework 暴露 `apiCallPort` 依赖
- **THEN** 它只暴露面向 Tool 的 API 调用接口
- **AND** 它不实现 HTTP 执行
- **AND** 它不要求 `agent-capability` 导入 gateway contract

### Requirement: ParameterExtraction Tool 依赖

Tool framework SHALL 将 `parameterExtraction` 识别为一个受控的 Tool 依赖名。`ToolDependencyName` 类型 MUST 包含 `"parameterExtraction"`。`ToolDependencies` 接口 MUST 包含一个可选的 `parameterExtraction?: ParameterExtractionPort` 字段。`ParameterExtractionPort` 接口 MUST 由 `agent-contracts/capability` 拥有，并 MUST 暴露一个执行单次 model `complete()` 调用的 `extractParams(input, signal)` 操作。生产实现 MUST 位于 `agent-runtime` 中，包装 `ModelInvocationService`，并遵循与 `SubagentExecutionPort` 相同的模式通过 `agent-app` 组合注入。

#### Scenario: 缺少依赖时需要 parameterExtraction 的 Tool 不可用

- **WHEN** 某 Tool 在 `requiredDependencies` 中声明 `parameterExtraction`
- **AND** capability 子系统没有提供 `parameterExtraction` 依赖
- **THEN** 该 Tool MUST NOT 变为可执行
- **AND** catalog MUST 以一个安全的可用性原因暴露不可用的 descriptor

#### Scenario: ParameterExtractionPort 在 framework 中只是接口

- **WHEN** 该 framework 暴露 `parameterExtraction` 依赖
- **THEN** 它只暴露面向 Tool 的参数提取接口
- **AND** 它不直接实现 model 调用
- **AND** 它不要求 `agent-capability` 导入 `ModelInvocationService`
