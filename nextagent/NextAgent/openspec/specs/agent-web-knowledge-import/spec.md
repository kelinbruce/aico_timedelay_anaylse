# agent-web-knowledge-import Specification

## Purpose

定义浏览器前端知识导入页面的 PIU 渲染、多宿主入口可见性与呈现行为。该能力只拥有前端投影与交互，知识导入内容由外部 PIU（MCSemanticPIU）承载。
## Requirements
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

immersive 左布局 SHALL 在侧边栏提供导航按钮，点击切换内容视图至知识导入并渲染页面。immersive 右布局 SHALL 在顶部栏提供按钮，点击切换面板视图至知识导入并渲染页面。collaborative 宿主 SHALL 在 MoreMenuButton 中提供菜单项，点击通过 `expandPanelStore.setView` 在扩展面板呈现知识导入页面。入口位置 SHALL 在记忆管理之后、投诉历史之前。入口图标 SHALL 使用知识导入图标，浅色主题与暗色主题各使用对应版本。

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

#### Scenario: 入口图标使用知识导入图标

- **WHEN** 知识导入入口被渲染
- **THEN** 浅色主题 MUST 使用 `knowledge-light.svg`
- **AND** 暗色主题 MUST 使用 `knowledge-dark.svg`

### Requirement: Knowledge import entry gate

Agent Web MUST 根据 `runtimeConfig.portalAbilityConfig.knowledgeImportEnabled` 控制知识导入入口可见性。字段为 `true` 或缺失时，入口 MUST 保持当前默认可见行为；字段为 `false` 时，入口 MUST NOT 渲染。

Local 宿主 MUST 继续不渲染知识导入入口。Immersive 与 Collaborative/PIU 宿主 MUST 使用同一个 `knowledgeImportEnabled` 值控制所有知识导入入口。关闭入口 MUST NOT 影响直达知识导入内容视图的既有行为，也 MUST NOT 修改知识导入 API 或知识导入能力执行语义。

**需求类别**：功能性需求

#### Scenario: 默认显示知识导入入口

- **WHEN** `knowledgeImportEnabled` 为 `true` 或缺失
- **THEN** Immersive 与 Collaborative/PIU 宿主中的知识导入入口 MUST 保持当前可见行为
- **AND** Local 宿主 MUST 继续不渲染该入口

#### Scenario: 关闭知识导入入口

- **WHEN** `knowledgeImportEnabled` 为 `false`
- **THEN** Immersive 与 Collaborative/PIU 宿主中的知识导入入口 MUST NOT 渲染
- **AND** 直达知识导入内容视图的既有行为 MUST 保持不变
- **AND** 知识导入 API 和知识导入能力执行语义 MUST 保持不变

#### Scenario: 多宿主入口一致

- **WHEN** `knowledgeImportEnabled` 为 `false`
- **THEN** Immersive 与 Collaborative/PIU 中的所有知识导入入口 MUST 均不可见
- **AND** MUST NOT 出现一个宿主隐藏、另一个宿主仍可见的行为
