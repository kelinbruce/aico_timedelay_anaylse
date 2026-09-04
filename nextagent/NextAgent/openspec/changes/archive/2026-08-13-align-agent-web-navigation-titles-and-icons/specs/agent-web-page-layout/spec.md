## Function

- **所属 Function**：`FN-10.35 呈现 Agent Web 页面布局`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 内置业务页面的导航标识与页面标题保持一致

系统 MUST 为下列四个内置业务页面使用唯一的本地化页面名称：定时任务在 `zh-CN` 下为“定时任务”、在 `en-US` 下为“Scheduled tasks”；收藏列表在 `zh-CN` 下为“收藏列表”、在 `en-US` 下为“Favorites List”；记忆管理在 `zh-CN` 下为“记忆管理”、在 `en-US` 下为“Memory Management”；投诉历史在 `zh-CN` 下为“投诉历史”、在 `en-US` 下为“Complaint History”。任一宿主已提供其中一个页面入口时，该入口的可见菜单文字、Tooltip 和无障碍名称 MUST 使用当前语言下的同一个页面名称；图标入口没有可见菜单文字时，Tooltip 和无障碍名称仍 MUST 使用该页面名称。系统 MUST NOT 为满足本 Requirement 向原本不提供该页面的宿主新增入口。

同一业务页面在任一宿主的入口 MUST 使用同一个图形语义：定时任务使用定时任务图标，收藏列表使用收藏图标，记忆管理使用记忆图标，投诉历史使用投诉图标。浅色主题和暗色主题 MUST 使用同一图形语义各自对应的主题版本。Sidebar 导航入口图标的可见宽度和高度 MUST 各为 `20px`；Immersive RIGHT 顶部栏和 Collaborative/PIU 菜单入口图标的可见宽度和高度 MUST 各为 `16px`。尺寸差异 MUST NOT 改变图形语义、页面名称或无障碍名称。入口图标 MUST 作为装饰图像从无障碍名称中隐藏，入口自身 MUST 继续提供页面名称。

页面作为 Local 或 Immersive 主内容、或作为 Collaborative/PIU 左侧扩展内容展示时，页面级标题 MUST 使用同一个页面名称，且页面 Header MUST NOT 重复展示入口图标。投诉历史在模态弹框中展示时，弹框标题 MUST 使用投诉历史页面名称，弹框内容 MUST NOT 再重复页面级标题。宿主 MUST 保留现有菜单集合、菜单顺序、入口容器和可见性条件；本 Requirement MUST NOT 使 Collaborative/PIU 特有的自定义 operator、窗口切换或停靠切换项出现在其他宿主。

**需求类别**：功能性需求

#### Scenario: 已有入口使用统一名称和图形语义
- **GIVEN** 当前宿主已经提供定时任务、收藏列表、记忆管理或投诉历史中的一个入口
- **WHEN** 系统以 `zh-CN` 或 `en-US` 渲染该入口
- **THEN** 可见菜单文字、Tooltip 和无障碍名称 MUST 使用该页面在当前语言下的唯一页面名称
- **AND** 入口 MUST 使用该页面的定时任务、收藏、记忆或投诉图形语义
- **AND** Sidebar 图标 MUST 为 `20px × 20px`，Immersive RIGHT 顶部栏与 Collaborative/PIU 菜单图标 MUST 为 `16px × 16px`
- **AND** 浅色与暗色主题切换 MUST NOT 改变该入口的页面名称或图形语义

#### Scenario: 页面标题与所选入口一致
- **GIVEN** 用户通过已有入口打开四个内置业务页面中的一个
- **WHEN** 页面作为主内容或 Collaborative/PIU 左侧扩展内容展示
- **THEN** 页面级标题 MUST 与所选入口的当前语言名称一致
- **AND** 页面 Header MUST NOT 重复展示入口图标

#### Scenario: 投诉历史弹框只展示一个标题
- **GIVEN** Collaborative/PIU 以模态弹框展示投诉历史
- **WHEN** 弹框完成渲染
- **THEN** 弹框标题 MUST 使用当前语言下的投诉历史页面名称
- **AND** 弹框内容 MUST NOT 再展示第二个投诉历史页面级标题

#### Scenario: 宿主特有菜单保持不变
- **WHEN** 系统应用四个内置业务页面的导航标识规则
- **THEN** Local、Immersive 和 Collaborative/PIU MUST 保留各自已有的菜单项集合、顺序、入口容器和可见性条件
- **AND** 系统 MUST NOT 向原本不提供某页面的宿主新增该页面入口
- **AND** Collaborative/PIU 特有菜单项 MUST NOT 因本 Requirement 出现在 Local 或 Immersive

### Requirement: 新建会话入口跨宿主使用统一图形语义

Local、Immersive 和 Collaborative/PIU 已提供的“新建会话”入口 MUST 使用同一个新建会话图形语义，并 MUST 按当前浅色或暗色主题使用对应的主题版本。三个宿主的新建会话入口图标可见宽度和高度 MUST 各为 `20px`。图标 MUST 作为装饰图像，入口按钮 MUST 继续提供 Tooltip 和无障碍名称；该名称在 `zh-CN` 下 MUST 为“新建会话”，在 `en-US` 下 MUST 为“New Session”。

该图标统一 MUST NOT 改变新建会话入口的按钮容器、位置、权限 gate、快捷键、导航目标、草稿处理或会话创建生命周期，也 MUST NOT 改变其他顶栏或菜单项的集合、顺序与图标尺寸。

**需求类别**：功能性需求

#### Scenario: 三宿主的新建会话入口使用主题图标
- **GIVEN** Local、Immersive 或 Collaborative/PIU 正在展示已有的新建会话入口
- **WHEN** 系统以浅色或暗色主题渲染该入口
- **THEN** 入口 MUST 使用当前主题对应的新建会话图形语义
- **AND** 图标 MUST 为 `20px × 20px` 的装饰图像
- **AND** 按钮的 Tooltip 和无障碍名称 MUST 继续使用当前语言下的新建会话名称
- **AND** 点击结果、权限 gate、快捷键与宿主导航行为 MUST 保持不变

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统除统一 Agent Web 页面的 Header、Content 与滚动边界外，还统一定时任务、收藏列表、记忆管理和投诉历史既有入口的本地化名称、无障碍名称、图形语义与页面级标题，并统一三宿主已有新建会话入口的图形语义；宿主仍独立决定入口集合、顺序、容器和可见性。
- **依据 Requirements**：`内置业务页面的导航标识与页面标题保持一致`、`新建会话入口跨宿主使用统一图形语义`

### 规格

- **规格项**：首批页面与宿主范围
- **变更类型**：修改
- **原规格值**：会话、定时任务、收藏使用统一页面布局；Local、Immersive 和 Collaborative/PIU 对同一页面保持同形。
- **目标规格值**：会话、定时任务、收藏使用统一页面布局；定时任务、收藏列表、记忆管理、投诉历史的已有入口在 Local、Immersive 和 Collaborative/PIU 中使用统一名称、无障碍名称和图形语义；三宿主已有的新建会话入口使用统一主题图形语义，宿主入口集合与顺序保持独立。
- **依据 Requirements**：`内置业务页面的导航标识与页面标题保持一致`、`新建会话入口跨宿主使用统一图形语义`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：继续覆盖 `F-1.4 查看会话内容`、`F-1.7 标注对话` 和 `F-10.9 Cron 工具`，并新增覆盖 `F-8.2 长期记忆` 的记忆管理导航标识呈现。
- **依据 Requirements**：`内置业务页面的导航标识与页面标题保持一致`
