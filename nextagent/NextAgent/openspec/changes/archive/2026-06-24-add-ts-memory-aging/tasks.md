## 0. 当前状态校正

- [x] 0.1 确认本 change 当前不是 completed implementation change；不得按旧任务勾选状态归档。
  验证：`packages/agent-memory/src/index.ts` 仍为 skeleton，`agent-common` 尚无 `LongTermMemoryState`，`agent-contracts/gateway` 尚无 `LongTermMemory*` Record/Request/port contract，`openspec/specs/memory-aging/spec.md` 尚未归档；code review 记录该 change blocked by memory prerequisites。

- [x] 0.2 重新确认 release scope 是否纳入 Long-term memory 产品能力及 memory aging lifecycle。
  验证：release scope / roadmap 记录明确包含 memory core、configuration、tools/detail access 和 aging；若未确认，本 change 保持 blocked。

## 1. 前置依赖门禁

- [x] 1.1 完成并验证 `add-ts-memory-core`，提供可消费 memory core contract。
  验证：当前代码基线中 `agent-common` 暴露 `LongTermMemoryState`，`agent-contracts/gateway` public subpath 暴露使用该 common enum 的 `LongTermMemoryRecord`、`LongTermMemoryStoreGateway`、`LongTermMemoryRetrieverGateway`、`transitionLongTermMemoryState`、`adjustLongTermMemoryConfidence`、`markLongTermMemoryAccessed`；`ListLongTermMemoryQuery` 支持 `stateFilter`、`isPinned`、`maxLastAccessedAt`、`maxArchivedAt`；`getLongTermMemoryDetail` 可读取 retained ARCHIVED record 供 revival helper 判定；对应 contract tests 通过。归档顺序按 OpenSpec release 流程处理，不替代源码/测试核验。

- [x] 1.2 完成 memory core 的 gateway-local persistence 实现。
  验证：gateway-local memory store/retriever tests 覆盖 owner scope、agent scope、L1/L2、accessCount、physical delete、state transition、confidence clamp、storage degradation；不得使用 generic records table 承载 memory facts。

- [x] 1.3 完成 `add-ts-memory-configuration` 中 `nextAgent.memory.*` namespace 的注册、runtime schema validation 和冻结快照。
  验证：app config tests 覆盖 `nextAgent.memory.aging.enabled`、`schedule`、`decayStaleDays`、`archiveRetentionDays`、`decayFactor`、`batchLimit`、`timeoutMs`、`reviveConfidenceBoost` 的默认值、范围和非法拒绝；`enabled=true + schedule unset` 不启动后台 scheduler 但允许受控管理/测试 trigger。

- [x] 1.4 完成 `add-ts-memory-tools` 的 owner-authorized `get_memory_detail` L2 detail access boundary，供 revival-on-access 接线使用。
  验证：memory tools `get_memory_detail` 已通过 public boundary 调用 `LongTermMemoryRetrieverGateway.getLongTermMemoryDetail`；该路径注入 trusted tenantId、subjectId 和 agentId。maintenance detail API 不作为当前 change 的并行前置路径。

## 2. Aging 契约和诊断

- [x] 2.1 定义 `MemoryAgingConfig` 消费快照和 `MemoryAgingCycleResult` / safe reason code 契约。
  验证：contract tests 覆盖 `SKIPPED`、`COMPLETED`、`PARTIAL`、`FAILED`，以及 processed/decayed/archived/deleted/revived/skipped/failure counts；诊断不包含 memory content、prompt、raw error、路径、credential 或 token。

- [x] 2.2 定义 aging disabled、core disabled、storage unavailable、invalid config、timeout、cancellation、update conflict 的降级语义。
  验证：unit/contract tests 断言对应 reason code 和 status；failure 不创建或修改 RequestRun、SessionMessage、canonical timeline、active context 或 stream projection。

## 3. Cycle trigger 和 scope 隔离

- [x] 3.1 实现后台 scheduler / controlled trigger 入口，默认 disabled。
  验证：scheduler tests 断言 disabled 时只返回 `MEMORY_AGING_DISABLED` skipped diagnostic；`enabled=true + schedule unset` 不启动后台 scheduler；`enabled=true + schedule set` 才启动后台 scheduler；受控管理/测试 trigger 可在 enabled 时执行；cycle 不进入 request terminal commit path。

- [x] 3.2 实现 trusted owner+agent scope partition 扫描。
  验证：security tests 构造 `(tenantId, subjectId, agentId)` 交叉 records，断言只处理当前 trusted scope；客户端提交的 owner/agent metadata 被忽略或安全拒绝。

- [x] 3.3 实现同进程 running-window 防重。
  验证：同一进程内，同一 owner scope、trigger identity 和 schedule window 已有 cycle running 时，重复 trigger 不并发执行，返回 `MEMORY_AGING_ALREADY_RUNNING` 或等价 skipped diagnostic；本 change 不新增 durable aging cycle anchor table，不承诺跨进程或跨重启幂等。

- [x] 3.4 验证 remote complete-service backend 禁用本地 aging。
  验证：app composition 选择 remote complete-service memory backend 时，本地 aging scheduler 不启动，revival helper 不接线；aging lifecycle decision 归远端长期记忆服务或后续 remote adapter owning change。

## 4. Decay、archive 和 delete

- [x] 4.1 实现 stale ACTIVE decay scan。
  验证：通过 `store.listLongTermMemory({ stateFilter: "ACTIVE", isPinned: false, maxLastAccessedAt })` 处理 `lastAccessedAt <= now - decayStaleDays` 的 records；不得直接读取 gateway-local 私有 SQLite/FTS5；staleness 只由 `lastAccessedAt` 判定，`accessCount` 不作为本 change 的 decay 条件；`newConfidence > 0` 时调用 `store.adjustLongTermMemoryConfidence(delta=-decayFactor)`；pinned records 不变。

- [x] 4.2 实现 confidence 降到 0 时自动 archive。
  验证：`newConfidence <= 0` 时调用 `store.transitionLongTermMemoryState(targetState=ARCHIVED, archiveReason="confidence_decayed")`；保留 sourceTrace、createdAt 和 scope；增加 archivedCount。

- [x] 4.3 实现 expired ARCHIVED physical delete。
  验证：通过 `store.listLongTermMemory({ stateFilter: "ARCHIVED", isPinned: false, maxArchivedAt })` 处理 `archivedAt <= now - archiveRetentionDays` 的 records；不得直接读取 gateway-local 私有 SQLite/FTS5；调用 `store.deleteLongTermMemory`；删除后普通检索、time-range 检索、detail 和 revival 均不可返回该 record。

- [x] 4.4 固定 cycle 顺序为 decay -> delete，并遵守 batchLimit、timeout 和 AbortSignal。
  验证：resilience/capacity tests 覆盖 deterministic order、batch limit partial result、timeout/cancellation stop remaining work，以及已完成更新保留计数。

## 5. Revival on L2 detail access

- [x] 5.1 在 `agent-memory` 中实现 owner-authorized L2 detail access 的 aging orchestration helper（如 `getLongTermMemoryDetailWithAging` / `reviveArchivedMemoryOnDetailAccess`），作为 app composition 可选接线点，而不是替代 `LongTermMemoryRetrieverGateway` 的新 contract。
  验证：L1 time-range hit 不复活；helper 先通过 core `getLongTermMemoryDetail` 读取同 owner+agent scope retained ARCHIVED record，读取成功后才调用 `transitionLongTermMemoryState(targetState=ACTIVE)` 并 `adjustLongTermMemoryConfidence(delta=reviveConfidenceBoost)`，confidence clamp 到 `1.0`；not-found / non-owned / physically deleted record 不复活。

- [x] 5.2 在 `get_memory_detail` L2 detail access composition 中接线 revival。
  验证：当 `agingConfig.enabled === true` 且模型工具调用位于 `get_memory_detail` owner-authorized L2 detail access boundary 时触发 revival helper；disabled 时直接使用原始 retriever；跨 owner/agent detail access 不复活并返回 core not-found / not-owned 安全语义。若后续 maintenance detail API 存在，必须复用该 helper，不得复制 revival-on-access 分支。

## 6. 可观测、安全和架构边界

- [x] 6.1 输出 safe structured diagnostic / metric / optional audit event。
  验证：observability tests 断言只包含 cycle id、status、reason code、计数、duration 和安全 entry ref；不得包含 memory content、briefIndex、structured content、source evidence 原文、raw storage error、路径、credential 或 token。

- [x] 6.2 验证 aging 不影响主请求终态。
  验证：integration/resilience tests 断言 aging failure、timeout、cancellation 不改变 RequestRun terminal state、SessionMessage、canonical timeline、active context 或 stream projection。

- [x] 6.3 验证架构边界。
  验证：architecture tests 断言 runtime、channel、context、model、capability packages 不导入 aging implementation，不复制 decay/archive/delete/revival state machine；aging implementation 不导入 gateway-local private path，不调用 model-facing memory tools。

## 7. OpenSpec 和归档

- [x] 7.1 运行 OpenSpec strict validation。
  验证：`cmd /c openspec.cmd validate add-ts-memory-aging --strict` 通过。

- [x] 7.2 所有前置和实施任务完成后再归档。
  验证：归档前稳定基线新增 `openspec/specs/memory-aging/spec.md`，并更新 overview、memory architecture/domain/contracts/modules/ADR/spec-to-design-map；不得在代码实现缺失时仅凭 active change validate 归档。

