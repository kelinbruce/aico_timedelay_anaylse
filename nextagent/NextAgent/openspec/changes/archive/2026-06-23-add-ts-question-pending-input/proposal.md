## 背景与问题（Why）

电信网络智能体在诊断、参数确认和排障流程中经常需要向当前用户追问缺失信息。roadmap 中 `add-ts-question-pending-input` 的目标是让模型或受控 Agent loop 能发起 question pending input，并在用户回答后继续原 run。

本 change 不决定 Agent 何时必须追问；它只规定 `PendingInputKind.QUESTION` 在已经进入 pending 后的请求形态、answer 形态、校验、恢复和 timeout 黑盒效果。

## 变更范围（What Changes）

- 支持 `QUESTION` pending input 的文本题、单选题、多选题和允许自定义文本的选项题。
- 题型约束来自 accepted `PendingInputQuestion`：
  - `options` 为空：文本题。
  - `options` 非空且 `multiple` 缺省或 false：单选题。
  - `options` 非空且 `multiple=true`：多选题。
  - `custom=true`：选项题允许至多一个非 option 自定义文本。
- answer 使用 `PendingInputAnswer.answers`：
  - 文本题：`answers[i]=["text"]`
  - 单选题：`answers[i]=["optionValue"]`
  - 多选题：`answers[i]=["optionA","optionB"]`
  - 允许 custom 的选项题：可包含一个非 option 文本值
- 用户 answer 被 runtime 接收后，原 run 从 checkpoint 继续；answer 不创建新的 root user message。
- timeout 不合成答案，原 run 进入 safe timeout outcome。

## 架构约束下的修改说明

- 需要修改：只修改 `QUESTION` kind 的 runtime request/answer validation、resume/timeout 黑盒行为和 safe projection tests；如果后续引入 AskUserQuestion tool，它只能作为上游 producer 提交 runtime-owned `PendingInputIntent`。
- 修改后的变化：文本、单选、多选和 custom 选项题都由 accepted pending request 解释，同一个 `PendingInputAnswer.answers` 外壳承载所有答案；answer 不成为新的 root user message。
- 影响：后续工具、hook 或 Agent loop 可以复用这套 question 语义；当前 change 不要求当前仓库新增或修改一个尚不存在的 AskUserQuestion package implementation。
- 边界：不定义模型何时追问；不新增表单/问卷引擎；不让 capability handler 等待用户；不让客户端 answer 携带 `multiple`、`custom`、schema、identity 或 idempotency。

## Capability 影响（Capabilities）

### 新增 Capability

- `question-pending-input`：type-specific behavior for `PendingInputKind.QUESTION`。

### 修改的 Capability

无。后续若新增或恢复 `ask-user-question-tool`，该 tool 必须消费本 change 的 question 语义：只提交 runtime-owned pending input intent，不等待用户回答，也不拥有恢复状态。

## 影响范围（Impact）

- 依赖：`refine-ts-pending-input-contracts`、`add-ts-human-pending-input-core`、`add-ts-human-pending-input-timeout`。
- 后续消费：`add-ts-ask-user-question-tool` 或等价 tool change 可消费本 change，但不是本 change 的实施前置条件。
- 影响 package：`agent-runtime` type-specific validation/resume、channel safe projection 和 tests；仅当仓库已有或后续新增 AskUserQuestion tool 时，才在对应 change 中修改 `agent-capability`。
- 非目标：不定义 routing 策略；不引入问卷/表单引擎；不支持逐题流式提交；不把 answer schema 写进客户端 answer 或 persistence object。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/question-pending-input/spec.md`：新增 question pending input 行为契约。
- `openspec/specs/ask-user-question-tool/spec.md`：若该基线或后续 change 存在，归档/后续实现时对齐 text/single-select/multi-select/custom 规则。
- `openspec/designs/architecture/pending-input-and-user-interaction.md` 或 runtime boundary 文档：补充 question answer mapping。
- `openspec/designs/modules/agent-runtime.md`、`agent-channel-web.md`：补充职责；`agent-capability.md` 只在后续 AskUserQuestion tool change 中更新。
- `openspec/designs/spec-to-design-map.md`：补充导航。
