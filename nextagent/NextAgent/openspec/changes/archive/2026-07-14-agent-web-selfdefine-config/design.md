## 背景和现状（Context）

NextAgent 前端目前有三种宿主模式：local（本地开发）、immersive（独立 URL 全屏）、collaborative（PIU 嵌入式面板）。三种模式共享同一套对话业务核心（ChatPage / ChatPageCore），但在 UI 外壳层各自硬编码了标题、图标、操作按钮、布局结构等。

现有代码结构：
- `App.tsx` / `ImmersiveApp.tsx` / `AIAgentPiuRuntime.tsx` 分别是三种模式的入口壳组件
- `Sidebar.tsx` 承载 local/immersive 的侧边栏导航（新建会话、搜索、收藏、设置、帮助、退出）
- `ChatPage.tsx` 是共享对话核心，包含 MessageList、ProcessPanel、BubbleActions、QuickOperatorArea、MessageInput、WelcomeState
- `RightPaneLayout.tsx` 提供对话区域布局框架，包含 header、footer、disclaimer
- `registerAIAgentPIU.tsx` 中 `loadAIAgent` handler 的 payload 临时定义为 `{ containerId?: unknown }`
- `PiuMessage.tsx` 已建立了 `Prel.autoLoad + piu.emit` 的 PIU 渲染模式
- `runtimeStore.ts` 是 collaborative 模式的外部 store，管理 display/layout/site/piu/session 状态

约束：
- AICOConfig 来自不可信边界（sessionStorage / PIU handler），需要 runtime 校验
- Local 模式不参与此功能
- 配置无热更新，一次性读取
- 图标使用 base64 编码

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 定义 AICOConfig 配置类型和校验规则，通过 sessionStorage（immersive）和 loadAIAgent handler（collaborative）注入
- 实现所有 PIU 渲染注入点：operators、answerOperator、quickInfo、inputOperator、guideInfo
- 实现 PANEL 状态模型和切换生命周期
- 实现 operatorPosition LEFT/RIGHT 布局模式切换
- 实现所有静态展示和行为开关字段
- 纯增量覆盖，不传配置时行为与当前完全一致

**非目标：**
- 不实现配置热更新
- 不实现 expandPanelPosition 的实际效果（预留字段）
- 不修改 local 模式的任何行为
- 不修改后端 API 或 stream 契约
- 不实现 activeIcon 字段的消费（预留）

## 设计决策（Decisions）

### D1: AICOConfig store 作为独立 external store

创建 `AICOConfigStore`（类似现有 `aiAgentPiuRuntimeStore`），作为 AICOConfig 的单一状态来源。采用 `useSyncExternalStore` 模式，与现有 runtimeStore 一致。

``+┌─────────────────────────────────────────────────┐
│              AICOConfigStore                      │
├─────────────────────────────────────────────────┤
│  snapshot: AICOConfig | null                     │
│  subscribe / getSnapshot                         │
│  setConfig(config: AICOConfig): void             │
│  clearConfig(): void                             │
├─────────────────────────────────────────────────┤
│  注入时机:                                        │
│  - immersive: entries/immersive.tsx 启动时读取    │
│    sessionStorage["AICOConfig"]                   │
│  - collaborative: registerAIAgentPIU.tsx 的       │
│    loadAIAgent handler 接收后设置                  │
│  - local: 不注入，snapshot 永远为 null             │
└─────────────────────────────────────────────────┘
```

选择独立 store 而非融入 runtimeStore 的理由：AICOConfig 在三种模式中都需要被消费（local 为 null），但 runtimeStore 只在 collaborative 模式存在。独立 store 让所有模式的组件统一通过 `useAICOConfig()` hook 获取配置，避免条件性依赖不同 store。

### D2: 手写校验函数而非 TypeBox/Ajv

AICOConfig 校验使用纯手写 TypeScript 函数，不引入 TypeBox/Ajv。理由：
- 前端打包体积敏感，Ajv runtime 约百 KB
- AICOConfig 字段类型简单（对象、字符串、枚举、数组），手写校验完全覆盖
- 校验逻辑与 `PiuMessage.tsx` 中 `piuNamePattern` 等现有手写校验风格一致

校验函数签名：`function validateAICOConfig(raw: unknown): AICOConfig | null`，返回 null 表示完全无效，返回 AICOConfig 表示已过滤无效字段后的有效配置。

### D3: 统一 PiuRenderer 组件

创建统一的 `PiuRenderer` 组件，封装 `Prel.autoLoad + piu.emit` 模式，供所有 AICOConfig 注入点复用。`PiuMessage.tsx` 保持不变，不做重构——它是 stream 结构化消息的渲染组件，职责不同于 AICOConfig 注入点。PiuRenderer 是新增独立组件，不依赖也不修改 PiuMessage。

```
┌─────────────────────────────────────────────────┐
│              PiuRenderer                         │
├─────────────────────────────────────────────────┤
│  Props:                                          │
│    piuInfo: PIUInfoItem                          │
│    extraPayload?: Record<string, unknown>        │
│      (theme, containerId, backFunc, sessionId,   │
│       runId, answer 等注入点特定数据)              │
│    containerStyle?: React.CSSProperties          │
│                                                  │
│  内部逻辑:                                        │
│  1. 生成唯一 containerId (useId)                 │
│  2. Prel.autoLoad(piuName, piuVersion)           │
│  3. piu.emit(renderFunc, {                       │
│       ...data, ...extraPayload,                  │
│       theme, containerId                         │
│     })                                           │
│  4. 无 Prel 时渲染 placeholder                    │
│  5. 卸载时清空容器 DOM 内容                        │
└─────────────────────────────────────────────────┘
```

### D4: PANEL 状态模型

在 AICOConfigStore 中增加 panel 状态字段：

```
type PanelType = 'CONVERSATION_PANEL' | 'CUSTOM_PANEL'

interface AICOConfigSnapshot {
  config: AICOConfig | null
  panelType: PanelType
  activePanelOperatorData: PIUInfoItem | null
  activeModalOperatorData: PIUInfoItem | null
}
```

- 点击 PANEL operator → `panelType = 'CUSTOM_PANEL'`, `activePanelOperatorData = operator.data`
- backFunc() 或新建会话 → `panelType = 'CONVERSATION_PANEL'`, `activePanelOperatorData = null`
- 点击 MODAL operator → `activeModalOperatorData = operator.data`（替换当前）
- 关闭 Modal → `activeModalOperatorData = null`
- 切换 PANEL 时先卸载当前（设为 null），再加载新的

### D5: operatorPosition 布局切换实现

在 `ImmersiveApp.tsx` 中根据 `operatorPosition` 选择渲染 `Sidebar` 布局还是顶部 bar 布局：

```
operatorPosition === 'RIGHT' || collaborative:
  ┌──────────────────────────────────────┐
  │ TopBar (icon, name, operators, ⋯, ×)│
  ├──────────────────────────────────────┤
  │ ConversationArea                      │
  │ (或 CustomPanel 如果 panelType)       │
  └──────────────────────────────────────┘

operatorPosition === 'LEFT' (local/immersive):
  ┌────────┬─────────────────────────────┐
  │ Sidebar│ ConversationArea             │
  │ (ops)  │ (或 CustomPanel 如果 panelType)│
  └────────┴─────────────────────────────┘
```

RIGHT 模式复用 collaborative 的 `PiuPanelHeader` 结构，但适配 local/immersive 的导航方式。

### D6: theme 传值格式

emit 数据中 `theme` 字段使用 HostTheme 值（`"lightday"` / `"evening"`），与 Prel site context 一致。只有 PIU 渲染时获取当前值，主题切换后已渲染的 PIU 不会收到新 theme（无热更新）。

### D7: answer 字段的内容提取

`answerOperator` 的 `answer` 字段从 `AnswerSegment[]` 中提取所有文本段（`kind === "text"` 和 `toolMessageType === "TEXT"` 的 structured segment），按 sequence 顺序拼接为纯文本字符串，排除 PIU、DSL、FILE、ACTION、OPERATOR 结构化段。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | AICOConfig 来自不可信边界，所有字段经手写校验后才能使用。base64 图标通过 `<img src>` 渲染，不执行代码。PIU 渲染通过 Prel 框架加载，不直接 eval。配置不包含身份/权限信息，不影响 Agent Scope / Owner Scope。 | 校验函数单元测试；注入恶意 payload 的安全测试 |
| 性能/容量 | 配置一次性读取，不引入运行时开销。PiuRenderer 使用 useId 生成 containerId，无冲突。operator 溢出通过 CSS overflow 滚动处理，不引入虚拟化。 | 配置加载性能测试；operator 溢出渲染测试 |
| 可靠性/恢复 | 配置校验失败时回退全部默认，不 crash。Prel 不可用时 PiuRenderer 渲染 placeholder。PANEL 切换失败不影响对话核心。backFunc 始终可用，确保用户不会卡在自定义面板。 | 配置无效时的回退测试；Prel 不可用时的 placeholder 测试 |
| 可维护性 | AICOConfigStore 独立于 runtimeStore，职责单一。PiuRenderer 统一复用，不重复 autoLoad/emit 逻辑。注入点通过 hook 消费配置，组件间无直接耦合。 | 架构检查；模块边界测试 |
| 可测试性 | 校验函数是纯函数，易于单元测试。PiuRenderer 可通过 mock Prel 测试。各注入点可通过配置驱动测试，无需真实 PIU 加载。 | 单元测试；组件测试；配置驱动集成测试 |
| 审计/可追溯性 | 配置校验失败时 emit console.warn。不引入额外日志/metric/tracing。PANEL 切换状态在 store 中可观察。 | console.warn 断言测试 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 无 AICOConfig 时行为不变 | T1 | 回归测试：不传配置时所有组件渲染与当前一致 |
| AICOConfig 校验规则 | T2 | 校验函数单元测试：有效/无效/部分无效输入 |
| immersive 从 sessionStorage 读取 | T3 | 组件测试：sessionStorage 含 AICOConfig 时配置生效 |
| collaborative 从 loadAIAgent 接收 | T4 | 组件测试：loadAIAgent payload 含 AICOConfig 时配置生效 |
| local 模式不消费配置 | T5 | 回归测试：local 模式不受 sessionStorage 影响 |
| operators 注入和溢出滚动 | T6 | 组件测试：OUTER/INNER operator 渲染 + 溢出滚动 |
| MODAL operator 单弹窗替换 | T7 | 组件测试：点击 MODAL operator 弹窗 + 替换 |
| PANEL operator 切换 + backFunc | T8 | 组件测试：PANEL 切换 + backFunc 返回 |
| answerOperator 替换 BubbleActions | T9 | 组件测试：answerOperator 渲染 + emit 数据包含 sessionId/runId/answer |
| quickInfo SELF_DEFINE 渲染 PIU | T10 | 组件测试：quickInfo SELF_DEFINE 渲染 PIU |
| inputOperator 替换 slash-hint | T11 | 组件测试：inputOperator 替换 + 尺寸约束 |
| guideInfo SELF_DEFINE 渲染 PIU | T12 | 组件测试：guideInfo SELF_DEFINE 渲染 PIU |
| operatorPosition LEFT/RIGHT 切换 | T13 | 组件测试：LEFT 有侧边栏 / RIGHT 无侧边栏有顶部 bar |
| modalSize 控制面板尺寸 | T14 | 组件测试：modalSize 覆盖默认宽度 |
| declaration false/true/object | T15 | 组件测试：三种 declaration 值的渲染 |
| clearStorage 控制会话恢复 | T16 | 组件测试：clearStorage true 不恢复 |
| showAskTime 控制时间戳 | T17 | 组件测试：showAskTime true 显示时间戳 |
| showThinkingChain 隐藏入口 | T18 | 组件测试：showThinkingChain false 隐藏入口 |
| icon/name/welcome/guideIcon 替换 | T19 | 组件测试：base64 图标和文本替换 |
| loadAIAgent payload 变更为 AICOConfig | T20 | 契约测试：loadAIAgent 接收 AICOConfig |

## 文档承载决策（Documentation Ownership）

- **行为契约**：
  - `openspec/specs/aico-config-contract/spec.md`：AICOConfig 类型定义、校验规则、注入路径、默认行为
  - `openspec/specs/aico-piu-injection/spec.md`：PIU 渲染注入点行为规格和 emit 数据契约
  - `openspec/specs/aico-layout-mode/spec.md`：布局模式和面板尺寸控制
  - `openspec/specs/aico-display-control/spec.md`：静态展示和行为开关
  - `openspec/specs/agent-web-multi-host-modes/spec.md`：loadAIAgent payload 变更

- **架构和跨模块设计**：
  - `openspec/designs/architecture/agent-web-frontend.md`：前端三种模式的 AICOConfig 消费流程、PIU 渲染注入机制、PANEL 状态机和布局切换

- **模块设计**：
  - `openspec/designs/modules/agent-web.md`：前端模块职责，包含 AICOConfigStore、PiuRenderer、各注入点组件的职责和依赖关系

- **ADR**：
  - `openspec/designs/adr/aico-config-handwritten-validation.md`：手写校验而非 TypeBox/Ajv 的决策
  - `openspec/designs/adr/aico-config-no-hot-reload.md`：一次性读取无热更新的决策

- **导航**：
  - `openspec/designs/spec-to-design-map.md`：四个新 capability + 一个修改 capability 到设计文档的导航

## 风险与取舍（Risks / Trade-offs）

- [PIU 渲染容器生命周期管理] → PiuRenderer 在组件卸载时需要通知 PIU 清理容器内容。当前 `PiuMessage.tsx` 未处理卸载清理。缓解：在 PiuRenderer 的 useEffect cleanup 中调用 `piu.emit("destroy", { containerId })` 或清空容器 DOM。

- [operator 溢出在 collaborative header 中的横向滚动] → header 空间有限，OUTER operator 过多时需要横向滚动，可能影响用户体验。缓解：通过 CSS `overflow-x: auto` 和隐藏滚动条样式实现，INNER 菜单收纳低频操作。

- [loadAIAgent payload BREAKING 变更] → 现有宿主可能只传 `{ containerId }`，新 payload 要求完整 AICOConfig。缓解：校验函数对 `containerId` 字段做向后兼容处理——如果 payload 只有 `containerId` 而没有其他 AICOConfig 字段，仍然正常工作（其他字段走默认值）。

- [answerOperator 性能] → 每个 assistant answer block 都会触发 `Prel.autoLoad + piu.emit`，长对话中可能有性能影响。缓解：Prel.autoLoad 有内部缓存，相同 piuName 不会重复加载；emit 是轻量操作。

## 迁移计划（Migration Plan）

- `loadAIAgent` payload 从 `{ containerId?: unknown }` 变更为 `AICOConfig`。现有 collaborative 宿主如果只传 `{ containerId }`，校验函数将其视为只含 containerId 的 AICOConfig，其余字段走默认值，行为不变。
- 不需要数据迁移或后端变更。
- 回滚策略：移除 AICOConfigStore 和相关消费代码，恢复 `LoadAIAgentPayload` 原始定义。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/aico-config-contract/spec.md`：新增 AICOConfig 类型定义、校验规则、注入路径和默认行为契约
- `openspec/specs/aico-piu-injection/spec.md`：新增 PIU 渲染注入点行为规格和 emit 数据契约
- `openspec/specs/aico-layout-mode/spec.md`：新增布局模式和面板尺寸控制
- `openspec/specs/aico-display-control/spec.md`：新增静态展示和行为开关
- `openspec/specs/agent-web-multi-host-modes/spec.md`：修改 loadAIAgent payload requirement
- `openspec/overview.md`：新增 AICOConfig 外部配置定制化能力背景
- `openspec/designs/architecture/agent-web-frontend.md`：新增前端 AICOConfig 消费流程、PIU 注入机制和 PANEL 状态机
- `openspec/designs/modules/agent-web.md`：新增/更新前端模块设计
- `openspec/designs/adr/aico-config-handwritten-validation.md`：手写校验决策
- `openspec/designs/adr/aico-config-no-hot-reload.md`：无热更新决策
- `openspec/designs/spec-to-design-map.md`：新增导航条目

## 待确认问题（Open Questions）

无。所有设计决策已在探索阶段与产品方确认闭合。
