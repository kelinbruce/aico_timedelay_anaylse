# add-agent-web-knowledge-import Design

## 设计范围（Scope）

| Function | 目标变化 | Delta spec | 设计章节 |
|---|---|---|---|
| `agent-web-knowledge-import`（新增） | 定义知识导入页面的 PIU 渲染、多宿主入口和可见性规则 | `specs/agent-web-knowledge-import/spec.md` | [agent-web-knowledge-import](#agent-web-knowledge-import) |
| `agent-web-page-layout`（修改） | 新增知识导入为内置业务页面，补充其本地化名称和图形语义 | `specs/agent-web-page-layout/spec.md` | [agent-web-page-layout](#agent-web-page-layout) |

## agent-web-knowledge-import

### 目标与规范依据

知识导入页签需要以与投诉历史完全一致的方式渲染外部 PIU，但不依赖 probe 探针。页面通过 `PiuRenderer` 渲染 `{ piuName: "MCSemanticPIU", piuVersion: "1.0.0", renderFunc: "loadDataSet" }`，在 immersive 和 collaborative 宿主下提供入口，在 local 宿主下不可见。

本 Function 的目标 Requirements：

- Canonical spec：`agent-web-knowledge-import`
- `ADDED 知识导入页面通过 PiuRenderer 渲染 MCSemanticPIU`
- `ADDED 知识导入入口在多宿主下的可见性与呈现`

### 当前实现

- `ComplaintHistoryView` 通过 `PiuRenderer` 渲染 `RobotRouterPIU / renderComplaintList`，可见性受 `complaintFeatureStore.enabled` 门禁。
- `ComplaintHistoryPage` 在 `ComplaintHistoryView` 外包 `PageHeader`，同样受 `complaintFeatureStore.enabled` 门禁。
- immersive 左布局通过 `Sidebar` NavButton + 路由 `/complaint-history` 呈现投诉历史。
- immersive 右布局通过顶部栏 Button + 路由面板视图呈现投诉历史。
- collaborative/PIU 通过 `MoreMenuButton` 菜单项 → `expandPanelStore.setView(<ComplaintHistoryPage />)` 呈现投诉历史。

### GAP 分析

- 不存在知识导入页面组件。
- 不存在 `MCSemanticPIU / loadDataSet` 的 PIU 渲染声明。
- 多宿主入口（Sidebar、顶部栏、MoreMenuButton）未接线知识导入。
- 路由系统（`mainContentRoutes.ts`）未声明知识导入路径。
- i18n 资源未声明知识导入页面名称。
- 知识导入不依赖 probe，需要独立的可见性规则（`mode !== 'local'` 即可见）。

### 修改方案

- 新增 `KnowledgeImportView` 组件：
  - `PIUInfoItem = { piuName: "MCSemanticPIU", piuVersion: "1.0.0", renderFunc: "loadDataSet" }`。
  - 通过 `PiuRenderer` 渲染，与 `ComplaintHistoryView` 同模式。
  - 不引用 `complaintFeatureStore`，不受 probe 门禁。
  - `window.Prel` 不可用时由 `PiuRenderer` 显示占位符。
- 新增 `KnowledgeImportPage` 组件：
  - `PageHeader`（title 取 `t('knowledge.importTitle')`）+ `KnowledgeImportView`。
  - 不引用 `complaintFeatureStore`，不受 probe 门禁。
- 修改 `mainContentRoutes.ts`：
  - 新增 `KNOWLEDGE_MAIN_CONTENT_PATH = '/knowledge-import'`。
  - `RoutedMainContentView` 新增 `'knowledge'`。
  - `resolveRoutedMainContentView` 新增 `/knowledge-import` → `'knowledge'` 分支。
- 修改 `ImmersiveApp.tsx`：
  - 左布局 `ImmersiveLeftLayout`：`ShellContentView` 新增 `'knowledge'`；`Sidebar` 新增 `onSelectKnowledgeImport` / `knowledgeImportActive` props；内容分支新增 `contentView === 'knowledge'` → `<KnowledgeImportPage />`。
  - 右布局 `ImmersiveRightLayout`：`RightPanelView` 新增 `'knowledge'`；顶部栏新增知识导入 Tooltip Button（复用 memory 图标）；内容分支新增 `panelView === 'knowledge'` → `<KnowledgeImportPage />`。
- 修改 `Sidebar.tsx`：
  - `SidebarProps` 新增 `onSelectKnowledgeImport` / `knowledgeImportActive`。
  - 新增 `isKnowledgeImportVisible = mode !== 'local'`（无 probe 门禁）。
  - 在记忆管理 NavButton 之后、投诉历史 NavButton 之前新增知识导入 NavButton（复用 memory 图标）。
- 修改 `AIAgentPiuRuntime.tsx`：
  - `MoreMenuButton` 新增 `onKnowledgeImportClick` / props。
  - 菜单项顺序：记忆管理之后、投诉历史之前。
  - 点击 → `expandPanelStore.getState().setView(<KnowledgeImportPage />)` + `expandPanelStore.getState().open()`。
- 修改 zh-CN / en-US i18n：
  - 新增 `knowledge.importTitle`：zh-CN 为"知识导入"，en-US 为"Knowledge Import"。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性 | 同形同策：知识导入入口与投诉历史入口使用相同的宿主接线和渲染模式 | 复用 `PiuRenderer`、`PageHeader`、`mainContentRoutes`、`Sidebar` NavButton 和 `expandPanelStore` 模式 | 断言三宿主入口结构同形 |
| 可测试性 | 无 probe 依赖 | 可见性仅由 `mode !== 'local'` 决定，无异步状态 | 断言 local 不可见、immersive/collaborative 可见 |
| 国际化一致性 | 页面名称使用 i18n | zh-CN / en-US 各一个 key | 断言两种语言下页面名称和入口名称一致 |

## agent-web-page-layout

### 目标与规范依据

`agent-web-page-layout` 的 `内置业务页面的导航标识与页面标题保持一致` Requirement 当前枚举四个内置业务页面（定时任务、收藏列表、记忆管理、投诉历史）。知识导入作为第五个内置业务页面加入，需要补充其本地化页面名称和图形语义。

本 Function 的目标 Requirements：

- Canonical spec：`agent-web-page-layout`
- `MODIFIED 内置业务页面的导航标识与页面标题保持一致`

### 当前实现

- 该 Requirement 枚举四个内置业务页面及其名称、图标语义和尺寸规则。
- 图标尺寸规则：Sidebar `20px × 20px`，Immersive RIGHT / Collaborative PIU `16px × 16px`。
- 投诉历史在模态弹框中展示时弹框标题使用页面名称。

### GAP 分析

- 知识导入作为新增的内置业务页面，需要在该 Requirement 中补充其本地化名称和图形语义。
- 知识导入暂复用记忆管理图标；图形语义规则需要覆盖这一情况。
- 知识导入不使用模态弹框（collaborative 模式走 expandPanel），不涉及弹框标题规则。

### 修改方案

- 在 `内置业务页面的导航标识与页面标题保持一致` Requirement 中补充：知识导入在 `zh-CN` 下为"知识导入"、在 `en-US` 下为"Knowledge Import"。
- 图标语义：知识导入暂复用记忆管理图标（`memory-light.svg` / `memory-dark.svg`），后续可替换为独立图标；替换时只需更新导入路径，不改变 Requirement 中的页面名称和无障碍名称规则。
- 菜单顺序：知识导入入口放在记忆管理之后、投诉历史之前（各宿主保持一致）。
- 不修改图标尺寸规则、不修改弹框规则、不修改宿主特有菜单保持不变规则。

## 验证策略（Verification Strategy）

- 组件测试：
  - `KnowledgeImportView` 在 `window.Prel` 不可用时显示占位符且不抛错。
  - `KnowledgeImportPage` 渲染恰好一个 `PageHeader`（标题"知识导入"）。
  - `KnowledgeImportView` / `KnowledgeImportPage` 不引用 `complaintFeatureStore`。
- Sidebar 测试：
  - local 模式不渲染知识导入入口。
  - immersive 模式渲染知识导入入口，点击触发 `onSelectKnowledgeImport`。
- Immersive 布局测试：
  - 左布局 `contentView === 'knowledge'` 渲染 `<KnowledgeImportPage />`。
  - 右布局 `panelView === 'knowledge'` 渲染 `<KnowledgeImportPage />`。
- i18n 测试：
  - zh-CN 下入口名称和页面标题为"知识导入"。
  - en-US 下入口名称和页面标题为"Knowledge Import"。
- 构建验证：
  - `cd frontend/agent-web && npm run build` 通过。
  - `cd frontend/agent-web && npm run build:vite:modes` 通过。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/agent-web-knowledge-import/spec.md`：归档时新建为 stable spec。
- `openspec/specs/agent-web-page-layout/spec.md`：归档时合并知识导入为第五个内置业务页面。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/`：归档时新增 `FN-10.X` Function 文档。
- `openspec/designs/architecture/`：无。
- `openspec/designs/modules/agent-web.md`：归档时同步前端多宿主页面列表。
- `openspec/designs/spec-to-design-map.md`：归档时新增 `agent-web-knowledge-import` 映射。
- `openspec/overview.md`：无。

## 风险与取舍（Risks / Trade-offs）

- 知识导入暂复用记忆管理图标。用户在侧边栏可能看到两个相同图标的相邻入口。后续替换为独立图标时只需修改 import 路径，不影响 spec 中的页面名称和无障碍名称规则。
- 知识导入不依赖 probe，在非 local 宿主下始终可见。如果后端 `MCSemanticPIU` 不可用，`PiuRenderer` 会在 `window.Prel` 不可用时显示占位符，但 PIU 加载失败的行为由 `window.Prel.autoLoad` 决定。

## 待确认问题（Open Questions）

无。
