## 1. agent-web-knowledge-import

- [x] 1.1 新增 `KnowledgeImportView` 组件测试：`window.Prel` 不可用时显示占位符且不抛错；不引用 `complaintFeatureStore`
  来源：`agent-web-knowledge-import` + `知识导入页面通过 PiuRenderer 渲染 MCSemanticPIU` + Scenario `window.Prel 不可用时显示占位符` / `知识导入页面不依赖 probe`
  验证：`cd frontend/agent-web && npx vitest run src/features/knowledge/components/KnowledgeImportView.test.tsx`；3/3 passed

- [x] 1.2 新增 `KnowledgeImportPage` 组件测试：渲染恰好一个 `PageHeader`，标题为 `t('knowledge.importTitle')`
  来源：`agent-web-knowledge-import` + `知识导入页面通过 PiuRenderer 渲染 MCSemanticPIU` + Scenario `知识导入页面渲染 PiuRenderer`
  验证：`cd frontend/agent-web && npx vitest run src/features/knowledge/components/KnowledgeImportView.test.tsx`；3/3 passed（含 PageHeader 断言）

- [x] 1.3 实现 `KnowledgeImportView` 和 `KnowledgeImportPage` 组件
  来源：design `agent-web-knowledge-import > 修改方案`
  验证：`cd frontend/agent-web && npx vitest run src/features/knowledge/components/KnowledgeImportView.test.tsx`；3/3 passed

## 2. 多宿主入口接线

- [x] 2.1 新增 Sidebar 测试：local 模式不渲染知识导入入口；immersive 模式渲染入口，点击触发 `onSelectKnowledgeImport`；入口位于记忆管理之后
  来源：`agent-web-knowledge-import` + `知识导入入口在多宿主下的可见性与呈现` + Scenario `local 宿主不渲染入口` / `immersive 左布局侧边栏入口` / `入口位置在记忆管理之后投诉历史之前`
  验证：`cd frontend/agent-web && npx vitest run src/features/sidebar/components/Sidebar.knowledgeImport.test.tsx`；4/4 passed

- [x] 2.2 修改 `Sidebar.tsx`：新增 `onSelectKnowledgeImport` / `knowledgeImportActive` props 和 `isKnowledgeImportVisible` 门禁（`mode !== 'local'`），在记忆管理之后、投诉历史之前新增知识导入 NavButton（复用 memory 图标）
  来源：design `agent-web-knowledge-import > 修改方案`
  验证：`cd frontend/agent-web && npx vitest run src/features/sidebar/components/Sidebar.knowledgeImport.test.tsx`；4/4 passed

- [x] 2.3 修改 `mainContentRoutes.ts`：新增 `KNOWLEDGE_MAIN_CONTENT_PATH = '/knowledge-import'`、`'knowledge'` 视图和路由解析分支
  来源：design `agent-web-knowledge-import > 修改方案`
  验证：`cd frontend/agent-web && npm run build` 通过

- [x] 2.4 修改 `ImmersiveApp.tsx`：左布局 `ImmersiveLeftLayout` 和右布局 `ImmersiveRightLayout` 新增知识导入入口和内容视图分支
  来源：`agent-web-knowledge-import` + `知识导入入口在多宿主下的可见性与呈现` + Scenario `immersive 左布局侧边栏入口` / `immersive 右布局顶部栏入口`
  验证：`cd frontend/agent-web && npm run build` 通过

- [x] 2.5 修改 `AIAgentPiuRuntime.tsx`：MoreMenuButton 新增知识导入菜单项，点击通过 `expandPanelStore.setView(<KnowledgeImportPage />)` 呈现，菜单顺序在记忆管理之后、投诉历史之前
  来源：`agent-web-knowledge-import` + `知识导入入口在多宿主下的可见性与呈现` + Scenario `collaborative 宿主扩展面板入口`
  验证：`cd frontend/agent-web && npm run build` 通过

## 3. i18n 与整体验证

- [x] 3.1 新增 zh-CN 和 en-US i18n 资源 `knowledge.importTitle`
  来源：design `agent-web-knowledge-import > 修改方案`
  验证：`cd frontend/agent-web && npm run build` 通过；zh-CN 为"知识导入"，en-US 为"Knowledge Import"

- [x] 3.2 前端类型检查和多宿主构建验证
  来源：AGENTS.md 验证门禁
  验证：`cd frontend/agent-web && npm run build && npm run build:vite:modes`；TypeScript 检查和多宿主 artifacts 构建成功

## 归档前更新基线检查（非实施任务）

归档时按 design 的"长期基线刷新计划"更新 `openspec/specs/agent-web-knowledge-import/spec.md`（新建）、`openspec/specs/agent-web-page-layout/spec.md`（合并知识导入为第五个内置业务页面）、`openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/`（新增 Function 文档）、`openspec/designs/modules/agent-web.md` 和 `openspec/designs/spec-to-design-map.md`。
