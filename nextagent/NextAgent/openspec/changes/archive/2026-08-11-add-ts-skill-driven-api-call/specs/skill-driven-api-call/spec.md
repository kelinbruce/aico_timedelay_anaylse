## ADDED Requirements

### Requirement: 非 agentic Skill 检测与分发

系统 SHALL 为 metadata 扩展 `_naie_agentic_loop_flag` 设置为 `"false"` 的 Skill 支持一条非 agentic 执行路径。当该 flag 为 `"false"` 时，`Skill` 工具 MUST 仍然加载 skill body 以从 ` ```api ` markdown 代码块解析 api 命令，但 MUST NOT 把 body 注入 model context，也 MUST NOT 执行资源投影。它 MUST 返回一个包含 skill 身份、解析出的 api 命令信息、`apiHeaderParams`、`apiRequestParams` 以及 metadata 中一个 `nonAgenticApiCall` 信号的结果。当该 flag 为 `"true"` 或缺失时，既有的 inline body 注入路径 MUST 保持完全不变。

#### Scenario: Flag 为 false 时加载 body 解析 api 命令但不注入

- **WHEN** 模型以有效的 skill 名调用 `Skill`
- **AND** 解析出的 skill metadata 扩展 `_naie_agentic_loop_flag` 等于 `"false"`
- **THEN** `Skill` 工具 MUST 通过 `loadCanonicalBodyView` 加载 skill body
- **AND** MUST 解析 ` ```api ` 代码块以提取 api name 和 hiro 值
- **AND** MUST NOT 把 body 注入 `generatedMessages`
- **AND** MUST NOT 调用 `projectSkillResources`
- **AND** MUST 返回 `status=SUCCEEDED` 的 `CapabilityInvocationResult`
- **AND** `structuredPayload` MUST 包含 skill 名、解析出的 api 命令、`apiHeaderParams` 值、`apiRequestParams` 值
- **AND** `metadata` MUST 包含 `nonAgenticApiCall: true`
- **AND** `generatedMessages` MUST 为空

#### Scenario: Flag 为 true 或缺失时保持既有行为

- **WHEN** 模型以有效的 skill 名调用 `Skill`
- **AND** 解析出的 skill metadata 扩展 `_naie_agentic_loop_flag` 为 `"true"` 或缺失
- **THEN** `Skill` 工具 MUST 遵循既有的 inline body 注入路径
- **AND** 行为 MUST 与当前实现完全一致

#### Scenario: Api 命令解析失败返回安全错误

- **WHEN** flag 为 `"false"` 且 skill body 不包含 ` ```api ` 代码块，或命令缺少 `-name`
- **THEN** `Skill` 工具 MUST 返回 `status=FAILED` 的 `CapabilityInvocationResult`
- **AND** `safeError.code` MUST 为 `API_COMMAND_PARSE_FAILED`
- **AND** 该错误 MUST NOT 暴露 raw body 内容

### Requirement: API Tool 是独立的非 model 可见 Tool 能力

系统 SHALL 使用 `defineTool` 将一个 `ApiCall` 工具注册为独立的 Tool 能力。该工具 MUST NOT 对 model 可见（`modelInvocable=false`、`disclosurePolicy=HIDDEN`）。它 MUST 只在检测到 `nonAgenticApiCall` 信号时由编排层通过 `capabilityInvocation.invoke()` 调用。该工具 MUST 依赖 `skillSources`、`apiCallPort` 和 `parameterExtraction` 依赖。

#### Scenario: API tool 已注册但对 model 不可见

- **WHEN** capability catalog 被组装
- **THEN** `ApiCall` 工具 descriptor MUST 以 `modelInvocable=false` 注册
- **AND** `disclosurePolicy` MUST 为 `HIDDEN`
- **AND** 该工具 MUST NOT 出现在 model 可见的 tool disclosure 中

#### Scenario: API tool 需要依赖

- **WHEN** `ApiCall` 工具被组合
- **THEN** `requiredDependencies` MUST 包含 `skillSources`、`apiCallPort` 和 `parameterExtraction`
- **AND** 如果任一依赖不可用，该工具 MUST 为 `UNAVAILABLE`

### Requirement: 编排层调用 API Tool 并返回终态响应

编排层（`agent-core` 路由）SHALL 从 `Skill` 工具结果检测 `nonAgenticApiCall` 信号。检测到时，它 MUST 从当前请求 header 提取 header 参数，从可信 context 获取 request 参数，构造可信的 API tool 输入，通过 `capabilityInvocation.invoke()` 调用 API tool，并把 API tool 结果作为终态响应使用而不继续 model loop。编排层 MUST NOT 执行 model 参数提取；那是 API tool 的职责。

#### Scenario: 编排层检测到非 agentic 信号并调用 API tool

- **WHEN** `Skill` 工具返回一个 metadata 中带有 `nonAgenticApiCall: true` 的结果
- **THEN** 编排层 MUST 从该结果提取 api name、hiro 值、skill 身份、`apiHeaderParams` 和 `apiRequestParams`
- **AND** MUST 使用 `apiHeaderParams` 声明的名字从当前请求 header 提取 header 参数
- **AND** MUST 使用 `apiRequestParams` 声明的名字从可信 context 获取 request 参数
- **AND** MUST 从 `RequestContext.acceptedInputText` 获取原始用户问题
- **AND** MUST 以可信输入通过 `capabilityInvocation.invoke()` 调用 `ApiCall` 工具
- **AND** MUST NOT 在 API tool 返回后继续 model loop

#### Scenario: API tool 结果成为终态响应

- **WHEN** API tool 返回一个成功的 `CapabilityInvocationResult`
- **THEN** 编排层 MUST 把 `structuredPayload` 写入终态 assistant 消息
- **AND** MUST 跳过后续 model 调用
- **AND** run MUST 以 API 结果作为最终响应到达终态

#### Scenario: 非 agentic 批次冲突被拒绝

- **WHEN** 同一 tool 轮次包含一个 metadata 带有 `nonAgenticApiCall: true` 的 Skill 工具结果以及其他 tool 结果
- **THEN** 编排层 MUST 拒绝该批次
- **AND** MUST 返回 code 为 `NON_AGENTIC_BATCH_CONFLICT` 的安全错误

### Requirement: ParameterExtractionPort 为 API Tool 提供 model 参数提取

系统 SHALL 将 `ParameterExtractionPort` 定义为由 `agent-contracts/capability` 拥有的面向 Tool 的依赖接口。该 port MUST 暴露一个 `extractParams(input, signal)` 操作，通过 `RunBoundModelInvocation` 执行单次 model `complete()` 调用来做参数提取。生产实现 MUST 位于 `agent-runtime` 中，包装 `ModelInvocationService` 并从已接受的 agent assembly 解析 model profile。该 port MUST 通过 `agent-app` 组合注入，遵循与 `SubagentExecutionPort` 相同的模式。

#### Scenario: API tool 通过 ParameterExtractionPort 提取参数

- **WHEN** API tool 需要为 `api_request_params` 未覆盖的必需 API 参数提取参数
- **THEN** 它 MUST 以由 skill 内容、用户问题和 yaml 必需参数生成的 prompt 调用 `parameterExtractionPort.extractParams()`
- **AND** 该 port MUST 使用 `RunBoundModelInvocation` 产生 `MODEL_INVOCATION_STARTED` 和 `MODEL_INVOCATION_COMPLETED` timeline event
- **AND** MUST 使用单次 `complete()` 调用，不重试也不循环
- **AND** MUST 使用来自已接受 agent assembly 的 model profile

#### Scenario: ParameterExtractionPort 不可用

- **WHEN** 未提供 `parameterExtraction` 依赖
- **THEN** `ApiCall` 工具 MUST 为 `UNAVAILABLE`
- **AND** catalog MUST 以一个安全的可用性原因暴露不可用的 descriptor

#### Scenario: 参数提取超时返回安全错误

- **WHEN** model 参数提取超时
- **THEN** 该 port MUST 返回 code 为 `PARAMETER_EXTRACTION_TIMEOUT` 的安全错误
- **AND** MUST NOT 暴露 model 输出或 prompt 内容

#### Scenario: 参数提取结果解析失败返回安全错误

- **WHEN** model 返回一个无法解析为期望参数的结果
- **THEN** 该 port MUST 返回 code 为 `PARAMETER_EXTRACTION_FAILED` 的安全错误
- **AND** MUST NOT 暴露 model 输出或 prompt 内容

### Requirement: ApiCallPort 定义 HTTP API 调用边界

系统 SHALL 将 `ApiCallPort` 定义为由 `agent-capability` 拥有的面向 Tool 的依赖接口。该 port MUST 暴露 API 调用操作而不耦合 HTTP 实现细节。生产实现 MUST 是位于 `agent-platform-gateway-remote` 中的 `FetchApiCallGatewayAdapter`，通过 `agent-app` 组合注入。

#### Scenario: ApiCallPort 支持非流式调用

- **WHEN** API tool 以 endpoint、method、headers、body 和 signal 调用 `apiCallPort.callApi()`
- **THEN** 该 port MUST 返回响应的 status、headers 和 body
- **AND** MUST 接受 `AbortSignal` 用于 cancellation 和超时

#### Scenario: ApiCallPort 支持流式调用

- **WHEN** API tool 以相同输入调用 `apiCallPort.callApiStream()`
- **THEN** 该 port MUST 返回 SSE 数据块的 async iterable
- **AND** MUST 接受 `AbortSignal` 用于 cancellation 和超时

#### Scenario: Gateway 实现使用来自配置的 Bearer token

- **WHEN** `FetchApiCallGatewayAdapter` 发起 HTTP 调用
- **THEN** 它 MUST 注入来自已配置 `credentialRef` 的 Bearer token
- **AND** MUST NOT 接受来自 model 输入、skill body 或客户端请求体的 credential

### Requirement: Swagger 2.0 ApiDoc 解析

API tool SHALL 使用 `js-yaml` 和一个自定义提取函数解析 `api/<name>.yaml`（Swagger 2.0）。该 yaml 文件 MUST 通过 `skillSources.readSkillResource` 读取（复用既有的 `SkillSourceDiscovery` 接口而不做扩展）。解析出的 `ApiDoc` MUST 包含 `baseUrl`、`path`、`method`、`produces` 和 `parameters`。系统 MUST NOT 引入第三方 swagger 解析库。系统 MUST NOT 缓存已解析的 apiDoc（每个请求读取一次）。

#### Scenario: 有效的 swagger yaml 产生 apiDoc

- **WHEN** API tool 通过 `readSkillResource` 读取一个有效的 Swagger 2.0 yaml 文件
- **THEN** 它 MUST 产生一个包含 `baseUrl`（来自 schemes/host/basePath）、`path`、`method`、`produces` 和 `parameters` 的 `ApiDoc`
- **AND** 每个参数 MUST 具有 `name`、`location`、`required` 以及可选的 `type`/`description`

#### Scenario: Yaml 文件缺失或格式错误时安全失败

- **WHEN** `api/<name>.yaml` 文件不存在或无法解析
- **THEN** API tool MUST 返回一个安全的失败 `CapabilityInvocationResult`
- **AND** `safeError.code` MUST 为 `API_DOC_LOAD_FAILED`
- **AND** MUST NOT 在 safe error 中暴露 raw 文件内容或文件路径

### Requirement: 流式与非流式响应处理

API tool SHALL 基于 `apiDoc.produces` 决定流式或非流式行为。当 `produces` 为 `text/event-stream` 时，API tool MUST 通过 `emitResultDelta` 流式输出 SSE 数据，并在流式输出完成后返回一个终态结果。当 `produces` 为 `application/json` 时，API tool MUST 在 `structuredPayload` 中返回完整的 JSON 响应而不截断。

#### Scenario: 非流式响应返回完整 JSON 而不截断

- **WHEN** `apiDoc.produces` 为 `application/json`
- **AND** HTTP 调用成功
- **THEN** API tool MUST 返回 `status=SUCCEEDED` 的 `CapabilityInvocationResult`
- **AND** `structuredPayload` MUST 完整包含 API 响应 JSON body（不截断）
- **AND** 非 agentic API tool 路径 MUST 绕过或放宽既有的 `maxCapabilityResultMessageChars` 限制

#### Scenario: 流式响应通过 delta 转发 SSE 数据

- **WHEN** `apiDoc.produces` 为 `text/event-stream`
- **AND** HTTP 调用返回 SSE 数据块
- **THEN** API tool MUST 为每个 SSE 数据块调用 `emitResultDelta`（原始数据按原样转发）
- **AND** 流式输出完成后，MUST 返回 `status=SUCCEEDED` 的终态 `CapabilityInvocationResult`

#### Scenario: 流式中断时保留已转发的 delta

- **WHEN** SSE 流在传输中途被中断
- **THEN** 已转发的 delta MUST 被保留
- **AND** API tool MUST 返回 `status=FAILED` 的终态 `CapabilityInvocationResult`
- **AND** `safeError.code` MUST 为 `API_STREAM_INTERRUPTED`

### Requirement: HTTP 调用失败处理

API tool SHALL 以稳定的安全 error code 处理 HTTP 调用失败。失败 MUST NOT 暴露 endpoint、credential、请求体或响应体。

#### Scenario: HTTP 未授权

- **WHEN** HTTP 调用返回 401 或 403
- **THEN** API tool MUST 返回 `status=FAILED` 的 `CapabilityInvocationResult`
- **AND** `safeError.code` MUST 为 `UNAUTHORIZED`

#### Scenario: HTTP 超时

- **WHEN** HTTP 调用超时
- **THEN** API tool MUST 返回 `status=TIMED_OUT` 的 `CapabilityInvocationResult`
- **AND** `safeError.code` MUST 为 `TIMEOUT`

#### Scenario: HTTP 其他失败

- **WHEN** HTTP 调用因未授权或超时以外的原因失败
- **THEN** API tool MUST 返回 `status=FAILED` 的 `CapabilityInvocationResult`
- **AND** `safeError.code` MUST 为 `UNAVAILABLE`

### Requirement: 参数来源是可信的

API tool SHALL 从三个可信来源组装 HTTP 调用参数：从当前请求 header 提取的 header 参数、来自可信 context（上层）的 request 参数，以及来自 model 参数提取的已提取参数。这些参数值都 MUST NOT 直接来自 model 输入、skill body 或客户端请求体。

#### Scenario: 从请求 header 提取 header 参数

- **WHEN** `apiHeaderParams` 为 `"x-user-id,x-user-name"`
- **THEN** 编排层 MUST 从当前请求 header 提取 `x-user-id` 和 `x-user-name` 的值
- **AND** MUST 把它们作为 header 参数传给 API tool

#### Scenario: 来自可信 context 的 request 参数

- **WHEN** `apiRequestParams` 为 `"query"`
- **THEN** 编排层 MUST 从可信 context 获取 `query` 值
- **AND** MUST 把它作为一个 request 参数传给 API tool

#### Scenario: 已提取参数填充其余必需参数

- **WHEN** swagger yaml 定义了未被 `apiHeaderParams` 或 `apiRequestParams` 覆盖的必需参数
- **THEN** model 参数提取 MUST 为这些参数生成值
- **AND** 三批参数 MUST 在组装 HTTP 调用之前被合并

### Requirement: 非 agentic 路径的 checkpoint 与恢复

编排层 SHALL 在调用 API tool 之前（标记进入非 agentic 路径）和 API tool 返回之后（标记已获得结果）各保存一个 checkpoint。如果恢复时发现已进入非 agentic 路径但没有获得结果，系统 MUST 返回失败而不重试 API 调用。

#### Scenario: 调用 API tool 之前保存 checkpoint

- **WHEN** 编排层即将调用 API tool
- **THEN** 它 MUST 保存一个标记进入非 agentic 路径的 checkpoint

#### Scenario: 没有结果时恢复不重试 API 调用

- **WHEN** 恢复时发现已进入非 agentic 路径但不存在结果 checkpoint
- **THEN** 系统 MUST 返回失败
- **AND** MUST NOT 重试 API 调用（避免重复副作用）

### Requirement: 非 agentic API 路径的可观测性

非 agentic API 路径 SHALL 复用既有的 capability invocation audit 和 metric。API tool SHALL 输出低基数的结构化日志（api name、执行步骤、成功/失败结果 code）。参数提取 SHALL 通过 `RunBoundModelInvocation` 产生 `MODEL_INVOCATION_STARTED` 和 `MODEL_INVOCATION_COMPLETED` timeline event。日志 MUST NOT 包含 credential、请求体、响应体或 endpoint。

#### Scenario: API tool 记录执行步骤

- **WHEN** API tool 执行（读取 yaml、参数提取、HTTP 调用）
- **THEN** 它 MUST 输出带 api name、执行步骤和结果 code 的结构化日志
- **AND** MUST NOT 记录 credential、请求体、响应体或 endpoint

#### Scenario: 参数提取产生 timeline event

- **WHEN** API tool 通过 `ParameterExtractionPort` 执行参数提取
- **THEN** MUST 输出 `MODEL_INVOCATION_STARTED` 和 `MODEL_INVOCATION_COMPLETED` timeline event
- **AND** 这些 event MUST 由 `RunBoundModelInvocation` 产生
