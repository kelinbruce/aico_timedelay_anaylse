# agent-web-assistant-markdown-rendering Specification

## Purpose
定义已完成普通 assistant 正文的安全 Markdown 语义、点分标识符、受控任务状态、已验证 GFM pipe table、宽窄视口可读性边界、图片同源过滤和链接安全属性与跨源确认门；不扩展到 live tail、结构化消息、完整 sanitization 或数学公式。

## Function

- **所属 Function**：`FN-1.22 展示会话消息正文`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格
## Requirements
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

### Requirement: Markdown 图片仅渲染同源 URL

`agent-web` MUST 只把同源图片 URL 渲染为 `<img>` 元素。非同源图片 URL MUST 以转义文本形式展示，MUST NOT 生成 `<img>` 标签。同源判定基于 `window.location` 的 protocol、hostname 和 port；相对路径、fragment、`data:` URI 视为同源。空或无效 `href` MUST 展示为 alt 文本。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 同源图片渲染为 img 元素
- **WHEN** 普通 assistant 正文包含相对路径或同源绝对 URL 的图片标记
- **THEN** `agent-web` MUST 生成包含该 `src` 和 `alt` 的 `<img>` 元素

#### Scenario: 跨源图片 URL 展示为文本
- **WHEN** 普通 assistant 正文包含非同源绝对 URL 的图片标记
- **THEN** `agent-web` MUST NOT 生成 `<img>` 元素
- **AND** MUST 把该 URL 以转义文本形式展示

#### Scenario: data URI 图片视为同源
- **WHEN** 普通 assistant 正文包含 `data:image/...` 格式的图片标记
- **THEN** `agent-web` MUST 把其渲染为 `<img>` 元素

#### Scenario: javascript 协议图片 URL 展示为文本
- **WHEN** 普通 assistant 正文包含 `javascript:` 协议的图片标记
- **THEN** `agent-web` MUST NOT 生成 `<img>` 元素
- **AND** MUST 把该 URL 以转义文本形式展示

### Requirement: Markdown 链接安全属性与跨源确认门

`agent-web` MUST 为所有 Markdown 链接添加 `target="_blank"` 和 `rel="noopener noreferrer"` 属性。同源链接 MUST 保留原始 `href` 并允许直接打开。非同源链接 MUST 把真实 URL 存入 `data-external-href`、把 `href` 设为 `#`，并在用户点击时弹出确认提示；用户确认后 MUST 在新标签页打开真实 URL，取消 MUST 阻止跳转。

危险协议 URL（`javascript:`、`vbscript:`、`data:` 等）MUST NOT 进入 `data-external-href` 或 `window.open` 调用路径。click handler MUST 在调用 `window.open` 前校验 URL 协议白名单（仅允许 `http:`、`https:` 和 protocol-relative `//`），不符合白名单的 URL MUST 被静默丢弃。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 同源链接直接打开并携带安全属性
- **WHEN** 普通 assistant 正文包含同源 URL 的链接标记
- **THEN** `agent-web` MUST 生成包含原始 `href`、`target="_blank"` 和 `rel="noopener noreferrer"` 的 `<a>` 元素
- **AND** MUST NOT 设置 `data-external-href`

#### Scenario: 跨源链接使用 data-external-href 拦截
- **WHEN** 普通 assistant 正文包含非同源 URL 的链接标记
- **THEN** `agent-web` MUST 生成 `href="#"` 并把真实 URL 存入 `data-external-href`
- **AND** MUST 添加 `target="_blank"` 和 `rel="noopener noreferrer"`

#### Scenario: 点击跨源链接弹出确认提示
- **WHEN** 用户点击带有 `data-external-href` 的链接
- **THEN** `agent-web` MUST 弹出确认提示，提示用户即将离开本系统
- **AND** MUST NOT 在用户确认前打开新标签页

#### Scenario: 用户确认后打开跨源链接
- **WHEN** 用户在确认提示中选择继续访问
- **THEN** `agent-web` MUST 在新标签页打开 `data-external-href` 中的真实 URL

#### Scenario: 用户取消后不跳转
- **WHEN** 用户在确认提示中选择取消
- **THEN** `agent-web` MUST NOT 打开新标签页或执行导航

#### Scenario: javascript 协议链接展示为纯文本
- **WHEN** 普通 assistant 正文包含 `javascript:` 协议的链接标记
- **THEN** `agent-web` MUST NOT 生成 `<a>` 元素或 `data-external-href`
- **AND** MUST 把该 URL 以转义文本形式展示

#### Scenario: data-external-href 中的危险协议被 click handler 阻断
- **WHEN** `data-external-href` 包含非 `http`/`https`/protocol-relative 的 URL
- **THEN** click handler MUST NOT 调用 `window.open`
- **AND** MUST NOT 弹出确认提示

### Requirement: Sanitized Markdown and Mermaid output uses a dedicated parser mount

Agent Web MUST keep the existing Markdown sanitization and Mermaid SVG cleanup boundaries before DOM mounting. The final mount for sanitized block Markdown, inline Markdown, and Mermaid SVG/style output MUST go through one dedicated parser-based mount component. Agent Web production source MUST NOT use `dangerouslySetInnerHTML` or direct `innerHTML` assignment for these outputs. A mount update MUST replace stale child nodes so an older Markdown segment or Mermaid diagram cannot remain visible.

**需求类别**：系统质量属性

**质量属性**：安全、可维护性、可测试性
**适用范围**：该 Function

#### Scenario: 已净化正文通过统一挂载边界进入 DOM

- **WHEN** completed Markdown body 或 Mermaid diagram produces sanitized HTML
- **THEN** Agent Web MUST mount that HTML through the dedicated parser-based mount component
- **AND** MUST preserve the upstream Markdown/Mermaid sanitization boundary

#### Scenario: 更新时清除旧渲染节点

- **WHEN** sanitized Markdown or Mermaid HTML changes
- **THEN** the mount MUST replace its previous child nodes
- **AND** stale nodes from the prior render MUST NOT remain in the DOM

#### Scenario: 生产源码禁止直挂载原始 HTML

- **WHEN** Agent Web production source is inspected
- **THEN** it MUST NOT contain `dangerouslySetInnerHTML` or direct `innerHTML` assignment for Markdown/Mermaid rendering
- **AND** raw executable HTML from assistant content MUST NOT be mounted or executed
