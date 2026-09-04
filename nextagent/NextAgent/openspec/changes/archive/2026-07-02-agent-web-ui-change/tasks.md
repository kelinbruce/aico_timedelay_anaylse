## 1. CSS 变量定义

- [x] 1.1 在 `frontend/agent-web/src/styles/theme.css` 的 `:root[data-theme="light"], :root[data-theme="lightday"]` 块中新增 `--bg-color-logo-text: #191919;`
  验证：CSS 文件解析检查，断言浅色主题块中存在 `--bg-color-logo-text: #191919`
  来源：spec "Logo 文字双色主题变量"

- [x] 1.2 在 `frontend/agent-web/src/styles/theme.css` 的 `:root[data-theme="dark"], :root[data-theme="evening"]` 块中新增 `--bg-color-logo-text: #fff;`
  验证：CSS 文件解析检查，断言深色主题块中存在 `--bg-color-logo-text: #fff`
  来源：spec "Logo 文字双色主题变量"

- [x] 1.3 在 `theme.css` 的浅色主题块中新增 `--bg-high-recommend: rgb(255, 255, 255);` 和 `--color-recommend-question: rgba(119, 119, 119, 1);`
  验证：CSS 文件解析检查，断言浅色主题块中存在两个变量及对应值
  来源：spec "高频问题双色主题变量"

- [x] 1.4 在 `theme.css` 的深色主题块中新增 `--bg-high-recommend: rgba(243, 243, 243, 0.1);` 和 `--color-recommend-question: rgba(201, 201, 201, 1);`
  验证：CSS 文件解析检查，断言深色主题块中存在两个变量及对应值
  来源：spec "高频问题双色主题变量"

- [x] 1.5 在 `theme.css` 浅色主题块中新增对话窗格和气泡变量：`--color-chat-pane-bg`（径向渐变 + `#f3f3f3`）、`--color-ai-bubble-bg`、`--color-chat-answer`、`--color-answer-separator`、`--send-icon-enabled`、`--send-icon-disabled`、`--send-btn-bg`、`--send-btn-bg-hover`、`--stop-icon-color`、`--color-stop-text`、`--bg-input-context`，并修改 `--color-user-bubble-bg` 为蓝色调
  验证：CSS 文件解析检查，断言浅色主题块中存在所有新增变量
  来源：spec "对话窗格双色主题变量"、"发送/停止按钮双色主题变量"

- [x] 1.6 在 `theme.css` 深色主题块中新增对应的深色值
  验证：CSS 文件解析检查，断言深色主题块中存在所有新增变量
  来源：spec "对话窗格双色主题变量"、"发送/停止按钮双色主题变量"

## 2. WelcomeState 品牌区域重构

- [x] 2.1 在 `frontend/agent-web/src/features/welcome/components/WelcomeState.css` 中新增 `.portalGuideWrapper` 类，设置 `gap: 24px`、`margin-top: 16px`、`margin-bottom: 16px`
  验证：CSS 解析断言 `.portalGuideWrapper` 存在且包含 gap 24px 和 margin 16px 0
  来源：spec "Welcome 块品牌区域容器布局"

- [x] 2.2 在 `WelcomeState.css` 中新增 logo 容器类，设置 `padding: 0 16px`、`gap: 16px`、`display: flex`、`align-items: center`、`justify-content: center`
  验证：CSS 解析断言 logo 容器类包含 padding 0 16px、gap 16px、flex 居中
  来源：spec "Welcome 块品牌区域容器布局"

- [x] 2.3 在 `WelcomeState.css` 中新增 `.logoName` 类，设置 `font-size: 36px`、`line-height: 44px`、`font-weight: 700`、`color: var(--bg-color-logo-text)`
  验证：CSS 解析断言 `.logoName` 包含 font-size 36px、line-height 44px、font-weight 700、color var(--bg-color-logo-text)
  来源：spec "Logo 名称排版"

- [x] 2.4 在 `WelcomeState.css` 中新增 `.guideWelcome` 类，设置 `font-size: 20px`、`line-height: 28px`、`font-weight: 600`、`margin-top: 24px`、`color: var(--bg-color-logo-text)`
  验证：CSS 解析断言 `.guideWelcome` 包含 font-size 20px、line-height 28px、font-weight 600、margin-top 24px、color var(--bg-color-logo-text)
  来源：spec "Welcome 描述排版"

- [x] 2.5 在 `WelcomeState.css` 中修改 Logo 图片样式为 `width: 72px`、`height: 72px`
  验证：CSS 解析断言 Logo 图片类包含 width 72px、height 72px
  来源：spec "Logo 图片尺寸"

- [x] 2.6 在 `WelcomeState.tsx` 中重构品牌区域 DOM 结构：用 `portalGuideWrapper` 包裹 logo 容器和描述，logo 容器内放 Logo img 和 `logoName` span，描述使用 `guideWelcome` 类；移除现有 `welcome-brand` / `welcome-title-block` 内联样式
  验证：组件渲染后 DOM 检查 `portalGuideWrapper` > [logo 容器 > (img + `.logoName`)] + `.guideWelcome` 结构存在
  来源：spec "Welcome 块品牌区域容器布局"、design 决策 3

- [x] 2.7 更新 welcome subtitle i18n 文案，移除旧 tags 区域
  验证：i18n 资源检查 subtitle 文案已更新，tags key 已移除
  来源：proposal "Welcome 块品牌区域"第 8 点

## 3. Collaborative 入口品牌区域小屏差异化

- [x] 3.1 在 `WelcomeState.css` 中新增 `body[data-nextagent-host-mode="collaborative"]` 作用域下的 Logo 图片覆盖样式：`width: 60px`、`height: 60px`
  验证：CSS 解析断言 collaborative 选择器下 Logo 图片为 60×60
  来源：spec "Logo 图片尺寸"

- [x] 3.2 在 `WelcomeState.css` 中新增 `body[data-nextagent-host-mode="collaborative"]` 作用域下的 `.guideWelcome` 覆盖样式：`font-size: 16px`、`line-height: 24px`、`margin-top: 16px`
  验证：CSS 解析断言 collaborative 选择器下 `.guideWelcome` 为 16px/24px/16px
  来源：spec "Welcome 描述排版"

## 4. welcome-state-shell 宽度放宽

- [x] 4.1 在 `WelcomeState.css` 中将 `.welcome-state-shell` 的 `max-width` 从 `640px` 改为 `100%`（或移除 max-width）
  验证：CSS 解析断言 `.welcome-state-shell` 的 max-width 为 100% 或 none
  来源：spec "welcome-state-shell 宽度放宽"

## 5. HighFrequencyQuestions 独立组件

- [x] 5.1 新建 `frontend/agent-web/src/features/high-frequency-questions/components/HighFrequencyQuestions.tsx`，将 `WelcomeState` 中的静态 SUGGESTIONS 数据搬入，组件接收 `onQuestionClick?: (question: string) => void` prop，渲染 `highFrequencyWrapper` 容器 + `questionItem` 项，无图标
  验证：组件可独立渲染，DOM 检查 `highFrequencyWrapper` 和 `questionItem` 类名存在，且无图标元素
  来源：spec "高频问题独立组件"、"问题项排版与尺寸"、design 决策 6

- [x] 5.2 新建 `frontend/agent-web/src/features/high-frequency-questions/components/HighFrequencyQuestions.css`，定义 `.highFrequencyWrapper` 和 `.questionItem` 的完整样式
  验证：CSS 解析断言两个类名包含所有规格属性
  来源：spec "高频问题容器布局"、"问题项排版与尺寸"、"问题项宽度与文字截断"

- [x] 5.3 在 `WelcomeState.tsx` 中移除 `welcome-suggestion-grid` 相关 DOM、CSS 引用和 antd 图标 import，改为渲染 `<HighFrequencyQuestions onQuestionClick={onSuggestionClick} />`
  验证：DOM 检查 `WelcomeState` 渲染结果中不存在旧类名，存在 `HighFrequencyQuestions` 组件
  来源：spec "高频问题独立组件"

- [x] 5.4 在 `WelcomeState.css` 中移除 `.welcome-suggestion-grid` 等旧类名规则
  验证：CSS 解析断言旧类名规则已移除
  来源：spec "高频问题独立组件"

## 6. 对话窗格与消息气泡样式

- [x] 6.1 在 `ChatPage.tsx` 中为 `chat-conversation-pane` 添加 `background: var(--color-chat-pane-bg)`
  验证：代码检查 chat-conversation-pane style 包含 background var(--color-chat-pane-bg)
  来源：spec "对话窗格背景"

- [x] 6.2 在 `theme.css` 中新增 `[data-testid="ai-bubble"]` 样式规则：`border-radius: 0px 8px 8px 8px`、`background: var(--color-ai-bubble-bg)`
  验证：CSS 解析断言 ai-bubble 选择器包含 border-radius 和 background
  来源：spec "AI 气泡样式"

## 7. 消息输入发送/停止按钮样式

- [x] 7.1 新建 `frontend/agent-web/src/assets/icons/SendIcon.tsx`，根据 `disabled` prop 和当前主题选择 light/dark send SVG
  验证：组件渲染检查图标存在
  来源：spec "发送按钮自定义图标"

- [x] 7.2 新建 `frontend/agent-web/src/assets/icons/StopResponseIcon.tsx`，根据主题选择 stop 图标
  验证：组件渲染检查图标存在
  来源：spec "停止按钮自定义图标"

- [x] 7.3 在 `theme.css` 中新增 `.send-btn` 和 `.stop-button` CSS 类
  验证：CSS 解析断言两个类名包含规格属性
  来源：spec "发送按钮 CSS 类"、"停止按钮 CSS 类"

- [x] 7.4 在 `MessageInput.tsx` 中将发送按钮从 antd Button + ArrowUpOutlined 改为 `type="text"` Button + `className="send-btn"` + `SendIcon`；将停止按钮从 antd Button + StopOutlined 改为 `div className="stop-button"` + `StopResponseIcon` + 文字标签
  验证：渲染检查 btn-send 使用 send-btn 类和 SendIcon，btn-stop 使用 stop-button 类和 StopResponseIcon
  来源：spec "发送按钮自定义图标"、"停止按钮自定义图标"

- [x] 7.5 新增 `composer.stopResponse` i18n key（en-US: "Stop response", zh-CN: "停止响应"）
  验证：i18n 资源检查 key 存在
  来源：spec "停止按钮文字标签"

## 8. 技能选择器视觉刷新

- [x] 8.1 新增 skill 图标资源 `index1-4.png` 和 `all.png` 到 `frontend/agent-web/src/assets/skill-icons/`
  验证：文件存在
  来源：spec "技能选择器图标"

- [x] 8.2 在 `SkillSelectorBar.tsx` 中为每个技能 chip 添加图标 img，chip 样式改为圆角药丸（border-radius 16, height 32）；"全部" 按钮始终显示
  验证：渲染检查每个 chip 包含 img，样式包含 border-radius 16
  来源：spec "技能选择条 chip 样式"

- [x] 8.3 在 `SkillCatalogModal.tsx` 中更新弹窗标题字号、新增副标题、搜索框添加 SearchOutlined 图标、列表项加高并添加图标 img
  验证：渲染检查标题字号、副标题存在、搜索框图标存在、列表项包含 img
  来源：spec "技能目录弹窗样式"

- [x] 8.4 在 `SelectedSkillChip.tsx` 中更新 chip 样式：使用 `--bg-input-context` 背景、`--color-chat-answer` 文字色、4px 圆角、显示图标
  验证：渲染检查 chip 样式包含新变量和图标
  来源：spec "已选技能 chip 样式"

- [x] 8.5 在 `skillSelectionStore.ts` 中新增 `selectedIconIndex` 字段，`selectSkill` 接收 `iconIndex` 参数
  验证：代码检查 store 包含 selectedIconIndex 和更新的 selectSkill 签名
  来源：spec "技能选择 store 扩展"

## 9. 对话过程面板提取

- [x] 9.1 新建 `frontend/agent-web/src/features/chat/components/ProcessPanel.tsx`，将 TurnBlock 中的过程面板渲染逻辑提取为独立组件，包括图标解析、展开/折叠交互
  验证：组件可独立渲染
  来源：spec "ProcessPanel 独立组件"

- [x] 9.2 新增 process 图标资源（think/skill/process-complete/final-complete/collapse 的浅色/深色版本）到 `frontend/agent-web/src/assets/process-icons/`
  验证：文件存在
  来源：spec "过程面板图标"

- [x] 9.3 在 `TurnBlock.tsx` 中移除内联过程面板 CSS、`ProcessPanelMode` 状态管理和 `persistedProcessPanelModes` 缓存，改为渲染 `<ProcessPanel>` 组件
  验证：代码检查 TurnBlock 不再包含已移除的常量和状态，包含 ProcessPanel import
  来源：spec "TurnBlock 过程面板提取"

## 10. 右侧布局调整

- [x] 10.1 在 `RightPaneLayout.tsx` 中将 maxWidth 从 880 改为 1080
  验证：代码检查 maxWidth={1080}
  来源：spec "右侧布局宽度"

- [x] 10.2 移除内容区 `background: var(--color-bg-primary)`，scrollbarColor 改为 transparent
  验证：代码检查背景已移除
  来源：spec "右侧布局背景透明"

- [x] 10.3 更新免责声明文案并新增 `rightPane.disclaimerTip` i18n key，添加 QuestionCircleOutlined 图标和 Tooltip
  验证：i18n 资源检查新 key 存在，渲染检查图标和 Tooltip 存在
  来源：spec "免责声明文案与 Tooltip"

- [x] 10.4 在 `SuggestedQuestions.css` 中移除 `margin-top: 16px`
  验证：CSS 解析断言 margin-top 已移除
  来源：proposal "右侧布局调整"第 32 点

## 11. 验证和收尾

- [x] 11.1 运行前端构建确认无编译错误
  验证：`cd frontend/agent-web && npm run build`
  来源：proposal 影响范围

- [x] 11.2 确认标签区域样式未被修改
  验证：git diff 检查 `welcome-quick-tags` 相关 CSS 规则无变更
  来源：spec "标签和建议按钮不在品牌区域样式范围内"

- [x] 11.3 清理本次改动产生的未使用 import、变量或临时样式
  验证：代码审查检查无遗留死代码
  来源：AGENTS.md 实现质量门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：
- 同步 `openspec/specs/agent-web-welcome-block-styles/spec.md`（新增 capability）。
- 同步 `openspec/specs/agent-web-high-frequency-questions/spec.md`（新增 capability）。
- 同步 `openspec/specs/agent-web-chat-pane-styles/spec.md`（新增 capability）。
- 同步 `openspec/specs/agent-web-composer-button-styles/spec.md`（新增 capability）。
- 同步 `openspec/specs/agent-web-skill-selector-styles/spec.md`（新增 capability）。
- 同步 `openspec/specs/agent-web-process-panel/spec.md`（新增 capability）。
- 同步 `openspec/specs/agent-web-right-pane-styles/spec.md`（新增 capability）。
- `openspec/overview.md`、`openspec/designs/` 无需更新。
