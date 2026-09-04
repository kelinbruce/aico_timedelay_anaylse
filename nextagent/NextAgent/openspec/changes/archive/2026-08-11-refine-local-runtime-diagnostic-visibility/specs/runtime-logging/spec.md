## Function

- **Owning Function**: FN-7.1 输出结构化日志
- **Change Type**: MODIFIED
- **Spec Role**: Primary delta

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: 本地 runtime 执行异常诊断保留受控详细信息

当 Tool 执行、Tool 结果校验、Model invocation、Web request handler、request terminal submit 或 runtime maintenance boundary 捕获执行异常时，系统 SHALL 把 caught exception 提交给本地 `RuntimeLogger`，且配置的 operational runtime log SHALL 包含 writer 派生的结构化 `rawExceptionData`。该字段 SHALL 在既有容量约束内保留异常 name、message、stack、cause 链、sandbox path、URL 和可序列化异常对象字段。

`rawExceptionData` SHALL 只对 password、secret、API key、authorization、cookie、credential value 和认证类 token 做窄匹配脱敏。`credentialRef`、`credentialStatus`、usage token count 及普通 prompt、路径、命令和业务文本 SHALL 保留。各 lifecycle owner SHALL 使用 writer 的统一异常派生入口，不得把 `SafeMessage` 作为本地异常详情的唯一来源。

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

#### Scenario: 原始定位字段不改变客户端安全错误

- **WHEN** 本地 runtime diagnostic 写入 Tool、Model 或 exception 原始定位字段
- **THEN** 客户端和 stream 只接收既有 SafeError、safe payload 或安全 terminal 投影
- **AND** 它们不得包含 special field 的原始业务值、exception message、stack、cause、sandbox path 或 URL

### Requirement: 本地模型调用诊断记录可定位输入输出

每次 Model invocation SHALL 由持有可信 request 和 normalized final result 的 run-bound Model owner 写入一组 direct local runtime diagnostic。Input diagnostic 的 `modelInput` MUST 只包含去除全部 `SYSTEM` message 后的 request `messages`，MUST NOT 包含 Tool descriptors、`modelId` 或其他模型调用选项；output diagnostic SHALL 包含规范化 final result 的 `content`、`toolCalls`、`finishReason`、`usage` 和存在时 `safeError`。

该 owner SHALL 保留 invocation 的 run/step/model profile/provider 关联信息。Output diagnostic MUST NOT 包含 reasoning、provider raw body 或 stream delta。调用在形成 final result 前抛出异常时，owner SHALL 写入带 caught exception 的 Model failure diagnostic，writer SHALL 自动派生 `rawExceptionData`。

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

## Function Change Summary

### Description

将本地 runtime operational log 收敛为可直接定位 Tool、Model 和执行异常的诊断面，同时保持所有产品输出和统一观测面使用安全投影。

### Inputs

- Tool canonical input/output
- 去除 SYSTEM message 前的可信 Model invocation request
- 规范化 Model final result
- runtime owner 捕获的 exception 和可信 correlation context

### Outputs

- 仅本地 operational runtime log 可见的 `toolInput`、`toolOutput`、`modelInput`、`modelOutput`、`rawExceptionData`
- 保持不变的 observation-derived structured log 和客户端 SafeError

### Processing

1. Runtime owner 提交可信 correlation 和原始定位对象。
2. Model owner 在 producer 边界移除 SYSTEM message，并对白名单 final result 建立输出。
3. Runtime writer 对 special field 只执行窄 credential/token 脱敏和容量约束，对 caught exception 统一派生 `rawExceptionData`。
4. External/observation surface 继续执行强裁剪，不消费任何 local special field。

### Result

复杂命令、模型调用和服务端异常可从单一 operational log 按执行坐标定位根因；默认 info 同时避免重复 HTTP 前置记录、成功 owner check 和持续不可用状态淹没业务轨迹，SafeMessage 不再承担本地问题定位职责。

### Specifications

| Specification Item | Change Type | Target Specification Value | Requirement Evidence |
| --- | --- | --- | --- |
| Tool 本地 payload | MODIFIED | 原始 input 和去除 generatedMessages 正文后的 output 保留，仅窄脱敏 credential/token，并保留完整执行坐标。 | Runtime log helpers are safe, diagnostic, and non-fatal |
| Model 本地 payload | ADDED | `modelInput` 仅记录移除全部 SYSTEM message 后的 `messages`，直接记录规范化 visible final output。 | 本地模型调用诊断记录可定位输入输出 |
| 执行异常 | MODIFIED | Writer 从 caught exception 统一派生 message/stack/cause/path/URL，可定位而不依赖 SafeMessage。 | 本地 runtime 执行异常诊断保留受控详细信息 |
| 外部隔离 | MODIFIED | local special fields 不进入 Web、stream、timeline、SafeError、audit、metric、trace 或 observation。 | 本地执行异常诊断不得扩散到产品输出面 |
| 日志拓扑 | MODIFIED | 复用现有 operational destination，不新增开关、store 或平行日志族。 | 正常执行使用单一可关联的安全日志目录 |
