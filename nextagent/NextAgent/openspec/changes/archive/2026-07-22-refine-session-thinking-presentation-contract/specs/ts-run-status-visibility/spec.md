## ADDED Requirements

### Requirement: In-progress and completed thinking reuse the existing public envelope

Shared channel projector SHALL把调用中和completed两种canonical `LLM_THINKING_DELTA`都投影为既有public event type。两者必须使用相同reasoning/content/text/contentType、stepId、requestId和runId规则；调用中delta的metadata必须恰为`{ accumulated:true }`，completed delta的metadata必须包含`{ accumulated:true, completed:true }`。

Projector MUST NOT把thinking投影成assistant final answer、message role或新public event type。

#### Scenario: Live in-progress delta omits completion state
- **WHEN**projector处理省略completed的LIVE_ONLY thinking event
- **THEN**envelope metadata MUST包含accumulated=true
- **AND**MUST省略completed

#### Scenario: Completed projection marks completion
- **WHEN**projector处理completed=true的PERSISTED thinking event
- **THEN**envelope MUST保持完整reasoning和stepId
- **AND**metadata.completed MUST为true

#### Scenario: Invalid completed payload fails closed
- **WHEN**thinking event包含completed=false、空reasoning或非法stepId
- **THEN**projector MUST返回projection failure
- **AND**MUST不降级成generic text或assistant answer

### Requirement: Live transports and REST history share one projector

SSE、WebSocket、timeline resume和REST event history SHALL调用同一个`projectTimelineEventToStreamEnvelope`。REST route不得手工复制字段、修改payload或建立第二套allowlist。

#### Scenario: REST history matches completed live state
- **WHEN**同一final event先在live publication出现、随后由REST history读取
- **THEN**两次envelope的event type、payload、run/request correlation和canonical time MUST等价

#### Scenario: Resume includes completed but not in-progress deltas
- **WHEN**client从durable sequence恢复已结束run
- **THEN**resume MUST返回persisted final thinking
- **AND**MUST不生成先前live-only调用中delta frames

#### Scenario: Timeline-only events are filtered consistently
- **WHEN**persisted page包含shared projector判定为timeline-only的event
- **THEN**所有transport MUST使用相同过滤结果
- **AND**不得因REST查询而扩大public payload surface

### Requirement: Run event-history Web API is scoped and schema validated

Web SHALL暴露`GET /api/v1/sessions/:sessionId/runs/:runId/events`。Query `afterSequence`缺省0且必须为non-negative safe integer；`limit`缺省100且必须在1..1000。Route只调用`RuntimeSessionPort.listEvents`。

AVAILABLE response包含projected StreamEnvelope events和optional nextAfterSequence；LEGACY unavailable response只能包含availability、空events且无cursor。任何runtime或projection failure MUST返回safe error，不得返回partial page或raw payload。

#### Scenario: Route delegates by session and run
- **WHEN**authorized client使用合法params/query读取events
- **THEN**route MUST把trusted identity、sessionId、runId和pagination传给runtime facade
- **AND**MUST不调用session或timeline gateway

#### Scenario: Invalid query is rejected before runtime
- **WHEN**afterSequence或limit非法
- **THEN**Web schema MUST返回validation failure
- **AND**runtime facade MUST不被调用

#### Scenario: Empty projected page preserves canonical cursor
- **WHEN**canonical page只包含timeline-only events且仍有下一页
- **THEN**public events MAY为空
- **AND**response MUST保留runtime提供的nextAfterSequence
