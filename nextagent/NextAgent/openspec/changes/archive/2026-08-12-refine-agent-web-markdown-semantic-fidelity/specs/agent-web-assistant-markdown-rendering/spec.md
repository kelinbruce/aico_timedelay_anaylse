## Function

- **所属 Function**：`FN-1.22 展示会话消息正文`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 点分标识符保持所属正文结构

当已完成普通 assistant 正文的同一文本或列表项包含由英文句点连接的至少三个非空字母或数字片段时，`agent-web` MUST 将该点分标识符保留在所属 Markdown 语义块内；系统 MUST NOT 把标识符内部的数字片段解释为新的有序列表。

**需求类别**：功能性需求

#### Scenario: 列表项保留点分标识符
- **WHEN** 无序列表项包含连续文本 `A.1.a`
- **THEN** `agent-web` MUST 在同一个列表项内连续展示 `A.1.a`
- **AND** MUST NOT 为 `1.a` 生成独立段落或有序列表项

#### Scenario: 真实有序列表边界继续生效
- **WHEN** 句末标点之后紧接带有数字、英文句点和空格的有序列表项
- **THEN** `agent-web` MUST 继续把该数字标记展示为新的有序列表项

### Requirement: 任务列表以受控不可交互状态展示

当已完成普通 assistant 正文包含 GFM 任务列表标记 `- [x]`、`- [X]` 或 `- [ ]` 时，`agent-web` MUST 将每一项展示为不可交互的选中或未选中 checkbox 语义及其文本；系统 MUST NOT 把 checkbox 标签显示为普通字符串，也 MUST NOT 因任务列表展示而允许任意可交互 HTML 输入或事件属性。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 展示选中和未选中任务
- **WHEN** 正文包含一个选中任务项和一个未选中任务项
- **THEN** `agent-web` MUST 展示两个不可交互 checkbox 状态及其各自文本
- **AND** MUST NOT 显示 `<input` 标签字符串

#### Scenario: 不可信输入元素保持不可交互
- **WHEN** 正文包含不是由任务列表标记产生的 `input` 元素、事件属性或脚本载荷
- **THEN** `agent-web` MUST NOT 生成可交互输入控件或可执行事件处理器

### Requirement: GFM 表格保留列对齐语义

当已完成普通 assistant 正文的 GFM pipe table 分隔行使用 `:---`、`---:` 或 `:---:` 声明列对齐时，`agent-web` MUST 分别把该列的全部表头和数据单元格展示为左对齐、右对齐或居中；未声明对齐的列 MUST 保持默认起始侧对齐。对已验证异常表格行进行整理后，系统 MUST 保留原分隔行的对齐语义。

**需求类别**：功能性需求

#### Scenario: 表头和数据使用同一列对齐
- **WHEN** 表格的四列分别声明左对齐、右对齐、居中和默认对齐
- **THEN** `agent-web` MUST 对每一列的表头和全部数据单元格应用对应对齐结果

#### Scenario: 整理后的表格保留对齐
- **WHEN** 带对齐分隔行的已验证异常表格输入被恢复为语义化表格
- **THEN** `agent-web` MUST 在恢复后的表头和数据单元格上保留原列对齐结果

### Requirement: 消息正文在宽窄视口保持可读

`agent-web` MUST 在共享会话消息区域内保持正文块的可读层级；表格与后续标题之间 MUST 只保留一个 `16px` 章节间隔。模型返回内容 MUST 继续使用现有共享消息列的响应式可用宽度，MUST NOT 为 Markdown 子类型新增 `820px` 或其他固定最大宽度。表格和 Mermaid 的可用宽度小于 `560px` 时，系统 MUST 在各自容器内保留至少 `560px` 的内容宽度并提供横向滚动，MUST NOT 让它们导致页面级横向溢出。消息滚动 viewport MUST 覆盖完整 main，浮动置底入口 MUST 在正文列水平居中且保持独立透明浮层；布局 MUST 按包含 Skill 选择器和 composer 的 footer surface 实际高度为滚动内容提供 bottom safe area，MUST NOT 通过缩短 viewport 或把浮动入口计入全宽遮罩来预留空间。Footer surface MUST 遮住其下方历史消息，MUST NOT 让文字出现在 Skill 选择器与 composer 之间。Composer 的可见外边界 MUST 使用共享 footer 内容列的完整可用宽度，MUST NOT 在该内容列内形成第二层水平缩进。

**需求类别**：功能性需求

#### Scenario: 表格后续标题使用单一章节间隔
- **WHEN** 一个表格后紧接标题
- **THEN** 表格可见边界与标题之间的垂直距离 MUST 为 `16px`

#### Scenario: 窄视口保留表格列结构
- **WHEN** 消息正文可用宽度小于 `560px`
- **THEN** `agent-web` MUST 让用户在表格容器内横向滚动查看全部列
- **AND** 表格内容宽度 MUST 至少为 `560px`
- **AND** MUST NOT 让页面产生横向滚动

#### Scenario: 窄视口保留 Mermaid 标签可读性
- **WHEN** 消息正文可用宽度小于 `560px` 且正文包含已完成渲染的 Mermaid 图
- **THEN** `agent-web` MUST 让用户在 Mermaid 容器内横向滚动查看完整图形
- **AND** Mermaid 内容宽度 MUST 至少为 `560px`
- **AND** MUST NOT 让页面产生横向滚动

#### Scenario: 宽视口使用共享消息列宽度
- **WHEN** 模型返回消息包含正文、列表、表格、代码块和 Mermaid
- **THEN** 各内容外层 MUST 使用共享消息列的响应式可用宽度
- **AND** MUST NOT 为任一 Markdown 子类型增加 `820px` 或其他固定最大宽度

#### Scenario: 完整滚动 viewport 与动态底部安全区
- **WHEN** 可滚动消息正文显示 overlay footer
- **THEN** 消息滚动 viewport 的上下左右边界 MUST 与 main 的对应边界一致
- **AND** 滚动内容的 bottom safe area MUST 等于包含 Skill 选择器和 composer 的 footer surface 实际高度
- **AND** footer surface 高度发生变化时 MUST 更新 bottom safe area，MUST NOT 改变 viewport 的底部边界

#### Scenario: 浮动置底入口不遮挡可读正文
- **WHEN** 用户从消息底部回滚且浮动置底入口出现
- **THEN** 该入口的水平中心 MUST 与正文列的水平中心一致
- **AND** 浮动入口周围 MUST 保持透明，MUST NOT 形成与其高度相同的全宽遮罩带
- **AND** 浮动入口显隐 MUST NOT 改变消息滚动 viewport 的可用高度、scrollHeight 或 bottom safe area

#### Scenario: Skill 选择区域不透出历史消息
- **WHEN** composer 左上方显示 Skill 选择器或已选 Skill，且用户回看历史消息
- **THEN** Skill 选择器、已选 Skill 与 composer 之间的 footer surface MUST 使用不透明页面背景
- **AND** MUST NOT 在该区域显示位于 overlay 后方的消息文字

#### Scenario: Composer 对齐共享 footer 内容列
- **WHEN** 会话区域显示 composer
- **THEN** composer 可见外边界的左右两侧 MUST 分别与共享 footer 内容列的左右边界对齐
- **AND** composer 可见外边界宽度与该内容列可用宽度的差值 MUST 不超过 `1px`

## Function 变更汇总

### 描述

- **变更类型**：新增
- **目标内容**：系统将已完成普通 assistant 正文展示为安全、语义一致且在宽窄视口下可读的 Markdown 内容。
- **依据 Requirements**：`点分标识符保持所属正文结构`、`任务列表以受控不可交互状态展示`、`GFM 表格保留列对齐语义`、`消息正文在宽窄视口保持可读`

### 输入

- **变更类型**：新增
- **目标内容**：已完成普通 assistant 的可见正文及当前消息正文可用视口。
- **依据 Requirements**：`点分标识符保持所属正文结构`、`任务列表以受控不可交互状态展示`、`GFM 表格保留列对齐语义`、`消息正文在宽窄视口保持可读`

### 输出

- **变更类型**：新增
- **目标内容**：保留点分标识符、受控任务状态、表格列对齐和窄视口可读性的语义化消息正文。
- **依据 Requirements**：`点分标识符保持所属正文结构`、`任务列表以受控不可交互状态展示`、`GFM 表格保留列对齐语义`、`消息正文在宽窄视口保持可读`

### 处理过程

- **变更类型**：新增
- **目标内容**：系统识别正文中的受支持 Markdown 结构，拒绝不可信交互输入，并根据正文可用宽度保持内容层级和表格可访问性。
- **依据 Requirements**：`点分标识符保持所属正文结构`、`任务列表以受控不可交互状态展示`、`GFM 表格保留列对齐语义`、`消息正文在宽窄视口保持可读`

### 结果

- **变更类型**：新增
- **目标内容**：用户在三种宿主中看到相同、无标签泄漏、无语义断裂且不会被浮动入口遮挡的消息正文。
- **依据 Requirements**：`点分标识符保持所属正文结构`、`任务列表以受控不可交互状态展示`、`GFM 表格保留列对齐语义`、`消息正文在宽窄视口保持可读`

### 规格

- **规格项**：受支持的任务列表状态
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：选中、未选中；两种状态均不可交互
- **依据 Requirements**：`任务列表以受控不可交互状态展示`

- **规格项**：受支持的表格列对齐
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：左对齐、右对齐、居中、默认起始侧对齐
- **依据 Requirements**：`GFM 表格保留列对齐语义`

- **规格项**：表格后续标题间隔
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：表格可见边界至紧随标题 `16px`
- **依据 Requirements**：`消息正文在宽窄视口保持可读`

- **规格项**：模型返回内容宽度 owner
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：复用共享消息列响应式宽度；Markdown 子类型不新增固定最大宽度
- **依据 Requirements**：`消息正文在宽窄视口保持可读`

- **规格项**：窄视口结构化内容最小宽度
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：表格与 Mermaid 各自至少 `560px`
- **依据 Requirements**：`消息正文在宽窄视口保持可读`

### 主规格

- **变更类型**：新增
- **目标内容**：`agent-web-assistant-markdown-rendering`
- **依据 Requirements**：`点分标识符保持所属正文结构`、`任务列表以受控不可交互状态展示`、`GFM 表格保留列对齐语义`、`消息正文在宽窄视口保持可读`

### 覆盖特性

- **变更类型**：新增
- **目标内容**：`F-1.4 查看会话内容`
- **依据 Requirements**：`点分标识符保持所属正文结构`、`任务列表以受控不可交互状态展示`、`GFM 表格保留列对齐语义`、`消息正文在宽窄视口保持可读`
