# add-agent-web-knowledge-import

## Why

投诉历史页签已通过 `PiuRenderer` 渲染外部 PIU，在 immersive（沉浸式）和 collaborative（协作式）宿主中呈现业务内容。当前缺少一个"知识导入"页签，需要以相同方式渲染 `MCSemanticPIU` 的 `loadDataSet` 方法。该页签行为与投诉历史完全一致，但不依赖 `complaintFeatureStore` 探针可见性门禁——在非 local 宿主下始终可见。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 在 immersive 左布局 Sidebar 中新增"知识导入"导航按钮，点击切换内容视图至知识导入页面。
- 在 immersive 右布局顶部栏中新增"知识导入"按钮，点击切换面板视图至知识导入页面。
- 在 collaborative/PIU 宿主 MoreMenuButton 中新增"知识导入"菜单项，点击通过 `expandPanelStore` 在扩展面板呈现知识导入页面。
- 知识导入页面通过 `PiuRenderer` 渲染 `{ piuName: "MCSemanticPIU", piuVersion: "1.0.0", renderFunc: "loadDataSet" }`。
- 知识导入页签在 `mode !== 'local'` 时始终可见，不依赖 probe 探测、不检查 `complaintFeatureStore.enabled`、不检查 `userOps`。
- 页面名称在 `zh-CN` 下为"知识导入"，在 `en-US` 下为"Knowledge Import"。
- 入口图标复用记忆管理图标（`memory-light.svg` / `memory-dark.svg`），放在记忆管理后面、投诉历史前面。

**非目标：**

- 不修改投诉历史既有行为、probe 机制或可见性门禁。
- 不新增 probe、REST 探针或 feature store。
- 不修改 `MCSemanticPIU` 或 `loadDataSet` 的 PIU 内部行为。
- 不在 local 模式渲染知识导入入口。
- 不新增独立图标资源；暂复用记忆管理图标，后续可替换。

## What Changes

- 新增 `KnowledgeImportView` 组件：`PiuRenderer` 渲染 `MCSemanticPIU / loadDataSet`，无 feature store 门禁。
- 新增 `KnowledgeImportPage` 组件：`PageHeader` + `KnowledgeImportView`，无 feature store 门禁。
- 修改 `mainContentRoutes.ts`：新增 `KNOWLEDGE_MAIN_CONTENT_PATH` 和 `'knowledge'` 路由视图。
- 修改 `ImmersiveApp.tsx`：左布局 Sidebar 和右布局顶部栏新增知识导入入口和面板视图分支。
- 修改 `Sidebar.tsx`：新增知识导入 `NavButton` 和对应 props。
- 修改 `AIAgentPiuRuntime.tsx`：MoreMenuButton 新增知识导入菜单项，通过 `expandPanelStore.setView` 呈现。
- 修改 zh-CN / en-US i18n 资源：新增 `knowledge.importTitle`。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

| Function | spec | 变化边界 |
|---|---|---|
| `FN-10.X 前端知识导入页面` | `agent-web-knowledge-import` | 知识导入页面的 PIU 渲染、多宿主入口、可见性规则 |

### 修改的 Function

| Function | spec | 变化边界 |
|---|---|---|
| `FN-10.35 呈现 Agent Web 页面布局` | `agent-web-page-layout` | 新增知识导入为第五个内置业务页面，补充其本地化页面名称和图形语义 |

## 影响范围（Impact）

- actor：使用 immersive 和 collaborative 宿主的最终用户。
- 前端：`frontend/agent-web` 的 `features/knowledge/components`、`app/mainContentRoutes.ts`、`app/ImmersiveApp.tsx`、`features/sidebar/components/Sidebar.tsx`、`piu/AIAgentPiuRuntime.tsx`、`i18n/resources`。
- 测试：知识导入视图组件测试、Sidebar 导航测试、immersive 布局测试。
- 配置：不新增配置项。
