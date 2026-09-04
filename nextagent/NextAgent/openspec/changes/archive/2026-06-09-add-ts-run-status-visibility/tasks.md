## 0. 当前分支导入预检

- [x] 0.1 对比 `origin/codex/ts-web-channel` 的 status projection 实现和当前分支 runtime/channel/frontend 代码，列出可直接复用、需要重做、需要丢弃的实现点。
  验证：code review 检查点，重点确认远程实现是否仍符合当前 `ts-core-contracts`、session lane、cancel/retry/recovery active change。
  来源：proposal `与当前基线和相邻 change 的边界`。
- [x] 0.2 确认本 change 只消费 canonical `RequestRun.status` 和 committed timeline facts，不生产 pending input、cancel、supersede、retry、policy、context compaction 或 observability sink 事实。
  验证：architecture review 检查点，配合后续 boundary tests。
  来源：design 目标和非目标；proposal 边界说明。

## 1. 契约和测试夹具

- [x] 1.1 在契约测试夹具中补齐 `RunStatus`、`TimelineEventType`、`StreamEventType`、`RunTimelineEvent`、`StreamEnvelope` 和 pending input safe payload fixtures，覆盖 accepted、model delta、capability、degradation、pending input 和 terminal 路径。
- [x] 1.2 增加 vocabulary contract tests，断言用户可见 stream 只能输出 canonical `StreamEventType`，并拒绝 `STREAM_STARTED`、`THINKING_SUMMARY`、`CONTENT_DELTA`、`CAPABILITY_PROGRESS`、`CAPABILITY_FINISHED` 和 `CAPABILITY_DISCOVERED`。
- [x] 1.3 增加 status visibility characterization tests，固定 `ACCEPTED`、`QUEUED`、`PLANNING`、`EXECUTING`、`COMPLETED`、`FAILED`、`CANCELED`、`SUPERSEDED` 在状态查询中的原样输出。

## 2. Runtime 事实发布接入

- [x] 2.1 在 runtime request admission 成功路径发布 `REQUEST_ACCEPTED` timeline fact，并确保当前 canonical `RequestRun.status`（例如同 session lane 主路径中的 `QUEUED`）可被 status projection 读取；不得把 `REQUEST_ACCEPTED` 事件误当成固定 `ACCEPTED` durable status。
- [x] 2.2 对已存在的规划、模型输出、能力调用、context compaction、policy application 和 degradation canonical timeline event 实现投影或 timeline-only 过滤，确保 core/capability 不直接写 Web stream。
- [x] 2.3 对已存在的 `USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT` 和 `USER_INPUT_CANCELED` timeline fact 实现安全投影，并只传递 runtime-owned safe summary；pending input 生产路径由 owning change 定义。
- [x] 2.4 对 terminal commit 成功后已存在的 `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED` timeline fact 实现投影，增加 characterization tests 确认 stream close、disconnect 或 empty output 不能合成 completed。

## 3. Web Channel Projection

- [x] 3.1 在 Web channel boundary 增加共享 run status projection service，输入为 owner-scoped run、timeline event、sequence、pending input safe summary、safe error normalizer、redaction policy 和 clock。
- [x] 3.2 实现 timeline-to-`StreamEnvelope` 投影，设置独立 stream event id、canonical event type、sequence、`timelineEventRef`、safe payload、transport hints 和 `EpochMillis`。
- [x] 3.3 实现 canonical run status visibility，从 `RequestRun.status` 输出用户可见状态，不读取 transport-private state 或前端缓存。
- [x] 3.4 将 SSE 和 WebSocket 的 stream projection 接到同一个 projection service，删除或禁止 adapter-private event name mapping。

## 4. 失败、降级和安全输出

- [x] 4.1 对 owner-scope mismatch 返回 safe authorization error，测试确认不会泄露 unauthorized run、timeline、pending input、model output 或 capability result 是否存在。
- [x] 4.2 对 timeline read failure、runtime unavailable、projection failure、terminal projection failure、redaction failure 和 serialization failure 输出 safe diagnostic 或 safe error；结构化日志/metric sink 由 observability owning change 接入。
- [x] 4.3 对 `DEGRADATION_NOTICE` 增加投影测试，确认 degradation 不改变 `RunStatus`，并输出可被 stream 直接消费、可被未来 audit/metric owning change 消费的 safe projection outcome。
- [x] 4.4 对 pending input payload 增加安全测试，确认不输出 identity、idempotency key、raw answer、timeout behavior、model-formatted answer、raw prompt、secret、credential 或 local path。

## 5. 集成和架构验证

- [x] 5.1 增加正常路径 integration test：request accepted → model/capability progress → completed，断言 stream/status visibility 使用 canonical 名称且状态一致。
- [x] 5.2 增加边界路径 integration test：queued/planning/executing 状态可见，`PLANNING_STARTED` 不被错误投影成未定义 stream event，`HOOK_DECISION_APPLIED` 和 `POLICY_APPLIED` 保持 timeline-only。
- [x] 5.3 增加失败/降级 resilience tests：timeline unavailable、projection failure、redaction failure 和 terminal projection failure 在投影层均可见且安全。
- [x] 5.4 增加 architecture tests，确认 Web channel boundary 不创建 `RequestRun` lifecycle、不持久化执行事实、不依赖 runtime private state。
- [x] 5.5 运行对应 module tests、contract tests、integration/resilience tests，并记录失败项与修复结果。

## 归档前基线提升检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前基线提升计划”处理：

- 同步 `openspec/specs/ts-run-status-visibility/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需新增 `openspec/designs/architecture/request-status-visibility.md`。
- 按需更新 `openspec/designs/architecture/request-run.md`。
- 按需新增或更新 `openspec/designs/architecture/stream-projection.md`。
- 按需更新 runtime boundary 与 Web channel boundary 的长期设计视图。
- 如归档时需要保留长期取舍，按需新增 `openspec/designs/adr/<next-id>-canonical-run-status-visibility.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
