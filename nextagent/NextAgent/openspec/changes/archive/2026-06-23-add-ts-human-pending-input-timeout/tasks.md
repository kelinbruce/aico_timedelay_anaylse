## 0. Scope lock

- [x] 0.1 本 change 只实现 runtime-owned timeout discovery/resolution：default/max timeout validation、`listDuePendingInputs({ now, limit })` consumption、CAS `TIMED_OUT` resolve、late answer conflict、safe `USER_INPUT_TIMEOUT` projection 和 no-auto-approve tests。
  验证：diff review 确认没有 external scheduler package、public timeout API、timeout behavior/autoApprove business field、new RunStatus、type trigger policy、timeout config source、tenant timeout policy、agent timeout policy、gateway-derived policy 或 model/client-provided policy
  来源：proposal 架构约束
- [x] 0.2 实施顺序固定为 timeout validation -> runtime due loop -> CAS timeout resolve -> late answer handling -> kind-specific timeout effects -> projection/boundary tests。
  验证：runtime 只通过 `PendingInputStoreGateway.listDuePendingInputs` 发现 due facts，不读取 adapter-private index 或做无界扫描
  来源：`Due timeout is discovered from durable facts`

## 1. Timeout assignment and validation

- [x] 1.1 在 pending creation path 中为缺省 timeout 设置 `createdAt + 30 minutes`，并验证 explicit `timeoutAt` 必须晚于创建时间且不超过 24 小时。
  验证：runtime validation tests
  来源：`Default timeout is assigned`、`Explicit timeout is bounded`
- [x] 1.1a 增加 runtime timeout ownership tests：`timeoutAt` 由 runtime pending lifecycle clock 计算/校验；producer-provided `timeoutAt` 只作为 explicit timeout request；client payload、model output、channel metadata 和 gateway records 不能定义或覆盖 timeout policy；本 change 不引入 timeout config、tenant policy、agent policy、per-agent/per-kind/per-tenant/client/gateway/model/configurable timeout policy。
  验证：runtime validation/negative tests 使用可注入 runtime clock；source review 确认没有 timeout config source、gateway clock、client clock 或 producer authority
  来源：`Runtime owns timeout decision`
- [x] 1.2 覆盖 invalid timeout negative cases：过去时间、等于创建时间、超过 24 小时、非安全 epoch millis。
  验证：runtime negative tests
  来源：`Explicit timeout is bounded`

## 2. Due discovery and resolution

- [x] 2.1 实现 runtime timeout/recovery loop，调用 `PendingInputStoreGateway.listDuePendingInputs({ now, limit })`。
  验证：runtime timeout integration test；gateway due query contract test
  来源：`Due timeout is discovered from durable facts`
- [x] 2.1a 确认 timeout loop 消费 `refine-ts-pending-input-contracts` 定义的 adapter-private indexed due query；不得在 runtime 中补无界扫描、业务对象 timeout 字段或 gateway 私有索引决策。
  验证：gateway/source tests 覆盖 indexed due query 约束；runtime timeout tests 只通过 `listDuePendingInputs({ now, limit })` 发现 due facts
  来源：`Due timeout is discovered from durable facts`
- [x] 2.2 对 due pending 使用 CAS 从 `PENDING` resolve 为 `TIMED_OUT`，并容忍 answer/cancel/timeout 并发造成的 no-op/conflict。
  验证：concurrency tests
  来源：`Due timeout is discovered from durable facts`

## 3. Timeout effects

- [x] 3.1 timeout 后 late answer 返回 safe timeout/conflict outcome，不恢复原 run，不把 status 改回 `RECEIVED`。
  验证：runtime late answer negative test
  来源：`Late answer after timeout is rejected`
- [x] 3.2 增加 no-auto-approve tests：confirmation timeout 不 approve；authorization timeout 不执行受保护操作；question/handoff timeout 不合成答案。
  验证：type-specific timeout integration tests
  来源：`Timeout never auto-approves`

## 4. Projection and validation

- [x] 4.1 发布 `USER_INPUT_TIMEOUT` 并确保 stream payload 只含 pending id、kind、status 和 safe summary。
  验证：stream projection tests
  来源：`Timeout publishes safe event`
- [x] 4.2 增加 architecture/review check，确认 timeout behavior 不进入 `PendingInput`、`PendingInputRequest`、`PendingInputAnswer` 或 gateway record。
  验证：contract tests；`rg "timeoutBehavior|autoApprove" packages/agent-contracts packages/agent-runtime`
  来源：`Runtime resolves pending input timeout`
- [x] 4.3 运行完整验证。
  验证：`openspec validate add-ts-human-pending-input-timeout --strict`、`npm run build`、`npm test`、`npm run lint:architecture`
  来源：本 change 全部 requirements

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，按 proposal/design 的 Baseline Promotion Plan 更新长期基线。
