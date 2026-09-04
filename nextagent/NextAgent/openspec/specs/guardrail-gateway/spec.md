# guardrail-gateway Specification

## Purpose
定义 GuardrailGateway 作为受治理外部安全路由的唯一出口、决策输入和拒绝结果，使受限操作在执行前获得一致风险判定。
## Requirements
### Requirement: GuardrailGatewayPort is the sole governed egress to RobotRouter

系统 SHALL 新增 gateway adapter kind `guardrail` 与 `GuardrailGatewayPort`，作为 NextAgent 对 RobotRouter IR 的所有调用的唯一受治理出口。`GuardrailGatewayPort` MUST 至少暴露两项操作：input/output guard proxy 转发、nl2py 代码检查。NextAgent 的 ER、nl2py 检查 与任何下游模块 MUST 经 `GuardrailGatewayPort` 调用 RobotRouter，MUST NOT 绕过 gateway 直连 RobotRouter HTTP 端点、在模块内 new HTTP client 或持有 RobotRouter 私有 client/endpoint/credential。

`GuardrailGatewayPort` MUST 通过 trusted app composition 注入的 `GatewayBindings.guardrail` 获得，MUST NOT 由 runtime 动态 import、远程加载或 hot reload。`GuardrailGatewayPort` MUST NOT 暴露 RobotRouter 原始 endpoint、credential 或私有 SDK 类型，只暴露稳定 port 操作与 safe 诊断。

RobotRouter 的护栏接口（guard proxy 端点与 nl2py check 端点）MUST 只能由 NextAgent 后端经 `GuardrailGatewayPort` 调用；前端/客户端 MUST NOT 直接调用任何 RobotRouter 端点，也 MUST NOT 持有或获知 RobotRouter endpoint。前端/客户端只与 NextAgent 自有的 web channel 端点交互；护栏转发对前端透明，由 NextAgent 后端在 request accept 边界内部决定。

#### Scenario: ER forwards through the guardrail gateway port

- **WHEN** 启用护栏的 REMOTE 部署收到客户端请求
- **THEN** Web channel 的 request accept 边界 MUST 经 `GuardrailGatewayPort` 转发到 RobotRouter guard proxy 端点
- **AND** MUST NOT 直接发起对 RobotRouter 的 HTTP 调用

#### Scenario: Frontend never calls RobotRouter directly

- **WHEN** 前端/客户端发起请求
- **THEN** 前端/客户端 MUST 只调用 NextAgent 自有 web channel 端点
- **AND** MUST NOT 直接调用 RobotRouter guard proxy 或 nl2py check 端点
- **AND** RobotRouter endpoint MUST NOT 出现在前端可见的 bootstrap projection 或任何前端可达响应中

#### Scenario: nl2py 检查 goes through the guardrail gateway port

- **WHEN** nl2py 检查 对 python capability 触发代码检查
- **THEN** python capability MUST 经 `GuardrailGatewayPort` 调用 RobotRouter nl2py check 端点
- **AND** MUST NOT 绕过 gateway 直连 `/rest/naie/guardrail/v1/application-sec/check`

### Requirement: Guardrail requires a REMOTE gateway entry and provider

安全护栏 SHALL 只在配置了 `deploymentMode: "REMOTE"` 的 guardrail gateway entry 且注入了 REMOTE guardrail provider 时生效。`deploymentMode: "LOCAL"` 的 guardrail gateway entry SHALL 在 gateway selection 时被过滤（不创建 binding、不执行 guard proxy 转发、不让 nl2py 检查生效），并以 safe diagnostic 记录忽略原因，MUST NOT 因此 fail。

不存在 LOCAL guardrail provider 产品包——护栏是 REMOTE-only 能力。测试通过在 test fixture 中显式注入 inline stub 实现 `GuardrailGatewayPort`（或 REMOTE provider 指向 mock 端点）来验证，MUST NOT 依赖 LOCAL 产品运行时的护栏来源。系统 MUST NOT 在运行时从 LOCAL 回退到 REMOTE 或从 REMOTE 回退到 LOCAL guardrail adapter。

#### Scenario: LOCAL guardrail entry is filtered

- **WHEN** source configuration 含 `deploymentMode: "LOCAL"` 的 guardrail gateway entry
- **THEN** gateway selection MUST 过滤该 entry，不创建 `guardrail` binding
- **AND** guard proxy 转发与 nl2py 检查 MUST 不生效

#### Scenario: REMOTE guardrail entry creates binding

- **WHEN** source configuration 含 `deploymentMode: "REMOTE"` 的 guardrail gateway entry 且注入了 REMOTE guardrail provider
- **THEN** startup MUST resolve REMOTE provider 并创建 `guardrail` binding
- **AND** guard proxy 转发与 nl2py 检查 按配置生效

### Requirement: Input guard is enforced by RobotRouter guard proxy at request submit

启用护栏时，Web channel 的 request submit 路径（`POST /api/v1/sessions/:sessionId/requests`，鉴权与路由之后、`runtime.submit` 之前）SHALL 把原本要交给 runtime 的 submit 请求经 `GuardrailGatewayPort` 转发到 RobotRouter `POST /api/v1/guard/sessions/{sessionId}/requests`，由 RobotRouter 做输入校验。RobotRouter 完成输入校验后回调 NextAgent 既有 `POST /api/v1/sessions/{sessionId}/requests` 触发 `runtime.submit` 执行 Agent。调用 RobotRouter 的发起方始终是 NextAgent 后端。

输入校验不通过时，RobotRouter 直接返回拒答 JSON（`status="BLOCKED"`、`phase="INPUT_GUARD"`、`reason`、`refusalMessage`、`sessionId`），NextAgent MUST NOT 调用 `runtime.submit`，MUST 以 HTTP 400 返回错误响应，`error.code="GUARD_INPUT_BLOCKED"`、`error.message` 为 RobotRouter 的 `refusalMessage`（透传不改写）。NextAgent MUST NOT 在 guard proxy 路径下绕过 RobotRouter 直接 dispatch Agent。拒答语由 RobotRouter 返回，NextAgent MUST NOT 自行生成或改写拒答内容。输出校验由 RobotRouter 作为 run 流的观察者进行，命中时按独立 requirement 注入 terminal `OUTPUT_GUARD_BLOCKED` 并隐藏 assistant 终态消息（不使用 run FAILED 路线）；客户端流始终由 NextAgent 经 `RuntimeSessionPort.streamEvents` 拥有，NextAgent MUST NOT 把 RobotRouter 的事件直接透传为客户端 stream event。

#### Scenario: Input guard blocked refuses without dispatching agent

- **WHEN** 启用护栏且 RobotRouter 输入校验返回 `BLOCKED` / `INPUT_GUARD`
- **THEN** NextAgent MUST NOT 调用 `runtime.submit`
- **AND** MUST 以 HTTP 400 返回 `error.code="GUARD_INPUT_BLOCKED"`、`error.message` 为 RobotRouter 的 `refusalMessage`

#### Scenario: Input guard passed forwards through guard proxy

- **WHEN** 启用护栏且 RobotRouter 输入校验通过
- **THEN** RobotRouter 回调 NextAgent `POST /api/v1/sessions/{sessionId}/requests` 触发 `runtime.submit`
- **AND** 客户端流仍由 NextAgent 经 `RuntimeSessionPort.streamEvents` 投影，不经 RobotRouter 透传

### Requirement: Output-guard block emits terminal OUTPUT_GUARD_BLOCKED via guard-forward relay

启用护栏时，NextAgent SHALL 经 `GuardrailGatewayPort.proxyStream` 把客户端流代理通过 guard 服务（RobotRouter 作为 run 流的观察者做输出校验）。`proxyStream` 接受客户端的 `lastSeenSequence`，guard 服务 SHALL 从该序列续传（而非从 0 重放），避免有历史的会话在重连时发生序列回退。命中风控时 guard-forward relay SHALL 在客户端流注入 terminal `OUTPUT_GUARD_BLOCKED` stream event（依 `refine-stream-guard-blocked-event` 放宽的 guard 层例外），payload 携带 guard reason 与 RobotRouter 返回的 `refusalMessage`。前端收到 `OUTPUT_GUARD_BLOCKED` 后 MUST 只清空本轮已渲染内容（不影响历史轮次）并替换为拒答语。`OUTPUT_GUARD_BLOCKED` 之后 MUST NOT 再出现 `LLM_CONTENT_DELTA` 或 `TOOL_STRUCTURED_DELTA` 事件，且 MUST 以 terminal 语义结束本次请求流。

拒答语由 RobotRouter 返回，NextAgent MUST 透传不改写、不生成；NextAgent MUST NOT 在 output-guard-block 后继续向前端推送已缓冲的模型输出原文。`OUTPUT_GUARD_BLOCKED` 是 guard 层对客户端流的 terminal 信号，不替代 runtime 的 canonical terminal commit 事实——run 仍按正常路径终态提交，但其 assistant 终态消息 SHALL 以 `visible=false` 持久化（经 `TerminalCommitOptions.guardBlocked` + `RuntimeCommandPort.hideRunMessages`，`VisibilityReason="GUARD_BLOCKED"`），从而不进入下一轮 model context。web channel 在流式投递过程中收到 `OUTPUT_GUARD_BLOCKED` 时（模型仍在生成、终态提交之前）触发 `hideRunMessages` 设置 guard-blocked 标志；`commitTerminal` 检查该标志决定 `visible=false`。若标志未赶上终态提交，`hideRunMessages` 的事后 `hideMessage` 兜底将已提交的 `visible=true` 改为 `false`。输出检查 MUST 经 `GuardrailGatewayPort`，前端/客户端仍只与 NextAgent 自有端点交互。本 change 不再使用 `failRun`/run FAILED/`REQUEST_FAILED` 映射路线（已撤除）。客户端流仍由 NextAgent 经 `RuntimeSessionPort.streamEvents` 拥有，`OUTPUT_GUARD_BLOCKED` 是该流上 guard 层注入的唯一例外事件。

#### Scenario: Output guard block emits terminal OUTPUT_GUARD_BLOCKED

- **WHEN** guard-forward relay（`proxyStream`）检测到输出风控命中
- **THEN** NextAgent MUST 在客户端流注入 terminal `OUTPUT_GUARD_BLOCKED` 事件，payload 携带 guard reason 与 RobotRouter 的 `refusalMessage`
- **AND** 该 run 的 assistant 终态消息 MUST 以 `visible=false` 持久化（不进下一轮 model context）
- **AND** 该 terminal 事件之后 MUST NOT 出现增量内容事件
- **AND** 前端 MUST 只清空本轮已渲染内容并替换为拒答语，历史轮次展示不受影响

#### Scenario: Output guard block does not leak buffered output

- **WHEN** output-guard-block 发生时已缓冲未推送的模型输出
- **THEN** guard-forward relay MUST NOT 在该 terminal 事件后推送已缓冲的模型输出原文
- **AND** 拒答 payload MUST 只含 RobotRouter 返回的 `refusalMessage`

#### Scenario: Normal completion不受影响

- **WHEN** 未触发输出风控且流正常结束
- **THEN** 前端 MUST 收到 `REQUEST_COMPLETED` 并保留已渲染内容

### Requirement: A blocked round is excluded from model-visible history in subsequent rounds

当一轮请求因输入或输出护栏被拦截而未产出 model-visible assistant 响应时，该轮的 assistant 响应内容 MUST NOT 作为 model-visible 历史消息持久化，也 MUST NOT 进入后续轮次的 model context。下一轮请求组装 model context 时 MUST NOT 包含被拦截轮次的 assistant 响应原文或其增量片段。

输入 BLOCKED 与 output-guard block 的持久化归属如下，二者均不进入 model context：

- 输入 BLOCKED：Web channel 的 submit 路径 MUST NOT 调用 `runtime.submit`，不创建 run、不产生 terminal timeline event。Web channel MUST 经 `RuntimeCommandPort.recordInputGuardBlock` 持久化一对 `SessionMessage`：用户输入消息（`role=USER`，content 为用户输入原文）与拒答消息（`role=ASSISTANT`，content 为 RobotRouter 透传的 `refusalMessage`，NextAgent MUST NOT 改写或生成）。两条消息 MUST 共享同一 `requestId`、MUST NOT 关联 `runId`，且 MUST 携带 `metadata.modelVisibility = { excluded: true, reason: "GUARD_BLOCKED" }`。两条消息的 `visible` 字段 MUST 为 `true`，使 conversation 接口返回它们供页面渲染（页面可见）；`metadata.modelVisibility.excluded=true` 使 context assembly 排除它们（模型不可见）。该持久化 MUST 幂等：同一 `idempotencyKey` 重复触发 MUST NOT 复制消息对。Web channel 在持久化之后仍 MUST 以 HTTP 400 返回 `error.code="GUARD_INPUT_BLOCKED"`、`error.message` 为 `refusalMessage`，作为前端即时反馈；前端 MUST NOT 依赖本地伪造信封或 `sessionStorage` 镜像维持该轮可见性。
- output-guard block：run 仍按正常路径终态提交，assistant 终态消息以 `visible=false` 持久化（经 `TerminalCommitOptions.guardBlocked` + `RuntimeCommandPort.hideRunMessages`，`VisibilityReason="GUARD_BLOCKED"`），不进下一轮 model context。该路径不在本 change 修改范围。

输入拦截轮的 safe marker（用户输入与拒答消息）`visible=true` 但 `metadata.modelVisibility.excluded=true`：MUST 经 conversation 接口返回（因 `visible=true`，不被 `includeHidden=false` 过滤），使页面刷新、关闭重开、锚定视图与 older/newer 游标分页后该轮均按真实时序位置可见；MUST NOT 被后续轮次的 context assembly 读取为 model-visible 内容——context assembly 的 `isHiddenReplacement` MUST 在 `metadata.modelVisibility.excluded === true` 时返回 true，与 `visible` 字段无关。前端清空只作用于本轮已渲染内容，历史轮次展示不受影响。

`recordInputGuardBlock` 是 `RuntimeCommandPort` 的可选命令，与 `hideRunMessages` 对称：`hideRunMessages` 隐藏已有 run 的 assistant 消息，`recordInputGuardBlock` 记录无 run 的输入拦截轮。该 command 的 identity MUST 来自当前 trusted owner/Agent/session scope，MUST NOT 接受客户端 metadata 或被拦截输入中的 identity override。runtime 实现 MUST 经 `SessionMessageStoreGateway.appendSessionMessage` 写入，MUST NOT 新增 message role、stream event type、gateway port 或数据库表。`metadata.modelVisibility` 是 `SessionMessage.metadata` 的 additive typed extension（owner 为 `agent-contracts/session`），不影响现有 `visible`/`replacement`/`visibility` metadata 字段语义。

#### Scenario: Output-blocked round is hidden from next round model context

- **WHEN** 某轮因 output-guard block 被拦截（run 正常终态提交，assistant 终态消息 `visible=false`）
- **THEN** 该轮的 assistant 响应 MUST NOT 持久化为 model-visible 历史消息
- **AND** 下一轮组装 model context 时 MUST NOT 包含该轮 assistant 响应原文或增量片段

#### Scenario: Input-blocked round produces no model-visible assistant message

- **WHEN** 某轮因输入 BLOCKED 被拦截而未执行 Agent
- **THEN** 该轮 MUST NOT 产生 model-visible assistant 响应
- **AND** 后端持久化的拒答 safe marker（`visible=true` 但 `metadata.modelVisibility.excluded=true`）MUST NOT 被后续轮次的 context assembly 读取为 model-visible 内容
- **AND** 下一轮组装 model context 时 MUST NOT 包含该轮任何 assistant 内容

#### Scenario: Input-blocked round is displayed and survives page refresh

- **WHEN** 某轮因输入 BLOCKED 被拦截（不调用 `runtime.submit`）
- **THEN** 后端 MUST 经 `recordInputGuardBlock` 持久化 `visible=true` 的用户输入消息与拒答消息，且携带 `metadata.modelVisibility = { excluded: true, reason: "GUARD_BLOCKED" }`
- **AND** conversation 接口 MUST 返回该轮消息对（因 `visible=true`，不被 `includeHidden=false` 过滤）
- **AND** 页面刷新、关闭重开、锚定视图与游标分页后该轮 MUST 仍按真实时序位置可见
- **AND** 前端 MUST NOT 依赖本地伪造信封或 `sessionStorage` 镜像维持该轮可见性
- **AND** 该 safe marker 因 `metadata.modelVisibility.excluded=true` MUST NOT 进入后续轮次的 model context

#### Scenario: Input-blocked round HTTP feedback remains unchanged

- **WHEN** 输入护栏拦截用户输入
- **THEN** Web channel MUST 以 HTTP 400 返回 `error.code="GUARD_INPUT_BLOCKED"`、`error.message` 为 RobotRouter 透传的 `refusalMessage`
- **AND** 前端 MUST 凭该 400 响应即时展示拒答，MUST NOT 等待 conversation 重建才显示
- **AND** 该 400 响应 MUST NOT 向客户端流注入新 stream event

#### Scenario: Input-blocked round persistence is idempotent

- **GIVEN** 同一 `idempotencyKey` 的输入拦截已持久化消息对
- **WHEN** `recordInputGuardBlock` 以同一 `idempotencyKey` 重复触发
- **THEN** runtime MUST NOT 复制用户输入消息或拒答消息
- **AND** conversation 接口 MUST 只返回一对该轮消息

#### Scenario: Blocked round safe marker is not model-visible

- **WHEN** 系统为被拦截轮次持久化 safe 标记用于审计或前端展示
- **THEN** 该标记 MUST NOT 被后续轮次的 context assembly 读取为 model-visible 内容

### Requirement: nl2py guard checks python code in the python capability path

nl2py 代码护栏 SHALL 在 `python` capability 执行路径内、真正提交 sandbox 执行前同步执行：当 `ToolDependencies.guardrail` 存在时，python capability SHALL 经 `GuardrailGatewayPort.checkNl2Python` 调用 RobotRouter 内部端点 `POST /rest/naie/guardrail/v1/application-sec/check`，request body 为 `{"type":"nl2py","content":"<python 代码>"}`，消费响应 `{"status": boolean, "error_msg": string[]}`。

`status=false`（BLOCKED）时 python capability MUST NOT 提交 sandbox 执行，并 MUST 以结构化 capability 失败（`status="FAILED"`，safeError code `NL2PY_GUARD_BLOCKED`，message 含 `error_msg`）回灌 AgentLoop，供模型自纠正后改写代码重试。`status=true`（PASS）时放行至 sandbox 执行与后续 risk policy。当 `ToolDependencies.guardrail` 不存在（LOCAL 或未启用护栏）时 python capability MUST 跳过 nl2py 检查、直接执行。nl2py 检查 MUST 只对 `python` capability 生效，MUST NOT 影响其他 capability。

nl2py 检查不走 lifecycle hook：`BEFORE_CAPABILITY_INVOKE` 的 `BLOCK` outcome 会使整轮 run 失败而非产出模型可见的工具失败，无法满足"模型自纠正"。nl2py 在 capability 路径内返回结构化失败既能让模型自纠正、又不动 runtime。本要求 MUST NOT 修改 `risk-policy-enforcement` 的行为契约。

#### Scenario: Blocked nl2py returns a model-visible tool failure for self-correction

- **WHEN** python capability 调用 `checkNl2Python` 返回 `status=false`
- **THEN** python capability MUST NOT 提交 sandbox 执行
- **AND** capability 调用结果 MUST 为 `status="FAILED"`，safeError code 为 `NL2PY_GUARD_BLOCKED`，message 含 `error_msg`
- **AND** 模型可据此改写代码重试

#### Scenario: Passed nl2py forwards to sandbox execution

- **WHEN** python capability 调用 `checkNl2Python` 返回 `status=true`
- **THEN** python capability MUST 放行至 sandbox 执行

#### Scenario: nl2py check is skipped when no guardrail dependency is present

- **WHEN** `ToolDependencies.guardrail` 不存在（LOCAL 或未启用护栏）
- **THEN** python capability MUST 跳过 nl2py 检查
- **AND** MUST 直接提交 sandbox 执行

#### Scenario: Non-python capability is not affected by nl2py

- **WHEN** 触发的 capability 不是 `python`
- **THEN** nl2py 检查 MUST NOT 执行

### Requirement: Guardrail is effective when a REMOTE guardrail binding is present

护栏的启用 SHALL 由 gateway binding 存在性决定：当 trusted app composition 注入的 `GatewayBindings.guardrail` 存在时，guard proxy 转发与 nl2py 检查 MUST 生效；不存在时（未配置 REMOTE guardrail gateway entry 或未注入 REMOTE provider）MUST 不生效。不设独立的 per-agent enable 开关——移除 binding 即关闭护栏。RobotRouter endpoint 由 REMOTE gateway provider selection entry 提供（与其他 remote adapter 一致），不进 per-agent config。拒答语由 RobotRouter 返回，不由 NextAgent 配置。

`/api/v1/runtime/bootstrap` MUST 投影 effective guardrail 状态（`guardrail.enabled`），MUST NOT 投影 credential、secret 或 deployment-private 字段。

#### Scenario: Bootstrap projects guardrail switch state

- **WHEN** 前端请求 `/api/v1/runtime/bootstrap`
- **THEN** 响应 MUST 包含 effective guardrail 状态（binding 存在时 `enabled=true`）
- **AND** MUST NOT 包含 credential、secret 或 deployment-private 字段

#### Scenario: No guardrail binding means guardrail is off

- **WHEN** 未配置 REMOTE guardrail gateway entry 或未注入 REMOTE provider
- **THEN** `GatewayBindings.guardrail` MUST 为 undefined
- **AND** guard proxy 转发与 nl2py 检查 MUST 不生效

### Requirement: Guardrail fails closed when RobotRouter is unavailable

当护栏开关开启且 RobotRouter 不可用、超时或返回非法响应时，护栏 SHALL fail-closed：ER 转发失败 MUST 返回拒答或安全错误，nl2py 检查 MUST 拦截 python 执行，并 MUST 记录 guardrail 专属降级审计事实（`HookInvocationEvent` status 或 guardrail audit event，MUST NOT 复用 `risk-policy-enforcement` 的 `DEGRADED` outcome 名）。系统 MUST NOT 在护栏开启期间因 RobotRouter 故障而放行输入、输出或 python 代码。需要绕过护栏时 MUST 通过关闭 guardrail 开关实现，MUST NOT 在护栏开启时静默放行。

#### Scenario: RobotRouter unavailable blocks when guardrail is on

- **WHEN** 护栏开关开启且 RobotRouter 不可用或超时
- **THEN** ER 转发 MUST 返回拒答或安全错误
- **AND** nl2py 检查 MUST 拦截 python 执行
- **AND** 系统 MUST 记录 guardrail 专属降级审计事实，且 MUST NOT 复用 `DEGRADED` outcome 名

#### Scenario: Disabling the switch is the only way to bypass

- **WHEN** 需要在 RobotRouter 故障期间放行
- **THEN** 必须 通过关闭 guardrail 开关实现
- **AND** MUST NOT 在护栏开启时静默放行

### Requirement: GuardrailGatewayPort validates knowledge content through RobotRouter

`GuardrailGatewayPort` MUST expose `checkKnowledge(input, signal?)` as the governed backend operation for knowledge content security checks. `input.texts` MUST contain 1 to 5 non-empty strings, each containing at most 2000 Unicode code points. `input.isPrivacy` MUST be an optional boolean: when present, the REMOTE adapter MUST send its value as `is_privacy`; when absent, the adapter MUST omit `is_privacy` and allow the provider default to apply.

The REMOTE guardrail adapter MUST call `POST /rest/naie/guardrail/v1/text/security/check` with `texts` in the original order. It MUST use the same outbound Header policy as the existing guardrail checks: `content-type: application/json` only. It MUST NOT add `System-Language`, `X-Product-Id`, `X-Tenant-Id`, owner scope, Agent Scope or caller-provided arbitrary Headers for this operation.

For an HTTP 200 response, the adapter MUST validate the top-level `is_legal` as a boolean and every ordered `check_results[].is_legal` as the exact string `"true"` or `"false"`, then normalize each per-item value to a boolean. `check_results` MUST contain exactly the same number of items as `input.texts`; a missing array, different item count or any other per-item value MUST fail closed as an unavailable result regardless of the top-level value. After this structural validation succeeds, the adapter MUST return legal only when the top-level value and every normalized per-item value are true. A false top-level value or any false per-item value MUST return a blocked result.

`check_results[].detail` MUST NOT be included in the public result, SafeError, log, metric, trace, audit or diagnostic because it can contain the rejected knowledge fragment. HTTP 400 MUST return safe non-retryable `GUARDRAIL_KNOWLEDGE_REQUEST_INVALID`; network failure, timeout, non-400 non-success HTTP status, JSON parse failure or invalid success response MUST return retryable `GUARDRAIL_KNOWLEDGE_UNAVAILABLE`; caller cancellation MUST return non-retryable `GUARDRAIL_KNOWLEDGE_CANCELED`. None of these failures may expose the provider response body, endpoint, credential or checked text.

#### Scenario: Up to five knowledge fragments pass in one request

- **WHEN** `checkKnowledge` receives five non-empty texts of at most 2000 Unicode code points each and `isPrivacy=true`
- **AND** RobotRouter returns top-level legal with five ordered legal item results
- **THEN** the adapter MUST send one request with the five texts in their original order and `is_privacy=true`
- **AND** it MUST return a legal result

#### Scenario: Privacy option remains caller-selectable

- **WHEN** a caller invokes `checkKnowledge` with `isPrivacy=false`
- **THEN** the adapter MUST send `is_privacy=false`
- **AND** it MUST NOT replace the caller value with the provider default

#### Scenario: A blocked fragment blocks the knowledge check

- **WHEN** RobotRouter returns an HTTP 200 response in which at least one ordered item is false
- **THEN** `checkKnowledge` MUST return a blocked result
- **AND** the public result and all observable diagnostics MUST NOT contain the corresponding `detail`

#### Scenario: An inconsistent success response fails closed

- **WHEN** RobotRouter returns HTTP 200 but `check_results` is missing, has a different item count or contains a value other than the exact strings `"true"` or `"false"`
- **THEN** `checkKnowledge` MUST return `GUARDRAIL_KNOWLEDGE_UNAVAILABLE`
- **AND** the result MUST be retryable and MUST NOT expose the response body

#### Scenario: Knowledge check input exceeds its bounded contract

- **WHEN** `checkKnowledge` receives zero texts, more than five texts, an empty text or a text longer than 2000 Unicode code points
- **THEN** it MUST return `GUARDRAIL_KNOWLEDGE_REQUEST_INVALID`
- **AND** it MUST NOT call RobotRouter

