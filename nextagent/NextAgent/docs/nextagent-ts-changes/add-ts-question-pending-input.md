# add-ts-question-pending-input

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)

所属分组：Human Pending Input

状态：ready
类型：实施 change
主要 owner：`agent-capability`、`agent-runtime`、`agent-channel-web`
依赖：`refine-ts-pending-input-contracts`、`add-ts-human-pending-input-core`、`add-ts-human-pending-input-timeout`、`add-ts-builtin-tool-framework`

目标：

- 支持 `QUESTION` pending input 承载模型或受控 upstream producer 已提交的澄清问题，并在用户回答后继续原 run。
- 支持文本、单选、多选、自定义文本、单问题和多问题。
- 保持 runtime-owned pending lifecycle，question 工具和 channel 都不拥有私有等待/恢复状态。

规格输入：

- `QUESTION` 用于模型主动发起的信息澄清。
- `QUESTION` 不用于授权、高危确认、credential 或 raw secret 获取。
- 多问题首版一次性提交，不做逐题流式提交。
- 问题对象使用 `prompt`、`header?`、`options?`、`multiple?`、`custom?`。
- 选项对象使用 `value`、`label`、`description?`。
- 用户回答统一进入 `PendingInputAnswer.answers: string[][]`。
- 文本题答案必须是一个非空字符串。
- 单选题答案必须是一个选项值；若 `custom=true`，可以是一个非选项自定义文本。
- 多选题答案必须是一个或多个唯一非空字符串；每个值必须匹配选项，除非 `custom=true` 允许最多一个非选项自定义文本。
- `multiple` 和 `custom` 只能来自已接受的 pending request，客户端 answer 不能设置这两个标志。
- runtime 按问题顺序解释回答，校验选项合法性、重复提交、late answer 和 timeout 后提交。
- 给模型继续处理的是 runtime 派生的模型可读事实，而不是原始 UI payload。
- `PendingInputAnswer` MUST NOT 包含 `formattedForModel`。

契约输入：

- `PendingInputKind.QUESTION`
- `PendingInputQuestion`
- `PendingInputOption`
- `PendingInputAnswer.answers`

实现约束：

- question 工具只能通过 runtime-owned pending input 边界创建用户问题。
- runtime 负责把结构化 answer 格式化为模型可读事实。
- channel 只投影 safe pending request 并提交 answer command。
- 授权和高危确认不属于 `QUESTION`；若后续 hook、policy 或 capability governance 需要 pending，必须通过 pending input core 已冻结的 producer boundary 进入，并由 `CONFIRMATION` / `AUTHORIZATION` type-specific change 处理。

非目标：

- 不支持 answer 附件。
- 不支持逐题流式提交。
- 不允许 question 工具获取 credential 或 raw secret。

验收要点：

- integration test 覆盖文本、单选、多选、自定义文本和多问题。
- validation test 覆盖非法选项、重复选项、重复提交、late answer、timeout 后 answer。
- security test 覆盖 question 不可用于授权、raw secret 或 credential 获取。

并行边界：

- 后续 `add-ts-ask-user-question-tool` 或等价 producer change 可以消费本 change 的 `QUESTION` request/answer 语义，但不是本 change 的实施前置条件。
- 不在本 change 修改 pending input 核心三对象契约；共享字段由 `refine-ts-pending-input-contracts` 承载。
