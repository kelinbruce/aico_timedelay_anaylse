## 背景和现状（Context）

`agent-web` 前端整体视觉风格需要按产品设计规范统一刷新。当前各区域存在以下问题：

- **Welcome 块**：品牌区域使用 `welcome-brand`（inline-flex, gap 10px）和 `welcome-brand-icon`（42×42），标题通过 antd `Typography.Title` 内联样式，颜色未走 CSS 变量主题化。建议问题区域使用 2 列 CSS grid + antd Button + antd 图标。`welcome-state-shell` 的 `max-width: 640px` 限制了所有子区域宽度。
- **对话窗格**：背景为纯色 `var(--color-bg-primary)`，AI 气泡使用默认 antd 样式，缺少设计规范要求的渐变背景和圆角差异。
- **消息输入按钮**：发送按钮使用 antd `Button type="primary" shape="circle"` + `ArrowUpOutlined`，停止按钮使用 `Button type="default" shape="circle"` + `StopOutlined`，均为 antd 默认样式，不符合设计规范。
- **技能选择器**：chip 使用方框样式（border-radius 8），无图标，选中态有边框/背景差异。弹窗标题字号偏小，搜索框为 small 尺寸，列表项无图标。已选 chip 使用蓝色主色调。
- **TurnBlock 过程面板**：过程面板渲染逻辑内联在 TurnBlock 中（约 600 行），包含 `ProcessPanelMode` 状态管理、`persistedProcessPanelModes` 缓存和 `PROCESS_IDLE_SWEEP_CSS` 内联样式，导致 TurnBlock 职责过重。
- **右侧布局**：maxWidth 880 偏窄，内容区有 `var(--color-bg-primary)` 背景色，免责声明缺少详细说明 Tooltip。

主题系统位于 `frontend/agent-web/src/styles/theme.css`，通过 `:root[data-theme="light"]` / `:root[data-theme="dark"]` 定义 CSS 变量。

三个入口 HTML 文件通过 `body[data-nextagent-host-mode="..."]` 属性区分 host mode。`collaborative.html` 是唯一的窄屏入口。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 按产品设计规范统一 welcome 块品牌区域、高频问题区域、对话窗格、消息输入按钮、技能选择器、过程面板和右侧布局的视觉样式。
- 通过 CSS 变量实现所有新增样式的双色主题化。
- 将过程面板逻辑提取为独立组件 `ProcessPanel`。
- 新增自定义图标组件 `SendIcon`、`StopResponseIcon` 和技能/过程图标资源。

**非目标：**
- 不改动功能逻辑（请求生命周期、流处理、权限控制等）。
- 不引入新的组件抽象框架或 CSS-in-JS 方案。
- 不实现动态问题数据获取（静态数据）。
- 不改动 welcome 块的标签区域（`welcome-quick-tags`）。

## 设计决策（Decisions）

**决策 1：使用 CSS 变量而非 antd token 做双色主题**

所有新增颜色值通过 `theme.css` 的 CSS 变量定义，与现有变量管理方式一致。选择新增独立变量而非复用 `--color-text-primary` 等 token，因为品牌文字色值和按钮色值是设计规范指定的精确值。

**决策 2：小屏尺寸用 host-mode 选择器而非容器查询**

小屏差异化尺寸通过 `body[data-nextagent-host-mode="collaborative"]` CSS 选择器触发。用户明确要求"走 collaborative 入口进就算小屏幕"，这是入口级别的语义判断。

**决策 3：品牌区域 DOM 结构调整**

将现有 `welcome-brand` + `welcome-title-block` 结构替换为 `portalGuideWrapper` > [`logo容器` > (img + `logoName`)] + `guideWelcome` 结构。

**决策 4：建议问题从 grid 改为 flex wrap 布局**

使用 `display: flex; flex-wrap: wrap; gap: 12px; justify-content: center`，每项宽度由内容决定。配合 `min-width: 0` + `overflow: hidden` + `text-overflow: ellipsis` + `white-space: nowrap` 实现截断。

**决策 5：高频问题区域提取为独立组件**

将静态 SUGGESTIONS 数据和渲染逻辑提取到 `HighFrequencyQuestions.tsx`，`WelcomeState` 只负责品牌区域布局。

**决策 6：welcome-state-shell 宽度放宽到 100%**

将 `max-width` 从 640px 放宽到 100%，使 shell 宽度等于 `RightPaneLayout` content-column 的宽度。

**决策 7：对话窗格使用径向渐变背景**

浅色主题下 `--color-chat-pane-bg` 使用三层径向渐变（紫色、青色、蓝色）叠加在 `#f3f3f3` 上，深色主题保持 `var(--color-bg-primary)`。渐变仅作为视觉氛围，不影响内容可读性。

**决策 8：发送/停止按钮使用自定义图标组件**

新建 `SendIcon` 和 `StopResponseIcon` React 组件，根据 `disabled` prop 和当前 `data-theme` 选择对应的 SVG 资源（light/dark 版本）。发送按钮使用 `type="text"` Button + `className="send-btn"`，停止按钮使用 `div className="stop-button"` + 文字标签。停止条件采用 `isExecuting && onStop`（与 main 分支 bug 修复保持一致）。

**决策 9：技能选择器使用 PNG 图标和圆角药丸样式**

为每个技能项分配一个图标（按 index 取模 4），chip 样式从方框（border-radius 8）改为圆角药丸（border-radius 16, height 32）。移除选中态边框/背景差异。`skillSelectionStore` 新增 `selectedIconIndex` 字段以在已选 chip 中保持图标一致。

**决策 10：过程面板提取为独立 ProcessPanel 组件**

将 TurnBlock 中的过程面板渲染逻辑（图标解析、展开/折叠、状态显示）提取到 `ProcessPanel.tsx`。新增 process 图标资源（think/skill/process-complete/final-complete/collapse 的浅色/深色版本），根据过程标题关键词和当前主题动态选择。TurnBlock 移除 `ProcessPanelMode`、`persistedProcessPanelModes`、`PROCESS_IDLE_SWEEP_CSS` 等内联逻辑。

**决策 11：RightPaneLayout maxWidth 调整为 1080**

maxWidth 从 880 调整为 1080 以提供更宽的对话内容区。移除内容区 `var(--color-bg-primary)` 背景，改为透明，使 `chat-conversation-pane` 的渐变背景可见。免责声明新增 `QuestionCircleOutlined` 图标和 Tooltip，展示详细使用注意事项。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 无安全影响，纯 CSS 和 UI 组件变更，不涉及身份、授权、数据泄露。 | 不适用 |
| 性能/容量 | 无性能影响，CSS 变量查找是 O(1)。图标资源为静态文件。 | 不适用 |
| 可靠性/恢复 | 无可靠性影响，不涉及状态、持久化或恢复。 | 不适用 |
| 可维护性 | 使用语义化类名和 CSS 变量。高频问题和过程面板提取为独立组件。 | 代码审查 |
| 可测试性 | 样式值可通过 DOM 检查或 CSS 解析断言验证。 | 单元/CSS 断言测试 |
| 审计/可追溯性 | 无审计影响，纯前端样式。 | 不适用 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `--bg-color-logo-text` 浅色/深色值 | T1 | CSS 变量值断言 |
| Logo 图片 72×72 / collaborative 60×60 | T2 | 渲染 DOM 尺寸断言 |
| `logoName` 36px/44px/700 | T2 | 渲染样式断言 |
| `guideWelcome` 20px/28px/600/24px | T2 | 渲染样式断言 |
| `guideWelcome` collaborative 16px/24px/16px | T3 | collaborative 入口渲染断言 |
| `highFrequencyWrapper` flex wrap 布局 | T5 | 渲染样式断言 |
| `questionItem` 尺寸/排版/颜色 | T5 | 渲染样式断言 |
| `HighFrequencyQuestions` 独立组件渲染 | T5 | 组件渲染断言 |
| `welcome-state-shell` max-width 100% | T4 | CSS 断言 |
| `--color-chat-pane-bg` 浅色/深色值 | T1 | CSS 变量值断言 |
| `--color-ai-bubble-bg` 浅色/深色值 | T1 | CSS 变量值断言 |
| ai-bubble border-radius 0px 8px 8px 8px | T6 | CSS 断言 |
| chat-conversation-pane background | T6 | 代码检查 |
| SendIcon 组件渲染 | T7 | 组件渲染断言 |
| StopResponseIcon 组件渲染 | T7 | 组件渲染断言 |
| `.send-btn` CSS 类 | T7 | CSS 断言 |
| `.stop-button` CSS 类 | T7 | CSS 断言 |
| `composer.stopResponse` i18n key | T7 | i18n 资源检查 |
| 技能 chip 图标和圆角药丸样式 | T8 | 渲染样式断言 |
| 技能弹窗标题/副标题/搜索图标 | T8 | 渲染断言 |
| 已选 chip 新样式 | T8 | 渲染样式断言 |
| `selectedIconIndex` store 字段 | T8 | 代码检查 |
| ProcessPanel 独立组件 | T9 | 组件渲染断言 |
| process 图标资源 | T9 | 文件存在检查 |
| TurnBlock 移除内联过程面板逻辑 | T9 | 代码检查 |
| RightPaneLayout maxWidth 1080 | T10 | 代码检查 |
| 内容区背景透明 | T10 | 代码检查 |
| 免责声明 Tooltip | T10 | i18n + 渲染检查 |
| SuggestedQuestions margin-top 移除 | T10 | CSS 断言 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/agent-web-welcome-block-styles/spec.md`
- 行为契约：`openspec/specs/agent-web-high-frequency-questions/spec.md`
- 行为契约：`openspec/specs/agent-web-chat-pane-styles/spec.md`
- 行为契约：`openspec/specs/agent-web-composer-button-styles/spec.md`
- 行为契约：`openspec/specs/agent-web-skill-selector-styles/spec.md`
- 行为契约：`openspec/specs/agent-web-process-panel/spec.md`
- 行为契约：`openspec/specs/agent-web-right-pane-styles/spec.md`
- 架构和跨模块设计：无
- 模块设计：无
- ADR：无
- 导航：无

## 风险与取舍（Risks / Trade-offs）

[径向渐变背景性能] -> 三层径向渐变在现代浏览器中性能良好，仅在首次渲染时计算，不影响滚动性能。

[自定义图标 vs antd 图标] -> 自定义 SVG 图标需要维护额外的资源文件，但提供了设计规范要求的精确视觉效果。antd 图标无法满足样式定制需求。

[ProcessPanel 提取的接口稳定性] -> ProcessPanel 作为 TurnBlock 的内部子组件，接口通过 props 传递 TurnBlock 数据。未来如需独立使用需进一步抽象，但当前不做 speculative work。

[技能图标按 index 分配] -> 图标按 index 取模 4 分配，不与技能语义绑定。如果未来需要语义化图标分配，需要扩展 store 和选择逻辑。

## 迁移计划（Migration Plan）

无。纯样式和组件变更，不涉及数据迁移或发布风险。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-web-welcome-block-styles/spec.md`：新增
- `openspec/specs/agent-web-high-frequency-questions/spec.md`：新增
- `openspec/specs/agent-web-chat-pane-styles/spec.md`：新增
- `openspec/specs/agent-web-composer-button-styles/spec.md`：新增
- `openspec/specs/agent-web-skill-selector-styles/spec.md`：新增
- `openspec/specs/agent-web-process-panel/spec.md`：新增
- `openspec/specs/agent-web-right-pane-styles/spec.md`：新增
- `openspec/overview.md`：无
- `openspec/designs/architecture/`：无
- `openspec/designs/modules/`：无
- `openspec/designs/adr/`：无
- `openspec/designs/spec-to-design-map.md`：无

## 待确认问题（Open Questions）

无。
