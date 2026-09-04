## 背景与问题（Why）

`agent-web` 前端整体视觉风格需要按产品设计规范统一刷新，涵盖 welcome 块品牌区域、高频问题推荐、对话窗格背景、消息输入发送/停止按钮、技能选择器外观、对话过程面板和右侧布局宽度。当前各区域样式与设计规范不一致：Logo 尺寸偏小、缺少独立描述文本块、颜色未走 CSS 变量主题化、发送/停止按钮使用 antd 默认圆形按钮而非自定义图标、技能选择器缺少图标且使用旧圆角方框样式、TurnBlock 过程面板逻辑臃肿需提取为独立组件。

## 变更范围（What Changes）

### Welcome 块品牌区域
1. 在 `theme.css` 新增 CSS 变量 `--bg-color-logo-text`，浅色主题（light/lightday）值为 `#191919`，深色主题（dark/evening）值为 `#fff`。
2. 重构 `WelcomeState.css` 和 `WelcomeState.tsx` 的品牌区域：引入 `portalGuideWrapper`、`logoName`、`guideWelcome` 三个语义类名，替换现有的 `welcome-brand` / `welcome-title-block` 内联样式。
3. Logo 图片从 42×42 调整为 72×72；collaborative 入口（`body[data-nextagent-host-mode="collaborative"]`）下缩小为 60×60。
4. Logo 名称（标题）字号从 28px 调整为 36px / 行高 44px / 字重 700，颜色走 `--bg-color-logo-text`。
5. Welcome 描述字号 20px / 行高 28px / 字重 600 / 上边距 24px，颜色走 `--bg-color-logo-text`；collaborative 入口下字号缩为 16px / 行高 24px / 上边距 16px。
6. `portalGuideWrapper` 容器 gap 24px、上下边距各 16px；logo 容器左右 padding 16px、logo 与名称间 gap 16px、flex 居中。
7. 将 `welcome-state-shell` 的 `max-width` 从 640px 放宽到 100%，使品牌区域和高频问题区域宽度与对话/输入框内容区一致。
8. 更新 welcome subtitle 文案，移除旧 tags 区域。

### 高频问题推荐区域
9. 新增 CSS 变量 `--bg-high-recommend`（浅色 `rgb(255,255,255)` / 深色 `rgba(243,243,243,0.1)`）和 `--color-recommend-question`（浅色 `rgba(119,119,119,1)` / 深色 `rgba(201,201,201,1)`）。
10. 将现有 `welcome-suggestion-grid`（2列 grid + antd Button + 图标）替换为 `highFrequencyWrapper`（flex wrap 布局）+ `questionItem`（纯文字、无图标），每项宽度随内容长度决定，超长文字省略截断。
11. 新建独立 React 组件 `HighFrequencyQuestions`（`frontend/agent-web/src/features/high-frequency-questions/components/`），从 `WelcomeState` 中提取静态建议问题数据，`WelcomeState` 改为渲染该组件。

### 对话窗格与消息气泡样式
12. 新增 CSS 变量 `--color-chat-pane-bg`：浅色主题为带紫色/青色径向渐变的 `#f3f3f3` 背景，深色主题为 `var(--color-bg-primary)`。
13. 新增 CSS 变量 `--color-ai-bubble-bg`、`--color-chat-answer`、`--color-answer-separator`，并修改 `--color-user-bubble-bg` 为蓝色调。
14. AI 气泡 `[data-testid="ai-bubble"]` 使用 `border-radius: 0px 8px 8px 8px` 和 `var(--color-ai-bubble-bg)` 背景。
15. `ChatPage` 中 `chat-conversation-pane` 添加 `background: var(--color-chat-pane-bg)`。

### 消息输入发送/停止按钮样式
16. 新增自定义图标组件 `SendIcon` 和 `StopResponseIcon`，替代 antd 默认 `ArrowUpOutlined` / `StopOutlined`。
17. 新增 CSS 变量 `--send-icon-enabled`、`--send-icon-disabled`、`--send-btn-bg`、`--send-btn-bg-hover`、`--stop-icon-color`、`--color-stop-text`、`--bg-input-context`。
18. 新增 `.send-btn` CSS 类（32×32 圆角按钮，flex 居中，hover 背景变化）和 `.stop-button` CSS 类（带文字标签的圆角按钮）。
19. 发送按钮在正常态显示 `SendIcon`，提交态显示 `Spin`；停止按钮在 `isExecuting && onStop` 时显示 `StopResponseIcon` + 文字标签，否则显示发送按钮。
20. 新增 `composer.stopResponse` i18n key。

### 技能选择器视觉刷新
21. 新增 skill 图标资源（`index1-4.png`、`all.png`），技能选择条、技能目录弹窗和已选技能 chip 中每个技能项前显示对应图标。
22. 技能选择条 chip 样式从方框（border-radius 8）改为圆角药丸（border-radius 16，height 32），移除选中态边框/背景差异。
23. 已选技能 chip（`SelectedSkillChip`）样式刷新：使用 `--bg-input-context` 背景、`--color-chat-answer` 文字色、4px 圆角、显示图标。
24. 技能目录弹窗（`SkillCatalogModal`）样式刷新：标题字号增大、新增副标题、搜索框加大并添加搜索图标、列表项加高并显示图标。
25. `skillSelectionStore` 新增 `selectedIconIndex` 字段，`selectSkill` 接收 `iconIndex` 参数。

### 对话过程面板提取
26. 将 `TurnBlock` 中的过程面板渲染逻辑提取为独立组件 `ProcessPanel`（`frontend/agent-web/src/features/chat/components/ProcessPanel.tsx`）。
27. 新增 process 图标资源（think、skill、process-complete、final-complete、collapse 的浅色/深色版本），根据过程标题和主题动态选择图标。
28. `TurnBlock` 移除内联的过程面板 CSS、`ProcessPanelMode` 状态管理和 `persistedProcessPanelModes` 缓存，改为渲染 `<ProcessPanel>` 组件。

### 右侧布局调整
29. `RightPaneLayout` maxWidth 从 880 调整为 1080。
30. 移除内容区背景色 `var(--color-bg-primary)`，改为透明背景。
31. 更新免责声明文案并新增 `rightPane.disclaimerTip` i18n key，在免责声明旁添加 `QuestionCircleOutlined` 图标和 Tooltip。
32. `SuggestedQuestions.css` 移除 `margin-top: 16px`。

## Capability 影响（Capabilities）

### 新增 Capability
- `agent-web-welcome-block-styles`: welcome 块品牌区域（Logo + 名称 + 描述）的样式规范，包括尺寸、字号、间距、字重、双色主题颜色变量和 collaborative 入口的小屏差异化尺寸。
- `agent-web-high-frequency-questions`: welcome 块高频问题推荐区域的样式规范和独立组件，包括 flex wrap 容器布局、问题项尺寸/排版/颜色、双色主题变量、文字截断行为。
- `agent-web-chat-pane-styles`: 对话窗格背景、AI 气泡、用户气泡、回答文字颜色和分隔线的双色主题样式规范。
- `agent-web-composer-button-styles`: 消息输入区域发送按钮和停止按钮的自定义图标、CSS 类和双色主题变量规范。
- `agent-web-skill-selector-styles`: 技能选择器（选择条、目录弹窗、已选 chip）的视觉刷新规范，包括技能图标、圆角药丸样式和 store 扩展。
- `agent-web-process-panel`: 对话过程面板独立组件的行为契约，包括图标类型解析、展开/折叠交互和过程状态显示。
- `agent-web-right-pane-styles`: 右侧布局容器的宽度、背景透明度、免责声明文案和 Tooltip 规范。

### 修改的 Capability
（无）

## 影响范围（Impact）

- 代码：`frontend/agent-web/src/features/welcome/`、`frontend/agent-web/src/features/high-frequency-questions/`、`frontend/agent-web/src/features/chat/components/TurnBlock.tsx`、`frontend/agent-web/src/features/chat/components/ProcessPanel.tsx`（新增）、`frontend/agent-web/src/features/composer/components/MessageInput.tsx`、`frontend/agent-web/src/features/skill-selector/`、`frontend/agent-web/src/components/RightPaneLayout.tsx`、`frontend/agent-web/src/pages/ChatPage.tsx`、`frontend/agent-web/src/styles/theme.css`、`frontend/agent-web/src/i18n/`、`frontend/agent-web/src/state/skillSelectionStore.ts`、`frontend/agent-web/src/features/suggested-questions/`。
- 新增资源：`frontend/agent-web/src/assets/icons/`（SendIcon、StopResponseIcon 及 SVG）、`frontend/agent-web/src/assets/process-icons/`（8 个 SVG）、`frontend/agent-web/src/assets/skill-icons/`（5 个 PNG）。
- 无 API、无配置、无后端、无运维面影响。
- 测试：`welcomeState.component.test.tsx` 更新断言以适配新类名和结构。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- openspec/specs/agent-web-welcome-block-styles/spec.md：新增
- openspec/specs/agent-web-high-frequency-questions/spec.md：新增
- openspec/specs/agent-web-chat-pane-styles/spec.md：新增
- openspec/specs/agent-web-composer-button-styles/spec.md：新增
- openspec/specs/agent-web-skill-selector-styles/spec.md：新增
- openspec/specs/agent-web-process-panel/spec.md：新增
- openspec/specs/agent-web-right-pane-styles/spec.md：新增

长期背景：
- openspec/overview.md：无

设计视图：
- openspec/designs/architecture/<topic>.md：无
- openspec/designs/modules/<module>.md：无
- openspec/designs/adr/<id>.md：无
- openspec/designs/spec-to-design-map.md：无

验证入口：
- 前端构建无编译错误
- welcome 块样式渲染验证（local 和 collaborative 入口）
- CSS 变量在浅色/深色主题下的值断言
- highFrequencyWrapper flex wrap 布局渲染验证
- 对话窗格背景和气泡样式渲染验证
- 发送/停止按钮图标和样式渲染验证
- 技能选择器图标和圆角药丸样式渲染验证
- ProcessPanel 独立组件渲染验证
- 右侧布局 maxWidth 1080 验证
