## 1. Message 与 event 边界

- [x] 1.1 保持`SessionMessageRole = USER | ASSISTANT | CAPABILITY_RESULT | SUMMARY`，确保message draft/record、ActiveContext和`TerminalCommitRequest`不包含thinking字段。
- [x] 1.2 确保Context Engine、retry、share、conversation adapter和Web message DTO不包含thinking message特例，最终答案继续由ASSISTANT message承载。
- [x] 1.3 保持`LLM_THINKING_DELTA`为唯一thinking event type，不增加segment event、segment identity或runtime thinking状态机。

## 2. Thinking delta 与持久化契约

- [x] 2.1 定义调用中与完成态两种合法`LLM_THINKING_DELTA`：调用中delta省略`completed`并为`LIVE_ONLY`；模型调用最后累计delta包含`completed=true`并为`PERSISTED`。
- [x] 2.2 拒绝空reasoning、空stepId、`completed=false`以及event payload与persistence不一致的组合。
- [x] 2.3 使用统一声明式`TimelineEventPersistencePolicy`分类event，保持`LLM_CONTENT_DELTA`和`CAPABILITY_RESULT_DELTA`为`LIVE_ONLY`，`emitEvent`不包含thinking专用分支。
- [x] 2.4 使用`RunTimelineEventStoreGateway.appendEvent`和`timeline_events`保存completed thinking delta；调用中delta不创建row或sequence。

## 3. 模型调用完成边界

- [x] 3.1 通过`RunBoundModelInvocation`的唯一terminal path，在`MODEL_INVOCATION_COMPLETED|FAILED`之前执行一次异步completion callback，覆盖normal completion、safe error、throw和abort。
- [x] 3.2 Default Agent在单次模型调用内累计reasoning，并在调用结束时完成和持久化最后一个非空累计delta；无reasoning时不生成completed thinking event，持久化失败时不发布model terminal event。
- [x] 3.3 Workflow projector只投影workflow visible output和node lifecycle；`NODE_COMPLETED | NODE_FAILED | NODE_SKIPPED`不得生成或持久化completed thinking event。

## 4. Run-scoped event history

- [x] 4.1 在`RuntimeSessionPort`提供owner-scoped、Agent-scoped、run-scoped `listEvents`，支持严格分页以及`AVAILABLE | LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE`结果。
- [x] 4.2 提供`GET /api/v1/sessions/:sessionId/runs/:runId/events`，只调用runtime facade并对params、query和response执行runtime schema validation。
- [x] 4.3 SSE、WebSocket、resume和REST history复用`projectTimelineEventToStreamEnvelope`；completed thinking投影`metadata={ accumulated:true, completed:true }`。
- [x] 4.4 确保conversation query只返回messages，event query只返回持久化过程事实，event history不进入context、provider input或prefix cache。

## 5. Fork process history

- [x] 5.1 扩展fork composite，在同一transaction内物化child-owned `FORK_SNAPSHOT` events和per-run `AVAILABLE | LEGACY_UNAVAILABLE`状态。
- [x] 5.2 为snapshot重映射child session/request/run/event identities，清除source coordinates、requestContextId、contentRef和runtime-only refs，并保持相对顺序。
- [x] 5.3 确保source删除、source后续变更和recursive fork不影响child-owned history；live-only deltas不进入复制集合。
- [x] 5.4 确保snapshot run anchor不是RequestRun，cancel、retry、edit、recovery、activeRun、stream和模型上下文忽略snapshot facts。

## 6. 一致性与验证

- [x] 6.1 覆盖message/event分离、live completed thinking与cold history一致、final answer message-only以及retry attempt隔离。
- [x] 6.2 覆盖partial零持久化、completed thinking单row持久化、SQLite reopen、append失败以及声明式policy negative cases。
- [x] 6.3 覆盖run history授权、scope、pagination、shared projector、fork原子性、source独立性、recursive fork和legacy availability。
- [x] 6.4 验证现有frontend adapter使用`completed=true`settle当前连续thinking entry，不在本change实现history hydration或ProcessPanel状态机。
- [x] 6.5 运行`openspec validate --all --strict`、受影响contract/runtime/gateway/channel/frontend/architecture测试以及`git diff --check`，区分change失败与仓库既有基线失败。
- [x] 6.6 完成OpenSpec和代码语义验证，确保无未解决P0/P1或`agent-contracts`确认项。
  验证记录（2026-07-28）：群内已确认 run event history public runtime schema 收敛为 `RuntimeListSessionEventsPaginationSchema`；trusted `sessionId` 与 `runId` 继续由 `RuntimeListSessionEventsQuery` 承载，pagination schema 只校验 `afterSequence` 与 `limit`。
- [x] 6.7 覆盖`partial thinking -> answer delta -> completed thinking`真实投影顺序，确保completed snapshot settle当前连续entry且不生成重复thinking卡片。
- [x] 6.8 归档前使用`$openspec-archive-design-sync`更新长期spec、architecture/module design、fork ADR、spec-to-design map和roadmap。
