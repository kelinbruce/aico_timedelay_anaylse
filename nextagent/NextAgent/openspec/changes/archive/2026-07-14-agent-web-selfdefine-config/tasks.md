## 1. AICOConfig 类型定义与校验

- [x] 1.1 创建 AICOConfig 类型定义文件，包含所有接口和枚举（AICOConfig、ModalSize、PIUInfoItem、QuickType、OperatorPosition、OperatorType、ExpandPanelPosition、ToolBarPosition、Operator、GuideAreaType）
  验证：`npm run build`（frontend/agent-web）通过，类型无错误
  来源：aico-config-contract spec "AICOConfig configuration type and field definitions"

- [x] 1.2 实现手写校验函数 `validateAICOConfig(raw: unknown): AICOConfig | null`，覆盖所有字段的类型检查、枚举值验证、数组元素过滤、空字符串处理
  验证：单元测试文件 `aicoConfig.test.ts`，覆盖：有效配置、空对象、null/undefined、非对象输入、部分无效 operators 过滤、无效枚举回退、空字符串视为 absent
  来源：aico-config-contract spec "AICOConfig validation uses hand-written functions"；design D2

- [x] 1.3 实现 negative case：传入字符串/数字/数组作为 AICOConfig 时返回 null 并 console.warn
  验证：单元测试中断言 `validateAICOConfig("invalid")` 返回 null 且 `console.warn` 被调用
  来源：aico-config-contract spec "AICOConfig validation uses hand-written functions" Scenario "Invalid AICOConfig falls back to defaults"

## 2. AICOConfigStore 与注入路径

- [x] 2.1 创建 AICOConfigStore（external store 模式），包含 snapshot（config + panelType + activePanelOperatorData + activeModalOperatorData）、subscribe、getSnapshot、setConfig、clearConfig、setPanelType、setActivePanelOperator、setActiveModalOperator 方法
  验证：单元测试 `aicoConfigStore.test.ts`，覆盖 setConfig 后 getSnapshot 返回正确值、subscribe 收到通知
  来源：design D1 "AICOConfig store 作为独立 external store"；design D4 "PANEL 状态模型"

- [x] 2.2 实现 `useAICOConfig()` hook，基于 `useSyncExternalStore` 消费 AICOConfigStore
  验证：组件测试中 hook 返回 null（无配置）或 AICOConfig（有配置）
  来源：design D1

- [x] 2.3 修改 `entries/immersive.tsx`，在页面加载时从 `sessionStorage["AICOConfig"]` 读取 JSON 并调用 `validateAICOConfig` + `setConfig`
  验证：组件测试 `immersiveConfig.test.tsx`，覆盖：sessionStorage 有有效配置时 store 收到配置、sessionStorage 无配置时 store 为 null、sessionStorage 值非 JSON 时回退默认且 console.warn
  来源：aico-config-contract spec "AICOConfig injection paths per host mode" Scenario "Immersive mode reads AICOConfig from sessionStorage"

- [x] 2.4 修改 `registerAIAgentPIU.tsx`，将 `loadAIAgent` handler 的 payload 类型从 `{ containerId?: unknown }` 替换为 `AICOConfig`，解析后调用 `setConfig`
  验证：组件测试 `loadAIAgentConfig.test.tsx`，覆盖：payload 含完整 AICOConfig 时配置生效、payload 只含 containerId 时其余字段走默认
  来源：agent-web-multi-host-modes spec MODIFIED "AIAgentPIU starts through Prel and loadAIAgent"；design D1

- [x] 2.5 实现 negative case：local 模式不从 sessionStorage 读取 AICOConfig
  验证：测试中设置 sessionStorage["AICOConfig"] 后启动 local 模式，断言 AICOConfigStore snapshot 为 null
  来源：aico-config-contract spec "AICOConfig injection paths per host mode" Scenario "Local mode ignores AICOConfig"

- [x] 2.6 实现 negative case：collaborative 模式重新 emit loadAIAgent 时完全替换配置而非 merge
  验证：测试中先 setConfig({ name: "A" })，再通过 loadAIAgent 传入 { name: "B" }，断言 store snapshot.config.name === "B"
  来源：aico-config-contract spec "AICOConfig injection paths per host mode" Scenario "AICOConfig is re-emitted in collaborative mode"

## 3. PiuRenderer 统一组件

- [x] 3.1 创建 `PiuRenderer` 组件，封装 `Prel.autoLoad + piu.emit` 模式，接收 piuInfo 和 extraPayload props，生成唯一 containerId，渲染容器 DOM
  验证：组件测试 `PiuRenderer.test.tsx`，覆盖：有 Prel 时调用 autoLoad + emit、无 Prel 时渲染 placeholder、containerId 存在于 DOM
  来源：aico-piu-injection spec "PIU rendering injection via Prel.autoLoad and piu.emit"；design D3

- [x] 3.2 实现 PiuRenderer cleanup：组件卸载时清空容器 DOM 内容
  验证：组件测试中渲染后卸载，断言容器 DOM 为空
  来源：design "风险与取舍" PIU 渲染容器生命周期管理

## 4. operators 注入

- [x] 4.1 创建 OperatorButton 组件，根据 lightIcon/darkIcon 渲染 base64 图标，根据主题切换图标
  验证：组件测试 `OperatorButton.test.tsx`，覆盖：light 主题用 lightIcon、dark 主题用 darkIcon
  来源：aico-piu-injection spec "Custom operators injection"

- [x] 4.2 在 `Sidebar.tsx` 中实现 operators 注入（operatorPosition: LEFT 模式）：OUTER operators 插入收藏按钮下方，INNER operators 放入"更多"菜单，operators 区域超出最大高度时垂直滚动
  验证：组件测试 `SidebarOperators.test.tsx`，覆盖：OUTER operator 渲染在收藏下方、INNER operator 在更多菜单中、超出高度时 overflow-y: auto
  来源：aico-piu-injection spec "Custom operators injection" Scenario "Operators appear in sidebar below favorites" + "Sidebar operator overflow scrolls vertically"

- [x] 4.3 在 collaborative header / RIGHT 模式 header 中实现 operators 注入：OUTER operators 放在 header 按钮区域，溢出时横向滚动
  验证：组件测试 `HeaderOperators.test.tsx`，覆盖：OUTER operator 渲染在 header、溢出时 overflow-x: auto
  来源：aico-piu-injection spec "Custom operators injection" Scenario "Operators appear in collaborative header"

- [x] 4.4 实现 MODAL 类型 operator 点击行为：打开 Modal 弹窗，尺寸使用 PIUInfoItem.width/height，同时只允许一个 Modal，点击新 MODAL 替换当前
  验证：组件测试 `OperatorModal.test.tsx`，覆盖：点击 MODAL operator 弹出弹窗、弹窗尺寸正确、点击第二个 MODAL 时第一个关闭
  来源：aico-piu-injection spec "Operator MODAL type opens a single modal dialog"

- [x] 4.5 实现 PANEL 类型 operator 点击行为：切换 panelType 为 CUSTOM_PANEL，渲染 PiuRenderer 并传入 backFunc
  验证：组件测试 `OperatorPanel.test.tsx`，覆盖：点击 PANEL operator 时 panelType 切换、PiuRenderer 渲染、backFunc 调用后切换回 CONVERSATION_PANEL
  来源：aico-piu-injection spec "Operator PANEL type replaces conversation area with backFunc"

- [x] 4.6 实现 negative case：LEFT 模式 PANEL 激活时侧边栏保留，RIGHT 模式 PANEL 激活时 header 被替换
  验证：组件测试，覆盖：LEFT 模式 sidebar 可见、RIGHT 模式 header 不可见
  来源：aico-piu-injection spec "Operator PANEL type replaces conversation area with backFunc" Scenario "LEFT mode preserves sidebar" + "RIGHT mode replaces header"

- [x] 4.7 实现 negative case：切换到另一个 PANEL operator 时先卸载当前再加载新的
  验证：测试中点击 PANEL operator A，再点击 PANEL operator B，断言 A 的容器被清空后 B 才渲染
  来源：aico-piu-injection spec "Operator PANEL type replaces conversation area with backFunc"

## 5. answerOperator 注入

- [x] 5.1 修改 `TurnBlock.tsx` 的 BubbleActions，当 answerOperator 配置存在时用 PiuRenderer 替换默认 BubbleActions
  验证：组件测试 `AnswerOperator.test.tsx`，覆盖：有 answerOperator 时不渲染默认按钮、PiuRenderer 渲染
  来源：aico-piu-injection spec "answerOperator replaces assistant BubbleActions"

- [x] 5.2 实现 emit payload 包含 sessionId、runId、answer 字段，answer 从 AnswerSegment[] 提取文本段拼接
  验证：单元测试 + 组件测试，覆盖：answer 包含 text 段和 TEXT structured 段、排除 PIU/DSL/FILE/ACTION/OPERATOR 段
  来源：aico-piu-injection spec "answerOperator replaces assistant BubbleActions" Scenario "answer text excludes structured segments"

## 6. quickInfo / inputOperator / guideInfo 注入

- [x] 6.1 修改 `QuickOperatorArea.tsx`，支持 quickInfo 配置：SKILL_LIST 用默认、CATEGORY_RECOMMEND 用默认、SELF_DEFINE 用 PiuRenderer
  验证：组件测试 `QuickInfo.test.tsx`，覆盖：三种 type 的渲染结果、SELF_DEFINE 时 emit payload 含 theme 和 containerId
  来源：aico-piu-injection spec "quickInfo controls input-above area"

- [x] 6.2 修改 `MessageInput.tsx`，当 inputOperator 存在时替换 slash-hint 区域为 PiuRenderer，高度匹配按钮行、宽度到重试左侧 16px
  验证：组件测试 `InputOperator.test.tsx`，覆盖：有 inputOperator 时 slash-hint 不显示、PiuRenderer 渲染、无 inputOperator 时 slash-hint 显示
  来源：aico-piu-injection spec "inputOperator replaces composer slash-hint area"

- [x] 6.3 修改 `GuideArea.tsx`，支持 guideInfo 配置：HIGH_FREQUENCY_RECOMMEND 用默认、SELF_DEFINE 用 PiuRenderer
  验证：组件测试 `GuideInfo.test.tsx`，覆盖：两种 type 的渲染结果、SELF_DEFINE 时 emit payload 含 theme 和 containerId
  来源：aico-piu-injection spec "guideInfo controls welcome page guide area"

## 7. operatorPosition 布局切换

- [x] 7.1 修改 `ImmersiveApp.tsx`，根据 operatorPosition 选择渲染 Sidebar 布局（LEFT）还是顶部 bar 布局（RIGHT）
  验证：组件测试 `LayoutMode.test.tsx`，覆盖：LEFT 模式有 sidebar、RIGHT 模式无 sidebar 有顶部 bar
  来源：aico-layout-mode spec "operatorPosition controls sidebar vs top-bar layout"

- [x] 7.2 实现 RIGHT 模式顶部 bar 组件（复用 collaborative PiuPanelHeader 结构），包含 icon、name、operators、关闭/最大化等按钮
  验证：组件测试，覆盖：顶部 bar 渲染 icon/name/operators
  来源：aico-layout-mode spec "operatorPosition controls sidebar vs top-bar layout" Scenario "RIGHT mode renders top bar instead of sidebar"

- [x] 7.3 实现 negative case：collaborative 模式忽略 operatorPosition，始终用顶部 bar 布局
  验证：测试中 collaborative 模式设置 operatorPosition: LEFT，断言无 sidebar
  来源：aico-layout-mode spec "operatorPosition controls sidebar vs top-bar layout" Scenario "Collaborative mode ignores operatorPosition"

## 8. 静态展示与行为开关

- [x] 8.1 实现 icon/entranceIcon/guideIcon 替换默认图标，通过 base64 渲染 img，malformed base64 回退默认并 console.warn
  验证：组件测试 `IconOverride.test.tsx`，覆盖：有效 base64 替换默认图标、无效 base64 回退默认 + console.warn
  来源：aico-display-control spec "Icon fields use base64 and override defaults"

- [x] 8.2 实现 name 替换标题文案、welcome 替换欢迎副标题
  验证：组件测试，覆盖：name 替换 "NextAgent"、welcome 替换 i18n 默认、absent 时用默认
  来源：aico-display-control spec "name and welcome override display text"

- [x] 8.3 修改 `RightPaneLayout.tsx`，实现 declaration 配置：false 隐藏、true 用默认、object 用自定义 title/tips
  验证：组件测试 `Declaration.test.tsx`，覆盖：false 不渲染、true 用 i18n 默认、object 用自定义文本
  来源：aico-display-control spec "declaration controls bottom disclaimer area"

- [x] 8.4 实现 clearStorage 配置：collaborative 模式 true 时不恢复 sessionStorage 中的上次会话
  验证：组件测试 `ClearStorage.test.tsx`，覆盖：true 不恢复、false/absent 恢复上次会话
  来源：aico-display-control spec "clearStorage controls session restoration"

- [x] 8.5 修改 `TurnBlock.tsx`，实现 showAskTime 配置：true 时在用户消息上显示时间戳
  验证：组件测试 `ShowAskTime.test.tsx`，覆盖：true 显示时间戳、false/absent 不显示
  来源：aico-display-control spec "showAskTime controls user message timestamp"

- [x] 8.6 修改 `ProcessPanel.tsx`，实现 showThinkingChain 配置：false 时隐藏"完整过程"按钮入口
  验证：组件测试 `ShowThinkingChain.test.tsx`，覆盖：false 隐藏入口、true/absent 显示入口、ProcessPanel 本身仍可见
  来源：aico-display-control spec "showThinkingChain controls full process entry"

- [x] 8.7 实现 modalSize 配置：collaborative 模式下覆盖 docked 面板宽度和最小宽度
  验证：组件测试 `ModalSize.test.tsx`，覆盖：modalSize.width 覆盖默认 484px、modalSize.minWidth 覆盖默认最小值、local 模式不受影响
  来源：aico-layout-mode spec "modalSize controls collaborative panel dimensions"

## 9. 回归与集成验证

- [x] 9.1 回归测试：无 AICOConfig 时所有组件渲染与当前完全一致
  验证：运行现有前端测试套件 `npm test`（frontend/agent-web）全部通过
  来源：aico-config-contract spec "AICOConfig default behavior when fields are absent" Scenario "Absent fields use defaults"

- [x] 9.2 回归测试：AICOConfig 为空对象时行为与无配置一致
  验证：组件测试 `EmptyConfig.test.tsx`，断言空对象配置时所有 UI 元素和默认值与无配置时一致
  来源：aico-config-contract spec "AICOConfig default behavior when fields are absent" Scenario "Absent fields use defaults"

- [x] 9.3 架构检查：AICOConfigStore 独立于 runtimeStore，无 private path import 跨包
  验证：`npm run lint:architecture` 通过
  来源：design D1；AGENTS.md 架构边界约束

- [x] 9.4 清理实现产生的临时调试代码、未使用 import 和 dead code
  验证：`npm run build` 无 TS 错误，代码审查确认无遗留临时代码
  来源：AGENTS.md 实现质量门禁

- [x] 9.5 更新 `entries/collaborative.ts` 测试入口，在 `piu.emit("loadAIAgent", ...)` 中传入完整 AICOConfig（含 name、operators 等字段），支持端到端验证
  验证：启动 collaborative dev 模式后，确认 AICOConfig 字段在 PIU 面板中生效（标题、操作按钮等）
  来源：design 迁移计划；agent-web-multi-host-modes spec MODIFIED "AIAgentPIU starts through Prel and loadAIAgent"

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 openspec/specs/aico-config-contract/spec.md
- 同步 openspec/specs/aico-piu-injection/spec.md
- 同步 openspec/specs/aico-layout-mode/spec.md
- 同步 openspec/specs/aico-display-control/spec.md
- 修改 openspec/specs/agent-web-multi-host-modes/spec.md 的 loadAIAgent requirement
- 更新 openspec/overview.md 新增 AICOConfig 背景
- 新增 openspec/designs/architecture/agent-web-frontend.md
- 更新 openspec/designs/modules/agent-web.md
- 新增 openspec/designs/adr/aico-config-handwritten-validation.md
- 新增 openspec/designs/adr/aico-config-no-hot-reload.md
- 更新 openspec/designs/spec-to-design-map.md
