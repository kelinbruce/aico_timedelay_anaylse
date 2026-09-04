# agent-web-page-layout Delta Specification

**所属 Function**：`FN-10.35 呈现 Agent Web 页面布局`
**Function 变更类型**：修改
**spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 内置业务页面的导航标识与页面标题保持一致

系统 MUST 为下列五个内置业务页面使用唯一的本地化页面名称：定时任务在 `zh-CN` 下为"定时任务"、在 `en-US` 下为"Scheduled tasks"；收藏列表在 `zh-CN` 下为"收藏列表"、在 `en-US` 下为"Favorites List"；记忆管理在 `zh-CN` 下为"记忆管理"、在 `en-US` 下为"Memory Management"；知识导入在 `zh-CN` 下为"知识导入"、在 `en-US` 下为"Knowledge Import"；投诉历史在 `zh-CN` 下为"投诉历史"、在 `en-US` 下为"Complaint History"。任一宿主已提供其中一个页面入口时，该入口的可见菜单文字、Tooltip 和无障碍名称 MUST 使用当前语言下的同一个页面名称；图标入口没有可见菜单文字时，Tooltip 和无障碍名称仍 MUST 使用该页面名称。系统 MUST NOT 为满足本 Requirement 向原本不提供该页面的宿主新增入口。

同一业务页面在任一宿主的入口 MUST 使用同一个图形语义：定时任务使用定时任务图标，收藏列表使用收藏图标，记忆管理使用记忆图标，知识导入暂使用记忆图标（后续可替换为独立图标，不改变页面名称和无障碍名称规则），投诉历史使用投诉图标。浅色主题和暗色主题 MUST 使用同一图形语义各自对应的主题版本。Sidebar 导航入口图标的可见宽度和高度 MUST 各为 `20px`；Immersive RIGHT 顶部栏和 Collaborative/PIU 菜单入口图标的可见宽度和高度 MUST 各为 `16px`。尺寸差异 MUST NOT 改变图形语义、页面名称或无障碍名称。入口图标 MUST 作为装饰图像从无障碍名称中隐藏，入口自身 MUST 继续提供页面名称。

页面作为 Local 或 Immersive 主内容、或作为 Collaborative/PIU 左侧扩展内容展示时，页面级标题 MUST 使用同一个页面名称，且页面 Header MUST NOT 重复展示入口图标。投诉历史在模态弹框中展示时，弹框标题 MUST 使用投诉历史页面名称，弹框内容 MUST NOT 再重复页面级标题。宿主 MUST 保留现有菜单集合、菜单顺序、入口容器和可见性条件；本 Requirement MUST NOT 使 Collaborative/PIU 特有的自定义 operator、窗口切换或停靠切换项出现在其他宿主。

**需求类别**：功能性需求

#### Scenario: 已有入口使用统一名称和图形语义
- **GIVEN** 当前宿主已经提供定时任务、收藏列表、记忆管理、知识导入或投诉历史中的一个入口
- **WHEN** 系统以 `zh-CN` 或 `en-US` 渲染该入口
- **THEN** 可见菜单文字、Tooltip 和无障碍名称 MUST 使用该页面在当前语言下的唯一页面名称
- **AND** 入口 MUST 使用该页面的定时任务、收藏、记忆、知识导入或投诉图形语义
- **AND** Sidebar 图标 MUST 为 `20px × 20px`，Immersive RIGHT 顶部栏与 Collaborative/PIU 菜单图标 MUST 为 `16px × 16px`
- **AND** 浅色与暗色主题切换 MUST NOT 改变该入口的页面名称或图形语义

#### Scenario: 页面标题与所选入口一致
- **GIVEN** 用户通过已有入口打开五个内置业务页面中的一个
- **WHEN** 页面作为主内容或 Collaborative/PIU 左侧扩展内容展示
- **THEN** 页面级标题 MUST 与所选入口的当前语言名称一致
- **AND** 页面 Header MUST NOT 重复展示入口图标

#### Scenario: 投诉历史弹框只展示一个标题
- **GIVEN** Collaborative/PIU 以模态弹框展示投诉历史
- **WHEN** 弹框完成渲染
- **THEN** 弹框标题 MUST 使用当前语言下的投诉历史页面名称
- **AND** 弹框内容 MUST NOT 再展示第二个投诉历史页面级标题

#### Scenario: 宿主特有菜单保持不变
- **WHEN** 系统应用五个内置业务页面的导航标识规则
- **THEN** Local、Immersive 和 Collaborative/PIU MUST 保留各自已有的菜单项集合、顺序、入口容器和可见性条件
- **AND** 系统 MUST NOT 向原本不提供某页面的宿主新增该页面入口
- **AND** Collaborative/PIU 特有菜单项 MUST NOT 因本 Requirement 出现在 Local 或 Immersive

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：在五个内置业务页面中新增知识导入，补充其本地化页面名称（zh-CN"知识导入" / en-US"Knowledge Import"）和图形语义（暂复用记忆图标）。
- **依据 Requirements**：`内置业务页面的导航标识与页面标题保持一致`

### 规格

- **规格项**：内置业务页面列表与名称
- **变更类型**：修改
- **原规格值**：四个内置业务页面（定时任务、收藏列表、记忆管理、投诉历史）
- **目标规格值**：五个内置业务页面（定时任务、收藏列表、记忆管理、知识导入、投诉历史）
- **依据 Requirements**：`内置业务页面的导航标识与页面标题保持一致`

### 主规格

- **变更类型**：修改
- **目标内容**：`agent-web-page-layout`
- **依据 Requirements**：`内置业务页面的导航标识与页面标题保持一致`
