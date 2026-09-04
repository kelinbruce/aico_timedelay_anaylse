## 1. Contract 和 Characterization Tests

- [x] 1.1 添加 cancel command owner/latest 负向测试，覆盖 owner mismatch、`expectedLatestRequestId` 过期、target not found 和历史 run cancel 被拒绝。
  验证：运行 request cancel runtime/contract 测试文件，断言返回 `REQUEST_CANCEL_NOT_LATEST`、not-found/forbidden safe outcome，且没有 RequestRun 被 mutation。
  来源：`Owner-Scoped Latest Request Cancel Command`；design D1、D2、D12。
- [x] 1.2 添加 cancelable 状态矩阵测试，覆盖 latest run 为 `ACCEPTED`、`QUEUED`、`EXECUTING`、terminal 和 `terminalCommitState=PENDING|RETRYING` 的结果。
  验证：运行 request cancel runtime 状态矩阵测试，断言 `ACCEPTED|QUEUED|EXECUTING` 进入 cancel path，terminal 和 terminal-pending 不产生第二 terminal；同 key terminal-pending 重试返回原始或等价 accepted pending outcome，不同 key terminal-pending cancel 返回 safe conflict。
  来源：`Cancelable Request State Classification`；design D3、D7。
- [x] 1.3 添加 terminal visibility characterization tests，覆盖 `RequestControlAccepted` 不等于 client-visible `REQUEST_CANCELED`，terminal commit pending 时 stream/history 不显示 committed canceled。
  验证：运行 stream/history visibility 测试，断言原始 cancel 可保留 accepted pending outcome，但只有 committed 或 idempotent already-committed terminal fact 可被投影。
  来源：`Canceled Terminal Visibility And Lane Release`；design D6、D7。
- [x] 1.4 添加 idempotency 和并发终态测试，覆盖缺失/空 `idempotencyKey` validation、同 key 同 command semantic 通过目标 `RequestRun` terminal commit metadata 重复 cancel、同 key 不同 command semantic conflict、`CANCEL_LATEST`/`CANCEL` alias 归一化后同 key 不冲突、不同 key 重复 cancel、cancel vs completed、cancel vs failed、cancel vs superseded race。
  验证：运行 request cancel resilience tests，断言缺失/空 key 返回 `REQUEST_CANCEL_IDEMPOTENCY_REQUIRED` 且无 side effect，同 key pending 重试不变成 terminal-pending conflict，同 key 不同 semantic 返回 `REQUEST_CANCEL_IDEMPOTENCY_CONFLICT`，同 key 的 `CANCEL_LATEST` 与 `CANCEL` 归一化后返回同一或等价 outcome，不同 key repeated cancel 返回 safe conflict，且每个 run 最多一个 request terminal lifecycle event；断言 accepted cancel replay 不依赖独立 command outcome store。
  来源：`Cancel Idempotency And Single Terminal Outcome`；design D9、D10。
- [x] 1.5 添加 late output suppression tests，覆盖 canceled terminal commit 后 late model final、model delta、capability result 和 Agent terminal attempt。
  验证：运行 late output 测试，断言 late output 不生成 visible final answer，不覆盖 `RunStatus.CANCELED`，不追加第二 terminal event。
  来源：`Cancel Late Output Suppression`；design D8。

## 2. Runtime Cancel Command Implementation

- [x] 2.1 在 Runtime command handling 中实现 cancel target selection，使用 `identityContext.tenantId`、`identityContext.subjectId`、`sessionId` 和 `expectedLatestRequestId` 校验 latest 可操作请求。
  验证：运行 1.1 owner/latest 测试和 runtime command tests。
  来源：`Owner-Scoped Latest Request Cancel Command`；design D1、D2。
- [x] 2.2 实现 cancelable 状态分类，将 `ACCEPTED` 归入 queued cancel path，将 terminal 归入 already-terminal path，并将不同 idempotency key 的 terminal-pending cancel 归入 safe conflict path。
  验证：运行 1.2 状态矩阵测试。
  来源：`Cancelable Request State Classification`；design D3、D7。
- [x] 2.3 实现 queued cancel path，取消、移除或校正 scheduler pending work item，并通过 terminal commit 写入 `RunStatus.CANCELED` 和 `REQUEST_CANCELED`。
  验证：运行 queued cancel scheduler/terminal integration tests，断言 queued run 不消失且 durable terminal fact 存在。
  来源：`Queued Request Cancellation`；design D4。
- [x] 2.4 实现 executing cancel path，通过 Runtime-owned execution handle、AbortController 或等价 cancellation context 通知执行链路，并提交 canceled terminal。
  验证：运行 fake execution handle/AbortSignal 测试，断言 signal 被触发且 Runtime 负责 terminal commit。
  来源：`Executing Request Cancellation`；design D5。
- [x] 2.5 实现 terminal commit result handling，只有 committed 或 idempotent already-committed 才允许 canceled stream/history visibility 和 same-lane release。
  验证：运行 terminal commit committed、already-committed、pending、version-conflict、not-found 分支测试。
  来源：`Canceled Terminal Visibility And Lane Release`；design D6、D7。

## 3. Consistency、SafeError 和 Late Output

- [x] 3.1 实现 cancel idempotency command handling，保证同一 `idempotencyKey` 与同一 command semantic 通过目标 `RequestRun` terminal commit metadata 重复 cancel 返回原结果或等价结果，并保证同 key 不同 command semantic 返回 safe conflict；不新增 cancel command outcome store。
  验证：运行 1.4 idempotency tests，断言原始 cancel terminal commit pending 时，同 key 重试返回原始或等价 accepted pending outcome。
  来源：`Cancel Idempotency And Single Terminal Outcome`；design D9。
- [x] 3.2 实现 terminal race fencing，确保 cancel 与 completed/failed/superseded 竞争时只有一个 terminal lifecycle event。
  验证：运行 1.4 concurrent terminal tests，并断言 losing attempt 返回 safe conflict、already-committed 或 version-conflict。
  来源：`Cancel Idempotency And Single Terminal Outcome`；design D9、D10。
- [x] 3.3 实现 late output suppression gate，阻止 committed canceled run 后的 model/capability/agent late output 变成 visible final 或 second terminal。
  验证：运行 1.5 late output suppression tests。
  来源：`Cancel Late Output Suppression`；design D8。
- [x] 3.4 实现 cancel SafeError mapping，覆盖 not latest、already terminal、不同 key terminal pending、not found、forbidden 和 commit unavailable。
  验证：运行 SafeError tests，断言 code/category/retryable/safeDetails 稳定，且不包含 raw provider/tool/model/storage/path/credential detail。
  来源：`Request Cancel Safe Errors`；design D12。

## 4. Cross-Module Boundary Integration

- [x] 4.1 接入 Channel cancel command，确保 Web/API 层兼容 public action `CANCEL_LATEST`/`CANCEL`、调用 Runtime 前统一归一化为 canonical `CANCEL`、向 Runtime 提供可信 identity 和 canonical idempotency 并调用 Runtime，不直接写 run status、timeline、history 或 lane release；本 change 不定义 public Web DTO 的 key 来源。
  验证：运行 channel command tests；code review 检查点：`agent-channel-web` 不引用 terminal commit writer 或 scheduler internals，Runtime 不从 client metadata、模型输出或 capability input 中回填 idempotency key，Runtime command boundary 不接收 `CANCEL_LATEST` 作为 canonical action。
  来源：`Owner-Scoped Latest Request Cancel Command`；design D1、Documentation Ownership。
- [x] 4.2 接入 Agent/Model/Capability cancellation consumer 边界，确保它们消费 Runtime cancellation context 或返回 typed cancellation/timeout outcome，不发布 request terminal lifecycle event。
  验证：运行 Agent/Model/Capability cancellation boundary tests；code review 检查点：非 Runtime 模块不发布 `REQUEST_CANCELED`。
  来源：`Executing Request Cancellation`；`Request Cancel Cross-Capability Boundaries`；design D5。
- [x] 4.3 接入 pending input root cancel boundary，使 canceled root run 的 pending input 无法恢复执行，late answer 返回 safe conflict/canceled outcome。
  验证：运行 pending input cancel boundary tests，断言 late answer 不恢复 canceled run。
  来源：`Request Cancel Cross-Capability Boundaries`；design D11。
- [x] 4.4 接入 stream/history projection，确保 `REQUEST_CANCELED` 只从 committed Runtime terminal facts 投影，cancel accepted response 不直接产生 terminal stream event。
  验证：运行 stream/history projection tests。
  来源：`Canceled Terminal Visibility And Lane Release`；design D6。

## 5. Verification 和 Boundary Checks

- [x] 5.1 运行 request cancel 相关单元、contract、integration 和 resilience tests。
  验证：运行包含 request cancel、runtime command、terminal commit、stream/history、pending input boundary 的测试集合。
  来源：proposal 影响范围；design Verification Map。
- [x] 5.2 运行 OpenSpec 严格校验。
  验证：`openspec validate add-ts-request-cancel --strict`
  来源：proposal Baseline Promotion Plan；OpenSpec config tasks rule。
- [x] 5.3 做核心契约边界检查，确认本 change 未新增 `RunStatus`、`TimelineEventType`、`StreamEventType`、`RequestControlCommand` 字段或 cancel 专属 gateway port。
  验证：code review 检查点：diff 中无 core vocabulary/schema/port 新增；cancel target lookup、terminal commit 和 idempotency 只消费 `add-ts-session-lane-scheduling` 的 RequestRun agent+owner scope 与 terminal commit idempotency anchor lookup 基础，不新增平行 scoped gateway DTO 或独立 command outcome store。
  来源：proposal 修改的 Capability；design Non-Goals、D1、风险与取舍。
- [x] 5.4 做逻辑对齐检查，确认 cancel 流程与 latest 校验、queued cancel、execution handle cancel、terminal commit、pending 不释放 lane、double/concurrent cancel 测试语义保持一致。
  验证：code review 检查点：对照 `RuntimeCommandPort.cancel`、runtime lifecycle coordinator、Runtime scheduler queue/dispatch boundary、`RequestRunStoreGateway.commitTerminal`、terminal pending recovery tests 和 cancellation resilience tests。
  来源：design Context；proposal 影响范围。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/request-cancel/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/runtime-boundaries.md`。
- 按需更新 `openspec/designs/architecture/request-run.md`。
- 按需更新 `openspec/designs/architecture/core-contracts.md`。
- 按需更新 `openspec/designs/modules/agent-runtime.md`、`agent-channel-web.md`、`agent-core.md`、`agent-model.md`、`agent-capability.md`。
- 按需新增或更新 `openspec/designs/adr/request-cancel-terminal-boundary.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 request cancel 状态机、API schema、数据 owner 或接口语义。
