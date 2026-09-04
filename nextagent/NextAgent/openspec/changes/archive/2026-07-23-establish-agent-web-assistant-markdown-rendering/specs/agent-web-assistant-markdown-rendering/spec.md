## ADDED Requirements

### Requirement: 已完成普通 assistant 正文采用 Markdown 语义展示

当普通 assistant turn 的状态为 `COMPLETED` 时，`agent-web` SHALL 将其 `LLM_CONTENT_DELTA` 形成的可见正文渲染为 Markdown 语义元素。本 Requirement 只定义已完成普通正文中的标题、无序列表、引用、强调、行内代码和普通代码围栏，不定义未完成流式尾部、事件聚合、结构化消息或精确视觉样式。

#### Scenario: 展示常用 Markdown 结构
- **WHEN** 普通 assistant 正文包含标题、无序列表、引用和强调标记
- **THEN** `agent-web` MUST 将这些内容分别展示为对应的标题、列表、引用和强调语义元素

#### Scenario: 展示行内代码和普通代码围栏
- **WHEN** 普通 assistant 正文包含行内代码和普通闭合代码围栏
- **THEN** `agent-web` MUST 将行内代码展示为正文内的 code 元素
- **AND** MUST 将代码围栏内容展示在独立的 pre/code 语义结构中

### Requirement: 已完成普通 assistant 正文展示 GFM 风格 pipe table

当普通 assistant turn 的状态为 `COMPLETED` 时，`agent-web` SHALL 把其正文中具有表头、分隔行和数据行的 GFM 风格 pipe table 展示为语义化表格。本 Requirement 只承诺下列已验证输入形态，不构成对完整 GFM 语法的承诺。

#### Scenario: 展示带边界 pipe 的表格
- **WHEN** 普通 assistant 正文包含带首尾 pipe 的表头、分隔行和数据行
- **THEN** `agent-web` MUST 输出包含 table、thead 和 tbody 的语义结构
- **AND** MUST 按输入列顺序展示表头和数据单元格内容

#### Scenario: 展示不带边界 pipe 的表格
- **WHEN** 普通 assistant 正文包含不带首尾 pipe、但具有表头、分隔行和数据行的 pipe table
- **THEN** `agent-web` MUST 将其展示为语义化表格

#### Scenario: 保留单元格内的 pipe 和行内 Markdown
- **WHEN** 表格单元格包含 escaped pipe、inline-code pipe 或行内 Markdown
- **THEN** `agent-web` MUST 将这些 pipe 保留在所属单元格内容中
- **AND** MUST 在表头和数据单元格内展示对应的行内 Markdown 语义

#### Scenario: 代码围栏内的表格形状文本保持代码
- **WHEN** 普通代码围栏包含表头、分隔行和数据行形状的文本
- **THEN** `agent-web` MUST 将这些文本保留在代码围栏中
- **AND** MUST NOT 为这些文本生成 table 元素

### Requirement: 已完成普通 assistant 正文中的已验证异常 pipe table 行保持可读表格

当普通 assistant turn 的状态为 `COMPLETED` 时，`agent-web` SHALL 对当前已验证的 pipe table 拆行、同行拼接和单行扁平化输入进行确定性整理，并展示为与原始列顺序一致的语义化表格。

#### Scenario: 修复跨行断开的边界 pipe 和数据行
- **WHEN** 表头末尾的边界 pipe 被换行，或数据行开头的边界 pipe 与其余单元格被拆到相邻行
- **THEN** `agent-web` MUST 合并相邻片段并展示包含原表头和数据内容的表格

#### Scenario: 修复同行拼接的多条数据行
- **WHEN** 多条数据行被连续拼接在同一 Markdown 行中
- **THEN** `agent-web` MUST 按表格列数拆分并展示对应的数据行

#### Scenario: 修复单行扁平化表格
- **WHEN** 表头、分隔行和数据行被扁平化到同一 Markdown 行中
- **THEN** `agent-web` MUST 恢复表头和数据行并展示语义化表格

#### Scenario: 空行分隔的数据行仍属于前一表格
- **WHEN** 有效表头和分隔行后的数据行仅由空行与前一表格内容分隔
- **THEN** `agent-web` MUST 将该数据行展示在前一表格的 tbody 中
