# tool-loop Delta Specification

所属 Function：`FN-3.4 工具循环失败保护`

Function 变更类型：修改

spec 角色：主规格

## REMOVED Requirements

### Requirement: Repeated non-terminal capability failures stop the current run

**Reason**：重复失败次数不能可靠代表模型已无可行下一步；它会在模型尚可改用其他 Capability、给出普通答复、核验远端状态或明确结束时，由 Agent loop 提前替模型终止请求，并与“全部非取消最终失败交给模型决策”的统一规则冲突。

**Migration**：普通 Agent 不再生成、记录或比较 Capability failure fingerprint，也不再发出 `CAPABILITY_REPEATED_FAILURE` 或设置局部失败次数阈值。每个非取消最终失败都使用统一 `CAPABILITY_RESULT` 反馈模型；循环收敛只由 canonical `maxTurns`、显式授权/生命周期控制、取消和模型结束共同保证。达到 `maxTurns` 后只允许一次无 Tool 执行权的最终模型收尾；`maxToolCallsPerTurn` 只限制单轮接纳的 Tool call 前缀，不形成独立 retry 或终止条件。

## MODIFIED Requirements

### Requirement: Tool loop preserves failure, timeout, and cancellation truth after streamed deltas

Tool loop MUST NOT treat prior `CAPABILITY_RESULT_DELTA` as proof that the capability succeeded. After zero or more safe deltas, the final capability result MUST continue to control the terminal capability status:

- `FAILED` MUST remain failed and MUST expose the final safe error to the next model round;
- `TIMED_OUT` MUST remain timed out and MUST expose the final safe timeout to the next model round;
- `CANCELED` MUST remain canceled, MUST NOT enter the next model round, and MUST propagate request cancellation;
- `DEGRADED` with usable safe output MUST remain a consumable partial result and continue the normal model loop.

The presence of a prior safe delta, repeated status, repeated arguments, repeated `safeError`, or repeated `structuredPayload` MUST NOT independently terminate the Agent loop or change the final disposition. Canonical `maxTurns` MUST remain the only loop-count convergence bound; exhaustion MUST transition to the single finalizing model turn defined by `达到最大轮次后只执行一次无工具模型收尾`. `maxToolCallsPerTurn` MUST remain a per-turn admission bound and MUST NOT independently terminate the loop.

**需求类别**：功能性需求

#### Scenario: Final failure remains model-visible after safe deltas

- **GIVEN** a capability emitted one or more safe `CAPABILITY_RESULT_DELTA` events
- **WHEN** its final result is `FAILED` or `TIMED_OUT`
- **THEN** the final capability lifecycle status MUST remain failed or timed out
- **AND** the complete safe final error MUST enter the next model round
- **AND** the prior delta MUST NOT convert the result into success or force request termination

#### Scenario: Final cancellation remains cancellation after safe deltas

- **GIVEN** a capability emitted one or more safe `CAPABILITY_RESULT_DELTA` events
- **WHEN** its final safe error category is `CANCELED`
- **THEN** the current request MUST end as canceled
- **AND** the cancellation MUST NOT be presented to the model as a recoverable capability failure

## ADDED Requirements

### Requirement: Agent loop 对最终 Capability 失败执行唯一处置

Agent MUST 只消费统一执行边界返回的最终 `CapabilityInvocationResult`，MUST NOT 根据 `safeError.retryable` 执行同参自动重试。`safeError.retryable` 只约束统一执行边界对当前逻辑调用的自动同参重放；它 MUST NOT 禁止模型读取最终失败后显式选择同一 Capability、修改参数、选择其他 Capability、给出普通答复或结束。

risk policy 明确返回 `decision.outcome=REQUIRE_AUTHORIZATION` 时，它是 runtime-owned 授权控制结果，不是最终 `CapabilityInvocationResult`；系统 MUST 使用 canonical `AUTHORIZATION` pending-input 生命周期。该控制身份 MUST 来源于明确 decision 或其私有控制 sentinel，MUST NOT 根据 `SafeError.category=AUTHORIZATION`、error code、message 或 `safeDetails.pendingInputKind` 等错误外形推断。普通 `AUTHORIZATION` SafeError 即使携带授权提示，也 MUST 作为最终 Capability 失败反馈模型。Lifecycle hook 明确返回的 `PEND`、`DENY` 和 `BLOCK` 是 request lifecycle 控制结果；系统 MUST 使用各自定义的 pending、deny 或 block 处置，MUST NOT 将这些控制结果转换为供模型恢复的 Capability 失败。请求或调用取消 MUST 优先传播。

最终失败 MUST 按以下顺序处置：

1. `safeError.category=CANCELED` 时，当前请求 MUST 结束为取消终态，MUST NOT 进入模型。
2. `safeError.code=CAPABILITY_OUTPUT_INVALID` 时，系统 MUST 追加失败 `CAPABILITY_RESULT`，MUST 允许模型缩小或调整请求、改用其他 Capability、给出普通答复或结束；message MUST 说明原样调用不能解决问题以及可行替代动作。
3. `safeError.code=CAPABILITY_RESULT_UNKNOWN`，或者 `safeError.category` 为普通 `AUTHORIZATION`、`POLICY_DENIED`、`INTERNAL` 时，系统 MUST 追加失败 `CAPABILITY_RESULT`，MUST 允许模型决定下一步；结果未知的 message MUST 要求通过独立查询核验实际状态。
4. 其他 `VALIDATION`、`NOT_FOUND` 或 `CONFLICT` 时，系统 MUST 追加失败 `CAPABILITY_RESULT` 并允许模型修正参数、选择安全替代动作、给出普通答复或结束。
5. `safeError.category` 为 `UNAVAILABLE` 或 `TIMEOUT`，且错误不是 `CAPABILITY_RESULT_UNKNOWN` 时，系统 MUST 在统一执行边界的自动重试已经结束后追加最终失败结果，并允许模型改用其他 Capability、稍后再试、给出普通答复或结束。
6. 没有规则匹配的非取消失败 MUST 先规范化为包含完整安全信息的最终失败，再按相同规则反馈模型。

所有非取消的最终失败反馈给模型时，`safeError.message` MUST 包含领域事实和可操作的下一步建议，MUST NOT 只表达失败本身。模型选择的每个后续调用 MUST 重新通过当前 authority、risk policy 和 sandbox 边界；失败反馈 MUST NOT 扩大权限或绕过任一安全边界。risk policy `DENY` 等最终调用前拒绝也按同一原则产生安全失败结果并反馈模型。

Agent loop MUST NOT 为 `FAILED`、`TIMED_OUT`、`DEGRADED`、空 Tool 名称或单轮 Tool call 超限建立 failure fingerprint、独立错误次数阈值或 `CAPABILITY_REPEATED_FAILURE` 终止。相同 Capability、相同参数和相同错误可以多次进入模型；每次实际调用都 MUST 重新经过治理边界并生成恰好一个配对结果。canonical `maxTurns` MUST 是唯一 loop-count 收敛上限；达到上限时系统 MUST 停止 Tool 执行并进入一次最终模型收尾，不得伪装成 Capability 重复失败，也不得直接跳过收尾构造 max-turn terminal error。`maxToolCallsPerTurn` 只限制单轮接纳的 Tool call 数量，超限反馈 MUST NOT 消耗独立 retry budget 或触发提前 finalization。

当同一 assistant tool-use batch 中任一普通 Capability 在 executor dispatch 前失败时，系统 MUST NOT 执行该 batch 的任一 Capability。失败调用 MUST 获得其实际安全失败结果；其他未执行调用 MUST 各自获得与原 `toolCallId` 配对的 `CAPABILITY_BATCH_REJECTED` 结果，其 `safeError.category` MUST 保持实际 pre-dispatch 失败的 category，避免把 authorization、policy、unavailable 或 internal 失败误报为 sibling 输入 validation。全部配对结果 MUST 写入后再进入下一模型轮次，形成无孤立、无重复的 tool-use/tool-result transcript。

若受治理 Capability 调用边界违反其只返回安全最终结果的契约并同步 throw、异步 rejection，或者最终结果未通过 envelope、generated message、reference、metadata 或 model patch authority 校验，系统 MUST 保留允许进入受控本地诊断的原始异常事实，把非取消异常规范化为包含领域事实、失败阶段和可操作下一步的安全最终失败，并复用同一 `CAPABILITY_RESULT` 与 event 处置；非法原结果和未授权扩展 MUST NOT 进入模型或公共事件，系统 MUST NOT 因调用边界实现缺陷直接终止请求。请求已取消或异常 category 为 `CANCELED` 时，取消 MUST 继续优先传播且 MUST NOT 反馈模型。

隐藏 `ApiCall` 的非 Agentic 直接路径和其他没有普通模型选路的 Capability 路径 MUST 只消费最终结果。成功时系统 MUST 执行该路径定义的后续处理；`safeError.category=CANCELED` MUST 取消请求；其他最终失败 MUST 投影一次安全失败证据并终止，MUST NOT 为恢复该失败启动普通 Agent tool loop。`CAPABILITY_RESULT_UNKNOWN` 的终止 message MUST 要求使用独立查询核验远端状态。

**需求类别**：功能性需求

#### Scenario: 可纠正输入失败反馈模型

- **WHEN** 最终 Capability 结果是包含可操作 message 和 violations 的 `VALIDATION`
- **THEN** Agent MUST 把一个 `CAPABILITY_RESULT` 加入下一轮模型上下文
- **AND** 模型 MUST 能读取最终 `safeError.message` 的 canonical 安全投影和完整 `safeError.safeDetails.violations`
- **AND** Agent MUST NOT 在反馈前自动重复相同调用

#### Scenario: 输出无效允许模型改变编排

- **WHEN** 最终 Capability 结果是 `CAPABILITY_OUTPUT_INVALID + VALIDATION + retryable=false`
- **THEN** Agent MUST 把一个不含非法输出的 `CAPABILITY_RESULT` 加入下一轮模型上下文
- **AND** 最终 `safeError.message` 的 canonical 安全投影 MUST 明确禁止原样重复相同调用
- **AND** 模型 MUST 可以缩小或调整请求、选择其他 Capability 或结束
- **AND** Agent MUST NOT 自动重放该 Capability

#### Scenario: 权限、策略、内部和结果未知失败反馈模型

- **WHEN** 最终 Capability 结果是 `INTERNAL`、`AUTHORIZATION`、`POLICY_DENIED` 或 `CAPABILITY_RESULT_UNKNOWN`
- **THEN** Agent MUST 追加一次安全失败结果
- **AND** Agent MUST 把该 `CAPABILITY_RESULT` 加入下一轮模型上下文
- **AND** `safeError.message` MUST 包含领域事实和可操作的下一步建议
- **AND** 相同 capability + 相同参数再次失败时 MUST 继续把新的配对结果加入下一轮模型上下文

#### Scenario: Bash 命令被 sandbox 拒绝后由模型决定下一步

- **WHEN** Bash 的最终结果包含 `COMMAND_NOT_ALLOWED + AUTHORIZATION`
- **THEN** Agent MUST 把该失败 `CAPABILITY_RESULT` 加入下一轮模型上下文
- **AND** 模型 MUST 能选择允许的命令、其他 Capability、普通答复或结束
- **AND** 后续任一 Capability 调用 MUST 重新通过当前 authority、risk policy 和 sandbox 边界
- **AND** Agent MUST NOT 因第一次该失败直接终止当前请求

#### Scenario: 授权待确认保持 pending 生命周期

- **WHEN** risk policy 对 Capability 调用返回 `REQUIRE_AUTHORIZATION`
- **THEN** 系统 MUST 创建 canonical `AUTHORIZATION` pending input
- **AND** 系统 MUST NOT 把该控制结果改写为失败 `CAPABILITY_RESULT`
- **AND** 系统 MUST NOT 启动该 Capability executor

#### Scenario: 普通授权错误不是授权控制指令

- **GIVEN** risk policy 没有返回 `REQUIRE_AUTHORIZATION`
- **WHEN** preparation、executor 或调用边界返回 `SafeError.category=AUTHORIZATION`
- **THEN** Agent MUST 把该最终失败作为 `CAPABILITY_RESULT` 加入下一轮模型上下文
- **AND** error code、message 或 `safeDetails.pendingInputKind=AUTHORIZATION` MUST NOT 使该错误进入 pending-input 控制流
- **AND** 系统 MUST NOT 因该错误创建 `AUTHORIZATION` pending input

#### Scenario: Lifecycle hook 控制结果不进入模型恢复

- **WHEN** Capability 调用前的 lifecycle hook 返回 `PEND`、`DENY` 或 `BLOCK`
- **THEN** 系统 MUST 按 canonical request lifecycle contract 处理该控制结果
- **AND** 系统 MUST NOT 把该控制结果改写为失败 `CAPABILITY_RESULT`
- **AND** 系统 MUST NOT 启动该 Capability executor

#### Scenario: 普通批次预检失败时整批零执行

- **WHEN** 同一 assistant tool-use batch 中任一普通 Capability 在 executor dispatch 前失败
- **THEN** 系统 MUST NOT 执行该 batch 的任一 Capability
- **AND** 失败调用 MUST 获得其实际安全失败结果
- **AND** 其他调用 MUST 获得 `CAPABILITY_BATCH_REJECTED` 结果
- **AND** 其他调用的 `safeError.category` MUST 等于实际 pre-dispatch 失败的 category
- **AND** 下一模型轮次 MUST 收到每个原始 `toolCallId` 对应的恰好一个结果

#### Scenario: Capability 调用边界异常规范化为失败反馈

- **WHEN** 受治理 Capability 调用边界对已 dispatch 的调用抛出非取消异常
- **THEN** 系统 MUST 保存受控本地原始异常诊断
- **AND** 系统 MUST 追加一个安全失败 `CAPABILITY_RESULT` 并加入下一轮模型上下文
- **AND** 系统 MUST 复用正常失败的 `CAPABILITY_COMPLETED` 和 `DEGRADATION_NOTICE` 处置
- **AND** 安全错误 MUST 说明调用边界失败事实和模型可选择的安全下一步
- **AND** 原始异常、stack 和 cause MUST NOT 进入模型、stream 或 timeline

#### Scenario: 非法最终结果或未授权扩展规范化为失败反馈

- **WHEN** 调用边界返回值未通过最终 envelope、generated message、reference、metadata 或 model patch authority 校验
- **THEN** 系统 MUST 丢弃非法原结果和未授权扩展
- **AND** 系统 MUST 追加一个空业务 payload 的安全失败 `CAPABILITY_RESULT` 并加入下一轮模型上下文
- **AND** 系统 MUST 只发出一次配对 `CAPABILITY_COMPLETED` 和一次正常失败 notice
- **AND** 非法原结果、generated message、reference、metadata 或未授权 patch MUST NOT 进入模型、stream 或 timeline

#### Scenario: 相同失败继续交给模型并由 maxTurns 收敛

- **WHEN** 模型在同一请求内再次显式选择相同 capability 和相同参数且得到相同非取消最终失败
- **THEN** Agent MUST 保存新的配对 `CAPABILITY_RESULT` 并继续模型循环
- **AND** 系统 MUST NOT 发出 `CAPABILITY_REPEATED_FAILURE`
- **AND** 系统 MUST NOT 因重复错误本身终止请求
- **AND** 模型继续调用时 MUST 受 canonical `maxTurns` 和每轮 `maxToolCallsPerTurn` 约束
- **AND** 达到 `maxTurns` 时 MUST 停止任何后续 Tool 执行并进入恰好一次最终模型收尾

#### Scenario: 结果未知反馈模型并要求独立核验

- **WHEN** 最终错误 code 是 `CAPABILITY_RESULT_UNKNOWN`
- **THEN** Agent MUST 追加一次失败 `CAPABILITY_RESULT` 并加入下一轮模型上下文
- **AND** 最终可见 message MUST 要求独立查询实际状态
- **AND** Agent MUST NOT 自动重放该结果未知调用
- **AND** 模型后续显式选择的动作 MUST 重新通过当前治理边界

#### Scenario: Capability 取消结束为取消终态

- **WHEN** 最终 Capability 错误 category 是 `CANCELED`
- **THEN** Agent MUST NOT 把它反馈给模型
- **AND** runtime MUST 提交 `CANCELED` 终态
- **AND** 系统 MUST NOT 把该请求提交为 `FAILED`

#### Scenario: 隐藏 ApiCall 失败不启动模型恢复

- **WHEN** 非 Agentic 直接路径调用隐藏 `ApiCall` 并收到最终失败
- **THEN** 系统 MUST 投影一次安全失败证据并终止当前请求
- **AND** 系统 MUST NOT 启动普通 Agent tool loop
- **AND** 结果未知时终止 message MUST 要求独立查询实际状态

### Requirement: maxTurns 达到上限后只执行一次无工具模型收尾

Agent Core MUST 使用 runtime-ready Agent assembly 已接受的 effective `maxTurns` 限制一个 accepted `RequestRun` 的普通 Agent model turns。新接受 run 的 trusted `RequestContext.agentTurnIndex` MUST 从 `0` 开始；普通 turn index MUST 为 `0..maxTurns-1`，并 MUST 在 pending-input pause、同进程 resume 和进程重启 recovery 后继续使用 checkpoint 恢复的同一个 run-level 计数。恢复同一个已开始 turn MUST 复用原 turn index，MUST NOT 开始一个新的 logical turn。当这些普通 turns 已消费完毕且请求仍未自然结束、进入显式 lifecycle control 或取消时，Agent Core MUST 立即禁止当前 request 后续任何 Capability 执行，MUST 发布 `TOOL_ROUND_LIMIT_EXCEEDED` degradation fact，并 MUST 追加且仅追加一次 finalizing model turn；系统 MUST NOT 因达到 `maxTurns` 直接提交 `REQUEST_FAILED`。

finalizing model turn MUST 复用普通 Agent loop 的 context assembly、render、model invocation、lifecycle hook 和 terminal commit 路径。Agent Core MUST 生成 runtime-owned request-local feedback：一条不持久化为真实用户消息的 `USER` generated message，要求模型基于当前 transcript 中已验证的结果总结完成情况、明确未完成项且不得请求或声称额外 Tool action；以及 `contextPatch.modelOptions.toolChoice=NONE`。Agent Core MUST 保留 request-local patch 的其他字段且只把 `toolChoice` 覆盖为 `NONE`，再由 Context Engine render；该 feedback 不是 Capability result 或 Skill patch，MUST NOT 经过二者的 source authorization。该 feedback MUST 只影响当前 request/run 的该次后续模型调用，MUST NOT 伪造成 `CapabilityInvocationResult`，MUST NOT 修改最后一个 Capability 结果，也 MUST NOT 持久化到 Agent、session、profile 或 provider 配置。

finalizing invocation MUST 保留本轮正常可见的完整 Tool descriptor 集合，MUST NOT 通过 `tools=[]` 表达禁用 Tool。保留 descriptors 只固定请求形态并允许 provider cache 按自身规则工作，MUST NOT 被解释为 NextAgent 承诺 cache hit。runtime feedback MUST 产生 pre-hook canonical `toolChoice=NONE`；governed `BEFORE_MODEL_INVOKE` Hook MAY 继续转换其他合法模型字段，但 Runtime/Agent Core MUST 在 Hook merge 后把 finalizing effective `toolChoice` 约束为 `NONE`，Hook MUST NOT 扩大该轮 Tool 选择权。`NONE` MUST 由模型调用边界映射到 selected provider；若 provider 仍返回 Tool call，系统 MUST 禁止执行。`providerOptions` 和 `modelParams` MUST NOT 用 `toolChoice`、`tool_choice` 或规范化同名 key 覆盖该 canonical 字段。

`executionMode=model-only` 时，Agent MUST 从首次模型调用起保留可见 Tool descriptors，并在 Hook merge 后约束 effective `toolChoice=NONE`；任何 Tool call 都 MUST NOT 执行。一次 `RequestRun` 最多开始 effective `maxTurns` 个普通 logical model turns，并最多开始一个 finalizing turn；同一 logical turn 的 provider retry 或 recovery replay 不得被误计为新的 Agent turn。Tool-call 数量超限、空 Tool 名称或 Capability 最终失败都 MUST 通过安全反馈继续普通 loop，MUST NOT 提前进入 finalizing turn。

`agentTurnIndex` MUST NOT 替代同一 turn 内的 lifecycle stage。若 recovery point 位于 `BEFORE_CAPABILITY_INVOKE`，系统 MUST 从已持久化 assistant Tool-use、Capability results 和 replay guard 继续该 turn，MUST NOT 仅因恢复同一 index 重做已经完成的 model invocation；只有当前 logical turn 的 Tool/result/control 处理闭合后，Agent Core 才能推进 index。

finalizing result 包含非空安全文本时，Agent MUST 丢弃其中全部 Tool call，MUST 禁止 `BEFORE_AGENT_TERMINAL` 或其他 terminal path 新增的 Tool call 执行，并 MUST 使用该文本通过 canonical terminal success 路径完成 request，同时保留 `maxTurns` degradation notice。finalizing result 只有 Tool call、没有非空安全文本或违反安全结果 contract 时，Agent MUST 使用 `TOOL_ROUND_LIMIT_EXCEEDED` safe error 失败，MUST NOT 再次调用模型。模型调用边界返回真实 `safeError` 时 MUST 保持该失败；父请求取消 MUST 优先产生取消终态。任何分支都 MUST NOT 进入第二个 finalizing turn。

**需求类别**：功能性需求

#### Scenario: maxTurns 达到上限后总结最后一批 Tool 结果

- **GIVEN** 普通 turn `0..maxTurns-1` 已经消费完毕，最后一轮产生的 Tool 结果已进入 canonical transcript
- **WHEN** Agent 准备开始 `turn=maxTurns`
- **THEN** Agent MUST 注入 finalizing generated message 和 `contextPatch.modelOptions.toolChoice=NONE`
- **AND** MUST 保留与普通 render 相同的 Tool descriptors
- **AND** MUST 调用模型恰好一次，使模型能够总结最后一批 Tool 结果
- **AND** MUST NOT 执行该轮返回的任一 Tool call

#### Scenario: 暂停和恢复保持同一 RequestRun 的轮次计数

- **GIVEN** 一个 `RequestRun` 已开始若干普通 logical model turns
- **WHEN** request 经 pending-input pause、同进程 resume 或进程重启 recovery 后继续
- **THEN** Agent MUST 从 recovered `RequestContext.agentTurnIndex` 继续
- **AND** recovery replay 同一个已开始 turn MUST 复用原 index；只有该 turn 已闭合时才推进到下一 index
- **AND** 该 run 开始的普通 logical turns 总数 MUST 不超过 effective `maxTurns`
- **AND** 已进入 finalizing 状态的 run MUST NOT 回到普通 turn 或再次开始 finalizing turn

#### Scenario: model-only 保留 Tool descriptors

- **WHEN** effective `executionMode=model-only`
- **THEN** 模型请求 MUST 保留当前 Agent 可见的 Tool descriptors
- **AND** pre-hook 与 post-hook effective `toolChoice` MUST 均为 `NONE`
- **AND** governed Hook MUST NOT 扩大 model-only Tool 选择权，provider 违反约束返回的任一 Tool call 仍 MUST NOT 执行
- **AND** Tool executor invocation count MUST 为 `0`
- **AND** 系统 MUST NOT 通过清空 `tools` 改变 capability disclosure

#### Scenario: 收尾轮返回文本和 Tool call

- **WHEN** finalizing model result 同时包含非空安全文本和一个或多个 Tool calls
- **THEN** Agent MUST 丢弃 Tool calls 且 executor invocation count MUST 保持不变
- **AND** `BEFORE_AGENT_TERMINAL` 新增的 Tool calls 同样 MUST NOT 执行
- **AND** Agent MUST 使用安全文本完成 canonical terminal success commit

#### Scenario: 收尾轮无法提供安全文本

- **WHEN** finalizing model invocation 失败、只返回 Tool calls或没有非空安全文本
- **THEN** Agent MUST 保持真实 model failure，或使用 `TOOL_ROUND_LIMIT_EXCEEDED` safe error 结束
- **AND** MUST NOT 启动第二个 finalizing model invocation
- **AND** 父请求已取消时 MUST 提交 `CANCELED` 而不是 `FAILED`

### Requirement: maxToolCallsPerTurn 只接纳有界 Tool call 前缀

Agent Core MUST 使用 runtime-ready Agent assembly 已接受的 effective `maxToolCallsPerTurn` 统一限制一个普通 model turn 可接纳的 Tool call 数量；它 MUST 按模型输出顺序计数全部 Tool calls，不区分 read-only 与 side-effecting Tool，也不按不同 Tool 名称去重。`maxToolCallsPerTurn` MUST 是单轮 capacity guard，MUST NOT 作为请求级累计预算、独立 retry budget 或 loop terminal condition；禁用 Tool MUST 使用 `executionMode=model-only` 或 effective `toolChoice=NONE`，MUST NOT 使用零值复用数量限制语义。

当非流式模型一次返回的 Tool calls 数量超过 effective `maxToolCallsPerTurn` 时，Agent Core MUST 按原始顺序只接纳前 `maxToolCallsPerTurn` 个 calls。canonical assistant tool-use message MUST 只包含接纳的 calls；系统 MUST 对接纳前缀执行 canonical 整批 preflight、治理、执行、事件和结果配对规则。超限尾部 calls MUST NOT 写入 canonical assistant message、MUST NOT 执行、MUST NOT 创建 synthetic Tool result，也 MUST NOT 形成孤立 tool-use/result pair。

Agent Core MAY 让同一 turn 的 admitted ordinary Tool calls 受控并行执行；未选择并行时 MUST 按模型顺序串行执行。两种方式都 MUST 为每个 admitted call 保留独立稳定 `toolCallId`、capability lifecycle events、result 和 safe error handling；无论完成顺序如何，canonical Tool results MUST 按模型返回 calls 的原始顺序回填。pending-input 或其他明确要求互斥的 control call MUST 遵守其 canonical 串行语义，MUST NOT 进入并行执行。

接纳前缀的全部配对结果闭合后，Agent Core MUST 发布一次 `TOOL_CALL_LIMIT_EXCEEDED` degradation notice，并 MUST 通过 runtime-owned request-local `USER` generated message 把 requested、admitted 和 omitted counts 反馈给下一模型轮次，要求模型在仍需继续时拆分剩余工作。该反馈 MUST NOT 把 admitted count 声称为实际执行成功数量，MUST NOT 伪装成 Capability result，MUST NOT 持久化为真实用户消息，MUST NOT 声称超限尾部已经执行。系统 MUST 继续普通 Agent loop；连续超限 MUST 每轮按同一规则处理，MUST NOT 使用 `toolCallLimitRecoveryLimit`、连续纠正计数、`MAX_TOOL_CALLS` finalizing reason 或其他局部阈值。

若接纳前缀中的任一普通 Capability 在 executor dispatch 前失败，canonical 整批零执行和配对失败规则 MUST 只作用于接纳前缀；超限尾部仍保持未接纳且不生成结果。若该普通 turn 同时是最后一个允许的 normal turn，系统 MUST 先闭合接纳前缀的 canonical tool-use/results 并加入超限反馈，再进入 `maxTurns` finalizing turn，使总结能够看到实际已执行和明确未执行的事实。

**需求类别**：功能性需求

#### Scenario: 非流式 Tool calls 超限时只接纳有界前缀

- **GIVEN** effective `maxToolCallsPerTurn=30`
- **WHEN** 一个普通 model turn 按顺序返回 `35` 个完整 Tool calls
- **THEN** canonical assistant tool-use message MUST 只包含前 `30` 个 calls
- **AND** 系统 MUST 只允许该前缀进入 canonical 治理和 Tool invocation 路径
- **AND** 后 `5` 个 calls MUST 不保存、不执行且不生成 synthetic results
- **AND** 前 `30` 个 calls MUST 按 canonical 规则各自获得恰好一个配对结果

#### Scenario: 超限反馈要求模型拆分剩余工作

- **GIVEN** 当前 turn 请求的 Tool call 数超过 effective `maxToolCallsPerTurn`
- **WHEN** 接纳前缀的配对结果已经闭合
- **THEN** 下一模型轮次 MUST 收到包含 requested、admitted 和 omitted counts 的安全反馈
- **AND** 反馈 MUST 明确省略部分未执行并要求模型按后续 turns 拆分剩余工作
- **AND** Agent MUST 继续普通 loop，不得因连续超限提前 finalization 或失败

#### Scenario: 接纳前缀并行执行后按模型顺序配对

- **WHEN** 同一普通 turn 接纳多个可并行 ordinary Tool calls
- **THEN** 系统 MAY 让这些 invocations 在时间上重叠
- **AND** 每个 call MUST 获得与原 `toolCallId` 对应的恰好一个 result
- **AND** canonical results MUST 按模型返回 calls 的顺序回填而不是按完成顺序回填

#### Scenario: 同批 Tool 调用保持取消和 pending-input 语义

- **WHEN** admitted batch 正在执行时父 `AbortSignal` 触发，或 batch 包含创建 runtime-owned pending input 的 control Tool
- **THEN** 父取消 MUST 传播到全部已启动的同批 invocations
- **AND** pending-input Tool 之后的 calls MUST 等待 run resume，MUST NOT 提前执行
- **AND** 一个 model turn MUST NOT 因并行执行创建多个竞争 pending-input facts

#### Scenario: 最后一个普通 turn 超限后仍保持总结上下文完整

- **GIVEN** 当前 turn 是 `maxTurns` 允许的最后一个普通 turn
- **WHEN** 模型返回超过 `maxToolCallsPerTurn` 的 Tool calls
- **THEN** 系统 MUST 先闭合接纳前缀的 assistant tool-use 和全部配对结果
- **AND** MUST 注入明确省略尾部未执行的超限反馈
- **AND** 随后的唯一 finalizing model turn MUST 能看到上述实际执行结果和未执行事实
- **AND** finalizing turn MUST NOT 执行任何 Tool call

### Requirement: 空 Tool 名称只产生可修正反馈

Agent loop MUST 在 Capability resolution 前检查 admitted Tool call 前缀中的 `toolName`。trim 后为空的名称 MUST 被视为可由下一模型轮次修正的 model-output defect，而不是 Capability、authorization 或 request terminal failure。若 admitted 前缀包含空名称，Agent loop MUST 不执行该前缀的任何 call，不持久化该 assistant tool-use message，不生成 synthetic Tool results，并 MUST 发布 `TOOL_NAME_EMPTY` degradation notice 和 request-local model-visible correction feedback；feedback MUST 列出 affected `toolCallId`，MUST NOT 包含 raw arguments。

`maxToolCallsPerTurn` prefix admission MUST 先于空名称校验。若同一 model result 同时超限且 admitted 前缀含空名称，feedback MUST 同时说明 requested/admitted/omitted counts 和 admitted prefix 中的空名称事实；超限尾部保持未接纳。重复空名称 MUST 每轮执行同一规则，MUST NOT 建立连续计数、reset 规则或独立失败阈值；loop 只受 `maxTurns`、模型结束、显式控制和取消收敛。

**需求类别**：功能性需求

#### Scenario: 空 Tool 名称不破坏消息配对

- **WHEN** admitted Tool call 前缀包含一个或多个 trim 后为空的 `toolName`
- **THEN** Agent Core MUST 发布 `TOOL_NAME_EMPTY` 并向下一模型轮次反馈 affected `toolCallId`
- **AND** MUST NOT 执行该前缀中的任何 Tool call
- **AND** MUST NOT 保存该 assistant tool-use message 或创建无锚点 Tool results
- **AND** request MUST 继续普通 loop

#### Scenario: 重复空 Tool 名称不建立局部终止阈值

- **WHEN** 模型在连续普通 turns 中重复返回空 Tool 名称
- **THEN** 每个 turn MUST 获得同形可修正反馈
- **AND** 系统 MUST NOT 维护 empty-name recovery counter 或因此提前失败
- **AND** 达到 `maxTurns` 时 MUST 进入唯一 finalizing turn

### Requirement: 失败结果复用正常 CAPABILITY_RESULT 路径

Agent MUST 使用与成功结果相同的 session message、context render 和大结果转储路径保存失败 `CapabilityInvocationResult`。模型可见失败 payload MUST 具有以下目标形态：

runtime `CapabilityInvocationResult.safeError` 的消息字段 MUST 为 `message`。生成模型可见 `CAPABILITY_RESULT` 时，系统 MUST 把该值映射到 payload 的 `safeError.errorMessage`。`message` 属于 runtime result，`errorMessage` 属于模型投影，Capability producer MUST 只提供 runtime `message`。

```json
{
  "status": "FAILED",
  "result": {},
  "safeError": {
    "code": "CAPABILITY_INPUT_INVALID",
    "category": "VALIDATION",
    "errorMessage": "Input validation failed for 2 constraints. Correct the listed fields and call the capability again.",
    "retryable": false,
    "safeDetails": {
      "violations": [
        {
          "path": "/query",
          "constraint": "minLength",
          "expected": "a non-empty string"
        },
        {
          "path": "/limit",
          "constraint": "maximum",
          "expected": "an integer no greater than 100"
        }
      ]
    }
  }
}
```

完整失败结果超过公共 inline 阈值时 MUST 转储完整序列化结果，并向模型提供 canonical `PERSISTED_PREVIEW`、`contentRef` 和受治理的 Read 回读说明。失败结果 MUST NOT 因转储而改变 status、`safeError` 或终止分类。

**需求类别**：功能性需求

#### Scenario: Runtime message 映射为模型 errorMessage

- **WHEN** 最终 runtime 结果包含 `safeError.message`
- **THEN** 模型可见 `CAPABILITY_RESULT.safeError.errorMessage` MUST 等于该安全 message
- **AND** runtime `CapabilityInvocationResult.safeError` MUST 只声明 `message`
- **AND** Capability producer MUST 把该消息交给模型投影边界完成字段映射

#### Scenario: 大型失败结果可供模型完整回读

- **WHEN** 最终失败结果超过公共 inline 阈值但未超过公共单结果转储容量
- **THEN** session 中 MUST 保存一个 `CAPABILITY_RESULT`
- **AND** 模型 MUST 收到 `PERSISTED_PREVIEW`、`contentRef` 和 Read 回读说明
- **AND** 回读内容 MUST 包含原始完整安全失败结果

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：Agent 把全部非取消 Capability 最终失败交给模型决策，以 `maxTurns` 作为唯一 loop-count 收敛上限，并以 `maxToolCallsPerTurn` 对每轮 Tool calls 执行前缀接纳；达到最大轮次后通过一次无 Tool 执行权的模型收尾完成对用户的最终说明。
- 依据 Requirements：`Agent loop 对最终 Capability 失败执行唯一处置`、`maxTurns 达到上限后只执行一次无工具模型收尾`、`maxToolCallsPerTurn 只接纳有界 Tool call 前缀`、`空 Tool 名称只产生可修正反馈`

### 输入

- 变更类型：修改
- 目标内容：失败判断使用最终 `CapabilityInvocationResult.safeError`；授权控制只由明确 `REQUIRE_AUTHORIZATION` decision 或私有控制 sentinel 识别，不从 SafeError 外形推断。
- 依据 Requirements：`Agent loop 对最终 Capability 失败执行唯一处置`

### 输出

- 变更类型：修改
- 目标内容：每个取消之外的最终失败产生一个统一、完整且可操作的 `CAPABILITY_RESULT` 并反馈模型；单轮 Tool call 超限只接纳有界前缀并反馈省略事实；空 Tool 名称不形成孤立消息；达到 `maxTurns` 产生一次有界总结机会。
- 依据 Requirements：`Agent loop 对最终 Capability 失败执行唯一处置`、`maxTurns 达到上限后只执行一次无工具模型收尾`、`maxToolCallsPerTurn 只接纳有界 Tool call 前缀`、`空 Tool 名称只产生可修正反馈`、`失败结果复用正常 CAPABILITY_RESULT 路径`

### 处理过程

- 变更类型：修改
- 目标内容：Agent 不执行 Capability 同参自动重试，也不按重复错误、空 Tool 名称或单轮 Tool call 超限终止；普通循环按 `RequestRun` 跨 pause/recovery 保持计数，并由模型结束、显式控制、取消或 `maxTurns` 收敛，达到上限后只允许一次 `toolChoice=NONE` 的模型收尾。
- 依据 Requirements：`Agent loop 对最终 Capability 失败执行唯一处置`、`maxTurns 达到上限后只执行一次无工具模型收尾`、`maxToolCallsPerTurn 只接纳有界 Tool call 前缀`、`空 Tool 名称只产生可修正反馈`、`Tool loop preserves failure, timeout, and cancellation truth after streamed deltas`

### 结果

- 变更类型：修改
- 目标内容：所有非取消的最终失败都反馈模型并获得基于完整安全诊断的决策机会；达到 `maxTurns` 时优先返回模型基于已验证事实形成的最终总结；普通授权错误不创建 pending input，显式授权控制保持 pending。
- 依据 Requirements：`Agent loop 对最终 Capability 失败执行唯一处置`、`maxTurns 达到上限后只执行一次无工具模型收尾`

### 规格

- 规格项：重复失败终止阈值
- 变更类型：修改
- 原规格值：同一请求中第 `3` 次相同非终态 Capability 失败终止
- 目标规格值：无局部重复失败、空 Tool 名称或 Tool-call 超限纠正阈值；相关安全反馈继续进入普通 Agent loop
- 依据 Requirements：`Agent loop 对最终 Capability 失败执行唯一处置`、`maxToolCallsPerTurn 只接纳有界 Tool call 前缀`、`空 Tool 名称只产生可修正反馈`

- 规格项：普通模型轮次上限后的收尾
- 变更类型：新增
- 原规格值：不适用（新增）
- 目标规格值：普通模型轮次达到 Agent assembly 已接受的上限且请求仍需结束说明时，追加且仅追加一次保留 Tool descriptors、但无 Tool 执行权的模型收尾
- 依据 Requirements：`maxTurns 达到上限后只执行一次无工具模型收尾`

- 规格项：单轮 Tool call 接纳
- 变更类型：新增
- 原规格值：不适用（新增）
- 目标规格值：每个普通 model turn 只接纳 Agent assembly 已接受上限内的顺序前缀；超限尾部不保存、不执行并反馈模型拆分
- 依据 Requirements：`maxToolCallsPerTurn 只接纳有界 Tool call 前缀`
