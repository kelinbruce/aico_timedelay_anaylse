## Why

Agent 开发者在一个澄清问题中需要提供十一至十五个候选项时，当前 `AskUserQuestion` 会拒绝该调用，导致模型必须删减有效候选项或改用不受治理的表达。将单个问题的正常选项上限从十个提高到十五个，可以完整表达这类候选集合，同时继续通过明确上限控制模型输入和用户交互容量。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 单个 `AskUserQuestion` 问题允许包含 `2..15` 个预定义选项。
- 包含十一至十五个其他方面合法选项的调用能够创建正常的 `QUESTION` pending input。
- 包含十六个或更多选项的调用安全失败，并且不得创建部分 pending input。
- 中文界面的自由文本入口使用简洁标签“手动输入”。

**非目标：**

- 不改变每次调用的问题数量、可见文本长度、option 唯一性、`multiple`、`custom` 或 `requiresTextInput` 语义。
- 不改变 pending input lifecycle、用户回答 contract、stream event、持久化或前端交互形态。
- 不为十五个以上选项增加兼容输入或截断行为。

## What Changes

- `AskUserQuestion` 单个问题的正常预定义选项数量范围由 `2..10` 修改为 `2..15`。
- 输入包含十一至十五个合法选项时，系统接受完整有序选项集合；包含十六个或更多选项时，系统返回安全输入校验失败，且不得截断或部分接受。
- 中文界面将自由文本入口文案由“我手动输入”简化为“手动输入”，不改变回答语义。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.6 向用户提问` → `specs/ask-user-question-tool/spec.md`
  - 功能边界：单个问题支持的预定义选项数量上限由十个提高到十五个。
  - 系统质量属性：无新增黑盒质量目标；性能/容量和可测试性仅有局部设计与验证影响。
  - 映射说明：`ask-user-question-tool` 是本次修改的 canonical spec。

## 影响范围（Impact）

- Agent 开发者和模型可以在一个问题中提供十一至十五个候选项。
- 模型可见 Tool input schema、输入校验测试和相关描述断言需要与新上限保持一致。
- 公共回答格式和运行时生命周期无需改变；前端只修改中文本地化文案，不改变组件交互。
