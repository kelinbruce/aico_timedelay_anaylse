# 组件规范：展开面板（Expand Panel）

> 实现来源：`features/expand-panel/`（`ExpandPanel.tsx`、`ExpandPanelStore.ts`、`useExpandPanelStreamWatcher.ts`）、`piu/layout.ts`、`ChatPage.tsx`。本组件是前端布局机制，非 OpenSpec 基线，不定义契约。

## 职责

在对话过程中，将**富内容**（地图、图表、DSL、PIU 组件等）在右侧（或左侧）展开面板呈现，对话区收到固定宽度。当能力结果内容过于复杂、不适合在气泡内联呈现时，通过展开面板提供更大的画布。

典型场景：用户问"查看陆家嘴顺势故障分布"，Agent 执行完成后，对话气泡内显示摘要卡片，右侧展开面板显示完整地图 + 故障分布标注。

## 布局模式

Expand Panel 的布局类型由**宿主模式**决定，自身不支持 docked/floating/maximized 切换。两种布局类型：

| 布局类型 | 适用宿主模式 | 位置 | 来源 |
|---|---|---|---|
| **flex sibling** | 本地（local）/ 沉浸式（immersive） | 与对话区并排，位置可配（沉浸式 LEFT/RIGHT，本地固定 RIGHT） | `ChatPage.tsx` L2066-2107 |
| **fixed overlay** | 协作式（PIU/collaborative） | 固定覆盖在 PIU 宿主面板左侧 | `AIAgentPiuRuntime.tsx` L217-222 |

> ℹ️ **docked/floating/maximized 是协作式（PIU）宿主面板的布局模式**（`piu/layout.ts` 的 `CollaborativePanelLayout`），不是 Expand Panel 的。PIU 宿主面板 header 提供切换按钮（Float/Dock、Maximize/Restore）。Expand Panel 打开时 PIU 宿主面板被强制 docked-right，关闭后恢复原布局。详见 `03-full-ui-layout.md` 协作式（PIU）布局章节。

### flex sibling（本地/沉浸式）

Expand Panel 作为 `<aside style="flex: 1 1 auto">` 与对话区并排渲染。对话区收窄为 `flex: 0 0 484px`。

```
┌──────────────────────────────────────────────────────────┐
│  会话列表  │  对话区（484px 固定宽度，收到左侧）  │  Expand Panel（flex:1，占满剩余）  │
│           │                                    │  [× Close]                         │
│           │  > 🧑 用户                         │                                    │
│           │  > 查看陆家嘴顺势故障分布           │  （地图 + 故障标注）                │
│           │                                    │                                    │
│           │  > 🤖 助手 · ✅ 已完成              │                                    │
│           │  > 📋 过程面板 ▶ 已完成             │                                    │
│           │                                    │                                    │
│           │  ┌─ Composer ──────────────────┐  │                                    │
│           │  │ [📎] 输入消息…      [发送]    │  │                                    │
│           │  └──────────────────────────────┘  │                                    │
└──────────────────────────────────────────────────────────┘
```

- 对话区：`flex: 0 0 484px`（固定宽度，靠左）
- Expand Panel：`flex: 1 1 auto`（占满右侧剩余空间）
- 位置可配：`layoutConfig.expandPanelPosition = "LEFT" | "RIGHT"`（默认 RIGHT；沉浸式生效，本地固定 RIGHT）

### fixed overlay（协作式/PIU）

Expand Panel 作为 `position: fixed` 覆盖层渲染在 PIU 宿主面板左侧。Expand Panel 打开时，PIU 宿主面板被强制切换到 docked-right。

```
┌──────────────────────────────────────────┐ ← 宿主页面
│  宿主产品顶部菜单（63.2px，PREL_MENU_HEIGHT）│
├────────────────────┬─────────────────────┤
│  Expand Panel      │  PIU 宿主面板       │
│  (fixed overlay)   │  (docked-right)     │
│  left: 0           │  right: 0           │
│  right: panelWidth │  width: 484px       │
│                    │                     │
│  （地图 + 故障标注）│  > 🧑 用户          │
│  [× Close]         │  > 🤖 助手 · ✅     │
│                    │  📋 过程面板 ▶      │
│                    │  ┌─ Composer ────┐  │
│                    │  │ 输入消息…[发送]│  │
│                    │  └────────────────┘  │
├────────────────────┴─────────────────────┤
│  宿主页面内容                            │
└──────────────────────────────────────────┘
```

- Expand Panel：`position: fixed, top: 63.2px, left: 0, bottom: 0, right: expandPanelPiuWidth, zIndex: 998`
- PIU 宿主面板：强制 docked-right（即使之前是 floating/maximized，`AIAgentPiuRuntime.tsx` L204-212）
- `expandPanelPiuWidth`：来自 `aicoConfig.modalSize.width`，默认 484px（`DOCKED_DEFAULT_WIDTH`）
- 位置不可配：固定在 PIU 面板左侧

### LEFT 位置（expandPanelPosition = "LEFT"）

immersive 宿主模式下，面板可配置在对话区左侧（而非默认的右侧）：

```
┌──────────────────────────────────────────────────────────┐
│  会话列表  │  Expand Panel（LEFT）  │  对话区（484px）   │
│           │  [× Close]             │                     │
│           │                        │  > 🧑 用户          │
│           │  （地图 + 故障标注）    │  > 查看故障分布     │
│           │                        │                     │
│           │                        │  > 🤖 助手 · ✅     │
│           │                        │  📋 过程面板 ▶      │
│           │                        │                     │
│           │                        │  ┌─ Composer ────┐  │
│           │                        │  │ 输入消息…[发送]│  │
│           │                        │  └────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 位置与宿主模式

来源：`ChatPage.tsx` L2075-2117。

| 宿主模式 | 布局类型 | expandPanelPosition | 面板位置 |
|---|---|---|---|
| 沉浸式（immersive） | flex sibling | LEFT | 对话区左侧 |
| 沉浸式（immersive） | flex sibling | RIGHT（默认） | 对话区右侧 |
| 本地（local） | flex sibling | —（固定 RIGHT） | 对话区右侧 |
| 协作式（PIU） | fixed overlay | —（固定左侧） | PIU 面板左侧（fixed overlay） |

## 触发方式

来源：`useExpandPanelStreamWatcher.ts`。

**自动触发**：流式事件 `TOOL_STRUCTURED_DELTA` 且 `payload.toolEventType === "EXPAND_PANEL"` → 自动打开面板。

```
TOOL_STRUCTURED_DELTA {
  toolEventType: "EXPAND_PANEL",
  toolMessageType: "PIU" | "TEXT" | "FILE" | "ACTION" | "OPERATOR" | "DSL",
  content: { ... },  // 按 toolMessageType 不同
  // PIU 类型额外字段：
  piuName: "fault-distribution-map",
  piuVersion: "1.0",
  data: "{ ... }",
  method: "render"
}
```

**关闭方式**：
- Close 按钮（`ExpandPanel.tsx` 右上角 `CloseOutlined`）
- PIU 组件调用 `handleExpandPanelClose` 回调
- turn 切换 / session 切换自动关闭（`ChatPage.tsx` L870-877）
- 打开 Run Graph 时自动关闭（互斥，见下文）

## 内容类型（6 种 ToolMessageType）

来源：`ExpandPanel.tsx` L14-29、`useExpandPanelStreamWatcher.ts` L6。

| ToolMessageType | 渲染器 | 内容 | 用途 |
|---|---|---|---|
| **PIU** | `PiuMessage` | `{ piuName, piuVersion, data, method }` | 通用组件宿主——地图、图表、仪表盘等富交互组件 |
| TEXT | `MarkdownContent` | markdown 字符串 | 长文本呈现 |
| FILE | `FileCard` | 文件名 | 文件卡片 |
| ACTION | `ActionCard` | 动作文本 | 动作卡片 |
| OPERATOR | `OperatorButtons` | 操作文本 | 操作按钮 |
| DSL | `DslRenderer` | DSL 内容 | DSL 渲染 |

**PIU 是可扩展类型**——地图、图表、仪表盘等所有富交互组件都是注册一个 `piuName` 的 PIU，不需要新增 ToolMessageType。

### 各 ToolMessageType 渲染样例

**PIU（富交互组件宿主）**——已在 flex sibling 布局样例中展示（地图/故障标注）。

**TEXT（长文本呈现）**：

```
┌─ Expand Panel（TEXT）──────────────────────────────┐
│  诊断报告全文                            [× Close]  │
├────────────────────────────────────────────────────┤
│                                                    │
│  # 网络健康诊断报告                                │
│                                                    │
│  ## 1. 摘要                                        │
│  本次诊断结论是：当前网络整体仍可用，但存在…       │
│                                                    │
│  ## 2. 关键发现                                    │
│  | F-01 | Edge-RTR-02 | CPU 持续高于 85% | … |     │
│                                                    │
│  ## 3. 推荐处置顺序                                │
│  1. 优先处理 Edge-RTR-02…                          │
│                                                    │
│  （Markdown 渲染，支持滚动）                        │
└────────────────────────────────────────────────────┘
```

**FILE（文件卡片）**：

```
┌─ Expand Panel（FILE）──────────────────────────────┐
│  诊断报告附件                            [× Close]  │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────────────────────────────────────┐      │
│  │ 📄 network-diagnosis-20260714.pdf        │      │
│  │ 2.3 MB · PDF                              │      │
│  │                              [下载 ↓]    │      │
│  └──────────────────────────────────────────┘      │
│                                                    │
└────────────────────────────────────────────────────┘
```

**ACTION（动作卡片）**：

```
┌─ Expand Panel（ACTION）────────────────────────────┐
│  建议的后续操作                          [× Close]  │
├────────────────────────────────────────────────────┤
│                                                    │
│  根据诊断结果，建议执行以下操作：                   │
│                                                    │
│  ┌──────────────────────────────────────────┐      │
│  │ ⚡ 立即重启 Edge-RTR-02                   │      │
│  │ 该设备 CPU 持续过高，建议在维护窗口重启   │      │
│  │                              [执行 →]    │      │
│  └──────────────────────────────────────────┘      │
│                                                    │
│  ┌──────────────────────────────────────────┐      │
│  │ 📋 创建故障工单                           │      │
│  │ 将本次诊断结果作为附件创建工单            │      │
│  │                              [创建 →]    │      │
│  └──────────────────────────────────────────┘      │
│                                                    │
└────────────────────────────────────────────────────┘
```

**OPERATOR（操作按钮）**：

```
┌─ Expand Panel（OPERATOR）──────────────────────────┐
│  选择操作                                [× Close]  │
├────────────────────────────────────────────────────┤
│                                                    │
│  诊断已完成，请选择后续操作：                       │
│                                                    │
│  [导出报告]  [创建工单]  [重新诊断]                │
│                                                    │
│  （按钮组，横向排列 flex wrap）                     │
└────────────────────────────────────────────────────┘
```

**DSL（DSL 渲染）**：

```
┌─ Expand Panel（DSL）───────────────────────────────┐
│  拓扑配置 DSL 渲染                       [× Close]  │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────────────────────────────────────┐      │
│  │  network_topology {                      │      │
│  │    region: "huadong-shanghai"            │      │
│  │    nodes: [                              │      │
│  │      { id: "Edge-RTR-02", type: "router" }│     │
│  │      { id: "Core-SW-01", type: "switch" } │     │
│  │    ]                                     │      │
│  │    edges: [                              │      │
│  │      { from: "Edge-RTR-02", to: "Core-SW-01" }│  │
│  │    ]                                     │      │
│  │  }                                       │      │
│  └──────────────────────────────────────────┘      │
│                                                    │
│  （DslRenderer 渲染，可含语法高亮/结构化展示）      │
└────────────────────────────────────────────────────┘
```

## PIU 宿主机制

来源：`PiuMessage.tsx`。

PIU（Process Input Unit）是通用外部组件托管机制：

> ℹ️ **命名区分**：本文档中 "PIU" 有两种含义：（1）**ToolMessageType PIU**（Process Input Unit，本节）——扩展面板内的可交互组件类型；（2）**宿主模式 PIU**（协作式，`HostMode = "piu"`，HTML data 属性 `"collaborative"`）——NextAgent 作为面板嵌入宿主产品的集成模式。两者共享 "PIU" 名称但概念不同。下文 "AIAgent PIU host（协作式宿主）" 指后者。

1. `PiuMessage` 接收 `{ piuName, piuVersion, data, method }`
2. 调用 `window.Prel.autoLoad(piuName, piuVersion)` 加载 PIU 组件包
3. 调用 `piu.emit(method, payload)`：默认 payload 为 `{ ...content, ...hostFields }`；受控兼容例外 `dte-bi-agent` 为 `{ ...objectShapedContentData, ...hostFields }`。`hostFields` 固定包含 `wrapperId`、`containerId`、`handleExpandPanelOpen`、`handleExpandPanelClose`、`expandPanelId`，并后置覆盖同名不可信字段
4. PIU 组件在 `expandPanelId` 容器内渲染

**PIU 组件的能力**：
- 通过 `handleExpandPanelOpen()` / `handleExpandPanelClose()` 控制面板开关
- 通过 `expandPanelId` 获取渲染容器
- 可切换 PIU 宿主面板布局模式（docked → floating → maximized），但 Expand Panel 打开时 PIU 宿主面板被强制 docked-right

**气泡内呈现**：PIU 在对话气泡内显示占位符"PIU: {piuName}@{piuVersion}（等待宿主渲染）"，富内容在右侧面板呈现。

**本地不可预览**：若 `window.Prel` 不可用（本地开发环境），显示"PIU 内容（本地不可预览）"。

## 交互式 PIU 保存→对话反馈

> **状态标注**：`[已实现-主干]` `PiuMessage` 已按 PIU 名称选择 whole-content 或 spread-data payload，并注入 panel host fields；当前 payload **无 save/submit callback**。`[UCD目标/Clarify]` 嵌套 ToolMessageType PIU 的提交应复用共享 composer/request owner，把受控配置反馈给 Agent；它不是 collaborative host 的 `sendQuestionToLui` 反向回调。

### 场景

PIU 组件在扩展面板中呈现**配置审核页**（如节能自治配置），用户审核修改后点击保存，配置数据反馈到对话，Agent 处理后新 turn 展示策略摘要。

### 当前缺口

`PiuMessage.tsx` 的 `piu.emit()` 传递的回调：

| 回调 | 当前状态 | 用途 |
|---|---|---|
| `handleExpandPanelOpen` | ✅ 已实现 | 打开扩展面板 |
| `handleExpandPanelClose` | ✅ 已实现 | 关闭扩展面板 |
| `expandPanelId` | ✅ 已实现 | 渲染容器 ID |
| `onPiuSubmit` | ❌ 未实现 | **PIU→对话反馈**（UCD 建议） |

### UCD 目标：nested PIU submit

`onPiuSubmit` 仅是当前 UCD 对“嵌套 PIU 提交动作”的暂定名称，不代表已冻结 public contract。实施前必须明确：提交后自动发送还是仅写入草稿、payload schema/大小上限、序列化错误体验，以及 shared composer/request 路径的 owner。

**反馈流程**：

1. PIU 组件渲染配置审核表单（区域列表 + 参数 + 预览）
2. 用户审核、修改配置
3. 用户点击 PIU 内 [保存] → PIU 组件调用 `onPiuSubmit(configData)`
4. LUI 将受校验的配置序列化为用户可理解的输入，并沿**唯一的共享 composer/request 路径**处理；具体是自动发送还是仅写入草稿，由后续契约决策，不得让 PIU 直接调用后端配置 API
5. Agent 接收修改后的配置 → 处理 → 新 turn 在对话气泡内展示策略摘要
6. Agent 可发起 confirmation pending input（"是否执行?"）

```
┌─ Expand Panel（配置审核 PIU）──────────────────────┐
│  节能自治配置                            [× Close]  │
├────────────────────────────────────────────────────┤
│                                                    │
│  区域列表：                                        │
│  ☑ 华东-上海-陆家嘴                                │
│  ☑ 华东-杭州-西湖                                  │
│  ☐ 华北-北京-海淀                                  │
│                                                    │
│  节能参数：                                        │
│  ├ 峰值时段：08:00 - 22:00                         │
│  ├ 节能模式：智能调度                              │
│  └ 温度阈值：26°C                                  │
│                                                    │
│  [取消]                              [保存并提交]   │
└────────────────────────────────────────────────────┘
         ↓ 用户点击 [保存并提交]

┌─ 对话区 ──────────────────────────────────────────┐
│  > 🤖 助手 · ✅ 已完成                              │
│  > ## 节能自治策略已生成                            │
│  > 已为你生成以下节能自治策略：                     │
│  > - 适用区域：华东-上海-陆家嘴、华东-杭州-西湖      │
│  > - 峰值时段：08:00 - 22:00                       │
│  > - 节能模式：智能调度                             │
│  > - 预估节能率：12%                               │
│  >                                                 │
│  > ┌─ Pending Input ─────────────────────────┐    │
│  > │ 是否执行该节能策略？                      │    │
│  > │              [否]    [是]                │    │
│  > └──────────────────────────────────────────┘    │
└────────────────────────────────────────────────────┘
```

### 与 `sendQuestionToLui` 的区别

| 维度 | `sendQuestionToLui`（已实现） | `onPiuSubmit`（UCD 建议） |
|---|---|---|
| 可用范围 | 仅 AIAgent PIU host（协作式宿主，`registerAIAgentPIU.tsx`） | 扩展面板内 PIU（`PiuMessage.tsx`） |
| 注入方式 | `aiAgentPiuRuntimeStore.queueQuestion` → `composerBridgeRef.sendQuestion` → shared composer | 待冻结的 nested PIU submit → shared composer/request 路径；不是 host bridge |
| 数据形态 | 文本问题（`{ question, isSend }`） | 结构化配置数据（`configData`，由 PIU 定义） |
| 目标 | 将文本注入 composer / 发送为新消息 | 将配置数据提交给 Agent 处理 |

### 约束

- **PIU 提交不直接修改后端状态**：`onPiuSubmit` 将数据反馈到对话，由 Agent 处理后决定是否执行——PIU 组件不直接调用后端 API 修改配置。
- **提交后面板状态**：PIU 提交后扩展面板可保持打开（用户可继续修改）或关闭（由 PIU 组件通过 `handleExpandPanelClose` 控制）。UCD 建议提交后保持打开，待 Agent 响应后由用户关闭。
- **数据安全**：`onPiuSubmit` 传递的 `configData` MUST NOT 包含 credential/token。
- **与 `sendQuestionToLui` 互补**：`sendQuestionToLui` 面向 AIAgent PIU host（协作式宿主，LUI 作为 PIU 嵌入宿主页面）；`onPiuSubmit` 面向扩展面板内 PIU（LUI 内部的 PIU 组件）。两者不冲突，可共存。
- **提交契约待决**：必须定义 runtime schema、大小/深度上限、自动发送与草稿二选一语义、重复提交与序列化失败反馈；未完成 Clarify 前不得按本节伪代码直接实现。

## 与 Run Graph 互斥

来源：`ChatPage.tsx` L851 "Mutex: opening expand panel closes graph panel"。

Expand Panel 与 Run Graph **共享同一右侧空间**，二者互斥：
- 打开 Expand Panel → 自动关闭 Run Graph（`setSelectedDetailRootMessageId(null)`）
- 打开 Run Graph → Expand Panel 不显示（`!isExpandPanelOpen` 条件，L2118）

## live 模式 vs history 模式

| 维度 | live 模式 | history 模式 |
|---|---|---|
| 自动打开 | ✅ `EXPAND_PANEL` 事件到达时自动打开 | ❌ `history-load` 事件被跳过，不自动打开 |
| 内容呈现 | ✅ PIU 组件实时渲染 | ⚠️ PIU 事件在历史重建中可见，但不自动打开面板 |
| 交互 | ✅ 可关闭 | — |

来源：`useExpandPanelStreamWatcher.ts` L31-33（`if (event.transportHints.includes("history-load")) continue;`）。

**history 模式不自动打开面板**——history 重建时 `EXPAND_PANEL` 事件带 `history-load` transport hint，stream watcher 跳过。用户浏览历史对话时看到的是过程面板中的工具条目（PIU 占位符），不自动展开右侧面板。若需在 history 中查看富内容，需用户主动触发（如点击条目）。

## 约束

- **触发仅限 `EXPAND_PANEL` toolEventType**：其他 toolEventType 不打开面板。
- **6 种 ToolMessageType**：`PIU` / `TEXT` / `FILE` / `ACTION` / `OPERATOR` / `DSL`，其他类型被忽略（`VALID_TOOL_MESSAGE_TYPES` 校验）。
- **与 Run Graph 互斥**：二者共享右侧空间，不可同时打开。
- **turn/session 切换关闭**：切换 turn 或 session 时自动关闭面板（`ChatPage.tsx` L870-877）。
- **history 不自动打开**：`history-load` 事件被跳过。
- **对话区固定宽度 484px**：Expand Panel 打开时对话区 `flex: 0 0 484px`（`DOCKED_DEFAULT_WIDTH = 484`，`piu/layout.ts` L2）。
- **PIU 宿主面板 floating 约束**（非 Expand Panel）：min 406×484，max 1112×viewport，margin 24px（`piu/layout.ts` L6-8）。
- **PIU 依赖 `window.Prel`**：本地环境不可用时显示占位符。
- **位置可配**：`expandPanelPosition = "LEFT" | "RIGHT"`，默认 RIGHT。

## UCD 设计建议

- **气泡内摘要卡片**：当前 PIU 在气泡内仅显示占位符文本。UCD 设计人员可设计更友好的摘要卡片（如地图缩略图 + "点击查看完整地图"），点击后打开面板——但当前触发是流式事件自动打开，非卡片点击。若需卡片点击触发，需扩展 `PiuMessage` 或新增交互入口。
- **PIU 宿主面板布局切换视觉**（非 Expand Panel）：floating 模式的拖拽手柄、resize 视觉反馈、阴影层级；maximized 切换入口由 PIU 宿主面板 header 控制（`AIAgentPiuRuntime.tsx` L538-555）。
- **关闭确认**：若 PIU 组件有未保存状态，关闭前是否提示（当前直接关闭）。

## 动态行为与交互响应

> 跨组件的通用模式见 `02-dynamic-behavior-and-interaction.md`。本节补充 Expand Panel 特有行为。

### 已实现

| 行为 | 说明 |
|------|------|
| 主题适配 | `[data-theme]` CSS 变量切换 |

### UCD 设计建议

| 行为 | 说明 |
|------|------|
| PIU 布局切换 | side-split（视口充足）与 drawer（视口不足）间切换，宽度过渡 120ms。当前 `ExpandPanel.tsx` 和 `ChatPage.tsx` 中**不存在**视口宽度切换为 drawer 模式的逻辑，也无 120ms 宽度过渡，**未实现** |
| 面板打开/关闭 | `EXPAND_PANEL` 事件触发时 slide-in 200ms ease-out；Close 时 slide-out 200ms ease-in |
| loading | PIU 内容加载时显示 skeleton 占位 |
| Close 按钮 hover | hover 时背景色变化 120ms |
| focus | Close 按钮 `focus-visible` outline 2px primary + offset 2px |
| turn 切换关闭动画 | turn 切换时面板自动关闭，fade-out 150ms |
