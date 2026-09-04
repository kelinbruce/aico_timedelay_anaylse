

# 集成方界面定制能力指南

> 契约来源：`openspec/specs/aico-config-contract/spec.md`、`openspec/specs/aico-piu-injection/spec.md`、`openspec/specs/agent-web-multi-host-modes/spec.md`。架构层背景见 `openspec/designs/architecture/agent-web-host-modes.md`。本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。

> **状态基线（2026-08-13，`origin/main@4f27c4a9f`）**：当前事实由 owning stable/active OpenSpec、代码和测试交叉确认；active change 尚待归档时会明确标注。任务准入以 owning spec 与 roadmap 为准。

## 目的

本文按 7 类组织 40 个定制点（包含已实现、预留、类型已声明未接线与 UCD 目标），每项给出契约字段映射与实现位置，关键场景给出代码示例。

**不定义契约**：所有字段的完整 schema、scenario、约束由上述 spec 承载。本文只做 UCD 视角的组织、映射与场景示例。

## 读者

- **集成方开发者**：规划集成方案、编写接入代码
- **UCD 设计人员**：理解集成方可定制范围，设计宿主产品与 NextAgent 的视觉一致性
- **产品经理**：评估集成方定制能力边界

## 状态标注规则

- `[已实现]` / `[已实现-主干]`——契约已定义且代码已进入上述主干基线
- `[类型已声明/未接线]`——仅 TypeScript host shape 可表达，实际 `createHandlers()` 未返回该 handler
- `[UCD 设计建议]` / `[UCD目标/Clarify]`——设计目标或需决策项，不是现有 callable contract

## 定制能力总览

| 类别 | 项数 | 典型能力 |
|---|---|---|
| A. 主题与视觉定制 | 7 | icon/entranceIcon/guideIcon/name/switchTheme/lightIcon-darkIcon/activeIcon |
| B. 布局定制 | 4 | operatorPosition/modalSize/expandPanelPosition/docked-floating-maximized |
| C. 文案/i18n 定制 | 4 | welcome/declaration/switchLocale/disclaimerTip |
| D. 行为定制 | 7 | clearStorage/showAskTime/showThinkingChain/sendQuestionToLui/displayAIAgent/minimizeAIAgent/handleHistoricalChatReplay |
| E. 组件替换/PIU 注入 | 8 | quickInfo/guideInfo/operators/answerOperator/inputOperator/PIU 消息/DSL 消息/renderKnowledge |
| F. 宿主事件/回调 | 6 | OPERATOR/ACTION CustomEvent、panel open/close、nested PIU submit（目标）、userAction（仅类型）、`$stateChange.theme` |
| G. 基础设施 | 4 | containerId/sessionStorage/Prel 生命周期/site 上下文 |
| **合计** | **40** | 含预留、未接线与 UCD 目标；不能把合计数当成已实现数 |

---

## 定制能力空间分布

以下 3 张 mockup 按 HostMode 标注定制点在界面上的位置。编号对应下方各类别表格行；`—` 表示该模式不适用，目标/未接线项需结合状态列理解。

### local 模式

local 模式独立运行，无宿主框架。适用 18 项定制点（全局字段 + 组件替换 + CustomEvent）。

```
┌──────────────┬────────────────────────────────────┐
│ 侧边栏        │  对话区 / 欢迎状态                   │
│              │  ┌────────────────────────────────┐ │
│ [💬 新会话]   │  │ 欢迎状态                        │ │
│ [🔍 搜索]     │  │  [A3] guideIcon 品牌图标 72px   │ │
│ [⭐ 收藏]     │  │  [A4] name 品牌名称             │ │
│ [⚙️ 设置]     │  │  [C1] welcome 欢迎副标题        │ │
│              │  │  [E2] guideInfo 高频问题区       │ │
│  会话列表    │  │      (SELF_DEFINE → PIU 替换)   │ │
│  · 会话 A    │  └────────────────────────────────┘ │
│  · 会话 B    │  ┌────────────────────────────────┐ │
│              │  │ 消息流                          │ │
│              │  │  USER 气泡 [D2] showAskTime     │ │
│              │  │  ASSISTANT 气泡                 │ │
│              │  │    ├ 过程面板                   │ │
│              │  │    │  [D3] showThinkingChain    │ │
│              │  │    │    "完整过程"按钮显隐       │ │
│              │  │    ├ [E4] answerOperator        │ │
│              │  │    │    答案操作区(PIU 可替换)   │ │
│              │  │    ├ [E6] PIU 消息内嵌渲染      │ │
│              │  │    ├ [E7] DSL 消息渲染          │ │
│              │  │    ├ [F1] OPERATOR 按钮组       │ │
│              │  │    │    → CustomEvent 通知集成方 │ │
│              │  │    ├ [F2] ACTION 卡片           │ │
│              │  │    │    → 自动 dispatch Event   │ │
│              │  │    └ [F3] handleExpandPanel     │ │
│              │  │         Open/Close 回调         │ │
│              │  │      [F4] onPiuSubmit (缺口 B1) │ │
│              │  └────────────────────────────────┘ │
│              │  ┌────────────────────────────────┐ │
│              │  │ Composer                       │ │
│              │  │  [E1] quickInfo skill 区       │ │
│              │  │      (SELF_DEFINE → PIU 替换)  │ │
│              │  │  [E5] inputOperator            │ │
│              │  │      composer 操作区(PIU 替换) │ │
│              │  └────────────────────────────────┘ │
│ [C2] declaration 免责声明                          │
│      [C4] disclaimerTip Tooltip                   │
└──────────────┴────────────────────────────────────┘

不适用（local 无宿主框架）：
  A1 icon、A2 entranceIcon、A5 switchTheme、A7 activeIcon
  B1-B4 全部布局定制
  C3 switchLocale
  D1 clearStorage、D4 sendQuestionToLui、D5 displayAIAgent、D6 minimizeAIAgent
  E3 operators（local 不注入自定义按钮）
  F5 userAction、F6 $stateChange
  G1 containerId、G3 Prel 生命周期、G4 site 上下文
```

### immersive 模式

immersive 模式全页面嵌入宿主产品，从 `sessionStorage["AICOConfig"]` 读取配置。在 local 基础上新增 4 项（header 图标 + 布局 + operators + 注入路径）。

```
┌──────────────┬────────────────────────────────────┐
│ 侧边栏 header │  对话区 / 欢迎状态                   │
│ [A1] icon    │  ┌────────────────────────────────┐ │
│  header logo │  │ 欢迎状态                        │ │
├──────────────┤  │  [A3] guideIcon [A4] name      │ │
│ [💬 新会话]   │  │  [C1] welcome [E2] guideInfo   │ │
│ [🔍 搜索]     │  └────────────────────────────────┘ │
│ [⭐ 收藏]     │  ┌────────────────────────────────┐ │
│              │  │ 消息流（同 local，含 D2/D3/      │ │
│ [E3] operators│  │  E4/E6/E7/F1/F2/F3/F4）        │ │
│  自定义按钮   │  └────────────────────────────────┘ │
│  · [A6] 双主题│  ┌────────────────────────────────┐ │
│    图标       │  │ Composer（含 E1/E5）            │ │
│  · OUTER 直接│  └────────────────────────────────┘ │
│    渲染       │                                    │
│  · INNER 更多│  [B1] operatorPosition=LEFT        │
│    菜单       │    （=RIGHT 时顶部栏替代侧栏）       │
│ [⚙️ 设置]     │                                    │
├──────────────┴────────────────────────────────────┤
│  [G2] sessionStorage["AICOConfig"] 注入路径        │
└────────────────────────────────────────────────────┘

较 local 新增：A1 icon、B1 operatorPosition、E3 operators、G2 sessionStorage
不适用：A2/A5/A7、B2-B4、C3、D1/D4/D5/D6、F5/F6、G1/G3/G4
```

### piu 模式（collaborative）

piu 模式作为面板嵌入宿主页面，通过 Prel 框架加载。在 immersive 基础上新增 18 项（PIU handler 全集 + 协作面板定制 + Prel 生命周期）。

```
┌─ 宿主页面 ─────────────────────────────────────────────────┐
│                                                          │
│  ┌─ PIU 入口 ─┐    ┌─ 宿主页面内容 ──────────────────┐    │
│  │ [A2]       │    │                                  │    │
│  │ entrance   │    │  宿主产品自有内容                │    │
│  │ Icon       │    │                                  │    │
│  └────────────┘    │                                  │    │
│       │ 点击       │                                  │    │
│       ▼            │                                  │    │
│  ┌─ PIU 面板（docked）──────────────────────────────┐    │
│  │  [B4] docked/floating/maximized 形态切换        │    │
│  │  [B2] modalSize 面板尺寸                        │    │
│  │  ┌─ 面板 header ─────────────────────────────┐  │    │
│  │  │ [A1] icon  │ 新会话 历史 搜索 │ 最小化  │  │    │
│  │  │            │                │ [D6]    │  │    │
│  │  └────────────┴────────────────┴─────────┘  │    │
│  │  ┌─ 对话区 ───────────────────────────────┐  │    │
│  │  │ 欢迎状态                                │  │    │
│  │  │  [A3] guideIcon 60px [A4] name          │  │    │
│  │  │  [C1] welcome [E2] guideInfo            │  │    │
│  │  └────────────────────────────────────────┘  │    │
│  │  ┌─ 消息流 ───────────────────────────────┐  │    │
│  │  │  （含 D2/D3/E4/E6/E7/F1/F2/F3/F4，      │  │    │
│  │  │   同 local/immersive）                  │  │    │
│  │  │  [E3] operators（piu 模式同样可用）     │  │    │
│  │  └────────────────────────────────────────┘  │    │
│  │  ┌─ Composer ─────────────────────────────┐  │    │
│  │  │  [E1] quickInfo [E5] inputOperator     │  │    │
│  │  └────────────────────────────────────────┘  │    │
│  │  [C2] declaration + [C4] disclaimerTip      │    │
│  │  [B3] expandPanelPosition (reserved)        │    │
│  └──────────────────────────────────────────────┘    │
│                                                          │
│  PIU handler（宿主通过 Prel 调用）：                    │
│    [A5] switchTheme  [C3] switchLocale                  │
│    [D4] sendQuestionToLui  [D5] displayAIAgent          │
│    [D6] minimizeAIAgent                                  │
│    [F5] userAction.febsMemuEvent/logout（仅类型声明）   │
│    [F6] $stateChange.theme（当前仅 reload）             │
│                                                          │
│  基础设施：                                              │
│    [A7] activeIcon (reserved)                           │
│    [D1] clearStorage                                    │
│    [G1] containerId  [G3] Prel 生命周期  [G4] site 上下文│
└──────────────────────────────────────────────────────────┘

较 immersive 新增：A2/A5/A7、B2/B3/B4、C3、D1/D4/D5/D6、F5/F6、G1/G3/G4
```

---

## A. 主题与视觉定制（7 项）

| 定制点 | 契约字段 | 定制内容 | HostMode 适用 | 实现位置 | UCD 设计要点 |
|---|---|---|---|---|---|
| 顶栏/侧栏 header 图标 | `AICOConfig.icon` | base64 替换 header logo | immersive/piu | `AIAgentPiuRuntime.tsx` PiuPanelHeader、`useIconWithFallback` | `[已实现]` 默认 NextAgent logo |
| 协作式入口按钮图标 | `AICOConfig.entranceIcon` | base64 替换 PIU 入口小 logo | piu | `AIAgentPiuRuntime.tsx` AIAgentEntrance | `[已实现]` |
| Welcome 品牌图标 | `AICOConfig.guideIcon` | base64 替换欢迎页 logo（72px local/immersive，60px piu） | 全部 | `WelcomeState.tsx`、`iconUtils.ts` | `[已实现]` 见 `agent-web-welcome-block-styles` |
| 品牌名称（wordmark） | `AICOConfig.name` | 替换硬编码 "NextAgent" wordmark 文本 | 全部 | `WelcomeState.tsx` L13-49 | `[已实现]` 默认 "NextAgent" |
| 主题切换 | PIU handler `switchTheme` | lightday/evening 切换，映射 AntD token + `data-theme` | piu | `registerAIAgentPIU.tsx` L84-90 | `[已实现]` |
| Operator 明暗双主题图标 | `Operator.lightIcon/darkIcon` | 每个 operator 提供明暗两套图标 | 全部 | `OperatorsArea.tsx` L94-98、`OperatorButton.tsx` | `[已实现]` |
| 预留 activeIcon | `AICOConfig.activeIcon`（reserved） | 预留字段，本期不消费 | — | 未消费 | `[UCD 设计建议]` spec 明确 reserved |

## B. 布局定制（4 项）

| 定制点 | 契约字段 | 定制内容 | HostMode 适用 | 实现位置 | UCD 设计要点 |
|---|---|---|---|---|---|
| 顶栏 vs 侧栏布局 | `layoutConfig.operatorPosition` (LEFT/RIGHT) | LEFT=侧栏；RIGHT=顶部栏替代侧栏 | immersive | `ImmersiveApp.tsx`、`aico-layout-mode/spec.md` | `[已实现]` 见 09 §1.4 |
| 协作面板尺寸 | `AICOConfig.modalSize` (width/height/minWidth) | 定制 docked 面板宽/高/最小宽 | piu | `registerAIAgentPIU.tsx` L118-123、`PiuDockedResizeHandle` | `[已实现]` |
| 扩展面板位置 | `layoutConfig.expandPanelPosition` (LEFT/RIGHT) | 预留字段，本期不改变渲染 | — | `aico-layout-mode/spec.md` L60-68 | `[UCD 设计建议]` spec 显式 reserved |
| 协作面板形态切换 | PIU 内部状态 docked/floating/maximized | 用户切换面板形态 | piu | `AIAgentPiuRuntime.tsx` L240-260、`layout.ts` | `[已实现]` 见 09 §1.4 |

## C. 文案/i18n 定制（4 项）

| 定制点 | 契约字段 | 定制内容 | HostMode 适用 | 实现位置 | UCD 设计要点 |
|---|---|---|---|---|---|
| 欢迎副标题 | `AICOConfig.welcome` | 替换 i18n 默认副标题 `welcome.subtitle` | 全部 | `WelcomeState.tsx` L13-49 | `[已实现]` 默认 i18n 文案 |
| 底部免责声明 | `AICOConfig.declaration` (false/true/{title,tips}) | 隐藏/显示/自定义免责声明文案+提示 | 全部 | `RightPaneLayout`、`aico-display-control/spec.md` L46-68 | `[已实现]` |
| 国际化语言切换 | PIU handler `switchLocale` (zh-cn/en-us) | 宿主切换中英文 | piu | `registerAIAgentPIU.tsx` L77-83 | `[已实现]` 见 09 §1.4 |
| 免责声明 Tooltip | i18n `rightPane.disclaimerTip` | 鼠标悬停展示详细提示 | 全部 | `agent-web-right-pane-styles/spec.md` L26-32 | `[已实现]` i18n key 已定义 |

## D. 行为定制（7 项）

| 定制点 | 契约字段 | 定制内容 | HostMode 适用 | 实现位置 | UCD 设计要点 |
|---|---|---|---|---|---|
| 会话恢复开关 | `AICOConfig.clearStorage` | true 时协作式不恢复上次会话 | piu | `registerAIAgentPIU.tsx` L117 | `[已实现]` |
| 用户消息时间戳 | `AICOConfig.showAskTime` | 控制用户气泡是否显示时间戳 | 全部 | `aico-display-control/spec.md` L88-101 | `[已实现]` |
| 完整过程入口显隐 | `AICOConfig.showThinkingChain` | false 时隐藏 ProcessPanel "完整过程"按钮 | 全部 | `aico-display-control/spec.md` L104-118 | `[已实现]` |
| 宿主注入问题 | PIU handler `sendQuestionToLui({question,isSend})` | 宿主页面→对话注入问题，可选直接发送 | piu | `registerAIAgentPIU.tsx` L91-100、`runtimeStore.ts` | `[已实现]` 见 09 场景 25 |
| PIU 显示状态控制 | PIU handler `displayAIAgent({showEntrance,showPanel})` | 宿主控制入口 logo 和面板的显示/隐藏 | piu | `registerAIAgentPIU.tsx` L61-73 | `[已实现]` |
| PIU 最小化 | PIU handler `minimizeAIAgent` + `nextagent:piu-display-change` CustomEvent | 宿主触发面板最小化 | piu | `registerAIAgentPIU.tsx` L37-42,L74-76、`MinimizedInputBox` | `[已实现]` |
| 历史聊天回放 | PIU handler `handleHistoricalChatReplay({piuName,piuVersion,method,chatId,data})` | 宿主注入 PIU 历史内容；按 `chatId` 去重，自动打开并恢复协作面板，在消息列表上方共享滚动区展示 | piu | `registerAIAgentPIU.tsx`、`HistoricalChatReplayView.tsx`、`historicalChatReplayStore.ts` | `[已实现-主干]` 仅进程内 browser view state；关闭面板、切换会话或新建会话时清空，最小化时保留；不写入 Message/Event/history，也不参与分享、举报、派生、标注、重试或编辑 |

## E. 组件替换/PIU 注入（8 项）

| 定制点 | 契约字段 | 定制内容 | HostMode 适用 | 实现位置 | UCD 设计要点 |
|---|---|---|---|---|---|
| Skill 区 PIU 替换 | `AICOConfig.quickInfo.type = SELF_DEFINE` | 用 PIU 替换整个 SkillSelector 区域 | 全部 | `QuickOperatorArea.tsx` L17-39 | `[已实现]` 见 composer.md |
| 高频问题区 PIU 替换 | `AICOConfig.guideInfo.type = SELF_DEFINE` | 用 PIU 完全替换整个 GuideArea | 全部 | `GuideArea.tsx` L15-32 | `[已实现]` |
| 自定义按钮注入 | `AICOConfig.operators` (Operator[]) | 注入自定义按钮到侧栏/header/更多菜单，支持 MODAL/PANEL 两类 | immersive/piu | `OperatorsArea.tsx`、`ImmersiveApp.tsx`、`aico-piu-injection/spec.md` | `[已实现]` 见 09 §1.4 |
| 答案操作区 PIU 替换 | `AICOConfig.answerOperator` (PIUInfoItem) | 替换默认 BubbleActions，透传 sessionId/runId/answer | 全部 | `PiuRenderer.tsx`、`aico-piu-injection/spec.md` L122-144 | `[已实现]` |
| Composer 操作区 PIU 替换 | `AICOConfig.inputOperator` (PIUInfoItem) | 替换 composer slash-hint 区域 | 全部 | `aico-piu-injection/spec.md` | `[已实现]` |
| PIU 消息内嵌渲染 | `toolMessageType: "PIU"` + `PiuMessage` 组件 | ANSWER 事件携带 PIU 时自动加载渲染 | 全部 | `agent-web-structured-message-rendering/spec.md` L144-165、`PiuMessage.tsx` | `[已实现]` 见 09 §3.4.5 |
| DSL 消息渲染 | `toolMessageType: "DSL"` + `<DSLEngine>` | 后端返回 DSL 时直接用 DSL 引擎渲染 | 全部 | `agent-web-structured-message-rendering/spec.md` L130-134 | `[已实现]` |
| Knowledge 列表渲染 | PIU handler `renderKnowledge(payload)` | 在指定 `containerId` 独立渲染知识源列表 | piu | `registerAIAgentPIU.tsx`、`KnowledgeSourceList.tsx` | `[已实现-主干]` handler 已注册，并独立管理 React root |

## F. 宿主事件/回调（6 项）

| 定制点 | 契约字段 | 定制内容 | HostMode 适用 | 实现位置 | UCD 设计要点 |
|---|---|---|---|---|---|
| OPERATOR 按钮事件 | `toolMessageType: "OPERATOR"` → `document.dispatchEvent(CustomEvent)` | ANSWER 渲染按钮组，点击 dispatch CustomEvent 通知集成方 | 全部 | `OperatorButtons.tsx` L64、`agent-web-structured-message-rendering/spec.md` L122-128 | `[已实现-主干/需安全加固]` 基础 dispatch 已存在；模型可控 event key 的 allowlist、宿主注册、scope 与必要确认仍为 `Clarify` |
| ACTION 事件 | `toolMessageType: "ACTION"` → `document.dispatchEvent(CustomEvent(key))` | ANSWER 携带 ACTION 时自动 dispatch 多个 CustomEvent | 全部 | `ActionCard.tsx` L27-39、`agent-web-structured-message-rendering/spec.md` L116-120 | `[已实现-主干/需安全加固]` live re-render/remount 与 history replay 都可能重复 dispatch；catalog/allowlist、history 禁派发或 live-only at-most-once/idempotency 未冻结前不得扩大发送面 |
| PIU 扩展面板回调 | `handleExpandPanelOpen/Close/expandPanelId` 注入 `piu.emit` payload | PIU 组件调用回调打开/关闭扩展面板并自行渲染 | 全部 | `agent-web-expand-panel/spec.md` L294-310、`PiuMessage.tsx` | `[已实现]` 见 09 §3.4.5 场景 20 |
| nested PIU submit | `onPiuSubmit`（暂定 UCD 名称） | Expand Panel 内 ToolMessageType PIU 将受控配置反馈给 Agent | 全部 | 当前 payload 无 submit callback | `[UCD目标/Clarify]` 应走 shared composer/request owner，不是 `sendQuestionToLui` 宿主回调 |
| 宿主菜单事件 | `piu.attach` shape 的 `userAction.febsMemuEvent` + `logout` | 计划承接宿主框架菜单事件与退出 | piu | `host/prel.ts` 仅有类型；`createHandlers()` 未返回 `userAction` | `[类型已声明/未接线]` 不可作为当前集成 API 使用 |
| $stateChange 状态变更 | `piu.attach` 的 `$stateChange.theme` | theme 变化时重新加载页面 | piu | `registerAIAgentPIU.tsx` `createHandlers()` | `[已实现-主干]` 当前仅 `theme: location.reload()`，不是通用状态字典 |

## G. 基础设施（4 项）

| 定制点 | 契约字段 | 定制内容 | HostMode 适用 | 实现位置 | UCD 设计要点 |
|---|---|---|---|---|---|
| 宿主容器 ID | `AICOConfig.containerId` | 宿主指定入口 logo 渲染位置 | piu | `registerAIAgentPIU.tsx` L110,L125 | `[已实现]` |
| PIU 注入路径 | `sessionStorage["AICOConfig"]` | 沉浸式从 sessionStorage 读取 AICOConfig | immersive | `aico-config-contract/spec.md` L64-66 | `[已实现]` |
| Prel/PIU 生命周期 | `Prel.start`/`piu.attach`/`loadAIAgent` | 宿主通过 Prel 框架加载并启动 PIU | piu | `registerAIAgentPIU.tsx` L27-35 | `[已实现]` 见 09 §1.4 |
| 宿主站点上下文 | `site.session/user/locale/theme`（Prel 提供） | 宿主通过 Prel 注入会话/用户/语言/主题 | piu | `registerAIAgentPIU.tsx` L29、`normalizeSiteContext` | `[已实现]` 见 09 §1.4 |

---

## HostMode 布局对比

3 种宿主模式的整体布局差异并排对比。各模式独有的定制区域用 `★` 标注。

```
local                          immersive                      piu (collaborative)
┌──────────┬────────────┐     ┌──────────┬────────────┐     ┌─ 宿主页面 ──────────────┐
│ 侧边栏    │ 对话区      │     │[A1]★icon │ 对话区      │     │ ┌入口┐ ┌宿主内容─────┐ │
│          │            │     │  header  │            │     │ │[A2]│ │             │ │
│ [新会话]  │ 欢迎状态    │     │ [新会话]  │ 欢迎状态    │     │ │★  │ │             │ │
│ [搜索]    │ 消息流      │     │ [搜索]    │ 消息流      │     │ └──┬─┘ │             │ │
│ [收藏]    │ Composer   │     │ [收藏]    │ Composer   │     │    ▼   │             │ │
│          │            │     │          │            │     │ ┌PIU 面板(docked)─────┐ │
│          │            │     │[E3]★     │            │     │ │ [B4]★ 形态切换     │ │
│          │            │     │ operators│            │     │ │ [B2]★ 尺寸         │ │
│          │            │     │ ★自定义  │            │     │ │ ┌对话区┐ ┌Composer┐│ │
│          │            │     │  按钮    │            │     │ │ │消息流 │ │       ││ │
│ [设置]    │            │     │ [设置]   │            │     │ │ └──────┘ └───────┘│ │
│          │            │     │          │            │     │ └────────────────────┘ │
│          │            │     │[B1]★     │            │     │                      │
│          │            │     │operator- │            │     │ PIU handler ★：       │
│          │            │     │Position  │            │     │  switchTheme/         │
│          │            │     │(LEFT/    │            │     │  switchLocale/        │
│          │            │     │ RIGHT)   │            │     │  sendQuestionToLui/  │
│          │            │     │          │            │     │  displayAIAgent/     │
│          │            │     │[G2]★     │            │     │  minimizeAIAgent     │
│          │            │     │sessionSt-│            │     │                      │
│          │            │     │orage 注入│            │     │ [G3]★ Prel 生命周期  │
│          │            │     │          │            │     │ [G4]★ site 上下文    │
└──────────┴────────────┘     └──────────┴────────────┘     └──────────────────────┘

视口占用：100%                  视口占用：100%（整页）            视口占用：docked/floating/
                                                              maximized 子区域
认证：本地                      认证：宿主托管                    认证：宿主托管
配置来源：默认                   配置来源：★ sessionStorage        配置来源：★ Prel 框架
```

**关键差异**：
- **local**：独立运行，无宿主框架，定制能力最有限（18 项）
- **immersive**：全页面嵌入，从 sessionStorage 读取配置，新增 header 图标 + operators + 布局（22 项）
- **piu**：面板嵌入宿主页面，通过 Prel 框架加载，文档中列举的定制点最多；预留、未接线与 UCD 目标不计为已实现覆盖

---

## HostMode × 定制能力适用矩阵

3 种宿主模式（local/immersive/piu）的适用情况如下。矩阵只表达作用范围，能否调用仍以每项状态为准。

### local 模式

适用 AICOConfig 全局字段 + 组件替换 + CustomEvent：

| 类别 | 适用项 |
|---|---|
| A | guideIcon、name、lightIcon/darkIcon |
| C | welcome、declaration、disclaimerTip |
| D | showAskTime、showThinkingChain |
| E | quickInfo、guideInfo、answerOperator、inputOperator、PIU 消息、DSL 消息 |
| F | OPERATOR CustomEvent、ACTION CustomEvent、handleExpandPanelOpen/Close、onPiuSubmit(缺口) |

### immersive 模式

local 全部能力 + 布局定制 + operators 注入 + sessionStorage：

| 新增类别 | 新增项 |
|---|---|
| A | icon |
| B | operatorPosition |
| G | sessionStorage 注入路径 |

> immersive 模式从 `sessionStorage["AICOConfig"]` 读取配置。

### piu 模式

immersive 全部能力 + PIU handler 全集 + 协作面板定制 + Prel 生命周期：

| 新增类别 | 新增项 |
|---|---|
| A | entranceIcon、switchTheme、activeIcon(reserved) |
| B | modalSize、expandPanelPosition(reserved)、docked-floating-maximized |
| C | switchLocale |
| D | clearStorage、sendQuestionToLui、displayAIAgent、minimizeAIAgent、handleHistoricalChatReplay |
| E | `renderKnowledge`（piu handler；`operators` 已在 immersive 中提供） |
| F | userAction.febsMemuEvent/logout（仅类型声明）、`$stateChange.theme`（reload） |
| G | containerId、Prel 生命周期、site 上下文 |

---

## 关键场景示例

### 场景 1：沉浸式注入自定义 operators

集成方在沉浸式模式下注入自定义按钮到侧栏或顶部栏。

**before（默认侧栏，无自定义按钮）**：
```
┌──────────────┬──────────────────┐
│ [A1] header  │  对话区            │
├──────────────┤                  │
│ [💬 新会话]   │                  │
│ [🔍 搜索]     │                  │
│ [⭐ 收藏]     │                  │
│              │                  │
│  会话列表    │                  │
│              │                  │
│ [⚙️ 设置]     │                  │
└──────────────┴──────────────────┘
```

**after（注入 operators，OUTER 直接渲染 + INNER 更多菜单）**：
```
┌──────────────┬──────────────────┐
│ [A1] header  │  对话区            │
├──────────────┤                  │
│ [💬 新会话]   │                  │
│ [🔍 搜索]     │                  │
│ [⭐ 收藏]     │                  │
│              │                  │
│ ─ operators ─│                  │
│ [🔧 网络诊断] │  ← OUTER 直接渲染 │
│ [📊 配置审计] │  ← OUTER 直接渲染 │
│ [⋯ 更多]     │  ← INNER 菜单    │
│              │                  │
│  会话列表    │                  │
│              │                  │
│ [⚙️ 设置]     │                  │
└──────────────┴──────────────────┘
```

```json
// sessionStorage["AICOConfig"]
{
  "layoutConfig": {
    "operatorPosition": "LEFT"
  },
  "operators": [
    {
      "enName": "networkDiagnose",
      "zhName": "网络诊断",
      "lightIcon": "data:image/svg+xml;base64,...",
      "darkIcon": "data:image/svg+xml;base64,...",
      "position": "OUTER",
      "type": "MODAL",
      "data": {
        "piuName": "network-diagnose-panel",
        "piuVersion": "1.0.0",
        "method": "render"
      }
    }
  ]
}
```

说明：
- `operatorPosition=LEFT` 时 operator 插入侧边栏（收藏下方、设置上方）
- `position=OUTER` 直接渲染按钮，`INNER` 放入"更多"菜单
- `type=MODAL` 点击弹出单例模态，`type=PANEL` 替换对话区（含 backFunc 回调）
- 完整 schema 见 `aico-piu-injection/spec.md`

### 场景 2：PIU 模式替换高频问题区

集成方用自定义 PIU 组件替换默认高频问题区。

**before（默认高频问题区，SKILL_LIST/absent）**：
```
┌─ 欢迎状态 ──────────────────────┐
│  [A3] NextAgent logo (72px)     │
│  [A4] NextAgent                 │
│  [C1] 智能运维助手，随时服务     │
│                                │
│  ─ 高频问题 ──────────────────  │
│  │ 📌 如何查看告警统计？        │  ← 默认 HighFrequencyQuestions
│  │ 📌 如何配置巡检规则？        │     数据来源：frequent-question API
│  │ 📌 如何诊断小区掉线？        │     + i18n fallback
│  └─────────────────────────────│
└────────────────────────────────┘
```

**after（guideInfo.type = SELF_DEFINE，PIU 替换）**：
```
┌─ 欢迎状态 ──────────────────────┐
│  [A3] NextAgent logo (72px)     │
│  [A4] NextAgent                 │
│  [C1] 智能运维助手，随时服务     │
│                                │
│  ─ custom-quick-actions (PIU)─ │
│  │ ┌─ 快捷操作 ──────────────┐ │  ← PIU 组件完全替换
│  │ │ 🔧 一键诊断  📊 巡检报告│ │     guideInfo.type=SELF_DEFINE
│  │ │ 📋 工单查询  ⚙️ 配置下发│ │     window.Prel.autoLoad
│  │ └─────────────────────────┘ │
│  └─────────────────────────────│
└────────────────────────────────┘
```

```json
// sessionStorage["AICOConfig"]
{
  "guideInfo": {
    "type": "SELF_DEFINE",
    "data": {
      "piuName": "custom-quick-actions",
      "piuVersion": "1.0.0",
      "method": "render"
    }
  }
}
```

```typescript
// 宿主页面注册 PIU 组件包
window.Prel.autoLoad('custom-quick-actions', '1.0.0');
```

说明：
- `guideInfo.type=SELF_DEFINE` 时 `GuideArea.tsx` 渲染 `PiuRenderer` 替代默认 `HighFrequencyQuestions`
- PIU 组件默认通过 whole-content payload 接收 host fields；受控例外 `dte-bi-agent` 展开 object-shaped `content.data`。两种路径都由 `PiuMessage` 后置注入 `wrapperId`、`containerId`、open/close callbacks 与 `expandPanelId`
- 同理 `quickInfo.type=SELF_DEFINE` 可替换 SkillSelector 区域

### 场景 3：定制欢迎语与品牌

集成方定制欢迎页品牌 logo、名称、副标题。

**before（默认品牌）**：
```
┌─ 欢迎状态 ──────────────────────┐
│                                │
│       ┌─────────┐              │
│       │ [A3]    │              │
│       │ NextAgent│             │  ← guideIcon: 默认 NextAgent logo
│       │  logo   │              │
│       └─────────┘              │
│       NextAgent                │  ← name: 默认 "NextAgent"
│  智能运维助手，随时为您服务     │  ← welcome: 默认 i18n subtitle
│                                │
│  ─ 高频问题 ──────────────────  │
└────────────────────────────────┘
```

**after（定制品牌）**：
```
┌─ 欢迎状态 ──────────────────────┐
│                                │
│       ┌─────────┐              │
│       │ [A3]    │              │
│       │ NetOps  │              │  ← guideIcon: base64 自定义 logo
│       │ Assistant│             │
│       └─────────┘              │
│       NetOps Assistant         │  ← name: "NetOps Assistant"
│  网络运维智能助手，随时为您服务 │  ← welcome: 自定义副标题
│                                │
│  ─ 高频问题 ──────────────────  │
└────────────────────────────────┘

同步定制（非欢迎页）：
  [A1] icon         → 顶栏/侧栏 header logo（immersive/piu）
  [A2] entranceIcon → PIU 入口小 logo（piu）
```

```json
// sessionStorage["AICOConfig"]
{
  "name": "NetOps Assistant",
  "welcome": "网络运维智能助手，随时为您服务",
  "guideIcon": "data:image/svg+xml;base64,...",
  "icon": "data:image/svg+xml;base64,...",
  "entranceIcon": "data:image/svg+xml;base64,..."
}
```

说明：
- `name` 替换硬编码 "NextAgent"（wordmark 文本）
- `welcome` 替换 i18n 默认副标题 `welcome.subtitle`
- `guideIcon` 替换欢迎页品牌 logo（72px local/immersive，60px piu）
- `icon` 替换顶栏/侧栏 header logo（immersive/piu）
- `entranceIcon` 替换协作式入口小 logo（piu）
- 所有图标字段有 fallback：未提供时用内置 NextAgent logo

### 场景 4：宿主控制 PIU 面板生命周期

集成方在宿主页面控制 PIU 面板的显示、最小化、注入问题。

**状态 1：面板隐藏（仅入口 logo）**：
```
┌─ 宿主页面 ──────────────────────────┐
│                                    │
│  ┌─ PIU 入口 ──┐   宿主页面内容      │
│  │ [A2]        │                   │
│  │ entranceIcon│                   │
│  └─────────────┘                   │
│  [D5] displayAIAgent               │
│   { showEntrance:true,             │
│     showPanel:false }              │
└────────────────────────────────────┘
```

**状态 2：面板显示（docked）**：
```
┌─ 宿主页面 ──────────────────────────┐
│  ┌─ PIU 面板 ─────────┐ 宿主内容    │
│  │ [B4] docked        │            │
│  │ ┌header──────────┐ │            │
│  │ │[A1]icon│新会话 历史│最小化│ │  │
│  │ └────────┴──────┴─────┘ │       │
│  │ ┌对话区──────────────┐ │       │
│  │ │ 消息流              │ │       │
│  │ └────────────────────┘ │       │
│  │ ┌Composer────────────┐ │       │
│  │ │ 输入框      [发送]  │ │       │
│  │ └────────────────────┘ │       │
│  └──────────────────────┘            │
│  [D5] displayAIAgent               │
│   { showEntrance:true,             │
│     showPanel:true }               │
└────────────────────────────────────┘
```

**状态 3：面板最小化（MinimizedInputBox）**：
```
┌─ 宿主页面 ──────────────────────────┐
│                                    │
│  ┌─ 最小化输入框 ───────────────┐   │
│  │ [D6] minimizeAIAgent         │   │
│  │ 💬 输入消息…        [发送]    │   │
│  └──────────────────────────────┘   │
│                                    │
│  宿主页面内容（全宽可见）            │
│                                    │
└────────────────────────────────────┘
```

**状态 4：注入问题（sendQuestionToLui）**：
```
┌─ 宿主页面 ──────────────────────────┐
│  ┌─ PIU 面板 ─────────┐ 宿主内容    │
│  │ ┌对话区──────────┐ │            │
│  │ │ 🧑 查询小区告警  │ │  ← [D4]   │
│  │ │                │ │   sendQues│
│  │ │ 🤖 正在查询...  │ │   tionTo  │
│  │ │                │ │   Lui     │
│  │ └────────────────┘ │   isSend= │
│  │ ┌Composer────────┐ │   true    │
│  │ │ 查询小区告警    │ │   自动发送│
│  │ └────────────────┘ │            │
│  └────────────────────┘            │
└────────────────────────────────────┘
```

```typescript
// piu 为宿主按 Prel.start(..., callback) 生命周期取得的 PIU handle；
// Prel.start 本身是 callback API，不返回可 await 的 handle。

// 显示面板（入口 logo 与面板独立控制）
piu.emit('displayAIAgent', { showEntrance: true, showPanel: true });

// 最小化面板（与 displayAIAgent 独立，showPanel 保持 true）
piu.emit('minimizeAIAgent');

// 注入问题并自动发送
piu.emit('sendQuestionToLui', { question: '查询小区告警', isSend: true });

// 切换主题（lightday → evening）
piu.emit('switchTheme', 'evening');

// 切换语言（zh-cn → en-us）
piu.emit('switchLocale', 'en-us');
```

说明：
- `displayAIAgent` 控制入口 logo 与面板的显隐，两者独立
- `minimizeAIAgent` 触发最小化，与 `displayAIAgent` 独立（showPanel 保持 true）
- `sendQuestionToLui` 注入问题，`isSend=true` 自动发送，`isSend=false` 仅填入 composer
- `switchTheme`/`switchLocale` 运行时切换主题与语言
- 完整 handler 签名见 `aico-piu-injection/spec.md`

### 场景 5：PIU 组件提交反馈到对话（onPiuSubmit，B1 缺口）

集成方在 Expand Panel 内的 PIU 组件审核配置后，将修改反馈到对话。**当前为 UCD 设计建议，spec 未定义**。

**before（当前状态：Expand Panel 内 PIU 无提交回调）**：
```
┌─ 对话区 ──────────┬─ Expand Panel ──────────┐
│ 🧑 审核巡检配置   │ ┌─ PIU 配置表单 ───────┐ │
│ 🤖 已加载配置     │ │ 区域: 全网           │ │
│                   │ │ 频率: 每日 02:00     │ │
│  （PIU 修改后     │ │ 阈值: 告警>10        │ │
│   无法反馈到对话）│ │                     │ │
│                   │ │  ❌ 无 [保存] 按钮    │ │  ← 当前无 onPiuSubmit
│                   │ │  ❌ 无法提交到对话   │ │     PIU 修改停留在面板内
│                   │ └─────────────────────┘ │
└───────────────────┴─────────────────────────┘
```

**after（目标态：onPiuSubmit 回调反馈到对话）**：
```
┌─ 对话区 ──────────┬─ Expand Panel ──────────┐
│ 🧑 审核巡检配置   │ ┌─ PIU 配置表单 ───────┐ │
│ 🤖 已加载配置     │ │ 区域: 全网 ✏️        │ │
│                   │ │ 频率: 每日 03:00 ✏️  │ │  ← 用户修改配置
│ 🧑 已更新配置：   │ │ 阈值: 告警>15 ✏️     │ │
│  频率→03:00       │ │                     │ │
│  阈值→15          │ │  ✅ [保存并反馈]     │ │  ← onPiuSubmit 回调
│ 🤖 确认执行？     │ │     点击提交         │ │     走 shared composer/request
│  [确认] [取消]    │ └──────────┬──────────┘ │
│                   │            │ onPiuSubmit │
│                   │            ▼            │
│                   │  configData 注入对话     │
└───────────────────┴─────────────────────────┘
```

```typescript
// 当前主干：payload 只包含 whole-content / 受控 spread-data 与 panel host fields。
piu.emit(method, buildPiuEmitPayload(content, hostFields));

// UCD 目标伪代码，不是现有 callable contract：
function nestedPiuSubmit(configData: unknown) {
  const validatedInput = validateAndSerializePiuInput(configData);
  sharedComposerRequestPath(validatedInput); // 自动发送或仅写草稿仍待 Clarify
}
```

说明：
- 当前 `piu.emit` 会注入 `wrapperId`/`containerId`/open-close callbacks/`expandPanelId`，但无 save/submit callback
- `sendQuestionToLui` 机制仅协作式宿主可用，扩展面板内 PIU 不可用
- nested PIU submit 必须复用 shared composer/request owner；实施前需决定自动发送或仅写草稿、payload schema/大小上限与序列化失败反馈
- 此为 B1 Clarify 项，详见 `10-implementation-gap-analysis.md`

---

## 已知缺口

| 缺口编号 | 名称 | 状态 | 说明 |
|---|---|---|---|
| B1 | nested PIU submit | `[UCD目标/Clarify]` | 需定义 shared composer/request owner、自动发送/草稿语义、payload schema/上限与错误反馈，见 `10-implementation-gap-analysis.md` |
| 新 | 问题模板运行时注入 | `[缺口]` | 集成方无法通过运行时接口注入自定义问题模板，只能通过 agent package JSONL 打包期定制。`category-question-source` spec 明确 `MUST NOT 从请求体/客户端获取路径` |

---

## 与其他文档的导航关系

| 方向 | 目标文档 | 用途 |
|---|---|---|
| → | `openspec/specs/aico-config-contract/spec.md` | AICOConfig 字段完整 schema |
| → | `openspec/specs/aico-piu-injection/spec.md` | PIU 注入扩展点完整契约 |
| → | `openspec/specs/agent-web-multi-host-modes/spec.md` | 三种 HostMode 完整定义 |
| → | `openspec/designs/architecture/agent-web-host-modes.md` | 宿主模式架构层背景 |
| → | `09-product-team-briefing.md` §1.4 | 宿主集成模式概览表 |
| → | `10-implementation-gap-analysis.md` B1 | onPiuSubmit 缺口详情 |
| → | `05-component-specs/composer.md` | SkillSelector 默认行为 |
| → | `05-component-specs/expand-panel.md` | PIU 宿主机制 + onPiuSubmit 设计建议 |
| → | `05-component-specs/sub-window.md` | OPERATOR CustomEvent + 导航卡片 |
| ← | `README.md` | 文档索引 |

---

## 维护策略

- **新增定制能力**：在对应类别下追加一行 + 更新总览表计数 + 更新 HostMode 适用矩阵
- **字段变更**：同步更新契约字段列与实现位置列
- **缺口收敛**：B1 先完成 Clarify 并由 OpenSpec 冻结唯一 nested PIU submit 路径；实现与验证完成后再改为 `[已实现-主干]`
