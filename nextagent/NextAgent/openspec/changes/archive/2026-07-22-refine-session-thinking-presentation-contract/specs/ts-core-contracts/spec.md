## ADDED Requirements

### Requirement: Final thinking is a persisted form of LLM_THINKING_DELTA

TS核心契约SHALL使用既有`LLM_THINKING_DELTA`同时表达调用中的累计delta和单次模型调用的最后累计delta，MUST NOT新增completed thinking event type。两种形态都必须包含trim后非空但保留原始whitespace的`reasoning`和非空`stepId`。调用中的delta MUST省略`completed`并为`LIVE_ONLY`；最后累计delta MUST包含literal`completed=true`并为`PERSISTED`。`completed=false`、调用中delta+PERSISTED、完成delta+LIVE_ONLY及空reasoning均非法。

Canonical payload MUST NOT为本change增加segmentId、segmentOrdinal、content、text或presentation metadata。Public `StreamEventType` MUST保持不变。

#### Scenario: In-progress cumulative deltas remain live only
- **WHEN**模型调用producer连续产生同一step的多个累计thinking deltas且调用尚未结束
- **THEN** events MUST全部为`LLM_THINKING_DELTA`和`LIVE_ONLY`
- **AND** MUST省略`completed`
- **AND** MUST不创建durable timeline row或消耗sequence

#### Scenario: Producer persists the last cumulative delta
- **WHEN**单次model invocation结束且已累计非空reasoning
- **THEN**模型调用producer MUST在其model terminal event前完成并持久化恰好一个`completed=true`的`LLM_THINKING_DELTA`
- **AND**该event MUST包含本次调用最后完整累计reasoning，不得产生新的thinking内容或segment
- **AND** runtime MUST先持久化再发布该event

#### Scenario: Empty reasoning creates no completed thinking event
- **WHEN**model invocation结束但没有接收非空reasoning
- **THEN** MUST不生成completed thinking event
- **AND**既有model terminal flow MUST继续执行

#### Scenario: Workflow lifecycle does not complete model thinking
- **WHEN**workflow node进入`NODE_COMPLETED | NODE_FAILED | NODE_SKIPPED`
- **THEN**workflow projector MUST不据此生成或持久化completed thinking event
- **AND**只有实际模型调用producer MAY完成其自身thinking delta

### Requirement: Conversation message contracts remain unchanged by process history

Thinking process history SHALL NOT扩展session message data model。`SessionMessageRole` MUST继续只包含`USER | ASSISTANT | CAPABILITY_RESULT | SUMMARY`；`SessionMessage`、draft、record和`TerminalCommitRequest` MUST NOT增加thinking role、context participation、segment metadata或thinking bundle。

最终user/assistant内容、capability result和summary继续由visible message承载。Timeline event MUST NOT进入ActiveContext、Context Engine、prompt shaping、provider request、token budget或prefix cache。

#### Scenario: Persisted thinking does not create a message
- **WHEN**completed thinking delta成功持久化
- **THEN** message store MUST不产生thinking row
- **AND** ActiveContext state、items和version MUST保持不变

#### Scenario: Final answer remains a message fact
- **WHEN** request成功提交最终回答
- **THEN** final answer MUST继续作为visible ASSISTANT message持久化
- **AND** system MUST NOT从terminal或thinking event重建最终回答

#### Scenario: Event history cannot enter later model input
- **WHEN** session包含任意数量persisted process events
- **THEN** 下一轮provider input和cache boundary MUST仍只由既有ActiveContext message path决定
- **AND** 有无event history时生成的模型输入 MUST字节等价

### Requirement: RuntimeSessionPort exposes run-scoped event history

`agent-contracts/runtime` SHALL在`RuntimeSessionPort`增加`listEvents`，输入trusted identity、sessionId、必填runId、non-negative safe-integer afterSequence、`1..1000` safe-integer limit和可选AbortSignal。输出必须是exact union：`AVAILABLE`含runtime-safe events与optional cursor；`LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE`只能含空events且无cursor。

Runtime MUST通过`UserSessionPort.requireSession`解析可信Owner/Agent/session，再把runId解析为同session RequestRun或copied-run snapshot status。返回event MUST省略tenantId、subjectId、agentId、contentRef和gateway metadata；普通runtime event包含真实requestContextId，fork snapshot MUST省略。

#### Scenario: Authorized current run returns ordered events
- **WHEN** caller查询合法current run
- **THEN** runtime MUST只返回同owner、Agent、session、request和run的persisted events
- **AND** events MUST按sequence严格升序并支持无重复、无遗漏分页

#### Scenario: Authorized copied run returns child-owned snapshots
- **WHEN** caller查询AVAILABLE copied-run anchor
- **THEN** runtime MUST返回child session/request/run坐标的FORK_SNAPSHOT events
- **AND** MUST不暴露source坐标或requestContextId

#### Scenario: Legacy copied run is explicitly unavailable
- **WHEN** message membership证明runId属于升级前copied prefix但没有可靠snapshot status
- **THEN** runtime MUST返回exact unavailable union
- **AND** MUST不猜测、回读或泄露source run

#### Scenario: Scope and pagination validation fail closed
- **WHEN** identity、Agent、session或run不匹配，或者pagination非法
- **THEN** runtime MUST返回safe failure
- **AND** MUST不访问或返回其他scope的event、payload、sequence或存在性
