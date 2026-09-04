## ADDED Requirements

### Requirement: Model producers persist the last accumulated thinking delta at model invocation completion

Default Agent SHALL继续在单次model invocation局部累积reasoning，并通过`RunBoundModelInvocation`的唯一terminal path在`MODEL_INVOCATION_COMPLETED|FAILED`之前完成并持久化最后一个非空累计`LLM_THINKING_DELTA`。该terminal path MUST覆盖normal completion、safe error、throw和abort，MUST对同一invocation至多执行一次completion callback。

Runtime MUST NOT为此新增open-segment state、segment identity、generation token、per-run thinking lane或ordinal recovery。

#### Scenario: Normal model completion orders completed thinking first
- **WHEN**invocation产生partial reasoning后正常完成
- **THEN**最后完整reasoning MUST先作为`completed=true`的PERSISTED thinking delta append/publish
- **AND**MODEL_INVOCATION_COMPLETED MUST获得更大sequence

#### Scenario: Model failure preserves the last accepted reasoning
- **WHEN**invocation产生partial reasoning后以safe error、throw或abort结束
- **THEN**completion callback MUST在MODEL_INVOCATION_FAILED前尝试保存最后累计delta
- **AND**同一invocation的重复failed调用 MUST不重复完成或持久化thinking delta

#### Scenario: Final append failure blocks dependent boundary
- **WHEN**最后累计thinking delta append失败
- **THEN**model terminal event MUST不发布
- **AND**request MUST沿既有safe failure路径结束，不伪造completed history

#### Scenario: Crash before model invocation completion may lose in-progress state
- **WHEN**进程在模型调用producer观察到调用结束前直接终止
- **THEN**未持久化的调用中reasoning MAY丢失
- **AND**recovery MUST不猜测或生成final thinking

### Requirement: Workflow lifecycle does not own model thinking completion

Workflow runtime projector SHALL只投影workflow visible output和node lifecycle。`NODE_COMPLETED | NODE_FAILED | NODE_SKIPPED` MUST NOT作为模型thinking完成边界，MUST NOT据此生成`completed=true`的`LLM_THINKING_DELTA`。

#### Scenario: Workflow node terminal does not synthesize completed thinking
- **WHEN**workflow LLM node此前投影过live-only thinking delta后进入任一node terminal state
- **THEN**projector MUST只输出既有workflow terminal投影
- **AND**MUST不生成PERSISTED thinking delta

### Requirement: Runtime event emission follows one persistence path

`RuntimeOwnedAgentRunStatePort` SHALL调用统一persistence policy决定LIVE_ONLY或PERSISTED。LIVE_ONLY只进入live callback；PERSISTED必须先append canonical record，再进入既有timeline publication。Terminal request events继续由既有terminal composite transaction拥有。

#### Scenario: Main emit path has no thinking special case
- **WHEN**调用中thinking、completed thinking和其他events进入emitEvent
- **THEN**emitEvent MUST通过同一policy结果选择live或append路径
- **AND**不得通过独立thinking branch绕过scope、suppression或publication规则

#### Scenario: Persisted completed event publishes canonical coordinates
- **WHEN**gateway成功append completed thinking
- **THEN**live consumer MUST接收gateway返回的eventId、sequence和createdAt对应投影
- **AND**history query MUST读取同一canonical record

### Requirement: Runtime exposes one scoped event-history facade

Runtime SHALL实现`RuntimeSessionPort.listEvents`并拥有session/run解析、pagination和safe mapping。Web/channel MUST不直连timeline gateway。Current RequestRun优先于copied-run status；没有两者的runId安全失败。

#### Scenario: Current run query uses RequestRun binding
- **WHEN**runId解析为同owner、Agent和session的RequestRun
- **THEN**runtime MUST以该run的requestId和runId查询timeline
- **AND**返回AVAILABLE page

#### Scenario: Copied run query uses snapshot status
- **WHEN**runId不是RequestRun但属于child copied prefix
- **THEN**runtime MUST读取对应snapshot status
- **AND**AVAILABLE读取child snapshot rows，LEGACY_UNAVAILABLE返回exact unavailable page

#### Scenario: Gateway or projection preparation failure returns no partial page
- **WHEN**任一page read、record validation或safe mapping失败
- **THEN**runtime MUST整页失败
- **AND**MUST不返回已读取的前缀events
