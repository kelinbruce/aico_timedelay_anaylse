## Function

- **所属 Function**：`FN-10.35 呈现 Agent Web 页面布局`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Agent Web 页面使用统一三段式布局

首批适用的会话、定时任务和收藏主内容页面 MUST 以 Header、Content 和可选 Footer 三个区域呈现；Header MUST 始终位于页面顶部，Content MUST 占用 Header 和可见 Footer 之外的剩余高度。页面未提供 Footer 时，Content MUST 使用 Header 之下的全部剩余高度；页面提供 Footer 时，Footer MUST 位于页面底部且 MUST NOT 随 Content 滚动离开视口。本 Requirement 中的 Footer 只表示统一布局提供的 docked Footer；会话 overlay composer 不属于该 Footer，并 MUST 继续遵循既有会话 viewport 与 overlay footer 契约。

**需求类别**：功能性需求

#### Scenario: 无 Footer 页面使用完整剩余高度
- **WHEN** 用户打开未提供 Footer 的定时任务或收藏页面
- **THEN** Header MUST 固定显示在页面顶部
- **AND** Content MUST 使用 Header 之下至页面底部的全部剩余高度

#### Scenario: docked Footer 保持在页面底部
- **WHEN** 用户打开提供 docked Footer 的页面并滚动 Content
- **THEN** Footer MUST 保持在页面底部
- **AND** Footer MUST NOT 随 Content 一起滚动
- **AND** Content MUST NOT 被 Footer 遮挡

### Requirement: 页面 Header 保持一致且在窄视口可用

统一页面 Header 的高度 MUST 为 `48px`，左右内边距 MUST 各为 `16px`，内容 MUST 垂直居中，且 Header MUST NOT 显示底部分隔线或阴影。标题字号 MUST 为 `16px`，字重 MUST 为 `500`，行高 MUST 为 `28px`。Header MUST 以透明背景连续呈现当前宿主主题的页面背景，MUST NOT 在 Header 内独立重复绘制页面背景渐变；Header 的主要文本色和交互状态色 MUST 使用当前宿主主题。主题切换 MUST NOT 改变 Header 几何。Header 左侧 MUST 依次展示可选返回操作和标题，右侧 MUST 原样展示目标页面提供的操作区域；未提供返回操作时标题 MUST 占用左侧起始位置。统一布局 MUST NOT 对页面操作建立主要或次要分类，MUST NOT 重排、隐藏或把页面操作转换为菜单项。Header 可用宽度不足以完整展示标题和操作区域时，Header MUST 保持单行，标题 MUST 以省略号截断，且 Header MUST NOT 换为第二行；目标页面 MUST 独立定义其操作区域在受支持容器宽度内的展示策略。

**需求类别**：功能性需求

#### Scenario: 标准宽度展示标题和操作
- **WHEN** 会话、定时任务或收藏页面的 Header 可用宽度足以展示全部内容
- **THEN** Header MUST 以 `48px` 高度和左右各 `16px` 内边距展示
- **AND** 标题 MUST 使用 `16px` 字号、`500` 字重和 `28px` 行高
- **AND** 标题和全部页面操作 MUST 保持在同一行
- **AND** Header 底部 MUST NOT 显示分隔线或阴影
- **AND** Header MUST NOT 独立重复绘制页面背景渐变

#### Scenario: 页面操作区域保持页面声明
- **GIVEN** 目标页面已提供一个包含页面操作的右侧区域
- **WHEN** 统一 Header 呈现该页面
- **THEN** Header MUST 原样展示目标页面提供的操作区域
- **AND** 统一布局 MUST NOT 重排、隐藏或把其中操作转换为菜单项

#### Scenario: 主题切换不改变 Header 几何
- **WHEN** 用户在浅色主题和暗色主题之间切换
- **THEN** Header MUST 以透明背景连续呈现切换后主题的页面背景，并使用切换后主题的主要文本色和交互状态色
- **AND** Header MUST NOT 独立重复绘制页面背景渐变
- **AND** Header 的高度、水平内边距、标题字体和单行排列 MUST 保持不变

#### Scenario: 首批页面不展示返回操作
- **WHEN** 用户打开会话、定时任务或收藏页面
- **THEN** Header MUST NOT 展示返回操作
- **AND** 页面标题 MUST 从 Header 左侧内容起始位置展示

#### Scenario: 窄视口保持单行 Header
- **GIVEN** 页面已提供适用于当前受支持容器宽度的右侧操作区域
- **WHEN** Header 可用宽度不足以完整展示标题和操作区域
- **THEN** 标题 MUST 以省略号截断
- **AND** 页面操作区域 MUST 保持页面提供的结构
- **AND** Header MUST NOT 换行或增加高度

### Requirement: 页面 Content 支持 contained 与 fluid 宽度

统一页面 Content MUST 使用页面显式选择的 `contained` 或 `fluid` 宽度模式，且未显式选择时 MUST 使用 `contained`。`contained` 模式的内容最大宽度 MUST 为 `1080px`，内容宽度不足 `1080px` 时 MUST 使用全部可用宽度，并 MUST 在页面可用宽度内水平居中；`fluid` 模式 MUST 不施加最大宽度。两种模式均 MUST 在 Content 左右各保留 `16px` 水平安全内边距。页面提供 docked Footer 时，其内容列 MUST 使用与 Content 相同的宽度模式和水平安全内边距。

**需求类别**：功能性需求

#### Scenario: 默认使用 contained 模式
- **WHEN** 页面未显式选择 Content 宽度模式
- **THEN** Content MUST 使用 `contained` 模式
- **AND** 内容最大宽度 MUST 为 `1080px`
- **AND** 内容 MUST 在左右各 `16px` 水平安全内边距之间居中

#### Scenario: fluid 模式占满安全区域
- **WHEN** 页面显式选择 `fluid` 模式
- **THEN** Content MUST 在左右各 `16px` 水平安全内边距之间占满可用宽度
- **AND** Content MUST NOT 施加固定最大宽度

#### Scenario: Footer 与 Content 内容列对齐
- **WHEN** 页面提供 docked Footer
- **THEN** Footer 内容列 MUST 使用与 Content 相同的 `contained` 或 `fluid` 模式
- **AND** Footer 内容列与 Content 的左右可见边界差值 MUST 不超过 `1px`

### Requirement: 适用页面保持单一纵向滚动边界

用户打开会话、定时任务或收藏页面时，系统 MUST 只在该页面声明的滚动区域提供页面级纵向滚动，MUST NOT 因统一布局再产生第二个页面级纵向滚动条。会话页面采用统一布局后 MUST 继续满足 `agent-web-assistant-markdown-rendering` 中 `消息正文在宽窄视口保持可读` 的 viewport 与 overlay footer 契约，以及既有会话交互规格定义的跟随底部、用户滚动意图、历史分页和锚点定位结果；本 Requirement 不重新定义这些会话语义。定时任务页面 MUST 仅让 Content 区域纵向滚动；收藏内容未超出可用高度时 MUST NOT 显示纵向滚动条，收藏内容超出可用高度时 MUST 仅让收藏内容区域纵向滚动。收藏列表的业务规则由收藏列表规格独立定义。

**需求类别**：系统质量属性

**质量属性**：可维护性、可测试性
**适用范围**：`FN-1.22 展示会话消息正文`、`FN-10.9 Cron 工具`、`FN-1.13 查看收藏列表`

#### Scenario: 会话滚动语义保持不变
- **WHEN** 会话页面采用统一布局且用户回看历史消息、返回底部或加载锚点窗口
- **THEN** 会话页面 MUST 继续满足其既有 viewport、overlay footer、跟随底部、用户滚动意图、历史分页和锚点定位契约
- **AND** 页面 MUST NOT 出现由统一布局新增的第二个纵向滚动条

#### Scenario: 定时任务只滚动 Content
- **WHEN** 定时任务页面内容高度超过 Content 可用高度
- **THEN** Header MUST 保持可见
- **AND** Content MUST 提供唯一的页面级纵向滚动条
- **AND** 页面根容器 MUST NOT 同时提供纵向滚动条

#### Scenario: 收藏只在展开后滚动内容区域
- **GIVEN** 收藏页面当前内容未超出收藏内容区域的可用高度
- **WHEN** 收藏页面完成布局
- **THEN** 收藏内容区域 MUST NOT 显示纵向滚动条
- **WHEN** 收藏内容因分组展开而超出收藏内容区域可用高度
- **THEN** 收藏内容区域 MUST 提供唯一的页面级纵向滚动条
- **AND** Header 和过滤区 MUST 保持可见

### Requirement: 统一布局在三个宿主中保持一致

Local、Immersive 和 Collaborative/PIU 宿主展示首批适用页面时，系统 MUST 复用同一 Header、Content 宽度和滚动边界契约。宿主入口和导航方式不同 MUST NOT 改变标题栏尺寸、标题字体、页面声明的宽度模式或页面声明的滚动区域；Collaborative/PIU 的收藏和定时任务页面 MUST 继续在既有左侧扩展内容容器内展示，MUST NOT 因统一布局创建新的覆盖弹框或导航 authority。

**需求类别**：系统质量属性

**质量属性**：可测试性
**适用范围**：系统

#### Scenario: 收藏在三个宿主中保持同形
- **WHEN** Local、Immersive 和 Collaborative/PIU 分别展示收藏页面
- **THEN** 三个宿主 MUST 展示相同尺寸和字体的 Header
- **AND** 三个宿主 MUST 使用 `fluid` Content
- **AND** 收藏展开滚动边界 MUST 保持一致

#### Scenario: 定时任务在复用宿主中保持同形
- **WHEN** Local、Immersive 或 Collaborative/PIU 展示定时任务页面
- **THEN** 页面 MUST 使用相同尺寸和字体的 Header
- **AND** 页面 MUST 使用 `contained` Content
- **AND** 页面 MUST 仅让 Content 区域纵向滚动

## Function 变更汇总

### 描述

- **变更类型**：新增
- **目标内容**：系统在 Local、Immersive 和 Collaborative/PIU 宿主中，以统一 Header、Content、可选 docked Footer、内容宽度和单一纵向滚动边界呈现 Agent Web 主内容页面；首批适用页面为会话、定时任务和收藏。
- **依据 Requirements**：`Agent Web 页面使用统一三段式布局`、`页面 Header 保持一致且在窄视口可用`、`页面 Content 支持 contained 与 fluid 宽度`、`适用页面保持单一纵向滚动边界`、`统一布局在三个宿主中保持一致`

### 输入

- **变更类型**：新增
- **目标内容**：页面标题、可选返回操作、页面提供的操作区域、页面内容、`contained|fluid` 宽度选择、页面滚动归属和可选 docked Footer。
- **依据 Requirements**：`Agent Web 页面使用统一三段式布局`、`页面 Header 保持一致且在窄视口可用`、`页面 Content 支持 contained 与 fluid 宽度`、`适用页面保持单一纵向滚动边界`

### 输出

- **变更类型**：新增
- **目标内容**：主题一致、窄视口单行可用、内容边界确定且只在声明区域纵向滚动的 Agent Web 页面布局。
- **依据 Requirements**：`页面 Header 保持一致且在窄视口可用`、`页面 Content 支持 contained 与 fluid 宽度`、`适用页面保持单一纵向滚动边界`、`统一布局在三个宿主中保持一致`

### 结果

- **变更类型**：新增
- **目标内容**：页面无 Footer 时内容使用 Header 下方全部剩余高度；使用 docked Footer 时内容不被遮挡；三个宿主中的同一页面保持同形。
- **依据 Requirements**：`Agent Web 页面使用统一三段式布局`、`统一布局在三个宿主中保持一致`

### 规格

- **规格项**：Header 几何与标题字体
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：首批适用页面 Header 高 `48px`、左右内边距各 `16px`、无底部分隔线、阴影或独立页面背景渐变；标题字号 `16px`、字重 `500`、行高 `28px`
- **依据 Requirements**：`页面 Header 保持一致且在窄视口可用`

- **规格项**：Content 宽度模式
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`contained` 默认最大宽度 `1080px` 并居中；`fluid` 无最大宽度；两者左右水平安全内边距均为 `16px`
- **依据 Requirements**：`页面 Content 支持 contained 与 fluid 宽度`

- **规格项**：首批页面滚动归属
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：会话为消息 viewport，定时任务为 Content，收藏仅在展开内容超高时为收藏内容区域；不产生第二个页面级纵向滚动条
- **依据 Requirements**：`适用页面保持单一纵向滚动边界`

### 接口

- **变更类型**：新增
- **目标内容**：Agent Web 页面布局契约；不新增 Web API、stream event、runtime command 或持久化契约。
- **依据 Requirements**：`Agent Web 页面使用统一三段式布局`、`页面 Header 保持一致且在窄视口可用`、`页面 Content 支持 contained 与 fluid 宽度`

### 覆盖特性

- **变更类型**：新增
- **目标内容**：`F-1.4 查看会话内容`、`F-1.7 标注对话`、`F-10.9 Cron 工具` 增加统一 Agent Web 页面布局这一共享 Function。
- **依据 Requirements**：`Agent Web 页面使用统一三段式布局`、`统一布局在三个宿主中保持一致`

### 主规格

- **变更类型**：新增
- **目标内容**：`agent-web-page-layout`
- **依据 Requirements**：`Agent Web 页面使用统一三段式布局`
