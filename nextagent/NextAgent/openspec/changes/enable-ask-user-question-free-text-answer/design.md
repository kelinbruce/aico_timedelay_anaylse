## 设计范围

| Function ID | Function 名称 | 变更类型 | Delta specs | 设计章节 | 影响边界 |
| --- | --- | --- | --- | --- | --- |
| FN-5.6 | 向用户提问 | MODIFIED | `ask-user-question-tool`、`question-pending-input` | `FN-5.6 向用户提问` | Runtime answer 校验、Schema 约束、模型可见 guidance、前端 QuestionInput 和 ProcessDetail 展示 |

本次变更保留 `answers: string[][]`，为 QUESTION 增加可选 `answerKinds` 来源语义并随 pending answer 持久化；不改变 stream event 类型、数据库表结构或 pending input lifecycle。

## 并行 change 兼容性

`strengthen-ask-user-question-guidance` 修改 `ask-user-question-tool` 的模型可见触发指导和 Schema description 文本，不修改 runtime validation 或 schema 约束结构。本 change 修改 schema `allOf` 约束和 runtime answer 校验，不修改触发指导。两个 change 的实施 ownership 明确分离：`strengthen-ask-user-question-guidance` 只改 prompt/descriptor 文本，本 change 只改校验逻辑和前端交互。归档时两个 change 不冲突。

`unify-capability-failure-disposition` 修改 `ask-user-question-tool` 中 `AskUserQuestion 可纠正输入错误进入安全模型纠错` 和 `AskUserQuestion 非纠正性失败保持终止和安全边界`，不触及本 change 修改的 `AskUserQuestion 支持具体选项附带文本输入` 和 `AskUserQuestion 用户回答提供可信且模型友好的结果`。两个 change 的 Requirement ownership 不交叉。

## FN-5.6 向用户提问

### 目标与规范依据

目标是让 QUESTION kind 的所有问题子形态都接受用户提交的选项列表外自由文本回答，使模型在后续步骤中能参考和使用用户的自由输入决断。

#### 目标 Requirements

- `ADDED`：`AskUserQuestion QUESTION kind accepts free-text answers regardless of custom declaration`
- `MODIFIED`：`AskUserQuestion 支持具体选项附带文本输入`（收窄互斥约束）
- `MODIFIED`：`AskUserQuestion 用户回答提供可信且模型友好的结果`（customText 不依赖 custom 声明）
- `MODIFIED`：`Question pending input supports text, single select, multi-select, and custom answers`（answer 校验不依赖 custom 声明）

### 当前实现

- `agent-capability` 的 schema `allOf` 约束：当 question 有 `requiresTextInput=true` option 时，`multiple` 和 `custom` 都必须为 `false`。
- `agent-runtime` 的 `assertValidPendingInputAnswerEntry`：当 answer value 不匹配任何 option value 且 `question.custom !== true` 时，返回 `PENDING_INPUT_ANSWER_INVALID`。
- `agent-runtime` 的 `resolvePendingQuestionAnswers`：已有 `customText` 分支，把不匹配 option value 的值投影为 `customText`。
- Web answer payload 和 pending answer record 未记录用户使用的输入控件；自由文本恰好等于 option value 时，现有 value 匹配无法区分来源。
- `agent-channel-common` 的 `projectAskUserQuestionAnswerResult`：已支持 `answers` 的安全投影，不区分 custom 与非 custom 来源。
- `agent-channel-common` 的 `safePendingInputQuestions`（`stream-envelope.ts`）：有一份与 schema 相同的 `requiresTextInput + custom` 互斥约束，`USER_INPUT_REQUIRED` 事件投影时会丢弃 ⑤+custom 的问题。MUST 同步修改。
- 前端 `QuestionInput`：只在 `question.custom === true` 时渲染自定义输入框；②③ 无 custom 时没有自由文本入口。
- 前端 `ProcessDetail` 的 `buildSupplementalInputDetail`：输入方式标签只在 `question.custom === true` 时显示"允许自定义输入"；回答展示使用 `options.get(answer) ?? answer` fallback，自由文本天然能显示。

### GAP 分析

| 目标 | 当前状态 | 差距 |
| --- | --- | --- |
| QUESTION kind 总是接受自由文本回答 | runtime 校验在 `custom !== true` 时拒绝自定义值 | ②③⑤ 形态无法接受自由文本 |
| ⑤ 与 custom 不互斥 | schema `allOf` 约束 `custom: { const: false }` | ⑤ 形态的模型无法声明 custom |
| 模型感知用户可能输入自由文本 | guidance 未提及此可能性 | 模型可能对意外输入处理不好 |
| 前端所有子形态都有 type anything | 只有 ④ 有自定义输入框 | ②③⑤ 缺少自由文本入口 |
| ProcessDetail 输入方式标签反映自由文本可用 | 只在 custom=true 时显示 | ②③⑤ 不显示自由文本可用 |
| 自由输入来源可准确恢复 | 只按 option value 匹配推断 | 自由文本等于 option value 时被误判为 selection |

### 修改方案

#### 1. Schema 约束修改

`ask-user-question-schemas.ts` 的 `allOf` 约束当前为：

```
if: { properties: { options: { contains: { ... requiresTextInput: { const: true } } } } }
then: { properties: { multiple: { const: false }, custom: { const: false } } }
```

修改为：

```
if: { properties: { options: { contains: { ... requiresTextInput: { const: true } } } } }
then: { properties: { multiple: { const: false } } }
```

移除 `custom: { const: false }`，保留 `multiple: { const: false }`。

理由：`multiple + requiresTextInput` 的 answer 歧义无法解决（多选时无法判断哪个文本属于哪个选项），必须保留互斥。`custom + requiresTextInput` 的 answer 歧义可以通过前端互斥交互解决（单选时选选项或打字，不能同时），不需要 schema 层强制。

#### 2. Runtime answer 校验修改

`submit.ts` 的 `assertValidPendingInputAnswerEntry` 当前在 QUESTION kind 中检查：

```
if (customValues.length > 0 && question.custom !== true) {
  throw PENDING_INPUT_ANSWER_INVALID;
}
```

修改为：移除 `question.custom !== true` 条件，QUESTION kind 总是接受 `customValues.length <= 1` 的自定义值。保留 `customValues.length > 1` 的拒绝（type anything 只允许一个自由文本值）。

`assertValidPendingInputAnswerEntry` 对 QUESTION kind 的校验逻辑变为：

1. 有空值 → 拒绝
2. 无 options（纯文本）→ 只接受 1 个值
3. 有 options、单选、requiresTextInput option → 接受 `[optionId, textInput]` 格式
4. 有 options、单选、普通 option → 接受 `[optionId]` 或 `[freeText]`（二选一）
5. 有 options、多选 → 接受 `[optionId, ...]` 或 `[optionId, ..., freeText]`（共存）
6. customValues.length > 1 → 拒绝

#### 3. 显式回答来源与 resolvedAnswers

`resolvePendingQuestionAnswers` 已有完整的 `customText` 分支：

```
const customText = values.find((value) => !optionsByValue.has(value));
return { questionIndex, selections, ...(customText === undefined ? {} : { customText }) };
```

该逻辑不依赖 `question.custom` 声明，能兼容缺失 `answerKinds` 的旧请求。新前端对 QUESTION 额外提交与问题一一对应的 `answerKinds`：`TEXT`、`OPTION_SELECTION`、`OPTION_ATTACHED_TEXT`、`CUSTOM_TEXT` 或 `OPTION_SELECTIONS_WITH_CUSTOM_TEXT`。Runtime 以 accepted question 校验 kind 与 values 的一致性；校验通过后随 pending answer durable fact 保存。`resolvePendingQuestionAnswers` 在 kind 存在时优先按 kind 解析，使 `CUSTOM_TEXT` 即使与 option value 相同也不会变成 selection；kind 缺失时继续使用既有 value 匹配兼容路径。

包含 `customText` 的正常 AskUserQuestion Tool Result 回显已校验的 `answerKinds`，并按实际回答类型组装一条简短英文 `instruction`。对于 `CUSTOM_TEXT`，指令明确 `customText` 是权威自由文本输入；对于 `OPTION_SELECTIONS_WITH_CUSTOM_TEXT`，指令明确 `selections` 与 `customText` 是同一用户回答中有意提供的两个组成部分，模型必须同时保留和使用。两种类型都明确自由文本即使与 option value 或 label 完全相同也不得重新解释为选项选择。该指令只约束回答解释，不指定后续业务动作，也不包含领域定制示例。

#### 4. Stream projection 不变

`projectAskUserQuestionAnswerResult` 只处理 `answers: string[][]` 的安全投影，不区分 custom 与非 custom 来源。无需修改。

`safePendingInputQuestions` 在 `stream-envelope.ts` 中有一份与 schema 相同的互斥约束：当 question 有 `requiresTextInput=true` option 且 `custom=true` 时，返回 `undefined` 导致整个 questions 数组被丢弃。MUST 同步修改：移除 `custom === true` 条件，只保留 `multiple === true` 条件。否则 ⑤+custom 的问题在 `USER_INPUT_REQUIRED` 事件投影时会被静默丢弃，前端看不到问题。

#### 5. Model-facing guidance 修改

在 `AskUserQuestion` Tool description 中增加一句：

> 用户可能提供选项列表外的自由文本回答；你需要在后续步骤中参考和使用该回答。

不改变 schema 的 `custom` 字段定义和 description。`custom=true` 仍是模型显式声明自定义回答的方式，模型继续按原规则使用。

同时 MUST 修改 Tool description 中已有的互斥指导文本：将 "do not combine such options with multiple=true or custom=true" 改为 "do not combine such options with multiple=true"，移除对 `custom=true` 的互斥提及，与 schema 约束修改保持一致。

#### 6. Frontend QuestionInput 修改

在所有有 options 的子形态（②③④⑤）底部增加 type anything textarea。

交互规则：

| 子形态 | 选项与 type anything | answer 组装 |
| --- | --- | --- |
| ② 单选（无 custom） | 互斥：选选项清空文本，打字清空选项 | `[freeText]` 或 `[optionId]` |
| ③ 多选（无 custom） | 共存：选项和文本可同时存在 | `[optionId, ..., freeText]` |
| ④ 单选+custom | 互斥（已有行为，不变） | `[freeText]` 或 `[optionId]` |
| ④ 多选+custom | 共存（已有行为，不变） | `[optionId, ..., freeText]` |
| ⑤ 选项+附加文本 | 互斥：选 requiresTextInput option 使用附加文本；type anything 使用自由文本 | `[optionId, textInput]` 或 `[freeText]` |

复用已有的 `activateCustom` / `setCustomValue` / `setQuestionCustomActive` 逻辑。对于 ②③ 无 `custom=true` 的 question，前端不再检查 `question.custom !== true` 就激活 custom 输入。

#### 7. Frontend ProcessDetail 修改

`buildSupplementalInputDetail` 的输入方式标签当前只在 `question.custom === true` 时显示"允许自定义输入"。

修改为：QUESTION kind 总是显示"自由输入"标签（或等价措辞），不只依赖 `question.custom === true`。

回答展示无需修改：`options.get(answer) ?? answer` fallback 天然能显示不匹配 option 的自由文本。

#### 8. Memory 影响分析

memory 系统与 AskUserQuestion answer 之间无直接数据交互：

- `task-trajectory-builder.ts` 只读取 timeline events 的 type 和 safeSummary，不读取 answer 内容。
- `memory-extraction.ts` 从 TaskTrajectoryRecord 提取候选记忆，Trajectory 结构没有 answers / customText / resolvedAnswers 字段。
- `USER_INPUT_RECEIVED` 事件只用作 `evidenceLevel: 'USER_CONFIRMATION'`，不记录用户回答了什么。

本次变更不改 timeline event 类型、不改 safeSummary、不改 Trajectory 结构。memory 完全无感知，不需要修改。

### answer 格式无歧义验证

QUESTION 的 answer values 与显式 kind 共同决定解析结果：

```
answers = [["optionId"]]              → selections: [{value, label}]
answers = [["optionId", "textInput"]] → selections: [{value, label, textInput}]  (requiresTextInput option)
answers = [["freeText"]]              → customText: "freeText"
answers = [["optionId", "freeText"]]  → selections: [{value, label}], customText: "freeText"  (多选共存)
```

新前端以实际 UI 状态生成 kind，不通过 `optionsByValue.get(value)` 推断输入来源。Runtime 使用 option value 只校验 `OPTION_SELECTION` 和 `OPTION_ATTACHED_TEXT` 是否引用 accepted option；`CUSTOM_TEXT` 的文本允许与任一 option value 相同。

唯一需要注意的边界：单选时 `["optionId", "freeText"]` 会被解析为 requiresTextInput option + 附加文本。但前端互斥交互保证了单选时不会同时产生选项和自由文本，所以这个 answer 格式在单选模式下不会出现。多选时 `["optionId", "freeText"]` 被正确解析为 selections + customText。

### 质量属性

- **安全**：CONFIRMATION、AUTHORIZATION、HUMAN_HANDOFF 的 answer 校验不变，安全边界不受影响。AskUserQuestion 的 forbidden-purpose、budget、option uniqueness 输入校验不变。
- **可维护性**：复用已有 customText 语义和 resolvePendingQuestionAnswers 逻辑，不引入新概念或新字段。
- **可测试性**：runtime answer 校验测试、schema 约束测试、resolvedAnswers 投影测试、前端 RespondInput 测试和 ProcessDetail 展示测试均可覆盖。
