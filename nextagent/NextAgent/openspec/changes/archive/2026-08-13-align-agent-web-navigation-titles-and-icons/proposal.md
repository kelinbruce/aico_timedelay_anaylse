## Why

用户在 Local、Immersive 和 Collaborative/PIU 中打开定时任务、收藏列表、记忆管理或投诉历史时，同一业务页面当前可能使用不同的入口名称、页面标题或图标。例如，收藏入口同时出现“收藏”和“收藏列表”，定时任务页面标题使用“定时任务管理”，英文记忆入口使用“Memory”，而投诉历史在部分主内容容器中没有页面标题。用户需要先根据宿主和位置重新判断入口含义，当前页面与所选菜单的对应关系也不够明确。

这些差异来自各宿主分别选择文案键和图标，而不是业务页面本身存在不同语义。现在统一四个既有页面的导航标识，可以在不改变宿主功能集合和交互方式的前提下消除可见歧义，并为后续同类页面提供明确规则。实施后的浏览器复核还发现，同一个“新建会话”命令在 Local 与 Collaborative/PIU 中使用现有主题 SVG，而 Immersive 仍使用通用加号图标；该入口也需要收敛到同一图形语义。

## 规范上下文

- 本 change 的 Cron 目标基线包含 `add-cron-task-created-by-name` 已定义的 `createdByName` 展示和单卡片菜单行为。
- 本 change 必须在 `add-cron-task-created-by-name` 归档后实施和归档；不得用本 change 的 Cron delta 覆盖其目标行为。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 定时任务、收藏列表、记忆管理和投诉历史在任一已提供该入口的宿主中，入口名称、辅助名称和页面级标题使用同一个本地化名称。
- 同一业务入口在不同宿主中使用相同语义的浅色或暗色主题图标；图标尺寸可以服从所在导航区域的既有尺寸。
- Local、Immersive 和 Collaborative/PIU 已提供的“新建会话”入口使用同一组主题图形语义，同时保留各宿主原有交互。
- 投诉历史作为主内容或 Collaborative/PIU 左侧扩展内容展示时具有“投诉历史”页面标题；投诉历史模态弹框仍只显示一个弹框标题。
- 三种宿主继续保留各自已有的菜单集合、顺序、容器和可见性条件。

**非目标：**

- 不要求 Local、Immersive 和 Collaborative/PIU 的菜单项完全相同。
- 不改变 Collaborative/PIU 特有的自定义 operator、窗口或停靠切换项，也不调整其菜单顺序。
- 不向 Immersive RIGHT 增加定时任务入口，不向 Local 增加记忆管理或投诉历史入口。
- 不改变投诉能力探针控制的可见性，不改变任何页面的路由、业务数据、操作行为、滚动归属或权限边界。
- 不在页面 Header 中增加图标；语义图标只用于已有导航入口。

## What Changes

- **新增**四个内置业务页面的导航标识一致性契约：系统按当前语言为每个页面提供唯一名称，并在菜单文字、Tooltip、无障碍名称和页面级标题之间保持一致。
- **修改**定时任务页面的中文标题为“定时任务”、英文标题为“Scheduled tasks”，并保留既有任务看板全部行为。
- **修改**收藏页面的中文标题为“收藏列表”、英文标题为“Favorites List”，并保留既有收藏列表全部行为。
- **修改**记忆管理英文入口名称为“Memory Management”；中文继续使用“记忆管理”。
- **修改**投诉历史的主内容与左侧扩展内容呈现，使其显示“投诉历史”或“Complaint History”页面级标题；模态弹框继续以同一名称作为唯一标题。
- **修改**四个入口在各宿主中的图标投影，使同一入口始终使用对应的定时任务、收藏、记忆或投诉语义图标。
- **修改**Immersive 的“新建会话”入口，使其与 Local、Collaborative/PIU 一样使用同一组新建会话浅色/暗色主题图形语义。

## Feature 影响（Features）

### 修改的 Feature

- `F-8.2 长期记忆`：组成 Functions 增加 `FN-10.35 呈现 Agent Web 页面布局`，只承接记忆管理既有入口与页面标题的呈现一致性；长期记忆的用户价值、管理行为、数据边界和质量保证不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.35 呈现 Agent Web 页面布局` → `specs/agent-web-page-layout/spec.md`
  - 功能边界：新增四个既有业务页面在多宿主中的入口名称、辅助名称、页面级标题和语义图标一致性，并统一三宿主已有“新建会话”入口的图形语义。
  - 系统质量属性：无；实现关注可维护性与可测试性，但本 change 不新增黑盒质量目标。
  - 映射说明：`agent-web-page-layout` 是本次跨页面呈现规则的 canonical spec；不改变各业务 Function 的菜单可用范围或业务行为。
- `FN-10.9 Cron 工具` → `specs/cron-task-management-api/spec.md`
  - 功能边界：定时任务看板使用“定时任务”或“Scheduled tasks”作为页面标题，并保留当前任务管理和创建人展示行为。
  - 系统质量属性：无。
  - 映射说明：`cron-task-management-api` 是 `add-cron-task-created-by-name` 归档后的 canonical spec；本 change 实际触及 legacy spec `agent-web-cron-task-dashboard`，并按触及即迁移规则承接该 Requirement 的完整目标态。
- `FN-1.13 查看收藏列表` → `specs/favorite-turn-list/spec.md`
  - 功能边界：收藏主内容页面使用“收藏列表”或“Favorites List”作为页面标题。
  - 系统质量属性：无。
  - 映射说明：`favorite-turn-list` 是 canonical spec。

## 影响范围（Impact）

- **actor：** 用户在三个宿主的已有入口中看到统一的名称和图形语义，并能直接确认当前业务页面。
- **公共 API、持久化与配置：** 无变化。
- **宿主集成：** Collaborative/PIU 的特有菜单内容、顺序和容器保持不变；投诉历史可见性仍由既有探针结果决定。
- **前端与测试：** 受影响范围限于浏览器前端的本地化资源、四个业务页面入口投影、三个相关页面标题、Immersive 新建会话图标和对应的组件及浏览器验收测试。
