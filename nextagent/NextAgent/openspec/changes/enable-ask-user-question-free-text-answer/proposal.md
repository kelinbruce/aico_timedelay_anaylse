## Why

AskUserQuestion 的 QUESTION kind 当前只在模型显式声明 `custom=true` 时接受用户选项列表外的自由文本回答。模型未声明 `custom=true` 时，runtime answer 校验直接拒绝自定义值。这导致用户在已有选项场景下无法绕过预设选项直接输入自由文本，缺少类似 Claude Code "type anything" 的逃生通道。

用户在流程执行过程中发现信息缺失时，应在所有 QUESTION 交互形态下都能直接输入自由文本，后端应接受并语义化投影该回答，使模型在后续步骤中能参考和使用用户的自由输入决断。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- QUESTION kind 的所有问题子形态（纯文本、单选、多选、选项+自定义、选项+附加文本）都接受用户提交的选项列表外自由文本回答。
- Runtime answer 校验不再因 `custom !== true` 拒绝 QUESTION kind 的自定义值；`customText` 语义化投影对所有 QUESTION 回答生效。
- QUESTION 回答显式携带 `answerKinds`，使 runtime 能区分选项选择、选项附加文本和用户主动自由输入，即使自由文本与 option value 完全相同也不得混淆。
- 移除 `requiresTextInput` option 与 `custom=true` 的 schema 互斥约束，保留 `requiresTextInput` 与 `multiple=true` 的互斥。
- 单选模式下选项选择与自由文本互斥；多选模式下选项选择与自由文本共存。
- 模型可见指导简要提及用户可能提供选项外自由文本回答，使模型在后续步骤中能参考和使用。
- ProcessDetail 的补充信息展示能正确显示自由文本回答。

**非目标：**

- 不移除或改写既有 `answers: string[][]`；`answerKinds` 作为 QUESTION 的可选补充语义，旧调用方缺失时保持既有推断行为。
- 不改变 CONFIRMATION、AUTHORIZATION、HUMAN_HANDOFF 的 answer 校验（它们的安全边界不引入自由文本）。
- 不新增 `freeText` 字段；复用已有 `customText` 语义，并只在 Tool Result 中增加英文动态处理指令。
- 不改变 model-facing schema 的 `custom` 字段定义；`custom=true` 仍是模型声明自定义回答的显式方式，只是不再是唯一自由文本入口。
- 不改变 AskUserQuestion 的输入校验（forbidden-purpose、budget、option uniqueness 等）。
- 不改变 memory 系统结构或 trajectory 记录。

## What Changes

- Runtime `assertValidPendingInputAnswerEntry` 移除 QUESTION kind 的 `custom !== true` 自定义值拒绝；QUESTION kind 总是接受不超过一个自定义值。
- Web answer boundary 为 QUESTION 接受与 `answers` 等长的可选 `answerKinds`；runtime 校验并持久化该语义，恢复后继续按显式来源生成 `resolvedAnswers`。
- Schema `allOf` 约束移除 `requiresTextInput` option 与 `custom=true` 的互斥；保留与 `multiple=true` 的互斥。
- Model-facing guidance 增加一句：用户可能提供选项列表外的自由文本回答，需在后续步骤中参考和使用。
- Frontend `QuestionInput` 在所有有 options 的子形态底部增加 type anything textarea；单选时与选项互斥，多选时与选项共存。
- Frontend `ProcessDetail` 补充信息展示的输入方式标签始终包含自由文本可用标识。
- 同步修改 `question-pending-input` spec 的 answer 校验 Scenarios，移除 `custom` 缺失时拒绝非选项值的约束。

## Feature 影响（Features）

### 修改的 Feature

- `F-5.4 向用户提问`：用户在所有 QUESTION 交互形态下都能直接输入自由文本回答，不再依赖模型是否声明 `custom=true`。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.6 向用户提问` → `specs/ask-user-question-tool/spec.md`、`specs/question-pending-input/spec.md`
  - 功能边界：QUESTION kind 的 answer 校验总是接受自由文本；`requiresTextInput` 与 `custom` 的互斥约束收窄为只与 `multiple` 互斥。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：`ask-user-question-tool` 是 canonical spec；`question-pending-input` 承载 answer 校验 Scenarios，两者同步修改。

## 影响范围（Impact）

- Agent 用户在所有结构化提问场景下都能直接打字输入自由文本，获得更灵活的交互体验。
- Agent 开发者需要知道模型可见 guidance 会提及用户自由文本可能性。
- 受影响实现集中在 QUESTION Web answer DTO、runtime answer 校验与 pending answer 持久化、模型可见 Tool Result、前端 QuestionInput 和 ProcessDetail 展示；pending input lifecycle、stream event 和数据库表结构不变。
- memory 系统不感知此变更，不修改 memory 结构。
