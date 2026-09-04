# runtime-logging Specification

## Purpose
Define the shared runtime diagnostic logging contract used by business packages and app composition while keeping structured observability logs as a separate observation-derived surface.
## Requirements
### Requirement: Runtime logs are separate from observability logs

Runtime logs SHALL be operational diagnostics emitted directly by product/runtime code for local problem diagnosis. They MUST NOT be treated as audit truth, metric truth, health truth, request lifecycle truth, or structured observability facts.

Observability structured logs SHALL remain derived from `ObservabilityObservationEvent` through `ObservabilityProjectorHost` and `StructuredLogProjector`.

#### Scenario: Runtime logger does not create observability facts

- **WHEN** a business package writes a runtime diagnostic log
- **THEN** it writes through the runtime logger contract
- **AND** it does not call `ObservabilityProjectorHost.acceptObservation`
- **AND** it does not create `StructuredLogEntry`

### Requirement: Logger implementation is reused without merging surfaces

The concrete logger factory SHALL live behind the shared runtime logging boundary and continue to produce a logger compatible with structured log transports. `agent-observability` MAY re-export the factory for compatibility, but structured log projection ownership remains in `agent-observability`.

#### Scenario: App composes two log consumers with one compatible logger

- **WHEN** app composition creates the product logger
- **THEN** runtime diagnostics consume it as a `RuntimeLogger`
- **AND** structured log projection consumes it as a `StructuredLogTransport`
- **AND** the two consumers remain separate surfaces with separate contracts

### Requirement: Runtime log helpers are safe, diagnostic, and non-fatal

Runtime logging helpers SHALL be non-throwing。系统 SHALL 把配置的 operational runtime log 作为本地问题定位面，并把 Web API、SSE、WebSocket、timeline、SafeError、audit、metric、trace 和 `ObservabilityObservationEvent` 作为对外安全输出面。

本地 runtime diagnostic SHALL 在既有容量约束内保留以下定位内容：Tool 的 canonical `toolInput` 和去除 `generatedMessages` 正文后的 `toolOutput` 原始业务值；移除全部 `SYSTEM` message 后的 canonical `modelInput`；规范化 Model final result 中的 `content`、`toolCalls`、`finishReason`、`usage` 和 `safeError`；执行异常的 `rawExceptionData`。`toolOutput` SHALL 以 `generatedMessageCount` 和 `generatedMessageKinds` 代替 `generatedMessages` 正文；`modelOutput` MUST NOT 包含 reasoning、provider raw body 或 stream delta。

Direct Tool diagnostic MUST 在完整 `toolInput` 之外包含一个 canonical `toolSafeSummary`。同一 diagnostic MUST NOT 输出同义 `toolInputPreview`。该约束不改变 lifecycle Hook 内部 safe input summary 的 contract。

上述本地字段 SHALL 只对 credential 和认证类 token 做窄匹配脱敏。字段名或文本值中的 prompt、路径、命令、stdout、stderr 和普通业务内容 MUST NOT 因敏感内容分类而被脱敏。脱敏 MUST NOT 误伤 `credentialRef`、`credentialStatus`、usage token count、`tokenCount`、`tokenLength` 或 `tokenization*`，并 MUST 只替换 credential value 而保留命令中的引号和参数分隔符。每个 special field 字符串最多保留 16 KiB UTF-8 前缀、每个数组最多保留 100 项、从 special field 根值开始计算的递归深度最多 6 层、每条 local runtime diagnostic 最多 1 MiB；超限值 MUST 保留预算内前缀并附明确 truncation marker，不得把仍可保留的整条 diagnostic 替换为只有 `entry_too_large`。容量退化不得改变主流程结果。

#### Scenario: Tool payload 保留定位内容

- **WHEN** Tool 执行成功或失败并形成 canonical input/output
- **THEN** operational runtime log SHALL 在 `toolInput` 和已有有效 `toolOutput` 中保留命令、路径、stdout、stderr 和业务字段值
- **AND** `toolOutput` MUST NOT 包含 `generatedMessages` 正文，SHALL 只保留其 count 和 kinds
- **AND** credential 与认证类 token MUST 被窄匹配脱敏
- **AND** 同一 entry SHALL 保留已有的 run、step、tool call 和 capability invocation 坐标
- **AND** MUST 保留一个 `toolSafeSummary`
- **AND** MUST NOT 同时包含 `toolInputPreview`

#### Scenario: Model payload 去除 SYSTEM 后可定位

- **WHEN** 一次 Model invocation 开始并最终返回规范化结果
- **THEN** operational runtime log SHALL 记录移除全部 `SYSTEM` message 后的 `modelInput`
- **AND** SHALL 记录包含 `content`、`toolCalls`、`finishReason`、`usage` 和存在时 `safeError` 的 `modelOutput`
- **AND** MUST NOT 记录 SYSTEM prompt、reasoning、provider raw body 或 stream delta

#### Scenario: Model input 保留常见 Tool 协议嵌套

- **WHEN** 非 SYSTEM message 包含 canonical Tool call arguments 或 Tool result content
- **THEN** writer SHALL 从 `modelInput` special field 根值开始计算递归深度
- **AND** 处于 6 层预算内的 message role、content、tool call id/name/arguments 和 Tool result SHALL 保留原值
- **AND** 真正超过深度预算的更深层业务值 SHALL 使用明确 truncation marker

#### Scenario: Logging failure does not affect the main path

- **WHEN** runtime logger implementation 拒绝 entry、达到容量限制或抛出异常
- **THEN** logging helper SHALL 吸收该失败
- **AND** request lifecycle、context assembly、Model/Tool 结果、terminal commit 和 gateway behavior 保持不变

### Requirement: Runtime log and trajectory log SHALL keep separate responsibilities

`nextagent-runtime.log` MUST 继续承载运行编排和局部执行诊断，例如 queue、dispatch、execution start/finish、terminal commit、tool call start/finish 以及本地调试所需的少量运行细节。它 MUST NOT 成为 agent execution trajectory 的唯一复盘面，也 MUST NOT 替代 observation-derived structured trajectory log。

凡是需要跨 turn、context assembly、capability selection、sandbox execution、visible output 和 terminal 形成统一复盘视图的轨迹点，系统 MUST 通过 observation-derived structured log 提供；runtime log 只保留编排诊断职责。

#### Scenario: Runtime diagnostics do not replace trajectory replay
- **WHEN** 本地排障需要查看 queue、dispatch、terminal commit 和工具执行等运行诊断
- **THEN** runtime log MAY 继续输出这些运行细节
- **AND** 当需要完整复盘 agent 如何推进任务时，系统 MUST 依赖 structured trajectory log 而不是 runtime log 拼接出唯一真相

### Requirement: Capability executor 在有损归一化前记录本地执行异常

当 Capability executor 捕获未知执行异常并将其转换为 `CAPABILITY_EXECUTION_FAILED` 时，executor MUST 在转换前以 `error` level 向本地 runtime diagnostic logger 输出恰好一个 `capability.execution.exception_captured`。producer MUST 只提交 `event`、`failureStage=CAPABILITY_EXECUTION`、可信 `agentId`、`agentVersion`、`sessionId`、`requestId`、`runId`、`stepId`、`toolCallId`、`capabilityId`、descriptor 的 `providerId`/`providerKind`、`safeErrorCode=CAPABILITY_EXECUTION_FAILED`、`safeErrorCategory=INTERNAL`、`retryable=false` 和统一 `rawExceptionData` 净化入口产生的字段；writer-owned timestamp、level、component 与净化投影不受该 producer allowlist 限制。

该 entry MUST NOT 携带 tenant/subject identity、Capability arguments/result、其它 descriptor metadata 或 caller 自行构造的 raw exception 字段。executor 当前 catch 入口的通用 `capability.invocation.error` MUST 被该 unknown-only event 替换，不得对同一 unknown exception同时输出两个 owner diagnostic。

输入 schema failure、输出 schema failure、已声明 `ToolFailedResultError`、`ToolTimedOutResultError`、`ToolDegradedResultError` 和普通 `SafeError` MUST 使用其安全分类，不得伪造成未知 execution exception。诊断写入失败 MUST NOT 改变 Capability result。

#### Scenario: 未知 Capability 异常在转换前被消费

- **WHEN** Capability implementation 抛出未知 Error
- **THEN** executor MUST 输出一个 `capability.execution.exception_captured`
- **AND** MUST 返回 `CAPABILITY_EXECUTION_FAILED`
- **AND** local runtime log MUST 能按 run、toolCall 和 capability 坐标关联诊断与失败结果

#### Scenario: 已声明 Tool failure 不重复记录未知异常

- **WHEN** Tool implementation 抛出携带安全 code/category 的已声明 Tool failure
- **THEN** executor MUST 保留该安全失败结果
- **AND** MUST NOT 输出 `capability.execution.exception_captured`
- **AND** MUST NOT 输出被替换的 `capability.invocation.error`

#### Scenario: Capability output validation 使用既有安全失败日志

- **WHEN** Capability 返回值未通过 output schema
- **THEN** executor MUST 返回 `CAPABILITY_OUTPUT_INVALID`
- **AND** outer tool loop MUST 继续通过既有 `tool.call.failed` 和 canonical `CAPABILITY_COMPLETED` 表达安全分类与关联坐标
- **AND** MUST NOT 新增 `capability.output.invalid` 或记录 rejected output value

#### Scenario: Logger 不可用时执行语义不变

- **WHEN** runtime diagnostic logger 不可用或写入失败
- **THEN** executor MUST 返回与 logger 可用时相同的 Capability result

### Requirement: 正常执行使用单一可关联的安全日志目录

系统 SHALL 继续把 observation-derived structured trajectory 和 direct local runtime diagnostic 写入现有 `agent-log` physical destination，不得新增 evidence store、配置开关或第三类日志目录。Observation-derived entry SHALL 继续只记录策略批准的安全结构字段；Tool、Model 和 execution exception 的原始定位字段 SHALL 只由 direct local runtime diagnostic 写入。

一个成功 run SHALL 至少可按可信 `agentId`、`agentVersion`、`sessionId`、`requestId` 和 `runId` 关联 request lifecycle。Context、Model 和 Tool 边界存在 `stepId` 时 SHALL 保留该字段；Tool diagnostic 存在 `toolCallId` 或 `capabilityInvocationId` 时 SHALL 保留对应字段。Model input/output diagnostic SHALL 与既有 Model started/completed 使用相同 run/step；缺失可选值时 MUST 省略，不得从默认配置或相邻 event 推断。

默认 `info` physical operational log MUST 对每个 HTTP 请求省略 Fastify `incoming request`，并 MUST 恰好保留一个 Fastify final `request completed` 或 `request errored` record；final record MUST 保留 server-generated `reqId`、请求 method、无 query/parameter value 的规范化 route、`res.statusCode` 和 `responseTime`。系统 MUST NOT 保存 raw URL、query、headers 或 body，也不得为此新增 app-owned access event、并行 access logger 或第二个 HTTP metric owner。

成功的 `session.owner-scope-check` MUST 只使用 `debug`；owner scope 不一致时 MUST 在返回既有安全拒绝前写入一条 `warn`，并包含稳定 `safeReasonCode`。同一 `LocalSkillDiscovery` 实例在 source 持续不可用且期间没有成功 source read 时 MUST 至多写入一条 `skill.discovery.source_unavailable` warn；每次 discovery 的 readiness evidence MUST 保持不变。一次成功 source read 后再次不可用时 MUST 允许新的首条 warn。

成功 trace projection confirmation 与 `SUCCESS + OBSERVE_PARALLEL` 的 `hook.completed` MUST 使用 `debug`；trace projection failure、Hook failure/timeout/cancel 和 `SERIAL_IMPACT` Hook MUST 保持既有级别。完整 request terminal summary MUST 省略 `summaryStatus=COMPLETE`，不完整 summary MUST 输出 `summaryStatus=PARTIAL`。成功 `request.completed` MUST 省略可由 event/status 推导的 `safeReasonCode=TERMINAL_COMPLETED`、`details.persistence=PERSISTED` 和 `details.terminalStatus=COMPLETED`；status、duration、usage、toolCallCount 与关联坐标 MUST 保留。`request.*`、`model.invocation.*`、`capability.*`、Tool/Model payload、失败和降级事件 MUST 保持既有级别与可见性。

每个由 run-bound Model owner 实际执行并形成的 `model.invocation.completed` 或 `model.invocation.failed` terminal summary MUST 包含非负整数 `durationMs`。该值 MUST 使用 monotonic clock，从对应 `MODEL_INVOCATION_STARTED` 已提交后的 Model 执行边界起点计量到规范化 final result 或 caught failure。首次出现非空 content、非空 reasoning 或 Tool call 的 delta 时，terminal summary MUST 包含从同一起点计量的非负整数 `firstContentLatencyMs`；若 Model 没有先产生 delta、但 final result 包含非空 content、非空 reasoning 或至少一个 Tool call，则该 final result MUST 作为首次反馈。没有上述反馈时 MUST 省略 `firstContentLatencyMs`。当两个时延同时存在时，`firstContentLatencyMs` MUST 小于或等于 `durationMs`。

当规范化 final result 提供 usage 时，Model terminal summary MUST 原样投影已有 normalized usage；provider 未提供或规范化结果没有 usage 时 MUST 省略，MUST NOT 估算或补零。返回 safe failure final result 时 `model.invocation.failed` MUST 保留其已有 usage；在 final result 形成前直接抛出的失败 MUST 仍保留 `durationMs` 和已有 `firstContentLatencyMs`，但 MUST NOT 构造 usage。Direct `model.payload.output_captured` SHALL 继续记录 final result 自身的 usage，MUST NOT 复制 terminal timing；`model.stream.first_visible_content` SHALL 继续作为轨迹 milestone，但 MUST NOT 成为 terminal timing 的唯一来源。

#### Scenario: 复杂 Tool 失败可从同一日志定位

- **WHEN** 复杂命令执行失败且异常包含 message、stack、cause、sandbox path 或 URL
- **THEN** 运维人员 SHALL 能在同一 operational log 中按 run、step、tool call 或 capability invocation 找到 Tool payload 和异常定位信息
- **AND** 无需依赖客户端 SafeMessage 反推原始错误

#### Scenario: 对外轨迹保持安全

- **WHEN** 同一执行同时产生 local runtime diagnostic 和 observation-derived trajectory
- **THEN** local runtime diagnostic MAY 包含本规格批准的原始定位字段
- **AND** observation-derived entry MUST NOT 因此包含 prompt、Model output、Tool payload、stack、路径或 provider raw body

#### Scenario: HTTP 请求只保留 final access record

- **WHEN** Fastify 请求以成功、普通 4xx 或内部错误结束
- **THEN** 默认 `info` physical operational log MUST 不包含该请求的 `incoming request`
- **AND** MUST 恰好包含一个带 `reqId`、method、规范化 route、status code 和 response time 的 `request completed` 或 `request errored`
- **AND** MUST NOT 包含 raw URL、query、headers 或 body

#### Scenario: 成功纯观察 Hook 与 trace confirmation 下沉 debug

- **WHEN** trace projection 成功，或 Hook 以 `OBSERVE_PARALLEL` 执行并成功
- **THEN** 对应 confirmation MUST 只写入 `debug`
- **AND** `SERIAL_IMPACT` Hook、Hook/trace failure、timeout 和 cancellation MUST 保持既有级别

#### Scenario: 成功 terminal 只保留独立诊断事实

- **WHEN** request terminal summary 完整且 terminal commit 成功
- **THEN** `request.completed` MUST 保留 `status=SUCCEEDED`、duration、usage、toolCallCount 和关联坐标
- **AND** MUST 省略 `summaryStatus=COMPLETE`、`TERMINAL_COMPLETED` 和重复的 persisted/completed details

#### Scenario: 不完整 terminal 显式标记

- **WHEN** request terminal summary 不完整
- **THEN** terminal structured log MUST 输出 `summaryStatus=PARTIAL`

#### Scenario: Model 完成摘要同时给出 usage 和时延

- **WHEN** Model 先产生可见 content、reasoning 或 Tool call feedback，随后返回带 normalized usage 的 final result
- **THEN** `model.invocation.completed` SHALL 同时包含该 usage、`durationMs` 和 `firstContentLatencyMs`
- **AND** `firstContentLatencyMs` SHALL 小于或等于 `durationMs`

#### Scenario: 仅在 final result 首次形成反馈

- **WHEN** Model 没有产生 feedback delta，但 final result 包含非空 content、非空 reasoning 或 Tool call
- **THEN** terminal summary SHALL 包含 `firstContentLatencyMs`
- **AND** 该值 SHALL 使用与 `durationMs` 相同的 run-bound 起点和 final result 到达时刻

#### Scenario: Model 没有反馈或 usage 不可用

- **WHEN** Model final result 没有 content、reasoning、Tool call 或 normalized usage
- **THEN** terminal summary SHALL 包含 `durationMs`
- **AND** MUST 省略 `firstContentLatencyMs` 和 usage
- **AND** MUST NOT 估算、补零或从相邻事件推导缺失字段

#### Scenario: Model 失败摘要保留实际可得事实

- **WHEN** Model 返回带 safe error 的 normalized final result，或在 final result 形成前直接抛出
- **THEN** `model.invocation.failed` SHALL 包含 `durationMs`
- **AND** SHALL 保留失败前已观测到的 `firstContentLatencyMs`
- **AND** 仅在 normalized final result 已提供 usage 时 SHALL 包含 usage

#### Scenario: Owner scope 成功检查下沉 debug

- **WHEN** session owner scope 校验成功
- **THEN** 默认 `info` physical operational log MUST 不包含该次 `session.owner-scope-check`
- **AND** debug logger MUST 接收该诊断

#### Scenario: Owner scope 失败保留 warn

- **WHEN** session owner scope 校验失败
- **THEN** warn logger MUST 接收一条带稳定 reason code 的诊断，且原安全拒绝保持不变

#### Scenario: Skill source 持续不可用只记录一次

- **WHEN** 同一 Local Skill source 连续多次 discovery 均不可用且期间没有成功 source read
- **THEN** physical operational log MUST 只包含第一次 `skill.discovery.source_unavailable` warn
- **AND** 每次 discovery MUST 继续返回对应 readiness evidence

#### Scenario: Skill source 恢复后允许新的不可用诊断

- **WHEN** source 成功读取后再次不可用
- **THEN** physical operational log MUST 再允许一条新的 `skill.discovery.source_unavailable` warn

### Requirement: Runtime writer 使用精确字段分类和 typed marker

Runtime writer SHALL 按 surface 和精确字段分类。`toolInput`、`toolOutput`、`modelInput`、`modelOutput` 和 `rawExceptionData` SHALL 作为 local runtime diagnostic special field，在 generic policy-omitted 分类前处理；它们只应用 credential 与认证类 token 的窄匹配脱敏以及本规格定义的字段数、递归深度、数组项、单值和单 entry 容量约束。Caller 提交的 marker MUST NOT 被信任为 writer 净化结果。

`modelInput` MUST 只包含 `messages`。`modelInput.messages` SHALL 删除 role 为 `SYSTEM` 的每一项后再进入 writer；writer MUST failed closed 地再次拒绝 special `modelInput` 中的 `SYSTEM` message，并 MUST 省略 `modelInput` 中除 `messages` 外的任一字段。`modelOutput` SHALL 只接受规范化 final result allowlist，未知字段、reasoning 和 provider raw body MUST 被省略。

Runtime writer SHALL 从 local runtime diagnostic entry 的 caught `err`/`exception` 自动派生 `rawExceptionData`，producer 不得为了获得可定位异常而重复实现异常序列化。`rawExceptionData` SHALL 保留有界的 name、message、stack、cause、sandbox path、URL 和可序列化异常字段，只窄匹配脱敏 credential 与认证类 token；prompt 文本不属于该字段的脱敏类别。

Writer-owned correlation 字段 SHALL 继续由可信投影或 runtime owner 设置。`tool.payload.captured`、`tool.call.failed`、`tool.call.result_invalid`、`tool.loop.repeated_failure`、Model payload diagnostic 及 execution exception event 中存在的 `stepId` MUST 保留。普通 observation-derived 字段 SHALL 继续应用既有 policy omission、路径移除和强隔离规则。

#### Scenario: Tool failure diagnostic 保留可信 step

- **WHEN** Tool owner 为失败、无效结果或重复失败事件提交 run、step 和 Tool 调用坐标
- **THEN** writer SHALL 保留 runtime owner 提交的 `stepId`
- **AND** 失败 entry SHALL 可与同一 run 中的 Tool input/output 和异常诊断直接关联

#### Scenario: Generic runtime exception 自动形成原始诊断

- **WHEN** local runtime logger 收到带 caught `err` 的 failure entry
- **THEN** writer SHALL 自动输出有界 `rawExceptionData`
- **AND** message、stack、cause、路径和 URL SHALL 保留
- **AND** credential 与认证类 token MUST 被脱敏

#### Scenario: Safe diagnostic names 不被 token 子串误伤

- **WHEN** special field 包含 `credentialRef`、`credentialStatus`、`inputTokens`、`outputTokens`、`tokenCount`、`tokenLength` 或 `tokenizationMode`
- **THEN** writer SHALL 保留这些正常诊断字段和值
- **AND** `accessToken`、`refresh_token`、`apiKey`、password、authorization 和 bearer credential 仍 MUST 被脱敏

#### Scenario: Observation-derived log 仍保持强隔离

- **WHEN** observation candidate 携带 raw Model output、Tool result、stack、路径或 special local diagnostic field
- **THEN** writer MUST NOT 把这些值写入 observation-derived destination
- **AND** `diagnosticDetail=debug` MUST NOT 改变该结果

#### Scenario: 复杂 Model messages 在本地容量内保留

- **WHEN** 去除 SYSTEM 后的 Model messages 超过旧的 16 KiB entry budget
- **THEN** writer MUST 在 1 MiB local entry budget 内保留所有未超出各自单值和数组预算的内容
- **AND** MUST NOT 把该 entry 替换为只有 `entry_too_large`

### Requirement: 本地 runtime 执行异常诊断保留受控详细信息

当 Tool 执行、Tool 结果校验、Model invocation、Web request handler、request terminal submit 或 runtime maintenance boundary 捕获执行异常时，系统 SHALL 把 caught exception 提交给本地 `RuntimeLogger`，且配置的 operational runtime log SHALL 包含 writer 派生的结构化 `rawExceptionData`。该字段 SHALL 在既有容量约束内保留异常 name、message、stack、cause 链、sandbox path、URL 和可序列化异常对象字段。

`rawExceptionData` SHALL 只对 password、secret、API key、authorization、cookie、credential value 和认证类 token 做窄匹配脱敏。`credentialRef`、`credentialStatus`、usage token count 及普通 prompt、路径、命令和业务文本 SHALL 保留。各 lifecycle owner SHALL 使用 writer 的统一异常派生入口，不得把 `SafeMessage` 作为本地异常详情的唯一来源。

**需求类别**：功能性需求

#### Scenario: Web handler 失败保留根因

- **WHEN** Web request handler 抛出带 cause 或 stack 的异常并向客户端返回 SafeError
- **THEN** operational runtime log 中对应 failure entry SHALL 包含 `rawExceptionData`
- **AND** server request id 和已有 request/run 坐标 SHALL 在存在时保留
- **AND** 客户端仍只接收既有安全错误

#### Scenario: Terminal submit 失败保留根因

- **WHEN** request 进入 terminal submit 后因执行异常失败
- **THEN** operational runtime log 中的 terminal failure SHALL 包含 `rawExceptionData`
- **AND** 既有 safe terminal status 和 safe reason code SHALL 保持不变

#### Scenario: Runtime maintenance failure 保留根因

- **WHEN** pending-input timeout scan 或同类 runtime maintenance pass 捕获执行异常
- **THEN** 对应 error diagnostic SHALL 提交 caught exception 并形成 `rawExceptionData`
- **AND** 既有 retry、backoff 和 recovery code 行为 SHALL 保持不变

### Requirement: 本地执行异常诊断不得扩散到产品输出面

`toolInput`、`toolOutput`、`modelInput`、`modelOutput` 和 `rawExceptionData` SHALL 仅经本地 `RuntimeLogger` 写入 operational runtime log。系统 MUST NOT 将这些 special field 投影到 Web API、SSE、WebSocket、timeline event、SafeError、audit record、metric sample、trace attribute 或 `ObservabilityObservationEvent`。

**需求类别**：功能性需求

#### Scenario: 原始定位字段不改变客户端安全错误

- **WHEN** 本地 runtime diagnostic 写入 Tool、Model 或 exception 原始定位字段
- **THEN** 客户端和 stream 只接收既有 SafeError、safe payload 或安全 terminal 投影
- **AND** 它们不得包含 special field 的原始业务值、exception message、stack、cause、sandbox path 或 URL

### Requirement: 本地模型调用诊断记录可定位输入输出

每次 Model invocation SHALL 由持有可信 request 和 normalized final result 的 run-bound Model owner 写入一组 direct local runtime diagnostic。Input diagnostic 的 `modelInput` MUST 只包含去除全部 `SYSTEM` message 后的 request `messages`，MUST NOT 包含 Tool descriptors、`modelId` 或其他模型调用选项；output diagnostic SHALL 包含规范化 final result 的 `content`、`toolCalls`、`finishReason`、`usage` 和存在时 `safeError`。

该 owner SHALL 保留 invocation 的 run/step/model profile/provider 关联信息。Output diagnostic MUST NOT 包含 reasoning、provider raw body 或 stream delta。调用在形成 final result 前抛出异常时，owner SHALL 写入带 caught exception 的 Model failure diagnostic，writer SHALL 自动派生 `rawExceptionData`。

**需求类别**：功能性需求

#### Scenario: 多条 SYSTEM message 全部移除

- **WHEN** Model request 同时包含多条 `SYSTEM` message、USER message 和 TOOL message
- **THEN** local `modelInput` SHALL 保留 USER/ASSISTANT/TOOL message 的顺序和内容
- **AND** MUST 删除每一条 SYSTEM message

#### Scenario: Model input 仅保留 messages

- **WHEN** Model request 同时包含 `messages`、Tool descriptors、`modelId` 和模型调用选项
- **THEN** local `modelInput` MUST 只包含 `messages`
- **AND** Tool descriptors、`modelId` 和其他模型调用选项 MUST 不存在

#### Scenario: Model final output 可直接定位

- **WHEN** Model invocation 返回文本、tool call、finish reason 和 usage
- **THEN** local `modelOutput` SHALL 原样保留这些规范化可见字段
- **AND** reasoning、provider raw body 和 stream delta MUST 不存在


### Requirement: Runtime logging policy controls asynchronous levels and sinks

Runtime logging SHALL support `error`, `warn`, `info`, and `debug` thresholds plus independently configurable console and file sinks. Every enabled destination MUST use asynchronous mode. A business-path log call MUST NOT wait for file/console I/O, drain, rotation, compression, retention or flush; it MAY synchronously perform only bounded level filtering, field normalization/redaction, JSON serialization and enqueue.

The normalized serialized entry MUST be limited to 16 KiB. Oversize caller fields MUST be replaced by a minimal safe entry rather than copied without bound. Each destination MUST use an independent implementation-owned 4 MiB asynchronous buffer. Buffer saturation MUST drop the new entry, update only a bounded/saturating dropped-count bucket and MUST NOT wait for drain, grow memory without bound or throw to the caller.

#### Scenario: Development console emits asynchronously

- **WHEN** development enables console, disables file and selects `debug`
- **THEN** eligible entries MUST be enqueued to the structured console destination
- **AND** no operational file MUST be created
- **AND** the business call MUST NOT await console completion

#### Scenario: Package file sink does not block requests

- **WHEN** local package file logging is enabled and the destination is slow
- **THEN** request/model/capability outcomes MUST remain independent of destination latency
- **AND** no synchronous append, gzip, scan or retention operation may execute on the business path

#### Scenario: Slow sink saturates its buffer

- **WHEN** one asynchronous destination reaches its 4 MiB buffer limit
- **THEN** the new entry MUST be dropped without blocking the business caller
- **AND** the dropped payload MUST NOT be copied to stderr or another fallback queue
- **AND** another healthy destination MUST remain usable
- **AND** overload/recovery evidence MUST be bounded to state transitions and a safe count bucket

### Requirement: Product runtime logger is implementation-owned and component-scoped

`agent-log` SHALL own the complete operational logging semantics: Pino envelope, console sink, operational file policy, Pino child provider, non-throwing result mapping and one independently owned `agent-local-file-roll` handle. The Node-only foundation SHALL own the shared pino-roll/SonicBoom rotation, gzip reconciliation, retention and bounded-handle mechanism without understanding operational fields. `agent-app` SHALL create one operational writer and bind its provider to the `agent-common` facade exactly once. Business modules/classes SHALL obtain component-scoped loggers through `getLogger({ component, source? })` without constructor/composition injection. The provider MUST derive a Pino child with trusted low-cardinality code-owned bindings. Business packages MUST NOT create concrete loggers or select sinks.

#### Scenario: Shared writer does not erase component ownership

- **WHEN** runtime and channel owners obtain loggers through `getLogger`
- **THEN** both entries MUST use the same configured writer/file family
- **AND** each entry MUST contain its app-bound component
- **AND** caller fields MUST NOT override component

### Requirement: Operational entries use one stable log event

Every ordinary operational diagnostic SHALL be a standalone structured JSON object containing writer-owned ISO `timestamp`, textual `level=debug|info|warn|error`, fixed `surface`, app-bound `component`, app-owned `serviceVersion` and one stable code-owned `event`. The controlled exception SHALL be Fastify's native access pair: `incoming request` MUST retain a safe native `req` shape and `request completed|request errored` MUST retain the native `res` and `responseTime` shape, without adding operational events. The two records MUST share Fastify's native server-generated `reqId`. The safe `req` serializer MUST contain only method and a validated route template in `url`, with unmatched requests represented by the fixed value `unmatched`. Pino numeric levels are internal routing details and MUST NOT enter the physical schema.

An ordinary physical entry MAY persist one optional sanitized `msg` for human readability, but MUST NOT persist `operation` or `outcome`. `event` remains its sole machine action/outcome semantic used for search, alerting and aggregation. The Fastify access exception uses its fixed native message together with `res.statusCode` and `responseTime` as the conventional access-log schema. Observation acquisition MAY retain boundary/operation/outcome internally for trace, metric and audit projection, but StructuredLogProjector MUST normalize them to one concrete event.

#### Scenario: Direct component diagnostic uses one event

- **WHEN** an owner writes a safe structured runtime diagnostic
- **THEN** the operational writer MUST emit it with timestamp, textual level, `surface=runtime_diagnostic`, bound component and stable event
- **AND** the physical envelope MUST include the trusted serviceVersion selected by app composition
- **AND** it MAY add a sanitized msg when it contributes safe dynamic context, but SHOULD omit msg when it only repeats the event
- **AND** it MUST NOT add operation or outcome
- **AND** no observation, timeline, audit or metric fact may be created

#### Scenario: Event-derived trajectory retains event identity

- **WHEN** StructuredLogProjector emits an approved trajectory entry
- **THEN** the writer MUST preserve its stable projector event and `surface=observation_derived`
- **AND** sharing the writer MUST NOT convert unrelated runtime diagnostics into event-derived entries

#### Scenario: Approved semantic fields survive centralized redaction

- **WHEN** an approved model usage object contains non-negative integer `inputTokens`, `outputTokens` and `totalTokens`
- **THEN** the common writer MUST preserve those values for operational diagnosis
- **AND** adjacent credential/token/path/query fields MUST remain redacted
- **AND** callers MUST NOT implement a second logging-only field sanitizer

### Requirement: Operational logs rotate by size or fixed daily boundary and archive as gzip

When file logging is enabled, `agent-log` SHALL use its frozen operational policy to create and own one `agent-local-file-roll` handle, including observation of that handle's transport-owned active identity. The foundation SHALL configure pino-roll with the frozen size string, whose default is `30m`, and implementation-owned `frequency=daily`. Rotation SHALL occur when either the size threshold or process-local midnight is reached. User configuration MUST NOT disable or override the daily safety rotation.

The daily boundary and any calendar date embedded in owned file names SHALL use the Node.js process-local timezone, fixed for the lifetime of the process. Request/runtime input and `observability.logging` MUST NOT override it. A daylight-saving calendar day MAY be shorter or longer than 24 hours; closed-segment expiration MUST remain elapsed `retentionDays * 24h` from `closedAt`.

After ready state, maintenance MUST scan the logger-owned family at least once per minute, exclude current `destination.file`, and gzip closed segments through `.gz.tmp` plus atomic rename. Source deletion MUST occur only after committed archive success.

#### Scenario: High-volume file rotates by size

- **WHEN** active file reaches `maxFileSizeMiB`
- **THEN** pino-roll MUST switch to a new active segment
- **AND** subsequent writes MUST continue without waiting for gzip

#### Scenario: Low-volume file rotates daily

- **WHEN** active file remains below the size threshold through the daily rotation boundary
- **THEN** pino-roll MUST close it and select a new active segment
- **AND** the closed segment MUST become eligible for archive maintenance

#### Scenario: Daily rotation uses the process calendar while retention uses elapsed time

- **WHEN** a controlled process timezone crosses local midnight, including a daylight-saving transition
- **THEN** the active segment MUST rotate according to that process-local calendar boundary
- **AND** its file date MUST use the same process-local calendar
- **AND** later expiration MUST use elapsed hours from `closedAt`, not a count of local midnights

#### Scenario: Compression failure preserves evidence

- **WHEN** gzip, rename or cancellation fails
- **THEN** the closed source MUST remain for retry
- **AND** `.gz.tmp` MUST NOT count as committed evidence

### Requirement: Operational archives age automatically after the retention window

Default retention SHALL be 7 days and configured retention MUST be an integer greater than or equal to 7. Default `maxArchiveFiles` SHALL be 10 and a configured value MUST be a positive integer. Expiration MUST use original closed/rotation time. Startup reconciliation and hourly maintenance MUST delete expired logger-owned archive or closed source. Startup reconciliation and every archive maintenance cycle MUST also delete the oldest committed logger-owned gzip archives when their count exceeds `maxArchiveFiles`, using `mtime` and then file name for deterministic ordering. Time expiration and archive-count overflow SHALL be independent deletion conditions. Maintenance MUST preserve active, young closed sources, audit, metrics, developer diagnostic, unknown, symlink and out-of-directory files; only an exactly owned committed operational gzip archive may be deleted before its time window because of the count limit.

The fixed daily rotation MUST ensure low-volume data cannot remain indefinitely in an active segment. The maximum target window for an entry is one daily active period plus the configured closed-segment retention and one maintenance interval, subject to earlier oldest-first eviction when committed operational archives exceed `maxArchiveFiles`.

#### Scenario: Default archive count exceeds ten

- **WHEN** compression commits an eleventh operational gzip archive while the prior ten are still younger than 7 days
- **THEN** the oldest exactly owned operational archive MUST be deleted during that maintenance cycle
- **AND** no more than ten committed operational gzip archives may remain after successful maintenance
- **AND** the count limit MUST NOT affect metrics, audit, developer diagnostic or unknown files

#### Scenario: Default archive remains for seven days

- **WHEN** a committed archive is younger than 7 days
- **THEN** maintenance MUST preserve it

#### Scenario: Expired files are aged

- **WHEN** a logger-owned archive or closed source reaches 7 days
- **THEN** it MUST be deleted by the next hourly maintenance or startup reconciliation

#### Scenario: Maintenance does not own other files

- **WHEN** the log directory contains audit storage, developer trace, symlink or unknown files
- **THEN** archive/retention maintenance MUST leave them unchanged

### Requirement: Logging failures never affect business behavior or readiness

Transport initialization, serialization, entry oversize, enqueue overflow, write, rotation, compression, retention, flush and close failures MUST NOT change app ready outcome, request lifecycle, terminal commit, stream delivery, model/capability/gateway results or trigger app shutdown. A failed or overloaded sink MUST NOT disable another healthy sink. Runtime logger methods MUST remain non-throwing.

Before the writer is usable or after it becomes degraded/overloaded, an app-owned asynchronous emergency reporter MAY enqueue one bounded structured stderr entry per startup or state transition. The originating caller MUST NOT await it. It MUST NOT become a per-entry fallback or normal console sink and MUST NOT include path, raw error, stack, configuration value, dropped payload or secret. If the emergency reporter itself fails, it MUST stop silently and MUST NOT invoke a synchronous fallback.

Invalid runtime logging configuration remains a configuration validation failure; it is not a transport failure and MAY reject startup under the configuration boundary.

#### Scenario: File transport initialization fails

- **WHEN** file logging is enabled but its transport cannot initialize
- **THEN** app business readiness and request behavior MUST remain unchanged
- **AND** an available console sink MAY continue
- **AND** the emergency reporter MAY emit one safe `logging.transport.init_failed` state transition

#### Scenario: Async destination fails after ready

- **WHEN** write or rotation fails after ready
- **THEN** the originating business call MUST retain its result
- **AND** logging MUST NOT initiate app shutdown
- **AND** degradation evidence MAY use only an independent bounded emergency path

### Requirement: Operational writer lifecycle brackets every product producer

After trusted configuration is frozen, app composition SHALL create/start operational destinations, then the deployment audit gateway and metrics pipeline, before it creates observation projectors or business producers. Transport initialization failure MAY degrade its owning output domain but MUST NOT create a partially owned second writer or reject otherwise valid business startup.

During shutdown, app composition SHALL first stop accepting work and drain every runtime/channel/scheduler/worker/gateway/deployment producer and the projector host according to their owning lifecycles. It SHALL then bounded-close the audit gateway, bounded-force-flush and shut down metrics plus close the `LocalMetricHistoryExporter` file lifecycle, emit the final app shutdown diagnostic, and bounded-flush/close the operational writer last. Each finalizer MUST execute from an independent failure-isolation boundary so one failure cannot skip later audit, metrics or operational cleanup.

#### Scenario: Metrics shutdown can still report degradation

- **WHEN** a metrics exporter times out or fails during app shutdown
- **THEN** its bounded degraded transition MAY be written before the operational writer closes
- **AND** operational flush/close MUST still run
- **AND** the metrics failure MUST NOT change the app's prior business results

#### Scenario: Earlier producer close fails

- **WHEN** a runtime, gateway or deployment producer throws while closing
- **THEN** metrics finalization and operational writer close MUST still be attempted within their own timeouts
- **AND** the operational writer MUST remain the last normal output domain to close

### Requirement: Common operational diagnostics provide baseline problem-location coverage

Product composition SHALL combine canonical timeline projection, narrow approved typed observation adapters and component-scoped runtime diagnostics. Existing canonical lifecycle facts MUST use timeline-first acquisition exactly once. Facts without a business event MAY be logged directly and MUST NOT be forced through observation merely to obtain a structured file.

Typed trajectory adapters in this change are limited to trusted pre-acceptance rejection, `ContextEnginePort.assemble`, existing attachment observation and `AppSandboxGatewayPort.execute/executeWithStdoutChunks`. Runtime diagnostics cover owner-private scheduler, commit, recovery, delivery, gateway binding, maintenance and other safe component state. Product composition MUST NOT blanket-wrap persistence stores, render/readiness queries or capability-covered remote calls.

#### Scenario: Canonical lifecycle outcome is projected exactly once

- **WHEN** canonical model, capability or request terminal events are published
- **THEN** the timeline mapper MUST supply the observation-derived milestone
- **AND** no model wrapper, runtime-log bridge, generic internal observer or same-outcome direct log may duplicate it

#### Scenario: Component diagnostic remains direct

- **WHEN** a component reports local initialization or owner-private failure not represented by timeline
- **THEN** it MAY write through its component-scoped RuntimeLogger
- **AND** it MUST NOT create an observation solely for logging

#### Scenario: Public composition cannot silently bypass the common writer

- **WHEN** an operational sink is enabled
- **THEN** product owners MUST receive app-composed adapters
- **AND** owner-local concrete logger, direct stdout/stderr/file output or noop replacement MUST be rejected except documented emergency/CLI/developer-trace exclusions

#### Scenario: Trace infrastructure failure preserves safe root-cause evidence

- **WHEN** OTel trace credential resolution, SDK initialization, batch export or span projection fails
- **THEN** the first infrastructure owner catch MUST emit a component-scoped diagnostic with code-owned failureStage and safe reason
- **AND** an unexpected Error MUST use the writer-owned safe exception projection
- **AND** endpoint, credential, service name, raw error message and raw stack MUST NOT be written through console or any parallel diagnostic path
- **AND** successful spans and successful export batches MUST NOT create per-item operational noise
### Requirement: Baseline operational catalog and signal budget are implementation-frozen

Implementation SHALL conform to `event-catalog.md` for the milestones explicitly cataloged there. The catalog MUST NOT be interpreted as a closed enum for all direct diagnostics.

For an isolated ordinary Web submit flow, default-info cataloged request trajectory MUST contain request/model/capability/terminal bookends plus key safe child-stage milestones needed for internal run diagnosis. Other process-level component logs are outside that per-request trajectory. Metrics MUST NOT increase it; failure/degradation MUST remain visible.

The `scheduler/submit degradation` catalog row is modified: `queue/dispatched/execution-finished` previously frozen at debug is split. `queue/execution-finished` remains debug; `dispatched` is upgraded to info. The "default info trajectory" framework statement "routine stream、queue/dispatch、task trajectory build 和 maintenance success 可继续保持 debug" is updated to exclude dispatch from the debug-keeping list.

`runtime.run.dispatched` MUST be emitted at info level after scheduler dispatch (when `resumeExecuting !== true`), carrying `agentId`, `sessionId`, `requestId`, `runId`, `laneKey`, `runCreatedAtMs`, where `runCreatedAtMs` = `Number(run.createdAt)`, which is the accept-time proxy, consistent with `runtime.run.turn_completed`'s `durationMs` definition. This event applies to all runs (workflow and non-workflow). It MUST NOT enter timeline event, audit, metric, trace, or Web API response.

`runtime.run.turn_completed` MUST be emitted at info level when a terminal event is published, carrying `agentId`, `sessionId`, `requestId`, `runId`, `runStatus`, `durationMs`, where `durationMs` = `terminalEvent.createdAt - run.createdAt`, representing accept-to-terminal latency. This event applies to all runs. It MUST NOT enter timeline event, audit, metric, trace, or Web API response.

`runtime.run.dispatched` and `runtime.run.turn_completed` together form the run lifecycle bookends: accept → dispatch → terminal. For DETERMINISTIC_FLOW runs, `workflow.execution.started` (defined in workflow-execution-engine spec) provides the workflow-start milestone between dispatched and turn_completed, enabling three-segment decomposition: accept → dispatch → workflow start → terminal.

Non-workflow runs (MODEL_DRIVEN_LOOP) produce `dispatched` and `turn_completed` but not `workflow.execution.started`. This is by routing definition, not an orphan: `dispatched` has independent diagnostic value (dispatch timestamp for queue-wait analysis) beyond workflow latency calculation.

**需求类别**：功能性需求

#### Scenario: Ordinary request remains diagnosable at info

- **WHEN** an isolated ordinary request completes with one model invocation and no capability invocation
- **THEN** its info trajectory MUST contain request accepted/completed, model start/completion, context assembly and first-visible milestones
- **WHEN** it completes with two model invocations and one capability invocation
- **THEN** its info trajectory MUST additionally contain capability start/completion and the model/child-stage milestones needed to locate where execution progressed or stopped

#### Scenario: Direct diagnostic need not enter the catalog

- **WHEN** a safe component diagnostic is not one of the cataloged required milestones
- **THEN** it MAY still be emitted through the shared writer
- **AND** it MUST obey component, level, safety and duplicate-outcome policy

#### Scenario: Server access has one owner

- **WHEN** Fastify completes or fails an HTTP request
- **THEN** the server boundary MUST emit Fastify's default native `incoming request` followed by exactly one `request completed` or `request errored` record through the common writer
- **AND** Fastify MUST receive a controlled native Pino child derived from the same `agent-log` root writer as its `loggerInstance`, without an app-owned parallel logger facade or custom `LogController`
- **AND** the default Fastify `LogController` MUST remain the sole access-log producer
- **AND** no product owner may emit `http.request.*` or `server.access.*`
- **AND** the incoming and final records MUST share Fastify's native server-generated `reqId`; the incoming record MUST retain safe `req.method` and validated route-template `req.url`, while the final record MUST retain `res.statusCode`, `responseTime` and the fixed native message
- **AND** the access pair MUST NOT project a caught Error or cause chain; unexpected HTTP exception evidence belongs only to the channel termination diagnostic
- **AND** raw URL/query/header/request/reply and client-provided request id MUST NOT enter the record
- **AND** HTTP server metrics MUST be emitted independently by official OpenTelemetry HTTP instrumentation on the shared MeterProvider, MUST NOT use an app-owned `onResponse` metric observer, and MUST NOT generate or modify access records
- **AND** incoming request logging MUST remain enabled as the first member of Fastify's native access pair
- **AND** Fastify stream, serializer, write-head, error-handler and service-unavailable failures MUST retain a stable framework event and pass caught Error through the common writer
- **AND** the adapter MUST serialize only the approved native access fields; raw Fastify req/reply/header/URL/free-form message, router dumps and client-controlled request ids MUST NOT bypass the common writer or enter operational output

#### Scenario: Routine diagnostics do not hide degradation

- **WHEN** policy allow or context assembly success occurs
- **THEN** the corresponding event MUST be info
- **WHEN** context budget/micro-compact success or task trajectory enqueue/build/skip occurs
- **THEN** the corresponding event MAY remain debug
- **WHEN** Skill scan is partial, task trajectory is dropped, or a category-question source enters unavailable state
- **THEN** the corresponding event MUST be warn
- **AND** category-question unavailable/recovered signals MUST be emitted only on state transition per agent and locale

#### Scenario: Run dispatched emitted at info with runCreatedAtMs

- **WHEN** a run is dispatched by the scheduler (and `resumeExecuting !== true`)
- **THEN** runtime MUST emit `runtime.run.dispatched` at info level
- **AND** the log MUST contain `agentId`, `sessionId`, `requestId`, `runId`, `laneKey`, `runCreatedAtMs`
- **AND** `runCreatedAtMs` MUST be `Number(run.createdAt)` and MUST be greater than 0
- **AND** the event MUST NOT appear in timeline store, audit, metric, trace or Web API response

#### Scenario: Run turn completed emitted at info with durationMs

- **WHEN** a run reaches terminal state and a terminal event is published
- **THEN** runtime MUST emit `runtime.run.turn_completed` at info level
- **AND** the log MUST contain `agentId`, `sessionId`, `requestId`, `runId`, `runStatus`, `durationMs`
- **AND** `durationMs` MUST be `terminalEvent.createdAt - run.createdAt` and MUST be greater than or equal to 0
- **AND** the event MUST NOT appear in timeline store, audit, metric, trace or Web API response

#### Scenario: Non-workflow run produces dispatched without workflow start

- **WHEN** a MODEL_DRIVEN_LOOP run is dispatched and completed
- **THEN** it MUST produce `runtime.run.dispatched` at info level
- **AND** it MUST produce `runtime.run.turn_completed` at info level
- **AND** it MUST NOT produce `workflow.execution.started`
- **AND** `runtime.run.dispatched` retains independent diagnostic value for queue-wait analysis

### Requirement: Audit and metrics remain outside operational logging

Operational writer SHALL accept only `runtime_diagnostic` and `observation_derived` surfaces. Audit MUST flow through `AuditEventWriter` to a write-only deployment gateway; LOCAL audit output belongs only to the gateway-owned `nextagent-audit.*.ndjson[.gz]` family and MUST NOT use operational logging or SQLite. Metric samples MUST flow through `MetricsRegistry`/OTel metric adapters and MUST NOT be serialized into operational console, active files or archives. A LOCAL OTel metrics NDJSON history family is a separate output artifact whose complete file lifecycle is owned by `LocalMetricHistoryExporter`; it MUST NOT be treated as an operational-log surface or file-family member. A bounded audit/metrics degraded/recovered component diagnostic MAY enter operational logging, but it MUST NOT contain audit/metric payload and MUST NOT occur per event, sample, snapshot or retry.

#### Scenario: Audit uses gateway writer

- **WHEN** AuditProjector produces an AuditEvent
- **THEN** it MUST call AuditEventWriter backed by the configured gateway sink
- **AND** it MUST NOT call RuntimeLogger or operational writer

#### Scenario: Metrics do not become logs

- **WHEN** MetricsProjector emits samples
- **THEN** samples MUST remain in the metrics pipeline
- **AND** no `metric_diagnostic` operational entry may be produced
- **AND** any LOCAL metrics file output MUST be produced only by the metrics exporter

### Requirement: Exception diagnostics are emitted only at owner-scoped termination boundaries

Every execution root SHALL have one explicit exception termination owner. A catch that rethrows the same exception or throws a wrapper with the original exception as `cause` MUST NOT emit an operational diagnostic for that exception. A catch that consumes the exception by returning a fallback/degraded/safe result, committing a request terminal, mapping a public response, abandoning one supervised background attempt, or terminating the process MAY emit the cataloged diagnostic for that operation and MUST do so for an unexpected INTERNAL exception when the catalog requires root-cause evidence.

The decision to log MUST be derived from static owner/control-flow responsibility. Implementations MUST NOT add an already-logged flag to Error/AgentError, maintain a global Error set, use exception fingerprint as a dedup key, or use AsyncLocalStorage/request-local mutable state to decide whether an outer handler should log. A new failure raised by cleanup, terminal commit, delivery or diagnostic infrastructure is a distinct operation and MAY be logged once by that operation's own termination boundary with a distinct event and failureStage.

`AgentError` SHALL preserve the standard Error `cause` when wrapping adds stable owner context. A catch MUST NOT replace the caught exception with a new exception that omits the cause. The wrapper MUST use a code-owned safe message and MUST NOT interpolate the original message. SafeError/public error projections MUST NOT carry Error/cause objects. The operational writer SHALL project at most four Error nodes including the outer error, at most five NextAgent-owned frame refs across the complete chain, and inspect at most 64 KiB of string material across the complete chain. Cause cycles, excessive depth, exhausted inspection/frame budget, inaccessible properties and projection failures MUST be represented only by omission plus `exceptionChainTruncated=true`; they MUST NOT throw or expose raw values. A non-Error cause MAY appear only as `exceptionType=NonErrorThrow` and terminates the projected chain.

#### Scenario: Propagating model and capability catches do not print

- **WHEN** model, capability or context code emits its canonical safe failed fact and then rethrows the same exception or a cause-preserving wrapper
- **THEN** that intermediate catch MUST NOT call RuntimeLogger with the exception
- **AND** the original cause chain MUST remain available to the request execution termination boundary

#### Scenario: Accepted request exception terminates once in runtime

- **WHEN** an unexpected exception escapes request core execution after the request was accepted
- **THEN** `agent-runtime` MUST emit exactly one `request.execution.exception_captured` direct diagnostic with trusted request/run coordinates and `failureStage=REQUEST_EXECUTION`
- **AND** runtime MUST normalize the public result and continue the existing safe terminal commit path
- **AND** the canonical request failure MAY remain a separate trajectory outcome but MUST NOT contain the Error or duplicate its exception chain
- **AND** a terminal commit failure MUST use its own terminal-commit event/failureStage and MUST NOT be reported as scheduler dispatch failure

#### Scenario: Channel top handler consumes an unexpected synchronous exception

- **WHEN** a Web or Task channel exception occurs before runtime has converted an accepted request into a terminal fact
- **THEN** the channel top error handler MUST map a known non-INTERNAL AgentError or a boundary-owned Fastify/TypeBox schema validation failure to its safe existing status without a dedicated exception diagnostic
- **AND** it MUST map an INTERNAL AgentError or unknown exception to a safe 500 response and emit exactly one `server.framework.failed` / `FASTIFY_INTERNAL` or `channel.task.request.failed` / `TASK_CHANNEL_REQUEST` safe exception diagnostic according to the transport root
- **AND** a Fastify access record MAY express the transport outcome but MUST NOT attach the same caught exception chain again

#### Scenario: Nested startup failure is printed only at deployment termination

- **WHEN** gateway composition or server listen catches an exception, performs cleanup and rethrows with the original exception as cause
- **THEN** the intermediate app helper MUST NOT log the exception
- **AND** the app composition/startup wrapper MUST throw `AgentError(code=APP_START_FAILED, category=INTERNAL)` with the original cause and an allowlisted `safeDetails.failureStage` for composition failures, server listen failures and other non-degraded startup failures
- **AND** `agent-app` MUST expose one package-root classifier that validates the wrapper code, category and stage against the single app-owned allowlist and returns `APP_STARTUP` for every unknown or invalid input
- **AND** the deployment boundary MUST use that classifier and MUST NOT duplicate the allowlist, import an `agent-app` private path or infer the stage from message, stack or frame text
- **AND** the LOCAL or REMOTE deployment startup boundary MUST emit exactly one startup failure diagnostic before rejecting startup
- **AND** it MUST use the current operational logger only after an app object has been created; a failure before app creation MUST use only the bounded emergency reporter

#### Scenario: Pre-listen startup contribution failure is degraded instead of coupled to listen readiness

- **WHEN** app lifecycle startup reaches any stage before `SERVER_LISTEN` and that stage rejects or throws because a scheduler, worker, validation, channel ready, RAG build, recovery-time gateway or external service is unavailable or invalid
- **THEN** `composeAppLifecycle.start()` MUST emit one safe degradation diagnostic for that stage with an allowlisted `failureStage`
- **AND** non-recovery stages MUST use `app.start.degraded`, while `RUNTIME_RECOVERY` MAY keep its dedicated `runtime.recovery.degraded` event
- **AND** startup MUST continue to the next stage and eventually to `SERVER_LISTEN` instead of wrapping the stage exception as `APP_START_FAILED`
- **AND** server listen failures MUST keep their existing fail-closed startup behavior
- **AND** later runtime requests and maintenance MUST continue to use their normal paths so the external service can become usable after startup

#### Scenario: Pre-acceptance orphan session is a distinct degradation fact

- **WHEN** a sessionless submit creates its internal session and fails before any RequestRun is durably accepted for that submit
- **THEN** runtime MUST emit exactly one `runtime.submit.orphan_session` warning before propagating the submit exception
- **AND** the warning MUST contain only trusted session/parent refs and a bounded safe derived failure reason
- **AND** it MUST NOT contain `err`, exception type, fingerprint, frames or cause
- **AND** once a RequestRun is durably accepted, later checkpoint, canonical-event or enqueue failure MUST NOT classify the session as orphan

#### Scenario: Todo replace adapters propagate without failure logs

- **WHEN** the runtime Todo adapter or SQLite Todo store catches a replace failure and rethrows it
- **THEN** neither layer MUST emit `todo.runtime.replace.failed` nor `todo.gateway.replace.failed`
- **AND** capability canonical failure and the applicable execution termination owner MUST remain responsible for failure evidence

#### Scenario: Shutdown finalizer failure is consumed at its own boundary

- **WHEN** one app shutdown finalizer fails and the lifecycle continues with the remaining finalizers
- **THEN** that finalizer boundary MUST emit one `app.shutdown.finalizer_failed` diagnostic
- **AND** `close()` MUST NOT later rethrow the same recorded exception object
- **AND** the deployment shutdown caller MUST NOT emit another diagnostic for that finalizer failure

#### Scenario: Supervised background failure is consumed

- **WHEN** a scheduler or worker callback catches a failed attempt and keeps the supervisor alive
- **THEN** the callback owner MAY emit one diagnostic for that attempt
- **AND** helpers that only propagate the same failure MUST NOT emit another diagnostic

#### Scenario: Process fatal handler is a last resort

- **WHEN** an uncaught exception or unhandled rejection escapes every normal execution-root boundary
- **THEN** the executable deployment entrypoint MUST emit at most one bounded fatal diagnostic, attempt a bounded operational flush and terminate non-zero
- **AND** writer unavailability MAY use only the bounded emergency reporter
- **AND** the fatal handler MUST NOT recover business execution or be implemented as a reusable agent-app global handler

### Requirement: Runtime logs are separate from observation-derived logs

Runtime diagnostics and observation-derived trajectory entries SHALL share one structured operational writer and file family while remaining logically distinct. Runtime diagnostics are direct component evidence and MUST use `surface=runtime_diagnostic`. Observation-derived entries are projected facts and MUST use `surface=observation_derived`.

Runtime diagnostics MUST NOT be treated as audit truth, metric truth, health truth, canonical lifecycle truth or terminal truth. Observation-derived entries MUST continue to consume approved observations only. The file MUST NOT become an input fact source.

#### Scenario: Runtime logger does not create observability facts

- **WHEN** a business package writes a runtime diagnostic
- **THEN** it MUST use `getLogger` from `agent-common`
- **AND** it MUST NOT call ProjectorHost or construct StructuredLogEntry

#### Scenario: Shared file preserves truth ownership

- **WHEN** both surfaces are written to one file
- **THEN** `surface` MUST distinguish them
- **AND** neither may parse the file to create facts for the other

### Requirement: Business packages use agent-common runtime logger contract

Business packages SHALL depend on `agent-common` only for the structural RuntimeLogger contract and no-I/O `getLogger` facade. The contract SHALL support `error`, `warn`, `info`, and `debug` methods with the `(obj, msg)` shape. They MUST NOT import `agent-log`, `agent-local-file-roll`, Pino, pino-roll, `agent-observability` logger helpers, logging transports, metrics registry, tracer, observability SDKs, zlib or filesystem APIs to emit product operational diagnostics. Adding logging to a class MUST NOT require a new constructor parameter, dependency option or composition-root edit.

#### Scenario: Business dependency prints a direct diagnostic

- **WHEN** a business owner needs a safe operational diagnostic
- **THEN** it MAY call its module/class-scoped logger obtained from `getLogger`
- **AND** it MUST NOT know sink or archive lifecycle

#### Scenario: Business dependency can use the runtime logger contract

- **WHEN** runtime, context, model, core, capability, session, attachment, memory, or gateway-owned code needs an operational diagnostic
- **THEN** it MAY accept or use the `RuntimeLogger` contract from `agent-common`
- **AND** the package does not need a direct Pino or `agent-observability` dependency

### Requirement: Output domains share only the rolling-file mechanism

`agent-app` SHALL create one operational writer. That writer SHALL create both runtime-diagnostic and observation-derived loggers through one RuntimeLogger implementation, differing only by a trusted writer-bound surface. Ordinary business `getLogger` MUST always bind `runtime_diagnostic`; only trusted app composition may obtain an observation-bound logger for StructuredLogProjector. AuditEventWriter, MetricsRegistry/OTel, trace and health outputs MUST NOT be implemented as operational writer adapters. `agent-log` SHALL exclusively own operational schema/policy/output interpretation. `LocalMetricHistoryExporter` SHALL separately own LOCAL metrics schema/policy/output interpretation. The LOCAL AuditEventStoreGateway SHALL separately own audit schema/policy/output interpretation.

Product composition MUST NOT expose or inject a separate StructuredLogTransport, duplicate per-level adapter, caller-selectable surface or second sanitization/routing path. StructuredLogProjector SHALL route each StructuredLogEntry through its logical level on the injected observation-bound RuntimeLogger. Test-only capture loggers MAY be injected only through test composition.

The three production consumers SHALL reuse `agent-local-file-roll` factory and mechanism code but MUST create four independent handles: separate operational and plugin diagnostic handles in `agent-log`, one metrics handle and one audit handle. They MUST NOT share destination, active identity, buffer, timer, maintenance lane, mutable state, close state or policy object. Each handle SHALL use its owner's trusted policy to derive a mutually exclusive selector. The foundation MUST NOT contain output-domain modes or DTOs, and each owner MUST remain the only component that interprets its append/log/export result.

#### Scenario: App composes independent output domains

- **WHEN** observability infrastructure is composed
- **THEN** runtime and trajectory logs MUST share the operational writer
- **AND** audit MUST use its gateway writer
- **AND** metrics MUST use its reader/exporter pipeline
- **AND** the three owners MUST create independent local-file-roll handles while sharing only foundation mechanism code

### Requirement: Runtime log helpers are safe, asynchronous, and non-fatal

Runtime log helpers SHALL be non-throwing and SHALL not perform synchronous sink I/O. They MAY include bounded stable identifiers, safe reason codes, status and buckets. RuntimeLogger SHALL accept an optional `msg` as a separate argument for all levels. The message MUST be based on a code-owned template plus validated low-risk variables, MUST be single-line and bounded to 1 KiB after UTF-8 normalization, and MUST pass the same centralized secret/path masking as structured string values. Caller-provided `msg` or `message` fields MUST be ignored. Invalid or unprocessable message input MUST be omitted while the stable structured event is still emitted.

They MUST NOT serialize raw prompt, model output, stream delta, attachment content, provider body or credentials as ordinary fields. Runtime-owned tool diagnostics MUST include canonical `toolInput` and, once an effective result exists, canonical `toolOutput` for internal local run diagnosis in both normal and debug diagnostic detail. This behavior MUST NOT depend on a raw-payload logging flag or be disabled by `diagnosticDetail`. Content nested under these two fields MUST preserve prompts, paths, commands, result content and non-secret credential/token diagnostic metadata. `agent-log` MUST narrowly redact credential values and authentication tokens without redacting credential references/status, usage token counts, token count/length or tokenization diagnostics. It MUST also apply bounded recursion, field/array/string limits, unsupported-value normalization and the 16 KiB entry fallback before enqueue. Runtime-owned tool failure diagnostics MUST include a bounded `safeErrorSummary` derived only from `SafeError.message` or a code-owned fallback message. `agent-log` MUST centrally own reserved-field filtering, ordinary-field sensitive-key filtering, recursive value normalization, inline secret masking, message normalization, exception projection and entry-size fallback before enqueue. Business callers MUST NOT add parallel logging-only redactors, message sanitizers, Error classifiers or logging-only try/catch wrappers. Producers MUST still apply data minimization for every field other than canonical `toolInput` / `toolOutput`.

RuntimeLogger debug/info/warn/error methods SHALL follow the Pino-compatible `fields, msg?` call shape. Only an exception termination or explicit consume/degrade boundary SHALL pass a caught value unchanged in the standard `err` field; an intermediate catch that continues propagation MUST NOT log it. The logging boundary MUST provide event, failureStage and applicable trusted coordinates, but MUST NOT perform logging-specific Error/AgentError/Node-error-code classification or copy caught properties into alternate fields. It MAY provide `safeReasonCode` only when it is a stable domain subreason that adds information not already encoded by event and failureStage. `fallbackReasonCode` MUST be discarded and MUST NOT appear in the caller convention or physical output; the writer MUST NOT synthesize a generic `UNEXPECTED_FAILURE`. The operational writer SHALL centrally classify and remove raw `err`, but SHALL NOT infer whether the exception should have been logged or deduplicate multiple calls. A non-INTERNAL AgentError on an ordinary failure event SHALL produce stable code/category/retryable without stack evidence; the owner MUST NOT create a dedicated unexpected-exception diagnostic for that expected error. An INTERNAL AgentError or ordinary Error SHALL additionally produce the bounded safe cause-chain projection defined by this change; a non-Error throw SHALL produce `exceptionType=NonErrorThrow` without exposing the original value. For ordinary Error/non-Error throw without an independent safe subreason, event, failureStage, category and exception evidence SHALL be sufficient and `safeReasonCode` SHALL be omitted. Projection or message-sanitization failure MUST omit the affected optional evidence without throwing, dropping the stable event or exposing the original value.

Observation-derived physical entries SHALL flatten only `agentId`, `agentVersion`, `sessionId`, `requestId`, `runId`, `timelineEventId` and `capabilityInvocationId` when present. They MUST NOT persist nested `ownerScope` or `correlation`, tenantId, subjectId, requestContextId or stepId. The writer timestamp records enqueue time; an observation occurrence time, when required, SHALL use the distinct `occurredAt` field.

Unexpected exceptions SHALL produce a direct error diagnostic only at the owner-scoped termination boundary defined by this change. Model, capability, context, composition, gateway, listen, delivery or other intermediate catches that continue propagation MUST preserve the exception/cause and MUST NOT log it. The diagnostic MUST remain distinct from the canonical lifecycle terminal fact and MUST NOT create another observation or persisted timeline event.

An owner catch MUST NOT copy `Error.message`, `Error.name`, `Error.stack` or `String(error)` into an alternate field. If a logger invocation throws, the business owner MUST isolate the failure and MUST NOT retry or emit a logging-failure event through the same logger; only the operational writer may own transport degradation and emergency fallback. Archive or retention maintenance failure MUST NOT reject an otherwise accepted active audit append or metric export.

#### Scenario: Tool failure excludes unsafe input

- **WHEN** a tool-related direct diagnostic is emitted
- **THEN** it MAY contain stable invocation/capability refs and safe reason
- **AND** it MAY contain standard `rawExceptionData.message` / `rawExceptionData.cause.message` only for runtime-owned exception diagnostics after centralized redaction and bounding
- **AND** it MUST NOT contain raw args/result/path/stack/secret or caller-copied exception text in alternate fields

#### Scenario: Unexpected capability exception remains root-cause locatable without an intermediate print

- **WHEN** a capability invocation throws a non-domain Error before returning a safe result
- **THEN** the canonical capability terminal MUST retain its safe generic outcome
- **AND** the capability catch MUST preserve and rethrow the Error without a direct diagnostic
- **AND** the runtime request termination boundary MUST emit one correlated direct diagnostic containing `failureStage=REQUEST_EXECUTION` plus writer-derived exception type/fingerprint/cause-chain/owned frames
- **AND** the runtime request termination boundary MAY include sanitized bounded `rawExceptionData.message` and cause messages for internal run diagnosis
- **AND** neither entry may contain raw stack, host path, provider frame, credential or caller-copied exception text in alternate fields

#### Scenario: Exception projection cannot identify an owned frame

- **WHEN** an Error contains only third-party frames or an unparseable stack
- **THEN** the diagnostic MUST retain failureStage, exceptionType and fingerprint when available
- **AND** it MUST omit exceptionFrames rather than emit the raw stack

#### Scenario: Diagnostic sink failure has one fallback owner

- **WHEN** a business component attempts a runtime diagnostic through `getLogger` and the provider fails
- **THEN** the business result MUST remain unchanged
- **AND** the component MUST NOT invoke the same logger again with a logging-failure event
- **AND** transport degradation evidence, when available, MUST be owned by the operational writer

### Requirement: Runtime diagnostic and trajectory log keep separate responsibilities

Runtime diagnostics SHALL carry local orchestration and component state such as queue, dispatch, commit-private failure, recovery, delivery and maintenance. They MUST NOT duplicate canonical request/model/capability outcomes or become a replay truth source.

Observation-derived logs SHALL provide the default safe request/model/capability/terminal problem-location skeleton plus successful context, policy, hook, sandbox, first-visible and warn/error child-stage evidence where present. Complete durable replay SHALL use canonical timeline and business durable facts, not operational logs alone.

#### Scenario: Default log supports diagnosis without claiming full replay

- **WHEN** an operator filters `surface=observation_derived` at info
- **THEN** the safe request/model/capability/terminal skeleton MUST be available
- **AND** missing debug-period child-stage success MUST NOT be represented as a complete replay guarantee

#### Scenario: Failed tool feedback is traceable without exposing feedback content

- **WHEN** a tool result returns `FAILED` or `TIMED_OUT` and the runtime appends the safe failure payload as a model-visible `CAPABILITY_RESULT`
- **THEN** the runtime MUST emit one `tool.failure_feedback.appended` info diagnostic correlated by run, tool call and capability identifiers
- **AND** the diagnostic MUST include status, safe error code/category, safe error summary, retryability and the feedback message kind
- **AND** the diagnostic MUST NOT include the feedback message content, raw tool result, prompt, model output or stream delta
- **AND** the existing canonical capability completion and degradation facts MUST remain the lifecycle truth

#### Scenario: Debug Tool diagnostic preserves raw input and output

- **WHEN** trusted app config uses normal or debug diagnostic detail and a Tool invocation returns an effective result
- **THEN** runtime direct diagnostic MUST support canonical `toolInput` and `toolOutput` fields containing the actual Tool arguments and effective Tool result
- **AND** prompts, paths, commands, result content, credential references/status, usage token counts, token count/length and tokenization diagnostics nested under those fields MUST remain unchanged unless a capacity bound truncates or replaces the entry
- **AND** credential values, standalone token values, authentication-token variants, explicit credential/token value fields and high-confidence inline `Bearer` or `sk-` values MUST be redacted
- **AND** the redaction rule MUST NOT classify a field as secret solely because its name contains the substring `credential` or `token`
- **AND** a successful or degraded effective result MUST emit an info `tool.payload.captured` runtime diagnostic so the payload remains available at the normal operational level
- **AND** Tool loop and app composition MUST NOT require or expose a raw Tool payload logging switch
- **AND** the diagnostic MUST remain local operational evidence and MUST NOT create or enrich observation, audit, metric, trace, stream, timeline, SafeError or public DTO payloads
- **AND** canonical capability completion MUST remain the lifecycle truth

### Requirement: Untrusted parser diagnostics use stable code-only operational evidence

Diagnostics derived from user, runtime-generated or third-party Skill manifests SHALL be treated as untrusted content. Builtin and local Skill discovery MUST log only the stable parser reason-code list, its count, owner-defined safe outcome code and trusted bounded source coordinates. Parser diagnostic messages, original field names/values, manifest paths and document content MUST NOT enter operational logs. Readiness evidence for the same failure MUST use an owner-defined static safe message rather than copying parser diagnostics.

#### Scenario: Invalid Skill manifest contains secret and path canaries

- **WHEN** Skill discovery rejects a manifest whose parser diagnostic contains document-controlled field text, a credential canary or a host path
- **THEN** the runtime diagnostic MUST contain only stable diagnostic reason codes and their count
- **AND** operational output and readiness evidence MUST NOT contain the parser message, canaries or path
