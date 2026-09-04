# add-ts-human-pending-input-timeout

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)

所属分组：Human Pending Input

状态：ready
类型：实施 change
主要 owner：`agent-runtime`、`agent-channel-web`、`agent-observability`
依赖：`refine-ts-pending-input-contracts`、`add-ts-human-pending-input-core`

目标：

- 支持 pending input 超时发现、超时事实记录、late answer 拒绝和后续安全处理。

规格输入：

- 默认 timeout 为 30 分钟。
- 单个 pending input 可以指定更短 `timeoutAt`。
- 系统上限为 24 小时。
- timeout 发生时 MUST 产生 `pending_input.timed_out` 或等价 canonical timeout fact。
- timeout fact MUST 进入 stream/status 和 safe observability/audit/metric 消费路径。
- timeout 后提交的 late answer MUST 被拒绝。
- timeout 行为 MUST NOT 作为 `PendingInput`、`PendingInputRequest` 或 `PendingInputAnswer` 字段持久化。
- runtime MUST 在处理超时时按当前 `kind` 已冻结的 timeout outcome 计算安全行为。
- 所有 timeout 都不得自动 approve。

契约输入：

- `PendingInput.timeoutAt`
- `PendingInputStatus.TIMED_OUT`
- canonical `USER_INPUT_TIMEOUT`
- hook / policy 执行边界

实现约束：

- `QUESTION` timeout 不合成答案，原 run 进入 pending-input timeout terminal outcome，终态 reason 使用 `PENDING_INPUT_TIMEOUT`。
- `CONFIRMATION` timeout 不视为同意；confirmed continuation 不得继续，原 run 或 confirmed step 产生 safe non-approval timeout outcome，终态 reason 使用 `PENDING_INPUT_TIMEOUT`。
- `AUTHORIZATION` timeout 不授权、不执行受保护操作，并产生 safe denial/no-execution timeout outcome；若 terminalize 原 run 或 guarded step，终态 reason 使用 `PENDING_INPUT_TIMEOUT`。
- `HUMAN_HANDOFF` timeout 不合成人工结果，原 run 进入 pending-input timeout terminal outcome，终态 reason 使用 `PENDING_INPUT_TIMEOUT`。
- 未能定位 checkpoint、continuation 或 kind-specific outcome 时必须采用 safe timeout failure outcome，不能 approve、不能合成 answer，也不能恢复原 run。

验收要点：

- timeout scanner 只读取 runtime/gateway 暴露的 due pending facts。
- timeout 处理必须 CAS 更新仍为 `PENDING` 的 pending input。
- late answer 必须得到 safe rejection，不能恢复 run。
- stream/status/history 能看到 safe timeout outcome。

并行边界：

- 不增加 timeout behavior 字段。
- 不修改 type-specific pending input 的业务解释规则，只定义通用超时发现和保守处理框架。
