# add-ts-confirmation-pending-input

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)

所属分组：Human Pending Input

状态：ready
类型：实施 change
主要 owner：`agent-runtime`、`agent-channel-web`、`agent-capability`
依赖：`refine-ts-pending-input-contracts`、`add-ts-human-pending-input-core`、`add-ts-human-pending-input-timeout`

目标：

- 支持系统发起普通二态确认，并将用户选择转化为系统控制结果。

规格输入：

- `CONFIRMATION` 是系统控制行为；本 change 不定义 producer，进入 pending 前必须通过 pending input core 已冻结的 producer boundary 提交 validated `CONFIRMATION` pending intent，不由模型或客户端直接决定。
- 首版只支持二态 `approve` / `reject`。
- 多选项决策应走 `QUESTION` 或后续扩展。
- confirmation 与 question 共用 `PendingInputRequest` / `PendingInputAnswer` 客户端外壳。
- runtime MUST 按 `CONFIRMATION` 类型进入系统控制流程，不把回答作为模型自然语言回答处理。
- 展示内容通过 safe question/options 表达。
- 安全详情、风险等级或待确认对象摘要应经过脱敏后进入展示文本或后续审计事实，不作为 pending input 核心字段。
- timeout 不自动 approve；所有 confirmation timeout 都必须产生 safe non-approval timeout outcome，若 terminalize 原 run 或 confirmed step，终态 reason 使用 `PENDING_INPUT_TIMEOUT`。

契约输入：

- `PendingInputKind.CONFIRMATION`
- `PendingInputRequest`
- `PendingInputAnswer`
- pending input core 已接受的 `CONFIRMATION` intent/request

实现约束：

- confirmation 的 approve 只恢复已绑定的 continuation，不得把用户回答作为自由文本交给模型。
- reject 或 timeout 不执行被确认的动作。
- 高危确认不能降级为普通 confirmation，应走 `AUTHORIZATION` 或高风险拒绝路径。
- hook、policy 或 capability governance 若需要 confirmation，必须通过 pending input core 已冻结的 producer boundary 进入；本 change 不新增 producer、policy port 或 capability-private wait/resume state。

验收要点：

- approve path 恢复 continuation。
- reject path 不执行待确认动作。
- timeout path 不自动 approve。
- malformed answer、late answer 和重复 answer 都必须 safe reject 或幂等返回。
