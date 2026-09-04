## FN-1.1 查看会话消息流

### 1. 下游依赖与术语收敛

- [x] 1.1 `add-ts-cross-session-activity-awareness`：声明本 refinement 为实现前置依赖，并统一使用 `Request Execution Stream`、`Session Activity Projection Stream` 与 `isConversationSurfaceVisible`；完成后下游 change 不再把 Activity Stream 描述为未经授权的纯 additive Web stream。
  来源：proposal「变更范围」；design「两类流的唯一边界」「Owner 与依赖边界」
  验证：运行 `rg -n "refine-ts-session-activity-stream-boundary|Request Execution Stream|Session Activity Projection Stream|isConversationSurfaceVisible" openspec/changes/add-ts-cross-session-activity-awareness docs/nextagent-ts-changes/add-ts-cross-session-activity-awareness.md docs/roadmap/ucd-capability-delivery.md`，预期 dependency、术语和浏览器可见性命名均存在，且 `rg -n "hostConversationVisible" openspec/changes/add-ts-cross-session-activity-awareness` 无匹配。
  实际（2026-07-28）：依赖与三个统一术语均已进入proposal、design、spec、tasks和change card；旧`hostConversationVisible`检索无匹配。

- [x] 1.2 roadmap 与 change 卡片：把本 refinement 登记为 active contract prerequisite，并把 session activity implementation 标记为依赖其确认后的两类流边界；完成后 owner、状态、依赖顺序和并行边界具有唯一解释。
  来源：proposal「影响范围」；design「Owner 与依赖边界」
  验证：人工 code review `docs/nextagent-ts-change-roadmap-v2.md`、`docs/roadmap/ucd-capability-delivery.md` 与 `docs/nextagent-ts-changes/add-ts-cross-session-activity-awareness.md`，检查 refinement 为 contract owner、implementation 仍以 `agent-session` 为主 owner，且两者没有并行争夺同一实施文件。
  实际（2026-07-28）：已新增独立refinement card，并同步UCD交付、UCD审查、主roadmap和downstream card；依赖顺序固定为refinement先、implementation后。

### 2. 契约与负向边界验证

- [x] 2.1 完成 legacy Requirement 原子迁移：整体 REMOVED `ts-core-contracts` 的 `Canonical Timeline And Stream Projection`，由 canonical `等价 Web Stream Transport` 完整保留 Request Execution Stream 并增加 Session Activity 唯一例外、两类连接隔离和禁止第三类私有 stream 的场景；未变化的 timeline fact 语义继续由 `ts-run-status-visibility` 承载。
  来源：FN-1.1 + Requirement「等价 Web Stream Transport」Scenarios「同一请求的 SSE 和 WebSocket 输出等价」「Session Activity 的 SSE 与 WebSocket 输出等价」「两类连接并存且互不驱动」「非 Activity 的私有 Stream 不获得例外」；design「存量 Requirement 迁移方案」
  验证：运行 `openspec validate refine-ts-session-activity-stream-boundary --strict`，预期 change valid；随后人工逐项对照稳定 requirement，确认既有 execution scenarios 未被删除或弱化。
  实际（2026-07-28）：严格校验通过；人工逐项对照确认两个稳定requirement的既有正文和全部既有scenario均被保留，并新增ER-only Activity例外及negative scenarios。

- [x] 2.2 下游验证入口：在 `add-ts-cross-session-activity-awareness` tasks 中增加 architecture/contract negative cases，实际断言 Activity 不进入 `StreamEnvelope`、`RuntimeSessionPort.streamEvents(...)`、`agent-contracts/channel` 或 IR route，且 Activity/detail 任一连接失败不改变另一类连接。
  来源：design「失败路径」「验证策略」
  验证：运行 `rg -n "StreamEnvelope|RuntimeSessionPort\\.streamEvents|agent-contracts/channel|IR route|detail.*activity|activity.*detail" openspec/changes/add-ts-cross-session-activity-awareness/tasks.md`，预期全部禁止边界都有明确测试入口和预期失败结果。
  实际（2026-07-28）：downstream tasks已覆盖contract、architecture、ER/IR registration、双连接失败隔离和全量禁止项门禁。

## 整体验证

- [x] 3.1 对本 refinement 与依赖 change 执行 semantic review 和 strict validation；只有不存在未确认 core/agent-contracts 变更、平行 stream owner 或存量代码冲突时，才把 refinement 判定为可供实现依赖。
  来源：design「验证策略」「需群内确认」
  验证：运行 `openspec validate refine-ts-session-activity-stream-boundary --strict`、`openspec validate add-ts-cross-session-activity-awareness --strict` 与 `openspec validate --all --strict`，预期全部通过；`$nextagent-skill-review` 结论预期为 PASS 或 PASS WITH FOLLOW-UP，不得为 BLOCKED。
  实际（2026-07-28）：两个change均strict valid；全仓strict validation为251 passed、0 failed；语义审查结论为PASS，无待确认core contract、agent-contracts、owner或当前代码冲突。
