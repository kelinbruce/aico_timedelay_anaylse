# agent-web-knowledge-import Delta Specification

**所属 Function**：`agent-web-knowledge-import`
**Function 变更类型**：新增
**spec 角色**：主规格

## ADDED Requirements

### Requirement: 知识导入页面通过 PiuRenderer 渲染 MCSemanticPIU

`agent-web` SHALL 通过 `PiuRenderer` 渲染知识导入页面，PIU 声明为 `{ piuName: "MCSemanticPIU", piuVersion: "1.0.0", renderFunc: "loadDataSet" }`。页面 SHALL 以 `PageHeader`（标题取 `t('knowledge.importTitle')`）包裹 `PiuRenderer` 内容。页面 MUST NOT 引用 `complaintFeatureStore`，MUST NOT 依赖 probe 探针或 `complaintFeatureStore.enabled` 门禁。当 `window.Prel` 不可用时，PIU 渲染区 SHALL 显示占位符且 MUST NOT 抛错。

**需求类别**：功能性需求

#### Scenario: 知识导入页面渲染 PiuRenderer

- **WHEN** 知识导入页面被渲染
- **THEN** MUST 通过 `PiuRenderer` 声明 `piuName: "MCSemanticPIU"`、`piuVersion: "1.0.0"`、`renderFunc: "loadDataSet"`
- **AND** MUST 以 `PageHeader` 包裹内容，标题为 `t('knowledge.importTitle')`

#### Scenario: 知识导入页面不依赖 probe

- **WHEN** `complaintFeatureStore.enabled` 为 `false`
- **THEN** 知识导入页面 MUST 仍然渲染
- **AND** MUST NOT 引用 `complaintFeatureStore`

#### Scenario: window.Prel 不可用时显示占位符

- **GIVEN** `window.Prel` 不可用
- **WHEN** 知识导入页面被渲染
- **THEN** MUST 显示 `PiuRenderer` 占位符
- **AND** MUST NOT 抛出错误

### Requirement: 知识导入入口在多宿主下的可见性与呈现

`agent-web` SHALL 在 immersive 与 collaborative 宿主下提供知识导入入口。local 宿主 MUST NOT 渲染知识导入入口。入口可见性不受 probe 或 `userOps` 控制——`mode !== 'local'` 时 SHALL 始终可见。

immersive 左布局 SHALL 在侧边栏提供导航按钮，点击切换内容视图至知识导入并渲染页面。immersive 右布局 SHALL 在顶部栏提供按钮，点击切换面板视图至知识导入并渲染页面。collaborative 宿主 SHALL 在 MoreMenuButton 中提供菜单项，点击通过 `expandPanelStore.setView` 在扩展面板呈现知识导入页面。入口位置 SHALL 在记忆管理之后、投诉历史之前。入口图标 SHALL 复用记忆管理图标，浅色主题与暗色主题各使用对应版本。

**需求类别**：功能性需求

#### Scenario: immersive 左布局侧边栏入口

- **GIVEN** immersive 左布局
- **THEN** 侧边栏 MUST 出现知识导入导航按钮
- **WHEN** 用户点击该按钮
- **THEN** 内容视图 MUST 切换至知识导入
- **AND** MUST 渲染知识导入页面

#### Scenario: immersive 右布局顶部栏入口

- **GIVEN** immersive 右布局
- **THEN** 顶部栏 MUST 出现知识导入按钮
- **WHEN** 用户点击该按钮
- **THEN** 面板视图 MUST 切换至知识导入
- **AND** MUST 渲染知识导入页面

#### Scenario: collaborative 宿主扩展面板入口

- **GIVEN** collaborative/PIU 宿主
- **THEN** MoreMenuButton MUST 包含知识导入菜单项
- **WHEN** 用户点击该菜单项
- **THEN** 扩展面板 MUST 打开
- **AND** 扩展面板内容 MUST 为知识导入页面

#### Scenario: local 宿主不渲染入口

- **GIVEN** local 宿主
- **THEN** 知识导入入口 MUST NOT 可见

#### Scenario: 入口位置在记忆管理之后投诉历史之前

- **GIVEN** immersive 或 collaborative 宿主
- **WHEN** 知识导入入口被渲染
- **THEN** 知识导入入口 MUST 位于记忆管理入口之后
- **AND** 知识导入入口 MUST 位于投诉历史入口之前

#### Scenario: 入口图标复用记忆管理图标

- **WHEN** 知识导入入口被渲染
- **THEN** 浅色主题 MUST 使用 `memory-light.svg`
- **AND** 暗色主题 MUST 使用 `memory-dark.svg`

## Function 变更汇总

### 描述

- **变更类型**：新增
- **目标内容**：知识导入页面通过 `PiuRenderer` 渲染 `MCSemanticPIU / loadDataSet`，在 immersive 和 collaborative 宿主下提供入口，不受 probe 门禁，local 宿主不可见。
- **依据 Requirements**：`知识导入页面通过 PiuRenderer 渲染 MCSemanticPIU`、`知识导入入口在多宿主下的可见性与呈现`

### 规格

- **规格项**：知识导入页面 PIU 渲染与多宿主入口
- **变更类型**：新增
- **目标规格值**：PIU `{ piuName: "MCSemanticPIU", piuVersion: "1.0.0", renderFunc: "loadDataSet" }`；immersive 左/右布局 + collaborative 扩展面板入口；`mode !== 'local'` 始终可见；不依赖 probe
- **依据 Requirements**：`知识导入页面通过 PiuRenderer 渲染 MCSemanticPIU`、`知识导入入口在多宿主下的可见性与呈现`

### 主规格

- **变更类型**：新增
- **目标内容**：`agent-web-knowledge-import`
- **依据 Requirements**：`知识导入页面通过 PiuRenderer 渲染 MCSemanticPIU`、`知识导入入口在多宿主下的可见性与呈现`
