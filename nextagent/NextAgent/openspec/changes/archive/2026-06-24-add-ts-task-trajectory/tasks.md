## 1. Contract 和 DTO

- [x] 1.1 在 `agent-common` 定义 `TaskTrajectoryId` branded type，以及 `TaskTrajectoryKind`、`TaskTrajectoryBuildStatus`、`TaskOutcomeStatus`、`OutcomeEvidenceLevel` 低基数 enum。
  验证：`npm run build`；contract type tests 覆盖 enum 取值。
  来源：spec `Task trajectory record content boundary`；design 决策 3。

- [x] 1.2 在 `agent-contracts/gateway` 定义 `TaskTrajectoryRecord`、source ref、observation、action、save request、query request/result DTO，所有 request/record 必须 `extends OwnerScoped` 并显式携带 `agentId`。
  验证：`npm run test:contract` 覆盖 DTO schema、owner/agent scope 必填、非法 enum 拒绝。
  来源：spec `Task trajectory query contract`；design 决策 3。

- [x] 1.3 在 `agent-contracts/gateway` 定义 `TaskTrajectoryStoreGateway` 和 `TaskTrajectoryQueryGateway` async port 签名。
  验证：`npm run build`；contract tests 覆盖 port result / SafeError shape。
  来源：proposal 变更范围；design 决策 3。

- [x] 1.4 在 `agent-contracts/gateway` 为 `TaskTrajectoryQueryGateway` 定义最小 `listBuildCandidates` 查询及 DTO，只返回已 terminal commit、同 scope 下尚无 trajectory 的 owner/agent/session/run/terminal event refs、状态和 cursor；不得返回 raw message、raw tool output、路径或 credential。
  验证：contract tests 覆盖 DTO schema、scope 必填、limit/cursor 上限、raw content 字段不存在。
  来源：spec scenario `Missed build intent is reconciled from committed facts`；design 决策 2、3。

## 2. Builder 投影

- [x] 2.1 在 `agent-memory` 实现 `TaskTrajectoryBuilder`，只消费 public session/message/timeline gateway ports、committed run refs，以及 timeline/session 中已有的 safe tool invocation projection / content refs；不得依赖未定义的独立 tool result gateway。builder 输出 `TaskTrajectoryRecord`，并区分 `trajectoryBuildStatus` 与 `taskOutcomeStatus`。
  验证：`npx.cmd vitest run packages/agent-memory/tests/task-trajectory-builder.test.ts` 覆盖 build completed/failed/skipped、outcome succeeded/failed/partial/unknown/cancelled projection。
  来源：spec `Task trajectory persistence after terminal commit`；design 决策 2。

- [x] 2.2 实现 raw content redaction 和 safe summary projection，摘要只能来自已提交事实的安全投影，禁止 raw prompt、raw model output、raw tool output、raw provider error、路径、credential、token、附件原文进入 trajectory。
  验证：安全测试构造上述内容并断言 record/log/audit 均不包含原文。
  来源：spec `Task trajectory record content boundary`；design 决策 4。

- [x] 2.3 实现 evidence-based outcome classifier，按 task kind、tool status、verification refs、user confirmation 和 safe diagnostic code 输出 `taskOutcomeStatus`、`outcomeEvidenceLevel`、`outcomeEvidenceRefs`；证据不足默认 `UNKNOWN`。
  验证：unit test 覆盖 terminal commit completed 但无验证证据 -> `UNKNOWN`、配置 apply+verify -> `SUCCEEDED/VERIFICATION`、用户确认 -> `SUCCEEDED/USER_CONFIRMATION`、失败/取消/超时 -> 对应 outcome，且 final assistant claim 不单独生成强证据。
  来源：spec `Task outcome is evidence-based`；design 决策 4。

- [x] 2.4 实现 non-task request skip 逻辑，无法形成任务目标或动作/观察摘要时不创建空 record。
  验证：unit test 覆盖寒暄、空任务、不可投影内容返回 `TASK_TRAJECTORY_NOT_APPLICABLE`。
  来源：spec scenario `Non-task request is skipped with diagnostic`。

- [x] 2.5 实现 trajectory historical immutability：后续相似 trajectory 不回写旧 trajectory outcome；只允许同一 `requestRunId` 的幂等重建、迟到已提交事实补齐或 projection bug 修复。
  验证：unit/gateway test 覆盖 `T1 UNKNOWN` + `T2 VERIFICATION` 时 `T1` 不变，`T2` 新增；同一 run 重建保持 scoped idempotency。
  来源：spec `Task trajectory historical immutability`；design 决策 4A。

## 3. Local gateway persistence

- [x] 3.1 在 `agent-platform-gateway-local` 新增专用 `task_trajectory` 表和必要索引，不使用 generic records table。
  验证：gateway-local migration/init tests 覆盖表结构、索引和重复 initialize。
  来源：proposal 影响范围；design 决策 3。

- [x] 3.1A 在 `LocalGatewayStores` 和 `SqliteGatewayStores` 显式新增 `taskTrajectoryStore` 与 `taskTrajectoryQuery` public gateway properties；app composition 只能通过这些 public properties 注入 `agent-memory` worker 和 extraction，不得让 `agent-memory` 直接创建 gateway-local store 或读取 SQLite row。
  验证：`npm run build` 覆盖 public type；architecture tests 断言 `agent-memory` 无 gateway-local private path/SQLite import；gateway composition tests 覆盖 properties 存在且由 `SqliteGatewayStores` 实现。
  来源：design 决策 3；spec `Task trajectory architecture boundary`。

- [x] 3.2 实现 `TaskTrajectoryStoreGateway.saveTaskTrajectory`，使用可信 scope、requestRunId/sessionId 作为 scoped uniqueness anchor，重复触发幂等返回既有 record 或安全 upsert。
  验证：gateway contract tests 覆盖重复 save、跨 scope 隔离、storage unavailable SafeError。
  来源：spec `Task trajectory persistence after terminal commit`；design 可靠性。

- [x] 3.3 实现 `TaskTrajectoryQueryGateway` 的 session/run/time-window/kind/build status/outcome status/evidence level/limit/cursor 查询。
  验证：gateway contract tests 覆盖过滤、分页、默认 limit、limit 上限和跨 owner/agent 空结果。
  来源：spec `Task trajectory query contract`。

- [x] 3.4 实现 `TaskTrajectoryQueryGateway.listBuildCandidates`，在 dedicated `task_trajectory` 表和已提交 terminal run/timeline facts 之间做 bounded missing-trajectory scan；查询必须只返回最小 scoped refs 和 cursor，并排除已存在同 scope `requestRunId` trajectory 的 run。
  验证：gateway contract/integration tests 覆盖 listener intent 缺失后的 candidate 可发现、重复 save 后 candidate 不再返回、limit/cursor 生效、跨 owner/agent 不泄漏。
  来源：spec scenario `Missed build intent is reconciled from committed facts`；design 决策 2、3。

## 4. App composition 和 post-commit 接线

- [x] 4.1 在 `agent-app` 中装配 task trajectory store/query gateway 和 builder，local backend 下启用，remote complete-service backend 下禁用本地 builder。
  验证：config/app composition tests 覆盖 local enabled、remote disabled、dependency missing diagnostic。
  来源：design 决策 2、5。

- [x] 4.2 在 `agent-app` 通过已有 `runTimelineEventListeners` 增加 task trajectory listener：只监听 `persistence="PERSISTED"` 的 terminal timeline event，只记录 scoped build intent / pending signal 作为快速触发，不新增 `AFTER_TERMINAL_COMMIT` hook，不把完整 builder projection 或 trajectory save 放入 terminal commit 事务，也不把该 pending signal 当作唯一可靠来源。
  验证：integration test 断言 terminal event/history projection 不等待 trajectory listener、intent 或 worker/save；listener 抛错、intent 记录失败或 worker save 失败均不改变 request terminal state；source/architecture test 断言没有新增 runtime post-commit lifecycle hook。
  来源：spec `Task trajectory persistence after terminal commit`。

- [x] 4.3 实现后台 trajectory worker，按 batch、concurrency、retry/backoff、max pending 和 shutdown cancellation 执行 builder。
  验证：worker tests 覆盖限流、重试、pending 上限、shutdown 停止未完成任务、失败 safe diagnostic，且不阻塞新请求。
  来源：design 决策 2；spec `Task trajectory persistence after terminal commit`。

- [x] 4.4 在同一个 trajectory worker 中实现 bounded catch-up / reconciliation：周期性调用 `TaskTrajectoryQueryGateway.listBuildCandidates` 扫描已 terminal commit 但缺少 trajectory 的 scoped refs，并按同一 builder/save 路径补建；该路径不得读取 gateway-local private table 或 raw content。
  验证：integration test 模拟 listener 抛错、pending signal 丢失或进程重启后，catch-up 能补建 trajectory；重复 listener + catch-up + retry 只产生一个 scoped trajectory；`rg "sqlite|gateway-local|SessionMessageRow" packages/agent-memory/src` 无 private access。
  来源：spec scenario `Missed build intent is reconciled from committed facts`；design 决策 2。

## 5. Memory extraction 接入

- [x] 5.1 调整 `add-ts-memory-extraction` 的 implementation path，使 automatic extraction 通过 `TaskTrajectoryQueryGateway` 查询时间窗口内 trajectories，而不是直接从 message history 生成 memory candidate。
  验证：`npx.cmd vitest run packages/agent-memory/tests/memory-extraction.test.ts` 覆盖 trajectory input path；source refs 可追溯到 trajectory 和原 session/run refs。
  来源：proposal 修改的 capability `memory-extraction`；spec `Task trajectory query contract`。

- [x] 5.2 增加 extraction fallback/blocked behavior：缺少 task trajectory capability 或 query gateway 时，local automatic extraction 不启动并产生 safe prerequisite diagnostic，不私查 DB。
  验证：integration/architecture tests 断言缺失 gateway 时 scheduler blocked，且 `rg "sqlite|gateway-local|SessionMessageRow" packages/agent-memory/src` 无 private access。
  来源：design 决策 5。

## 6. Architecture、安全和验证

- [x] 6.1 增加 architecture tests，断言 `agent-runtime` 不导入 task trajectory builder，`agent-memory` 不导入 gateway-local private path/SQLite/FTS5，memory tools 不导入 task trajectory gateway 或 builder。
  验证：`npm run lint:architecture` 和对应 dependency-cruiser tests 通过。
  来源：spec `Task trajectory architecture boundary`。

- [x] 6.2 增加 observability tests，覆盖构建成功/失败/skip 诊断只包含 safe refs、status、reason code、durationMs，不包含 raw content。
  验证：`npx.cmd vitest run packages/agent-memory/tests/task-trajectory-observability.test.ts`。
  来源：design 审计/可追溯性。

- [x] 6.3 运行 OpenSpec 和常规验证。
  验证：`openspec validate add-ts-task-trajectory --strict`、`openspec validate add-ts-memory-extraction --strict`、`openspec validate --all --strict`、`npm run build`、`npm run test:contract`、`npm run lint:architecture`。
  来源：AGENTS.md 验证门禁。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档前依据 proposal/design 的 Baseline Promotion Plan 同步 stable specs、overview、architecture、modules、ADR 和 spec-to-design-map。不得在长期基线中重复定义同一 DTO schema、数据 owner 或接口语义。
