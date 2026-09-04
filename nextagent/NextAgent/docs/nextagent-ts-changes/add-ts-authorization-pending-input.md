# add-ts-authorization-pending-input

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)

所属分组：Human Pending Input

状态：ready
类型：实施 change
主要 owner：`agent-runtime`、`agent-channel-web`、`agent-observability`
依赖：`refine-ts-pending-input-contracts`、`add-ts-human-pending-input-core`、`add-ts-human-pending-input-timeout`

目标：

- 支持当前 run 内一次受保护操作的显式授权。
- 区分普通 confirmation 和 authorization：authorization 绑定一次 protected operation，deny/timeout 必须阻止该操作执行。

规格输入：

- `AUTHORIZATION` 是系统控制行为；本 change 不定义 producer，进入 pending 前必须通过 pending input core 已冻结的 producer boundary 提交 validated `AUTHORIZATION` pending intent。
- 模型不能直接发起授权，客户端也不能自报授权 scope。
- 首版只授权当前 run、当前 checkpoint 中的一次受保护操作。
- 不做跨 run、跨 session、跨 agent 或长期授权。
- 用户响应只支持 `approve` / `deny`，通过 `PendingInputAnswer.answers` 表达。
- `approve` 只允许该 pending input 绑定的单次受保护操作继续，不能被后续操作复用。
- `deny` 或 `timeout` 时目标操作不得执行。
- 首版不支持撤销，因为授权只在操作执行前一次性消费。

契约输入：

- `PendingInputKind.AUTHORIZATION`
- `PendingInputAnswer`
- runtime checkpoint / continuation
- pending input core 已接受的 `AUTHORIZATION` intent/request

实现约束：

- authorization scope 只能由 runtime 从 accepted run、checkpoint、continuation 和 pending fact 推导。
- operation id、permission scope、policy decision、identity 或 capability args 不得作为客户端 answer payload 传入。
- 绑定受保护操作的上下文保存在 runtime checkpoint/continuation 中，不新增 authorization-specific pending object field。
- timeout 行为不持久化；处理超时时 runtime 按 `AUTHORIZATION` 已冻结的 no-execution outcome 处理。
- `AUTHORIZATION` 超时必须按拒绝或安全不执行处理，目标操作不得执行；若 terminalize 原 run 或 guarded step，终态 reason 使用 `PENDING_INPUT_TIMEOUT`。
- 本 change 不实现完整 risk policy engine，不新增 audit sink，不定义具体工具风险等级。

非目标：

- 不实现完整 policy engine。
- 不新增真实 audit sink 或审计查询 API。
- 不定义具体 capability 风险等级。
- 不让 confirmation 替代 authorization。

验收要点：

- approve path 只恢复 checkpoint 中绑定的一次受保护操作。
- deny path 不执行受保护操作。
- timeout path 不执行受保护操作。
- approve reuse negative test 覆盖后续 operation、run、session、agent 都不能复用授权。
- architecture test 覆盖 client/model/capability 私有状态不能设置 authorization scope 或绕过 runtime pending lifecycle。

并行边界：

- risk policy / capability guard 触发规则留给后续消费 change；若需要 authorization pending，必须通过 pending input core 已冻结的 producer boundary 进入。
- capability invocation audit 只作为后续 safe fact 消费者；本 change 不新增审计写入边界。
