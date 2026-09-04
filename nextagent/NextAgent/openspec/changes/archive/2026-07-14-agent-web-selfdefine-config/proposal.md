## 背景与问题（Why）

NextAgent 前端目前以硬编码方式呈现 UI 组件和交互行为：标题固定为 "NextAgent"、欢迎语来自 i18n 默认值、图标使用内置 SVG、操作栏只暴露新建会话/搜索/收藏等固定按钮、答案区域操作固定为复制/点赞/点踩/收藏/fork/share、输入框上方固定为技能选择器、欢迎页中间固定为高频问题。当产品方将 NextAgent 嵌入不同宿主环境（collaborative PIU 面板、immersive 独立 URL 页面）时，无法通过外部配置自定义这些 UI 元素和行为，每次定制都需要修改源码。

需要引入一套标准的外部配置契约 `AICOConfig`，让宿主在加载 NextAgent 前端时通过参数传入，实现 UI 外观、操作按钮、渲染区域、布局结构和行为开关的定制化。配置为纯增量覆盖：不传任何字段时，所有行为与当前完全一致。

## 变更范围（What Changes）

### 新增配置注入路径

- **Immersive 模式**：页面加载时从 `sessionStorage` 读取 key 为 `AICOConfig` 的 JSON 配置，刷新页面重新读取。
- **Collaborative 模式**：通过 PIU `loadAIAgent` handler 接收完整 `AICOConfig` 作为 payload，服务启动时一次性接收，无热更新。
- **Local 模式**：不消费 AICOConfig，全部使用当前默认行为。

### 新增配置类型 AICOConfig

定义完整的配置接口，包含：静态展示字段（icon/name/welcome 等）、行为开关（clearStorage/declaration/showAskTime/showThinkingChain）、布局控制（modalSize/operatorPosition）、PIU 渲染注入点（operators/answerOperator/quickInfo/inputOperator/guideInfo）。所有图标字段使用 base64 编码字符串。

### 新增 PIU 渲染注入机制

复用现有 `PiuMessage` 组件的 `Prel.autoLoad + piu.emit` 模式，为每个注入点提供统一的 PIU 渲染容器。每个注入点有特定的 emit 数据契约：
- `operators`：传入 `{ ...data, theme, containerId }`；PANEL 类型额外传入 `backFunc`
- `answerOperator`：传入 `{ ...data, theme, containerId, sessionId, runId, answer }`
- `inputOperator`：传入 `{ ...data, theme, containerId }`
- `quickInfo`/`guideInfo` 的 `SELF_DEFINE` 类型：传入 `{ ...data, theme, containerId }`

### 新增 PANEL 状态模型

引入 `PanelType = 'CONVERSATION_PANEL' | 'CUSTOM_PANEL'` 状态切换。点击 `Operator.type === PANEL` 时切换到自定义面板，通过 `backFunc` 或新建会话返回对话面板。同时只能有一个 PANEL 激活。

### 新增 operatorPosition 布局模式

- `LEFT`（默认）：local/immersive 保留侧边栏布局，自定义 operators 插入侧边栏收藏按钮下方。
- `RIGHT`：local/immersive 移除侧边栏，改为顶部 bar 布局（与 collaborative 一致），operators 放在顶部栏。

### 修改 LoadAIAgentPayload

**BREAKING**：collaborative 模式 `loadAIAgent` handler 的 payload 类型从临时定义的 `{ containerId?: unknown }` 替换为完整 `AICOConfig`。

## Capability 影响（Capabilities）

### 新增 Capability
- `aico-config-contract`: AICOConfig 配置类型定义、校验规则、注入路径和默认行为契约
- `aico-piu-injection`: PIU 渲染注入点（operators/answerOperator/quickInfo/inputOperator/guideInfo）的行为规格、emit 数据契约和 PANEL/MODAL 生命周期
- `aico-layout-mode`: operatorPosition 布局模式和 modalSize 面板尺寸控制规格
- `aico-display-control`: 静态展示字段和行为开关（icon/name/welcome/declaration/clearStorage/showAskTime/showThinkingChain）规格

### 修改的 Capability
- `agent-web-multi-host-modes`: collaborative 模式 `loadAIAgent` handler 的 payload 从临时 `{ containerId?: unknown }` 变更为完整 `AICOConfig`

## 影响范围（Impact）

### 代码影响
- `frontend/agent-web/src/piu/registerAIAgentPIU.tsx`：`LoadAIAgentPayload` 类型替换为 `AICOConfig`，`loadAIAgent` handler 解析配置
- `frontend/agent-web/src/piu/runtimeStore.ts`：新增 AICOConfig 状态字段和配置设置方法
- `frontend/agent-web/src/entries/immersive.tsx`：新增 sessionStorage AICOConfig 读取逻辑
- `frontend/agent-web/src/piu/AIAgentPiuRuntime.tsx`：消费 AICOConfig，替换硬编码 icon/name/operators
- `frontend/agent-web/src/app/ImmersiveApp.tsx`：消费 AICOConfig，支持 operatorPosition 布局切换
- `frontend/agent-web/src/App.tsx`：local 模式不消费 AICOConfig，保持现状
- `frontend/agent-web/src/features/sidebar/components/Sidebar.tsx`：支持自定义 operators 注入和滚动
- `frontend/agent-web/src/features/chat/components/TurnBlock.tsx`：`BubbleActions` 支持 `answerOperator` 替换
- `frontend/agent-web/src/features/composer/components/MessageInput.tsx`：支持 `inputOperator` 替换 slash-hint 区域
- `frontend/agent-web/src/features/composer/components/QuickOperatorArea.tsx`：支持 `quickInfo` 配置
- `frontend/agent-web/src/features/guide/components/GuideArea.tsx`：支持 `guideInfo` 配置
- `frontend/agent-web/src/features/welcome/components/WelcomeState.tsx`：消费 icon/name/welcome 配置
- `frontend/agent-web/src/components/RightPaneLayout.tsx`：支持 `declaration` 配置和 `modalSize`

### 测试影响
- 新增 AICOConfig 校验函数的单元测试
- 新增各注入点 PIU 渲染的组件测试
- 新增 PANEL 状态切换测试
- 新增 operatorPosition 布局切换测试
- 新增配置缺失时默认行为不变的回归测试

### 依赖影响
- 无新增外部依赖，校验使用手写函数

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/aico-config-contract/spec.md`：新增，AICOConfig 类型定义、校验规则、注入路径和默认行为
- `openspec/specs/aico-piu-injection/spec.md`：新增，PIU 渲染注入点行为规格和 emit 数据契约
- `openspec/specs/aico-layout-mode/spec.md`：新增，布局模式和面板尺寸控制
- `openspec/specs/aico-display-control/spec.md`：新增，静态展示和行为开关
- `openspec/specs/agent-web-multi-host-modes/spec.md`：修改，loadAIAgent payload 变更

长期背景：
- `openspec/overview.md`：新增 AICOConfig 外部配置定制化能力的背景说明

设计视图：
- `openspec/designs/modules/agent-web.md`：新增/更新前端模块设计，包含 AICOConfig 消费、PIU 注入和布局模式
- `openspec/designs/adr/`：新增 ADR 记录"手写校验而非 TypeBox/Ajv"和"一次性读取无热更新"的技术决策
- `openspec/designs/spec-to-design-map.md`：新增四个 capability 到设计文档的导航

验证入口：
- AICOConfig 校验函数单元测试
- 各 PIU 注入点组件测试（operators/answerOperator/quickOperator/inputOperator/guideInfo）
- PANEL 状态切换测试
- operatorPosition LEFT/RIGHT 布局切换测试
- 配置缺失时默认行为不变回归测试
