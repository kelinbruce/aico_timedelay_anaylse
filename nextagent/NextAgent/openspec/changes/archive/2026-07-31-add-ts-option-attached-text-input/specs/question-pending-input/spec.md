## ADDED Requirements

### Requirement: 单选选项可以要求一个附加文本值

`QUESTION` pending input SHALL 允许一个单选问题中的多个不同选项声明 `requiresTextInput=true`。选择这样一个选项 MUST 通过既有的有序 `string[][]` 回答 envelope 产生一个同时保留所选稳定选项值和一个非空附加文本值的回答条目。

#### Scenario: 附加文本选项回答

- **WHEN** 一个 pending 单选问题包含一个带 `requiresTextInput=true` 的选项
- **AND** 用户选择该选项并输入非空文本
- **THEN** 客户端 MUST 以 `[optionValue, inputText]` 提交该问题回答条目
- **AND** runtime MUST 校验第一个字符串与所选已接受选项完全匹配
- **AND** runtime MUST 仅因该匹配选项具有 `requiresTextInput=true` 才接受第二个字符串
- **AND** 已接受的回答 MUST 按此顺序携带两个字符串恢复原始 run。

#### Scenario: 普通选项保持既有回答形状

- **WHEN** 一个 pending 单选问题包含选项附加输入选项，但用户选择了一个不带 `requiresTextInput=true` 的普通选项
- **THEN** 客户端 MUST 恰好提交 `[optionValue]`
- **AND** runtime MUST 拒绝该普通选项的任何第二个字符串。

#### Scenario: 附加选项回答要求完整输入

- **WHEN** 一个回答选择了带 `requiresTextInput=true` 的选项，但省略第二个字符串、提供空第二个字符串、提供超过两个字符串，或使用与已接受选项不匹配的第一个字符串
- **THEN** runtime MUST 以安全的校验结果拒绝该回答
- **AND** MUST NOT 将该 pending input 解析为 `RECEIVED`。

#### Scenario: 附加选项输入约束与多选和通用 custom 互斥

- **WHEN** 一个已接受的问题包含任何带 `requiresTextInput=true` 的选项
- **THEN** 该问题 MUST 是单选
- **AND** 问题级 `custom` MUST 缺席或为 false
- **AND** runtime MUST 拒绝将附加选项输入与 `multiple=true` 或 `custom=true` 组合的 pending intent。

### Requirement: 选项附加输入投影保持安全且跨宿主一致

系统 SHALL 只投影已被接受的选项附加输入呈现约束，且所有浏览器 host 模式 MUST 复用同一问题组件和回答提交语义。

#### Scenario: 所选选项展开一个有界文本输入

- **WHEN** 用户选择一个带 `requiresTextInput=true` 的选项
- **THEN** 共享浏览器问题组件 MUST 在该选项行内展开一个文本输入
- **AND** MUST 在存在时显示已接受的 `inputPlaceholder`，缺席时显示通用本地化回退
- **AND** MUST 将输入文本限制为 500 个字符
- **AND** MUST 在附加文本非空前保持提交禁用。

#### Scenario: 切换选择清除过时的附加输入

- **WHEN** 用户输入附加文本后在同一单选问题中选择另一个选项
- **THEN** 前一个选项的附加文本 MUST NOT 被包含在提交的回答中
- **AND** 选择另一个附加输入选项 MUST 只呈现由新选择选项拥有的输入。
