## 背景与问题（Why）

NextAgent 当前把模型 reasoning 作为累计的 `LLM_THINKING_DELTA` 投影到 live stream。该事件被 runtime 按类型固定归为 `LIVE_ONLY`，因此请求结束后只有 final assistant message 和其他 durable timeline facts；刷新或重新打开会话时，已经展示的 thinking 无法恢复。

系统已有清晰的事实边界：`SessionMessage` 保存最终对话内容，`RunTimelineEvent` 保存 request/run 执行过程，`StreamEnvelope` 是 channel-safe 展示投影。Thinking 属于执行过程，不是独立 message，也不应进入 ActiveContext、模型输入或 prefix cache。

本change保持既有`LLM_THINKING_DELTA`事件类型。单次模型调用产生的delta本身就是完整累计内容：调用进行中产生的delta仅用于live展示；调用结束时只把最后一个非空累计delta标记为`completed=true`并持久化。Event history使用runId查询并复用既有channel projector。Fork session在创建时物化复制其message prefix对应的durable events，source删除后child过程历史仍可独立读取。

## 变更范围（What Changes）

- 保持`SessionMessageRole = USER | ASSISTANT | CAPABILITY_RESULT | SUMMARY`，不增加`THINKING` message，不修改terminal assistant message transaction。
- 保持既有 `TimelineEventType.LLM_THINKING_DELTA`；不新增 `LLM_THINKING_SEGMENT_COMPLETED`。
- 统一thinking payload：调用中的累计delta包含完整`reasoning`与`stepId`并省略`completed`；最后一个累计delta增加literal `completed=true`。Canonical payload不增加segmentId、ordinal或presentation字段。
- Agent Core只在单次模型调用结束边界完成thinking：最后一个非空累计delta至多持久化一次；workflow node、Agent request和runtime不得推断thinking完成。
- Timeline persistence使用声明式分类：调用中的`LLM_THINKING_DELTA`为`LIVE_ONLY`，`completed=true`的最后累计delta为`PERSISTED`；`LLM_CONTENT_DELTA`和`CAPABILITY_RESULT_DELTA`保持`LIVE_ONLY`。`emitEvent`只执行统一分类结果，不包含thinking专用分支。
- 完成的thinking delta复用`RunTimelineEventStoreGateway.appendEvent`和`timeline_events`，先append取得canonical sequence，再进入现有live publication；调用中的delta不写row、不消耗sequence。
- `RuntimeSessionPort` 增加 owner-scoped、Agent-scoped、run-scoped event-history query。Web接口固定为 `GET /api/v1/sessions/:sessionId/runs/:runId/events?afterSequence=&limit=`。
- Web event history与SSE、WebSocket、resume共同复用`projectTimelineEventToStreamEnvelope`。完成的thinking delta仍投影为`LLM_THINKING_DELTA`，metadata包含`completed=true`；调用中的delta只含`accumulated=true`。
- Message query只返回最终对话；event query只返回持久化过程；final answer不得从terminal event重建。
- Retry不修改旧attempt events；share/export继续message-only；event history永不进入context、prompt、token budget或prefix cache。
- 新fork在同一composite transaction中复制message prefix、active context和这些display runs的durable events。Copied event使用child session/request/run/event identity与child session sequence，标记`recordOrigin=FORK_SNAPSHOT`，不复制RequestRun、checkpoint、pending input或其他runtime state。
- `FORK_SNAPSHOT`允许省略`requestContextId`；普通runtime timeline record仍必须包含真实`requestContextId`。Lifecycle、recovery、cancel、retry、edit、activeRun和stream控制不得把snapshot run anchor当作可操作RequestRun。
- Fork复制所有匹配source display run的durable timeline events，再由同一Web allowlist决定可见性；live-only delta不会进入复制集合。Source坐标、gateway idempotency metadata和`contentRef`不得进入child snapshot。
- 每个copied run记录`AVAILABLE | LEGACY_UNAVAILABLE`过程快照状态。新fork与递归fork复制available快照并传播legacy unavailable；旧fork缺少可靠映射时只返回明确不可用状态，不猜测或回填。

## 能力边界（Capabilities）

- `ts-core-contracts`：thinking保持event而非message；定义模型调用最后累计`LLM_THINKING_DELTA`语义和run-scoped history facade。
- `ts-minimal-agent-kernel`：在单次模型调用结束边界完成最后累计delta，并按统一persistence policy append/publish。
- `local-run-timeline-store`：持久化完成的thinking delta，支持fork snapshot origin、原子复制、sequence和分页。
- `ts-run-status-visibility`：复用public thinking envelope和shared projector。
- `ts-stream-history-consistency`：message/event双查询与live/history完成态一致。
- `session-fork-from-message`：fork物化child-owned process history但不复制runtime lifecycle state。

## 非目标（Non-Goals）

- 不持久化逐token或可替换delta frame，不从event重建final answer。
- 不把thinking拼接到下一轮模型输入，不改变prefix-cache策略。
- 不新增thinking脱敏、限长、截断、externalize或管理员策略。
- 不在本change完成ProcessPanel history hydration、自动折叠、manual override、动画、滚动或三宿主E2E。
- 不复制RequestRun、checkpoint、pending input、provider invocation、execution workspace或source runtime引用。
- 不回填上线前已经丢失的thinking，也不重建旧fork的source映射。
- 不为public share或文本导出增加thinking内容。

## 影响（Impact）

- Contract：新增runtime event-history query/page；为gateway timeline record增加受控fork snapshot origin并收窄`requestContextId`可选条件；扩展fork composite write和per-run snapshot status。
- Runtime/Core：模型调用producer完成并持久化最后累计thinking delta；workflow node和request lifecycle不推断thinking完成；runtime使用统一persistence classifier并提供event-history facade。
- Persistence：复用`timeline_events`和现有session sequence；fork composite原子写copied snapshot，不新增thinking sidecar或lineage read-through。
- Channel：新增run-scoped REST route，复用shared projector和既有wire event type。
- Frontend：本change仅做现有adapter兼容验证；完整历史过程UI由后续change交付。
- Security：所有查询和复制继续校验Owner Scope与Agent Scope；Web只返回allowlist投影；event永不进入模型上下文。
