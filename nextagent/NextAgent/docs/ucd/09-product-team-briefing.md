# NextAgent 对话界面 UCD 方案澄清（产品业务团队版）

> 本文档面向产品业务团队，自包含地澄清 NextAgent 对话界面的 UCD 方案与场景覆盖。无需阅读其他 UCD 文件即可理解全貌。如需深入某个主题，每节末尾标注了详细的源文档路径。

> **状态基线（2026-08-13，`origin/main@4f27c4a9f`）**：当前事实由 owning stable/active OpenSpec、代码和测试交叉确认；active change 尚待归档时会明确标注。任务准入以 owning spec 与 roadmap 为准。

---

## 第 1 章：覆盖的关键场景

### 1.1 目标用户

| 用户类型 | 角色 | 核心诉求 |
|---|---|---|
| 网络运维工程师 | 一线运维，处理告警分诊、故障定位、配置审核 | 看到 Agent 调用了哪些能力及输出；高危操作需显式授权；可快速取消/重试/编辑重发 |
| 运维主管 | 团队负责人，审查复杂故障处理流程、回溯 Agent 使用情况 | 历史对话完整可审（思考/降级/压缩均可见）；区分"完整答案"与"部分答案"；会话搜索/收藏/重命名 |
| 平台开发者 | Agent 配置与调试，验证 spec 合规性 | 能力卡片显示 safeErrorCode/Category；Run Graph 完整时间线；fork 新会话探索不同方案 |

> 来源：`00-user-personas.md`

### 1.2 业务域总览

NextAgent 对话界面覆盖 **7 个业务域**，共 **27 条用户旅程 × 27 个场景**；第 27 个场景是横切多条旅程的长会话容量验收。

| 域 | 旅程 | 场景 | 域说明 |
|---|---|---|---|
| A | 1 提问到答案、2 附件上传、12 多轮思考与工具调用、19 查看 Run Graph、20 查看右侧展开面板富内容、21 从对话通知集成方打开系统页面、22 下载 Agent 生成的文件、23 在扩展面板中审核修改配置并保存、25 管理定时任务、27 并行工具调用 | 1 正常路径、2 失败路径、4 附件上传、7 多轮思考与工具调用、16 Run Graph 完整执行流程、17 右侧展开面板——地图故障分布、18 打开 OSS 配置——导航卡片与集成方页面跳转、19 下载区域列表模板、20 在扩展面板中审核修改节能配置、21 开启节能自治——端到端复合场景、23 创建和管理 Cron 定时任务、26 并行工具调用 | **核心对话与任务执行**——单轮/多轮任务、附件输入、失败分支、执行流程查看、富内容展开、跨系统导航、文件下载、配置审核与保存反馈、定时任务管理、端到端复合场景、并行工具调用 |
| B | 13 多会话后台 run、14 长时运行能力、17 执行中发新消息、24 监控后台任务执行 | 8 多会话后台 run、9 长时运行、10 请求被取代、22 后台分离执行与任务追踪 | **长时任务与并行工作流**——长时任务三出路（fork/后台/supersede），后台分离执行（结果不参与上下文）由 capability-card 内联追踪 |
| C | 5 历史对话浏览、11 派生新会话、15 会话搜索与管理 | 12 会话搜索与管理、13 分享与派生 | **会话组织与检索**——浏览/搜索/派生/分享/重命名/删除 |
| D | 4 断线重连、7 路径拒绝、9 取消与重试、10 重试失败请求、18 页面关闭与重开 | 5 断线重连、6 路径被策略拒绝、11 取消与重试、15 页面关闭与重开 | **错误与异常恢复**——网络级到页面级中断恢复 + 用户主动控制 |
| E | 3 pending input、6 上下文压缩 | 3 Pending Input 全 kind 矩阵、24 上下文压缩——长对话中的上下文窗口管理 | **交互输入与上下文**——Agent 主动交互（确认/授权/问答）+ 上下文超限压缩 |
| F | 8 编辑重发 | 10 请求被取代（阶段 10a-10c） | **编辑与修正**——编辑最近用户消息重发，与 B 共享场景 10 |
| G | 16 Sub-agent 委派 | 14 Sub-agent 委派 | **委派与能力扩展**——Agent 调用子 agent 处理专长任务 |

### 1.3 域间关系

- **A → B**：A 是基础单轮/多轮执行；B 处理执行时间长的任务的并行/替代路径。旅程 14（长时运行）第 7 步的 fork-to-continue 跨引用旅程 11（派生）+ 旅程 13（后台 run）。
- **A → D**：D 域的中断恢复不是独立场景，而是嵌入 A 域执行过程中——任务执行可能失败（场景 2）、被策略拒绝（场景 6）、网络中断（场景 5），D 域提供恢复路径。
- **A ↔ E**：A 域任务执行中可被 E 域 pending input 暂停（等待用户确认/授权/问答），用户应答后恢复执行；E 域的上下文压缩在长对话中触发（场景 24 独立演示压缩触发与用户体验）。场景 21（端到端复合场景）串联多次 pending input。
- **B 内部三出路**：长时任务执行中用户想干别的 → fork 保留任务（旅程 14）/ 切换会话后台执行（旅程 13）/ 直接发送终止（旅程 17 supersede）。三者互补，非互斥。
- **B → C**：B 的三出路均依赖 C 域会话管理——fork 创建新会话（旅程 11），后台 run 由独立 Session Activity Stream 投影注意力状态，supersede 终态在历史中持久。
- **D 覆盖中断谱系**：网络瞬断（旅程 4，cursor 保留）/ 页面关闭（旅程 18，cursor 丢失，cold-start）/ 请求被拒（旅程 7）/ 用户主动取消（旅程 9）/ 失败重试（旅程 10）。
- **D → C**：D 域页面级中断（旅程 18）恢复后需从 C 域会话列表恢复上下文；`continuityPhase` 是当前已连接会话的 conversation/stream 状态，不是列表行字段。
- **F 与 B 共享场景 10**：编辑重发（旅程 8）和执行中发新消息（旅程 17）后端机制相同（supersede），但用户意图、UI 流程、对话结构不同——场景 10 用阶段 10a-10c（编辑）和 10d（执行中发新消息）区分。
- **G 是 A 的特化执行路径**：sub-agent 委派复用 A 域过程面板和能力卡片，但子 agent 上下文隔离、内部过程不可见（只呈现单步卡片，不展开子 agent 的思考/工具调用）。子 run 以 `priority: "LOW"` 调度（与 B 共享调度模型），父 turn 同步阻塞等待。子 agent 失败由父能力卡片呈现，但不必然升级为父 run 失败。

> 来源：`README.md` 域间关系章节

### 1.4 宿主集成模式

NextAgent 支持三种宿主集成模式（`HostMode = "local" | "immersive" | "piu"`），决定 NextAgent 如何嵌入宿主环境：

| 模式 | 代码值 | 嵌入方式 | 视口占用 | 导航方式 | 适用场景 |
|---|---|---|---|---|---|
| **本地（local）** | `"local"` | 独立运行（mock Prel） | 100% | URL 路由 | 本地开发/独立部署 |
| **沉浸式（immersive）** | `"immersive"` | 全页面嵌入宿主产品（Prel 框架） | 100%（整页） | URL 路由（HashRouter） | 宿主产品全页面承载 NextAgent |
| **协作式（PIU/collaborative）** | `"piu"` | 作为面板嵌入宿主页面 | docked/floating/maximized 子区域 | sessionStorage | 宿主页面内嵌 NextAgent 面板，与宿主页面内容共存 |

**布局差异**：

| 维度 | 本地（local） | 沉浸式（immersive） | 协作式（PIU） |
|---|---|---|---|
| 侧边栏 | 有（`showLocalControls=true`，含设置/帮助/退出） | 有（`showLocalControls=false`）或顶部栏（`operatorPosition=RIGHT`） | 无侧边栏；PIU 面板 header 含导航按钮（新会话/历史/搜索） |
| 设置入口 | 侧边栏底部本地控件 | 宿主环境控制 | 宿主环境控制 |
| Expand Panel 布局 | flex sibling（固定右侧） | flex sibling（LEFT/RIGHT 可配） | fixed overlay（固定 PIU 面板左侧） |
| 面板形态 | — | — | docked（停靠 left/right）/ floating（浮窗）/ maximized（全屏），用户可切换 |
| 会话认证 | 本地认证 | `useNonLocalAuthRedirect`（宿主托管） | 宿主托管 |

**功能差异**：

| 功能 | 本地 | 沉浸式 | 协作式（PIU） |
|---|---|---|---|
| `sendQuestionToLui`（宿主页面→对话注入） | ❌ | ❌ | ✅ |
| `handleHistoricalChatReplay`（宿主 PIU 历史内容回放） | ❌ | ❌ | ✅；仅本地 view state，不进入会话历史 |
| Expand Panel LEFT 位置 | ❌（固定 RIGHT） | ✅（`expandPanelPosition`） | ❌（固定左侧 overlay） |
| PIU 面板 docked/floating/maximized 切换 | — | — | ✅（header 按钮） |
| 主题/语言切换 | 设置模态框 | 宿主 `switchTheme`/`switchLocale` | 宿主 `switchTheme`/`switchLocale` |

> ℹ️ **协作式（PIU）模式命名**：代码中 `HostMode` 值为 `"piu"`，HTML/CSS data 属性为 `"collaborative"`，文档中称"协作式"。三者指向同一模式。详见 `04-information-architecture.md` 布局模式差异、`03-full-ui-layout.md`、`05-component-specs/expand-panel.md` 布局模式章节。

### 1.5 集成方界面定制能力概览

本文汇总 **40 个集成方界面定制点**，按 7 类组织，覆盖 local/immersive/piu 三种宿主模式；合计包含已实现、预留、类型已声明未接线与 UCD 目标，不能把总数当成已实现数。集成方可通过 `AICOConfig`（sessionStorage 注入）+ PIU handler（Prel 框架）+ CustomEvent 三类机制定制 NextAgent 界面。

| 类别 | 项数 | 典型能力 | 详细文档 |
|---|---|---|---|
| A. 主题与视觉定制 | 7 | logo/图标/品牌名称/主题切换 | `12-integrator-customization-guide.md` §A |
| B. 布局定制 | 4 | 侧栏/顶栏/面板尺寸 | `12` §B |
| C. 文案/i18n 定制 | 4 | 欢迎副标题/免责声明/语言切换 | `12` §C |
| D. 行为定制 | 7 | 会话恢复/时间戳/问题注入/历史聊天回放 | `12` §D |
| E. 组件替换/PIU 注入 | 8 | skill 区/高频问题区/自定义按钮/答案操作区/Knowledge 列表渲染 | `12` §E |
| F. 宿主事件/回调 | 6 | OPERATOR/ACTION/nested PIU submit（目标） | `12` §F |
| G. 基础设施 | 4 | containerId/Prel 生命周期 | `12` §G |
| **合计** | **40** | 含预留、未接线与 UCD 目标 | |

> ℹ️ 字段级契约映射、HostMode 适用矩阵与 5 个关键场景代码示例见 `12-integrator-customization-guide.md`。契约 schema 见 `openspec/specs/aico-config-contract/spec.md`、`openspec/specs/aico-piu-injection/spec.md`。

---

## 第 2 章：全局视图与关键组件

### 2.1 全屏布局总览

```
┌────────────┬─────────────────────────────────────────────────────────────┐
│ 🛰️ NextAgent│  对话区（主区域）                                            │
├────────────┤                                                              │
│ [💬 新会话] │  ┌─ Turn 1 ──────────────────────────────────────────────┐  │
│ [🔍 搜索]   │  │  > 🧑 用户：网络健康诊断                               │  │
│ [⭐ 收藏]   │  │  > 🤖 助手 · ✅ 已完成                                 │  │
│ [⚙️ 操作]   │  │  ┌─ 📋 过程面板（auto-collapsed ▶）───────── [完整过程] ┐  │
│            │  │  │  已完成  ▶                                      │    │  │
│ 最近会话    │  │  └─────────────────────────────────────────────────┘    │  │
│ ▸ 会话 A   │  │  > # 网络诊断联调长回复                                │  │
│ ●会话 C◀── │  │  > ## 1. 摘要                                         │  │
│   (live)   │  │  > 本次诊断结论是：当前网络整体仍可用……               │  │
│ ▸ 会话 D   │  └────────────────────────────────────────────────────────┘  │
│            │                                                              │
│            │  ┌─ Composer ────────────────────────────────────────────┐  │
│            │  │ [📎]  输入消息……                              [发送]  │  │
│            │  └────────────────────────────────────────────────────────┘  │
└────────────┴──────────────────────────────────────────────────────────────┘
```

侧边栏自上而下：品牌 header（🛰️ NextAgent）→ 导航按钮（新会话/搜索/收藏/操作）→ 会话列表。"完整过程"按钮位于每个 turn 的过程面板摘要行右侧，非独立底部 bar。

**3 个核心区域**：

| 区域 | 位置 | 职责 |
|---|---|---|
| 侧边栏 | 左侧 | 品牌标识（header）、导航按钮（新会话/搜索/收藏/操作）、会话导航（live ● / history ▸）；immersive-right 布局下无侧边栏，导航通过顶部栏按钮 |
| 对话区 | 主区域 | 消息流 + 过程面板 + Composer；每个 turn = USER 气泡 → 过程面板（含"完整过程"入口）→ ASSISTANT 气泡 |
| Composer | 对话区底部 | 文本输入 + 附件 + 发送/停止；Skill 选择器、slash 命令、编辑模式 |

**可选叠加层**：Run Graph 面板（side-split 或 drawer，由过程面板"完整过程"按钮触发）、右侧展开面板（PIU 富内容）、模态层（搜索/重命名/删除确认/分享/快捷键帮助）。

> ℹ️ **immersive-right 布局**：`operatorPosition === "RIGHT"` 时，使用全宽 54px 顶部栏（品牌标识 + 导航按钮 + 操作区）替代侧边栏，会话列表通过顶部栏按钮以面板覆盖形式打开。详见 `03-full-ui-layout.md` §2.2 顶部栏（immersive-right 布局）。

### 2.2 组件层级与联动

NextAgent 的 14 个 UCD 规范分为 3 个层级（2 容器组件 + 10 叶子组件 + 2 跨组件规范）：

```
┌─ 容器组件 ──────────────────────────────────────────────────────┐
│  process-panel    对话区内 turn 级过程容器（think/capability/    │
│                    degradation/compaction 条目）                  │
│  expand-panel     右侧展开面板（PIU/TEXT/FILE/ACTION/地图/图表）  │
└──────────────────────────────────────────────────────────────────┘
         │ 包含                              │ 联动
         ▼                                   ▼
┌─ 叶子组件 ──────────────────────────────────────────────────────┐
│  message-bubble     USER/ASSISTANT 消息气泡                      │
│  capability-card    工具结果卡片（parser/formatter/fallback 分层）│
│  pending-input-card 4 durable + 7 frontend；workflow 待澄清      │
│  degradation-notice 降级提示卡片                                  │
│  composer           输入区（文本/附件/skill/slash/编辑）          │
│  session-list-item  会话列表项                                    │
│  file-download      文件下载卡片                                  │
│  cron-task          Cron 定时任务卡片                             │
│  background-task-   后台任务监控面板（⚡ header 下拉）             │
│    monitor          （会话级，跨卡片追踪后台任务）                 │
│  sub-window         导航卡片（OPERATOR LINK）+ 集成方页面跳转契约 │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─ 跨组件规范 ────────────────────────────────────────────────────┐
│  tool-ui-interface-overview     工具 UI 接口总览（8 类接口）      │
│  tool-output-presentation-      工具输出呈现策略                  │
│    policy                       （4 策略 × 3 维度）               │
└──────────────────────────────────────────────────────────────────┘
```

**关键联动入口**：

| 触发 | 来源组件 | 目标组件 | 说明 |
|---|---|---|---|
| 点击会话列表项 | session-list-item | 对话区 | 加载历史或加入 live stream |
| 发送消息 | composer | 对话区 | 底部新增 turn |
| 点击"完整过程" | 过程面板摘要行右侧 | process-panel（Run Graph） | 打开抽屉查看完整时间线 |
| EXPAND_PANEL 事件 | capability-card | expand-panel | 自动打开右侧面板 |
| 点击 fork 按钮 | message-bubble | session-list-item | 创建派生会话并导航 |
| OPERATOR LINK | capability-card | 集成方页面 | dispatch CustomEvent 通知集成方打开新 tab |

### 2.3 live vs history 目标模式与当前边界

**[已实现-主干]** live 与 history 对完成的持久化过程事实最终一致：Message history 建立对话内容，Event history 渐进恢复完成的 thinking 与 capability lifecycle。history 不呈现未完成 delta、running 动画和打字机效果。B17/B18 的过滤 owner、策略配置和各 surface 一致性仍为 `clarify`。

| 维度 | live 模式 | history 模式 |
|---|---|---|
| 会话列表标记 | ●（live） | ▸（history） |
| 过程面板 | 流式追加，完成后 auto-collapsed | `[UCD目标]` 默认折叠，可展开查看相同安全内容；think 条目尚非主干 history 能力（详见 §3.4.4） |
| 助手气泡 | 打字机效果 + running 动画 | 终态内容直接呈现，无动画 |
| 能力卡片 running 态 | ✅ 可见 | ❌ 不可见（瞬时态，终态由 CAPABILITY_RESULT_DELTA 交付） |
| 推荐后续问题 | ✅ 最新 COMPLETED turn 显示 | ❌ 不显示 |
| 重连状态指示 | ✅ 可见 | ❌ 不适用 |
| 展开面板 | ✅ EXPAND_PANEL 事件自动打开 | ❌ 不自动打开（可手动） |

> 来源：`03-full-ui-layout.md`、`04-information-architecture.md`

---

## 第 3 章：各组件详细设计规格

### 3.1 规范总览表

14 个 UCD 规范分为 3 个层级：2 个容器组件、10 个叶子组件、2 个跨组件规范。

| # | 规范 | 层级 | 职责 | 关键状态/模板 |
|---|---|---|---|---|
| 1 | process-panel | 容器组件 | turn 级过程容器，渲染思考/能力调用/降级/压缩条目 | 3 容器状态 × 7 条目模板 + 按当前 formatter/fallback 分层维护的结果呈现 + Run Graph 抽屉 |
| 2 | expand-panel | 容器组件 | 右侧展开面板，渲染 PIU/地图/图表等富内容 | 2 布局类型 × 6 ToolMessageType |
| 3 | sub-window | 叶子组件 | `[已实现]` OPERATOR 按钮与点击 dispatch；`[UCD目标]` LINK 导航卡片 + 集成方页面跳转契约 | 当前按钮 / 目标 LINK 卡片 / CustomEvent 安全边界 |
| 4 | message-bubble | 叶子组件 | USER/ASSISTANT 消息气泡，含流式/终态/操作 | 3 变体 × 4 终态 + 7 BubbleActions |
| 5 | capability-card | 叶子组件 | 工具调用生命周期与结果呈现 | 3 生命周期 + 当前 parser/专门 formatter/generic fallback 分层 + SafeError 失败态 |
| 6 | pending-input-card | 叶子组件 | Agent 暂停等待用户交互的输入卡片 | 当前 live required 卡 + 3 个目标终态；4 durable kind + 7 frontend identifier；workflow 复用 `QUESTION` |
| 7 | degradation-notice | 叶子组件 | 系统降级提示（安全脱敏/子系统降级） | 2 触发类型 × 5 category 变体 |
| 8 | composer | 叶子组件 | 用户输入区（文本/附件/skill/slash/编辑） | 2 模式 + 3 slash + 附件校验 |
| 9 | session-list-item | 叶子组件 | 会话列表项，投影跨会话注意力状态 | 五态 activity 优先级 + 未读终态安全消费；`continuityPhase` 不属于列表行 |
| 10 | file-download | 叶子组件 | Agent 生成文件下载卡片 | 2 content 格式 × 2 下载机制 |
| 11 | cron-task | 叶子组件 | Cron 定时任务管理卡片 | 3 操作类型（创建/列表/删除） |
| 12 | background-task-monitor | 叶子组件 | 后台任务监控面板（⚡ header 下拉，会话级） | 4 状态 × Kill 交互 + stream live update |
| 13 | tool-ui-interface-overview | 跨组件规范 | 工具 UI 接口总览（跨组件导航） | 8 类接口 × 18+ 工具映射 |
| 14 | tool-output-presentation-policy | 跨组件规范 | 工具输出呈现策略框架 | 4 策略 × 3 维度 × 4 层级 |

### 3.2 核心容器组件

#### 3.2.1 过程面板（process-panel）

**职责**：在单个 turn 内，USER 气泡与 ASSISTANT 气泡之间渲染执行过程条目（思考、能力调用、降级提示、压缩通知）。

> **关联场景**：[场景 1：正常路径](#场景-1正常路径) · [场景 7：多轮思考与工具调用](#场景-7多轮思考与工具调用) · [场景 17：右侧展开面板——地图故障分布](#场景-17右侧展开面板地图故障分布) · [场景 22：后台分离执行与任务追踪](#场景-22后台分离执行与任务追踪) · [场景 24：上下文压缩——长对话中的上下文窗口管理](#场景-24上下文压缩长对话中的上下文窗口管理) · [场景 10：请求被取代](#场景-10请求被取代supersede) · [场景 14：Sub-agent 委派](#场景-14sub-agent-委派)

**关键规格**：
- 3 种容器状态：expanded（全高可滚动，所有条目可见）/ collapsed（仅显示 summary row，条目区域不渲染）/ absent（无 run 或无过程条目时面板不渲染）
- 7 种条目模板：think streaming（思考流式输入中）、think completed（思考完成）、capability running（工具执行中）、capability success（工具成功完成）、capability failure（工具执行失败）、degradation（降级提示）、compaction（上下文压缩通知）
- 能力成功结果按四层核对：后端/上游安全投影、前端 parser、普通结果 formatter（或补充信息专用关联路径）、generic safeSummary fallback。当前库存以 `safeCapabilityResult.ts` 与 `processDetails.ts` 为准，不维护易漂移的固定数量；`cron`、`toolSearch` 已有专门 formatter，`clipStream*` 仍未进入前端 parser，`httpResponse` 仍无专门 formatter
- ~9 种能力失败子模板：safeErrorCode 4 种（TIMEOUT / COMMAND_NOT_ALLOWED / CAPABILITY_PATH_REJECTED / PROJECTION_UNSAFE）/ safeErrorCategory 4 种（TIMEOUT / UNAVAILABLE / VALIDATION / AUTHORIZATION_POLICY_DENIED）/ 兜底 1
- 不维护静态“视觉模板总数”；设计清单随 parser/formatter/fallback 库存更新，避免把后端 kind 误报为已落地前端卡片
- Run Graph 抽屉：7 种节点类型（start / think / tool / decision / loop / parallel / end），2 种布局（侧分屏 / 抽屉）
- auto-expand/collapse 状态机：running 阶段自动展开，settled 阶段自动折叠，用户手动覆盖优先

#### 3.2.2 展开面板（expand-panel）

**职责**：右侧面板渲染富内容（地图、图表、DSL、PIU 组件）；对话区在面板打开时收窄为固定宽度。

> **关联场景**：[场景 17：右侧展开面板——地图故障分布](#场景-17右侧展开面板地图故障分布) · [场景 21：开启节能自治——端到端复合场景](#场景-21开启节能自治端到端复合场景)

**关键规格**：
- 2 种布局类型（由宿主模式决定）：flex sibling（本地/沉浸式，与对话区并排）/ fixed overlay（协作式/PIU，覆盖在 PIU 面板左侧）。docked/floating/maximized 是协作式（PIU）宿主面板的布局模式，非 Expand Panel 自身
- 6 种 ToolMessageType：PIU（可交互组件，如配置审核表单）/ TEXT（富文本段落）/ FILE（文件下载卡片）/ ACTION（自动 dispatch 的结构化内容，安全边界待加固）/ OPERATOR（当前普通按钮 + 点击 dispatch；`[UCD目标]` LINK 导航卡片）/ DSL（结构化数据，如图表/表格）
- PIU 宿主机制：当前已有 panel open/close 与 `expandPanelId` 等宿主字段；nested PIU submit 仅是 `[UCD目标/Clarify]`，尚无冻结的 `onPiuSubmit` public contract
- 与 Run Graph 互斥；turn/session 切换自动关闭；history 模式跳过自动打开
- `[UCD目标/Clarify]` 嵌套 PIU 用户提交如获准实现，必须进入共享 composer/request lifecycle owner；不得直接路由内部 `injectQuestion` helper，也不得由宿主桥接层直接创建 canonical message/run

### 3.3 叶子组件

#### 3.3.1 消息气泡（message-bubble）

**职责**：渲染 USER 和 ASSISTANT 消息，含流式内容、终态指示器、操作按钮。

> **关联场景**：[场景 1：正常路径](#场景-1正常路径) · [场景 7：多轮思考与工具调用](#场景-7多轮思考与工具调用) · [场景 13：分享与派生](#场景-13分享与派生) · [场景 5：断线重连](#场景-5断线重连) · [场景 6：路径被策略拒绝](#场景-6路径被策略拒绝capability_path_rejected) · [场景 10：请求被取代](#场景-10请求被取代supersede) · [场景 14：Sub-agent 委派](#场景-14sub-agent-委派)

**关键规格**：
- 3 变体：USER（用户消息，右对齐）/ ASSISTANT 非终态（流式输出中，含打字机效果）/ ASSISTANT 终态（完成/失败/取消，含操作按钮）
- 4 终态指示器：COMPLETED（正常完成 ✅）/ FAILED（执行失败 ❌）/ CANCELED（用户取消 ⏹️）/ SUPERSEDED（被新消息取代 🔁）
- 7 BubbleActions：赞 / 踩 / 收藏 / 分享 / 派生（fork 到子会话）/ 重试 / pin（置顶）
- 打字机效果：32ms tick, 120 初始字符, 自适应步长（8/16-48/96）
- CANCELED 分 2 子情况（有/无部分内容）
- 派生（Fork）：支持 message anchor / request anchor 两种路由

#### 3.3.2 能力卡片（capability-card）

**职责**：渲染单个能力调用的生命周期与结果，是用户观察 Agent 执行过程的核心组件。

> **关联场景**：[场景 7：多轮思考与工具调用](#场景-7多轮思考与工具调用) · [场景 17：右侧展开面板——地图故障分布](#场景-17右侧展开面板地图故障分布) · [场景 21：开启节能自治——端到端复合场景](#场景-21开启节能自治端到端复合场景) · [场景 23：创建和管理 Cron 定时任务](#场景-23创建和管理-cron-定时任务) · [场景 9：长时运行](#场景-9长时运行long-running与三选择分流) · [场景 22：后台分离执行与任务追踪](#场景-22后台分离执行与任务追踪) · [场景 6：路径被策略拒绝](#场景-6路径被策略拒绝capability_path_rejected) · [场景 14：Sub-agent 委派](#场景-14sub-agent-委派)

**关键规格**：
- 3 生命周期状态：running（CAPABILITY_STARTED 后执行中）/ result（CAPABILITY_RESULT_DELTA 到达，结果渲染中）/ terminal（CAPABILITY_COMPLETED，终态）+ long-running 扩展态（超过阈值无 RESULT_DELTA，显示计时器 + 取消入口）
- 当前前端 parser 还识别 `cron` 与 `toolSearch`；`httpResponse` 无专门 formatter，`pendingInputAnswer` 走补充信息关联路径，`clipStream*` 尚不识别。这里不维护易漂移的固定数量
- ~9 种 failure 子模板：safeErrorCode 4 种（TIMEOUT 超时 / COMMAND_NOT_ALLOWED 命令被策略阻止 / CAPABILITY_PATH_REJECTED 路径被拒 / PROJECTION_UNSAFE 投影不安全）/ safeErrorCategory 4 种（TIMEOUT / UNAVAILABLE 子系统不可用 / VALIDATION 校验失败 / AUTHORIZATION_POLICY_DENIED 鉴权拒绝）/ 兜底 1（未知错误，显示 safeSummary）
- 不维护固定模板总数；running、专门 success formatter、generic fallback、failure 与 long-running 分层验收
- long-running 扩展态：计时器（从 CAPABILITY_STARTED 的 createdAt 计算）+ "可能需要较长时间"提示 + 取消入口 + 可选进度（safeProgress: { current, total }）
- fork-to-continue 引导 CTA：long-running 态显示，建议非强制，不阻断 supersede
- **后台任务追踪**：`[已实现-主干]` `⚡` header monitor 以一次 REST seed + `BACKGROUND_TASK_*` session stream + Kill local override 合成状态，stdout/stderr 展开时按需读取；`[UCD目标]` capability-card 内联追踪区若实施应复用同一 snapshot，不新增轮询。当前自然完成与 Kill 都不提交 Agent continuation；未来若需把结果恢复到 Agent 上下文，必须另立 contract change

  > ℹ️ `backgroundHandle` 是 UCD 文档使用的**概念术语**，指代后台分离执行返回的句柄，非 `bashBackgroundOutputSchema` 中的字面字段。实际 schema 字段为 `taskId`（句柄标识）+ `backgroundReason`（分离原因）。详见 `capability-card.md`。
- 4 组图标集：file / command / stream / generic

#### 3.3.3 交互输入卡片（pending-input-card）

**职责**：Agent 暂停执行等待用户输入时，渲染交互请求卡片及应答生命周期。

> **关联场景**：[场景 3：Pending Input 全 kind 矩阵](#场景-3pending-input-全-kind-矩阵) · [场景 21：开启节能自治——端到端复合场景](#场景-21开启节能自治端到端复合场景)

**关键规格**：
- `[已实现-主干]` live required 卡可应答；POST 成功或终态 event 会清空卡片。received/timeout/canceled 只读 lifecycle 卡是 `[UCD目标]`，当前 process details 只显示独立 system 条目。
- backend 只有 4 种 durable kind：QUESTION / CONFIRMATION / AUTHORIZATION / HUMAN_HANDOFF；frontend 接受 7 个 identifier，另含 CLARIFICATION / APPROVAL / SELECTION compatibility aliases。workflow interrupt 专用 kind/presentation 仍为 Clarify。
- AUTHORIZATION 只允许对受保护操作 approve/deny，不得要求用户在卡片中输入 credential/token；其当前视觉为 2px primary 边框 + 蓝色徽章。
- AUTHORIZATION 有 2px primary 边框 + 蓝色徽章区分（其他 kind 为 1px 边框）
- 倒计时计时器 + 超时/取消状态流
- live 模式可交互；history lifecycle 卡只读重建是目标，当前仅有独立 process system 条目

#### 3.3.4 降级提示卡片（degradation-notice）

**职责**：渲染系统降级提示，告知用户信息经过了处理或子系统能力受损。

> **关联场景**：本组件未在第 4 章代表性场景中独立展示，详见 [08-sample-scenarios.md 场景 2：失败路径](./08-sample-scenarios.md)（阶段 2.1 含降级提示）

**关键规格**：
- 2 触发类型：Type A 安全脱敏（按设计执行 redaction，告知用户信息已脱敏）/ Type B 子系统降级（非预期能力受损，告知用户功能不可用）
- 5 category 变体：TIMEOUT（超时降级）/ UNAVAILABLE（子系统不可用）/ VALIDATION（校验失败降级）/ AUTHORIZATION_POLICY_DENIED（鉴权策略拒绝）/ 兜底（未知降级类别）
- 可作为次要系统提示与能力失败卡片并存
- projection failure（投影失败）特殊呈现（STREAM_PROJECTION_PAYLOAD_UNSAFE 等，后端安全过滤事件内容时失败）

#### 3.3.5 输入区（composer）

**职责**：用户输入入口，含文本输入、附件上传、发送/停止切换、草稿缓存。

> **关联场景**：[场景 9：长时运行](#场景-9长时运行long-running与三选择分流)（fork 引导） · [场景 21：开启节能自治——端到端复合场景](#场景-21开启节能自治端到端复合场景) · [场景 10：请求被取代](#场景-10请求被取代supersede)（编辑模式）

**关键规格**：
- 2 模式：正常（发送新消息）/ 编辑（编辑最近一条已发送 USER 消息并重新发送，触发 supersede）
- 3 slash 命令：/help（打开帮助）/ retry（重试最新失败请求）/ edit（进入编辑模式）
- staged composer 从 bootstrap 的 effective file config 读取数量、单文件大小和类型限制；默认 10 个文件、10 MiB/文件、仅 Markdown（`.md`/`.markdown`），可由可信配置启用 CSV/TSV/TXT/JSON/XML/LOG 等文本类型。3 个文件/5 MiB 仅是 compatibility direct-intake 边界，不是 staged composer 主路径默认值
- 草稿缓存：per session
- 问题关联推荐：300ms debounce，3 来源（pinned / high-frequency / static）
- long-running fork 引导：长时任务执行中聚焦 composer 时 inline 提示后果 + fork 替代方案

#### 3.3.6 会话列表项（session-list-item）

**职责**：侧边栏渲染单个会话条目，支持切换、识别 live/history、搜索/重命名/删除，并提供当前 favorite turn（收藏回合）入口；现有数据语义不是 session favorite。

> **关联场景**：[场景 12：会话搜索与管理](#场景-12会话搜索与管理) · [场景 13：分享与派生](#场景-13分享与派生) · [场景 5：断线重连](#场景-5断线重连)

**关键规格**：
- `[已实现-主干]` 独立 Session Activity Stream 投影 `WAITING_FOR_INPUT > RUNNING > UNREAD_FAILURE > UNREAD_RESULT > NONE`，四个会话入口复用同一 store/selector/trailing slot
- 未读终态只有在匹配 terminal presentation 已进入共享 conversation projection 且前台可见后消费；点击列表项或加载失败不得提前消费
- 当前 conversation/stream 有 reconnecting / resyncing / disconnected 等 `continuityPhase`；这些状态不在 session-list DTO/row 中，也不属于本轮 Ready。若未来要投影到列表，须另立 public contract。
- 4 时间格式：今天 HH:mm / 昨天 / 本年 M/D / 更早 Y/M/D
- 未读结果蓝点与未读失败红色感叹号已实现；视觉调整不得绕过 canonical activityId/runId 消费协议

#### 3.3.7 文件下载卡片（file-download）

**职责**：Agent 在对话气泡内输出可下载文件（模板/报告/导出数据），用户点击下载。

> **关联场景**：[场景 21：开启节能自治——端到端复合场景](#场景-21开启节能自治端到端复合场景)（阶段 21.1 文件下载卡片）

**关键规格**：
- content 格式：`{ fileName, downloadUrl, mimeType?, fileSize? }`
- 文件图标按 mimeType 映射：CSV📊 / PDF📄 / Excel📗 / Word📘 / JSON📋
- 下载机制：`<a download>` 或 Blob+createObjectURL
- 文件来源：Agent 生成（模板/报告/导出），后端提供 downloadUrl
- history 模式：下载卡片重建，downloadUrl 依赖后端可用性（临时文件可能过期）

#### 3.3.8 Cron 定时任务卡片（cron-task）

**职责**：Cron Tool 支持会话内创建/列表/删除并投影本地化结构结果；独立 Cron Dashboard 已支持任务与执行记录管理。

> **关联场景**：[场景 23：创建和管理 Cron 定时任务](#场景-23创建和管理-cron-定时任务)

**关键规格**：
- 3 种操作类型：创建 / 列表 / 删除
- 列表投影：max 50 项 + truncated 标记
- 5 字段 cron 表达式（进程本地时区）
- `recurring` 默认 true
- 创建卡片：显示任务 ID、调度计划、cron 表达式、循环标记
- 列表卡片：表格展示多个任务（ID + 调度 + cron 表达式 + 循环标记）
- 删除卡片：显示已删除的任务 ID
- **Cron Dashboard**（`[已实现-主干]`）：sidebar route；任务/执行记录 Tab；当前 trusted owner + active Agent scope 下的查询、创建、修改、删除、启停与立即执行。结果会话跳转策略仍为独立 Clarify

#### 3.3.9 导航卡片与集成方页面跳转（sub-window）

**职责目标**：NextAgent 在对话气泡内联渲染导航卡片，用户点击后通过 `document.dispatchEvent` 通知集成方打开目标页面。`[已实现-主干]` 当前 OPERATOR 内容统一渲染为普通按钮并支持点击 dispatch；`type: "LINK"` 专门卡片尚未实现。集成方在自身页面打开新 tab，切到导航 tab 时**全屏显示外部页面**（NextAgent 对话不可见），切回 NextAgent tab 时恢复对话。页签管理、页面嵌入均由集成方在 NextAgent 页面外部实现。

> **关联场景**：本组件未在第 4 章代表性场景中独立展示，详见 [08-sample-scenarios.md 场景 18：打开 OSS 配置——导航卡片与集成方页面跳转](./08-sample-scenarios.md)

**关键规格**：
- OPERATOR LINK 卡片渲染（UCD 设计建议）：`type === "LINK"` 时渲染为导航卡片（标题 + 描述 + "打开"入口），非按钮组
- CustomEvent 事件协议：事件名 = operator JSON key，`detail` = `JSON.parse(data)`（含 `{ url, title, embed }`）
- **全屏整页切换**：切到导航 tab 时全屏显示外部页面，NextAgent 对话不可见；切回 NextAgent tab 时对话完整恢复（与 Expand Panel 的并排共存是关键区别）
- 集成方职责：事件监听（`addEventListener`）、页签管理（打开/切换/关闭/去重）、页面嵌入（iframe/component）、对话保持（页签切换不影响 NextAgent 对话状态）
- NextAgent 职责边界：仅渲染卡片 + dispatch 事件，不监听、不管理页签
- 导航卡片 3 种视觉样式：primary / default / risk
- 页签是集成方临时 UI 状态，不持久化在 conversation 中

### 3.4 跨组件规范

#### 3.4.1 工具 UI 接口总览（tool-ui-interface-overview）

汇总 8 类工具到 UI 的交互路径，提供跨组件的接口导航：

| # | 接口类别 | 说明 |
|---|---|---|
| 1 | Stream 事件 | 当前 channel contract 23 种 event；其中 22 种进入 canonical timeline projection，`OUTPUT_GUARD_BLOCKED` 为 terminal guard relay 例外；前端另保留 `HOOK_DEGRADED` compatibility event |
| 2 | safeResult 投影 | 分别核对 backend/upstream projection、frontend parser、specialized formatter 与 generic safeSummary fallback；不使用固定 kind 总数代替消费状态 |
| 3 | TOOL_STRUCTURED_DELTA | toolEventType × toolMessageType 二维分发（7×6） |
| 4 | Pending Input | 4 种 durable kind + 7 个 frontend accepted identifier；workflow interrupt 专用路线仍为 Clarify |
| 5 | PIU 宿主回调 | 已有 panel open/close + expandPanelId；nested PIU submit 为 Clarify，须走共享 composer/request owner |
| 6 | 后台任务 REST API | 3 端点（listTasks/readOutput/killTask） |
| 7 | OPERATOR CustomEvent | `[已实现]` BUTTON 点击分发 + `[UCD目标]` LINK 导航；event allowlist/scope 与 ACTION replay 仍为安全 Clarify |
| 8 | 工具定义 UI 字段 | name / disclosurePolicy / replayPolicy |

18+ 工具映射覆盖：Bash/Read/Write/Edit/Grep/Glob/WebSearch/PIU/networkDiagnostic/queryAlerts/queryConfig/configAudit/faultQuery/Cron/memory tools 等。

#### 3.4.2 工具输出呈现策略（tool-output-presentation-policy）

`[已实现-主干]` 当前提供启动期 `STATUS_ONLY` / `SUMMARY` / `DETAIL` 三档 Capability 结果配置，按 exact `capability-id` 匹配并受平台安全上限约束。配置只控制成功结果披露，不提供场景级阈值、内容扫描或终端用户切换。

以下 **4 种呈现策略** 和可配置框架仍是 `[UCD目标/Clarify]`，不是当前可用配置 contract；尤其 redaction 的 authoritative owner、scope、默认值和 live/history/share 一致性仍需先澄清：

| 策略 | 说明 |
|---|---|
| 完整呈现（Full） | 工具输出完整显示，不截断、不折叠 |
| 仅摘要（Summary-Only） | 只显示工具名 + 执行状态，不显示详细结果 |
| 长度自适应截断（Adaptive） | 短输出完整显示，长输出截断并提示 |
| 安全脱敏（Redacted） | 对输出内容扫描式脱敏，敏感信息替换为掩码 |

**3 个配置维度**：`detailLevel`（full/summary/adaptive）× `truncationThreshold`（数值）× `redactionPolicy`（none/whitelist/content-scan）

**4 层应用层级**：全局默认 → 场景级 → 工具级 → kind 级（低层级继承高层级默认值）

**6 个业务场景示例**：

| 业务场景 | detailLevel | truncationThreshold | redactionPolicy |
|---|---|---|---|
| 诊断/调试 | full | 10000 字符 | none |
| 日常对话 | summary | — | whitelist |
| 数据查询 | adaptive | 1000 字符 | whitelist |
| 安全审核 | adaptive | 4000 字符 | content-scan |
| 移动端 | summary | — | whitelist |
| 跨团队共享 | adaptive | 2000 字符 | content-scan |

**用户控制**：产品团队可决定是否向终端用户暴露策略切换（场景自动应用 / 用户手动切换 verbose/compact/summary-only / per-entry 展开）。

> 来源：14 个 `05-component-specs/` 文件

#### 3.4.3 动态行为与交互响应（02-dynamic-behavior-and-interaction）

集中定义跨组件的动态行为规范，各组件规格引用本文并补充组件特有行为：

- **执行过程动态时序**：从 T0（用户发送）到 T_final（面板 auto-collapse）的完整时序，覆盖 think → tool → think → tool → answer 多轮过程。running 阶段新条目自动展开，条目完成后延迟 800ms 自动折叠，request terminal 后外层面板延迟 150ms 折叠。
- **滚动行为与焦点跟随**：视口跟随底部、滚动锚定补偿、新条目 scrollIntoView 等。
- **通用交互响应模式**：7 个维度统一规范——hover（11/14 缺失）、click/激活、focus（12/14 缺失）、disabled、loading、error、appear/disappear（13/14 缺失），每项标注 `[已实现]` / `[UCD 设计建议]`。
- **动画参数规范**：15 个参数（时长 200ms/120ms/100ms、延迟 150ms/800ms、tick 32ms、idle 触发 2.5s、循环 4s/1.2s/1s/1.05s、自动消失 3s、复制反馈 1.5s）+ 缓动函数 + reduced-motion 降级。
- **组件速查表**：15 个组件 × 8 个维度（running 动画、hover、click、focus、disabled、loading、error、appear/disappear）的完整性矩阵；新增当前会话预览轨道。

> 来源：`02-dynamic-behavior-and-interaction.md` + 12 个组件规格的"动态行为与交互响应"章节

#### 3.4.4 think 内容呈现与安全过滤策略

模型思考过程（think）的目标呈现涉及**动态时序**、**持久化一致性**、**安全过滤**三个维度。本节描述 `[UCD目标]`，不表示主干已实现或方案已获准实施；准入状态以 roadmap 为准。

**1. 动态呈现时序**

`[UCD目标]` think 条目在过程面板内按 `think → tool → think → tool → answer` 时序呈现：running 阶段新条目 auto-expanded，流式文本 replace 累积；条目进入终态后延迟 800ms auto-collapse（让用户看到结果预览）；活跃条目 idle-sweep 扫光提示"仍在工作中"。用户手动展开/折叠后该条目 auto 行为冻结，直到新 run 开始。

**2. 持久化与 live=history 一致性**

`[已实现-主干]` live 与 history 展示相同的完成持久化过程事实，只有动态呈现效果（打字机、running 动画、渐进式披露）有差异。完成 thinking 的持久化与 history hydration 已交付；字段级安全过滤及其配置 owner 仍需 B17/B18 独立收敛。

**3. 可配置安全过滤**

`[已实现-主干]` 当前已有 REMOTE input/output whole-round guard、`OUTPUT_GUARD_BLOCKED` 与 blocked assistant model-history 隔离等基础护栏；下述多层、可配置、跨 live/history/share 一致的过滤是 `[UCD目标/Clarify]`，不是当前实现。B17/B18 必须先确认 authoritative owner、策略 scope/默认值/生效时机与审计要求，再决定是否以及如何扩展：

| 层级 | 机制 | 覆盖范围 | dev/prod |
|---|---|---|---|
| 第 1 层 正则扫描 | 7 条规则（私钥/password/Bearer/sk-/手机号/内网IP/路径） | 模式化秘密（key/token/IP/路径） | dev 关 / prod 开 |
| 第 2 层 源内容匹配 | think 文本与模型可见原始内容子串匹配，替换为语义占位（`[REDACTED_PROMPT]`/`[REDACTED_TOOL_OUTPUT]`/`[REDACTED_SKILL]`/`[REDACTED_ARGS]`） | 语义内容泄漏（模型复述 prompt/工具结果/skill/args） | dev 关 / prod 开 |
| 第 3 层 prompt 约束 | 系统 prompt 约束模型不复述敏感原始内容 | 软约束，降低泄漏概率 | 始终启用 |
| 第 4 层 可选隐藏 think | prod 模式完全隐藏思考过程，仅显示最终回答 | 兜底措施，安全要求极高场景 | 独立配置项 |

| UCD 目标示例 | think 流式呈现 | answer 流式呈现 | 适用场景 |
|---|---|---|---|
| dev（调测） | 第 1/2 层关闭，原文完整显示 | 原文完整显示 | 开发调测，排查模型行为 |
| prod（运行） | 第 1/2 层开启，模式化秘密与语义内容均替换为占位 | 同 think | 生产环境，安全合规 |

**待确认的设计要求（B17/B18 Clarify）**：
- 是否以及在哪个 owner 上执行 streaming 过滤，确保 live/history/share 使用同一 authoritative 安全结果
- 安全策略配置的 owner、scope、默认值、生效时机、审计与是否需要独立管理 UI/API
- 过滤占位与用户可见 observability 如何定义，且不得泄露 prompt、模型输出、raw provider error 或其他受限内容
- 如何与现有 whole-round guard、safe-result whitelist 和字段级投影组合，避免建立互相矛盾的平行过滤链路

> 来源：`02-dynamic-behavior-and-interaction.md` 第 1.6 节、`05-component-specs/process-panel.md`、`05-component-specs/message-bubble.md`、`openspec/designs/architecture/conversation-ui-state.md`（Think 内容持久化与安全过滤章节）

#### 3.4.5 长时任务分流策略

长时任务（耗时较长的工具调用）执行过程中，用户可能不愿干等。系统提供**三个显式选择**，让用户根据"输出是否需要参与后续对话上下文"决定如何处理。这条原则统一了长时能力扩展态、Fork-to-Continue、后台任务、cron 任务触发四个场景的分流逻辑。

**三个选择**：

| 选择 | 触发条件 | 输出与上下文关系 | 用户继续对话位置 | 原会话状态 |
|---|---|---|---|---|
| **1. 等待**（默认） | 用户愿意等 | ✅ 输出进入当前会话上下文 | 当前会话 | 阻塞，等任务完成 |
| **2. 转后台** | 用户不愿等 + 输出**不需要**进上下文 | ❌ 输出不进上下文，存到监控面板 | 当前会话继续 | 不阻塞，任务在后台跑 |
| **3. Fork 继续** | 用户不愿等 + 输出**需要**进上下文 | ✅ 输出进入**原会话**上下文（任务完成后） | **新派生会话**继续 | 原会话继续等任务完成 |

**业务意图**：

- **选择 1（等待）**：输出是后续对话推理的关键依据，用户愿意投入时间等待。例如：网络诊断结果需用于下一步排查决策
- **选择 2（转后台）**：输出供参考但不参与后续推理，用户希望并行处理其他事项。例如：dev server 启动、build 任务、日志监控、批量数据采集
- **选择 3（Fork 继续）**：输出会参与后续推理，但用户当下不愿等待，希望基于已有上下文换个方向继续探索，原会话保留等待任务完成的完整性。例如：长扫描进行中，用户想先就已知信息追问

**工具声明机制**：

工具在 spec 中声明 `outputContextMode`，决定可用 CTA：

| 模式 | 含义 | 允许的选择 | 典型工具 |
|---|---|---|---|
| `required` | 输出必须进上下文 | 1（等待）、3（Fork 继续） | 网络诊断、配置审计、复杂分析 |
| `decoupled` | 输出可不进上下文 | 1（等待）、2（转后台） | dev server、build、log watch、批量采集 |
| `user-choice`（默认） | 用户决定 | 1、2、3 全部可选 | 通用工具 |

**关键设计要求**：

- **显式选择**：任务输出是否进入会话上下文由用户显式决定，系统不隐式决定，避免上下文污染
- **转后台不可逆**：任务转后台后输出不能事后注入上下文（避免隐式污染）；如需输出参与推理，用户应复制内容到 composer 或重新发起同步调用
- **Fork 点为上一轮已完成答案处**：选择 3 从上一轮已完成对话的答案处 fork 新会话，**不从当前运行中的任务处 fork**；原会话继续等待任务完成，输出仍进入原会话上下文
- **原会话任务失败不影响派生会话**：派生会话已独立存在，原会话任务失败时原会话出现失败终态，派生会话不受影响
- **`⚡` 监控面板承载所有 backgrounded 态任务**：不限 Bash，未来支持任何工具转后台（含网络诊断、配置审计等长时工具）
- **与 cron 任务的关联**：cron 触发执行等价于**选择 2 转后台**——输出不应进入原会话上下文。这为 cron 执行结果会话归属策略提供共同约束

**与现有概念的关系**：

- **后台任务（Bash `run_in_background: true`）**：当前实现的选择 2 实例（仅 Bash），未来泛化到所有工具
- **长时能力扩展态**：能力卡片在 inline-running 态展示扩展 UI（计时器、进度、转后台 CTA、Fork 继续 CTA），承载选择 2/3 的触发入口
- **Fork-to-Continue**：选择 3 的 CTA 实现，fork 机制已存在（`session-fork-from-message`），补卡片级 CTA 契约
- **Cron 任务触发**：等价于选择 2（输出不进原会话上下文），是定时调度场景下的"转后台"实例

> 来源：`02-dynamic-behavior-and-interaction.md` 第 1.7 节、`05-component-specs/capability-card.md`（长时能力扩展态）、`05-component-specs/background-task-monitor.md`（taskType 泛化方向）、`openspec/designs/architecture/conversation-ui-state.md`（任务输出与上下文解耦原则章节）

---

## 第 4 章：关键业务场景样例

> 15 个代表性场景覆盖全部 7 个业务域，按域分组。序号为 `08-sample-scenarios.md` 原始编号，保持可追溯。

### 域 A：核心对话与任务执行

#### 场景 1：正常路径

**用户故事**：运维工程师输入"网络健康诊断"，Agent 经过思考阶段、调用 `networkDiagnostic` 能力，输出结构化 Markdown 回复（含摘要、关键发现表、处置建议）。过程面板在执行中自动展开，完成后自动折叠。

```
┌─ Turn 1 ──────────────────────────────────────────────┐
│  > 🧑 用户                                           │
│  > 网络健康诊断                                       │
│                                                        │
│  > 🤖 助手 · ✅ 已完成                                 │
│                                                        │
│  ┌─ 📋 过程面板（auto-collapsed ▶ 已完成）──────────┐ │
│  │  已完成  ▶                                         │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  > # 网络诊断联调长回复                                │
│  > ## 1. 摘要                                          │
│  > 本次诊断结论是：当前网络整体仍可用……               │
│  > ## 2. 关键发现                                      │
│  > | F-01 | Edge-RTR-02 | CPU 持续高于 85% | …… |     │
│  > ## 4. 推荐处置顺序                                  │
│  > 1. 优先处理 Edge-RTR-02……                          │
└────────────────────────────────────────────────────────┘
```

**关键交互**：USER 消息 → 过程面板（think + capability）→ ASSISTANT 回复。降级/压缩为可选，非每次必然出现。

> **涉及组件**：[过程面板](#321-过程面板process-panel) · [消息气泡](#331-消息气泡message-bubble)

#### 场景 7：多轮思考与工具调用

**用户故事**：用户要求"排查 Edge-RTR-02 丢包问题，先查告警再查配置"。Agent 执行 3 轮独立思考 + 2 次工具调用（queryAlerts → queryConfig），产出根因分析和证据链表。严格渲染规则：think → 过程面板，content → 助手气泡。

```
┌─ Turn ──────────────────────────────────────────────────┐
│  > 🧑 用户                                              │
│  > 排查 Edge-RTR-02 丢包问题，先查告警再查配置          │
│                                                          │
│  📋 过程面板（auto-collapsed ▶ 已完成）                 │
│    └ 点击 ▶ 可展开查看：                                │
│       💭 #1 思考 ✅（建立计划）                          │
│       🔧 queryAlerts ✅（3 条告警）                      │
│       💭 #2 思考 ✅（分析告警）                          │
│       🔧 queryConfig ✅（route-map 变更）               │
│       💭 #3 思考 ✅（根因定位）                          │
│                                                          │
│  > 🤖 助手 · ✅ 已完成                                   │
│  > ## 根因分析                                           │
│  > Edge-RTR-02 在 08:45 的配置变更中……                  │
│  > ## 证据链                                             │
│  > | 08:45 | route-map 变更 | queryConfig |             │
│  > | 09:02 | CPU 88%        | queryAlerts |             │
│  > | 09:05 | 丢包 0.18%     | queryAlerts |             │
│  > ## 处置建议                                           │
│  > 1. 立即撤销 10.5.0.0/16 的通告。                     │
└──────────────────────────────────────────────────────────┘
```

**关键规则**：think 条目按轮独立（flushThinking 机制）；整个 turn 的所有 content delta 合并到助手气泡的一个字符串。

> **涉及组件**：[过程面板](#321-过程面板process-panel) · [能力卡片](#332-能力卡片capability-card) · [消息气泡](#331-消息气泡message-bubble)

#### 场景 17：右侧展开面板——地图故障分布

**用户故事**：用户要求"查看陆家嘴故障分布"。Agent 调用 `faultQuery`，完成后 `EXPAND_PANEL` 事件自动打开右侧面板，渲染交互式 PIU 地图。对话区收窄为 484px 固定宽度。用户可缩放/平移/点击标记，切换布局模式。

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区（484px 固定）       │  Expand Panel（flex:1）     │
│  ● 会话 A   │  > 🧑 用户                  │  [× Close]                  │
│  ▸ 会话 B   │  > 查看陆家嘴故障分布       ├─────────────────────────────┤
│             │  > 🤖 助手 · ✅ 已完成       │  🗺️ 陆家嘴故障分布地图      │
│             │  > ## 故障分布概览           │   ┌─────────────────┐       │
│             │  > 陆家嘴区域共 12 处故障…  │   │  📍 📍 📍       │       │
│             │  > [PIU: fault-distribution-│   │ 📍  📍  📍      │       │
│             │  >   map @1.0]              │   │  📍 📍 📍 📍    │       │
│             │  📋 过程面板 ▶ 已完成       │   └─────────────────┘       │
│             │    └ 🔧 faultQuery ✅       │  [× Close]                  │
└──────────────────────────────────────────────────────────────────────────┘
```

**关键约束**：仅 `EXPAND_PANEL` toolEventType 触发面板；与 Run Graph 互斥；history 模式不自动打开。

> **涉及组件**：[展开面板](#322-展开面板expand-panel) · [能力卡片](#332-能力卡片capability-card) · [过程面板](#321-过程面板process-panel)

#### 场景 21：开启节能自治——端到端复合场景

**用户故事**：用户输入"开启节能自治"，触发 7+ 步骤的完整链路：pending question + 文件下载 → 用户下载/填写/上传 CSV → Agent 解析文件 → 扩展面板配置审核 PIU → 用户修改保存 → confirmation → 长时任务执行 + fork 引导。串联场景 3/4/9/17/19/20。

```
阶段 21.1：pending question + 文件下载
┌─ 对话区 ────────────────────────────────────────────────┐
│  > 🧑 用户：开启节能自治                                 │
│  > 🤖 助手 · ✅ 已完成                                   │
│  > 你希望在哪些区域开启节能自治？                        │
│  ┌─ 文件下载卡片 ──────────────────────────────────┐    │
│  │  📊 区域列表模板.csv        1.0 KB   [⬇ 下载]   │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌─ Pending Input ─────────────────────────────────┐    │
│  │ 你希望在哪些区域开启节能自治？    [取消] [提交]  │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘

阶段 21.2：用户下载模板、填写、上传 CSV
┌─ 对话区 ────────────────────────────────────────────────┐
│  > 🧑 用户：开启节能自治                                 │
│  > 🤖 助手 · ✅ 已完成                                   │
│  > 你希望在哪些区域开启节能自治？                        │
│  ┌─ 文件下载卡片 ──────────────────────────────────┐    │
│  │  📊 区域列表模板.csv        1.0 KB   [⬇ 下载]   │    │
│  └──────────────────────────────────────────────────┘    │
│  ┌─ Composer（文件已上传）──────────────────────────┐    │
│  │ 📎 意图生效区域.csv (已就绪)  [×]                 │    │
│  │ 输入消息…                              [发送]    │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
  ↑ 用户下载模板 → 本地填写 → composer 📎 上传 → 附件 chip 显示

阶段 21.3：扩展面板配置审核 PIU
┌──────────────────────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区（484px）  │  Expand Panel（配置审核 PIU）         │
│  ● 会话 A   │  > 🧑 用户        │  节能自治配置          [×]           │
│  ▸ 会话 B   │  > 开启上述文件…  ├────────────────────────────────────────┤
│             │  > 🤖 助手 · ✅    │  区域列表（从文件解析）：             │
│             │  > 已解析 3 个区域 │  ☑ 华东-上海-陆家嘴                  │
│             │  > 请在右侧审核。  │  ☑ 华东-杭州-西湖                    │
│             │                    │  ☑ 华北-北京-海淀                    │
│             │                    │  节能参数：                          │
│             │                    │  ├ 峰值时段：08:00-22:00             │
│             │                    │  └ 温度阈值：26°C                    │
│             │                    │  [取消]      [保存并提交]            │
└──────────────────────────────────────────────────────────────────────────┘

阶段 21.4：confirmation pending input
┌─ 对话区 ────────────────────────────────────────────────┐
│  > 🤖 助手 · ✅ 已完成                                   │
│  > ## 节能自治策略已生成                                 │
│  > - 适用区域：华东-上海-陆家嘴、华东-杭州               │
│  > - 峰值时段：08:00 - 22:00                            │
│  > - 预估节能率：12%                                     │
│  ┌─ Pending Input ─────────────────────────────────┐    │
│  │ 是否执行该节能策略？              [否]    [是]   │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘

阶段 21.5：长时任务 + 三选择分流
┌─ 对话区 ────────────────────────────────────────────────┐
│  > 🤖 助手 · 🔄 执行中                                   │
│  ┌─ 能力卡片（long-running 扩展态）────────────────┐    │
│  │ 🔧 energyPolicyApply 🔄 已 45 秒                 │    │
│  │ ℹ️ 此能力可能需要较长时间完成                    │    │
│  │ 💡 想同时处理其他事？                            │    │
│  │    [转后台]  [在新分支继续 →]                   │    │
│  │                          [⏹ 取消]               │    │
│  └──────────────────────────────────────────────────┘    │
│  ℹ️ energyPolicyApply 仍在执行（已 45 秒）                │
│     直接发送将终止任务（触发 supersede）                 │
└──────────────────────────────────────────────────────────┘
```

**关键约束**：`[已实现-主干]` staged upload 已可由可信配置启用 CSV（默认仍仅 Markdown），composer 必须消费 bootstrap effective config；`[UCD目标/Clarify]` 嵌套 PIU 保存反馈尚无冻结 submit contract，如获准实现必须进入共享 composer/request lifecycle owner，不得直接调用内部 `injectQuestion`；`energyPolicyApply` 的三选择 CTA 仍按 3.4.5 的目标设计审查。

> **涉及组件**：[交互输入卡片](#333-交互输入卡片pending-input-card) · [文件下载卡片](#337-文件下载卡片file-download) · [展开面板](#322-展开面板expand-panel) · [能力卡片](#332-能力卡片capability-card) · [输入区](#335-输入区composer) · [消息气泡](#331-消息气泡message-bubble)

#### 场景 23：创建和管理 Cron 定时任务

**用户故事**：用户既可通过 Cron Tool 在会话内创建/列表/删除任务，也可通过 sidebar 的 Cron Dashboard 管理当前 trusted owner + active Agent scope 下的任务与执行记录。

```
创建：
┌─ 对话区 ────────────────────────────────────────────────┐
│  > 🧑 用户：每天 9 点检查网络拓扑                        │
│  > 🤖 助手 · ✅ 已完成                                   │
│  > 好的，我已创建定时任务。每天 09:00 会自动检查。       │
│  📋 过程面板 ▶ 已完成                                    │
│    └ 🔧 Cron ✅                                          │
│      ┌──────────────────────────────────────────────┐   │
│      │ ⏰ 定时任务已创建                              │   │
│      │ 任务 ID：cron-abc123                          │   │
│      │ 调度计划：Every day at 09:00                  │   │
│      │ 循环：✅ 是    cron 表达式：0 9 * * *         │   │
│      └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘

列表：
┌─ 能力卡片（Cron list）──────────────────────────────────┐
│  📋 当前会话有 2 个定时任务                              │
│  ┌────────────────────────────────────────────────┐     │
│  │ cron-abc123  Every day at 09:00    [循环]      │     │
│  │ 0 9 * * *                                      │     │
│  ├────────────────────────────────────────────────┤     │
│  │ cron-def456  Every 5 minutes        [循环]      │     │
│  │ */5 * * * *                                    │     │
│  └────────────────────────────────────────────────┘     │
│  （最多显示 50 条，超出截断）                            │
│            [⏰ 打开 Cron Dashboard →]                    │
└──────────────────────────────────────────────────────────┘

删除：
┌─ 能力卡片（Cron delete）────────────────────────────────┐
│  🗑️ 定时任务已删除                                       │
│  任务 ID：cron-def456                                    │
└──────────────────────────────────────────────────────────┘
```

**关键约束**：Cron Tool 使用 5 字段表达式（进程本地时区），`recurring` 默认 true，Tool list 投影 max 50 项且按 session scope；Dashboard 必须使用 Web public API 和受信 owner + active Agent scope，不得直接调用 Tool/gateway/runtime，也不得从客户端提交可信范围字段。

> **涉及组件**：[Cron 定时任务卡片](#338-cron-定时任务卡片cron-task) · [能力卡片](#332-能力卡片capability-card) · [过程面板](#321-过程面板process-panel)

#### 场景 25：宿主页面触发 AI 提问（sendQuestionToLui）

**用户故事**：用户在宿主产品页面（如网管系统告警列表）点击"询问 AI"按钮，宿主页面通过 `sendQuestionToLui` 向 NextAgent PIU 面板注入问题。PIU 面板自动打开，问题注入对话（`isSend=true` 自动发送，`isSend=false` 仅填入 composer）。仅协作式（PIU）模式可用。

**关键约束**：仅协作式（PIU）模式；调用后 PIU 面板自动打开；`question` 非空校验；`isSend` 默认 false；不改变面板布局。宿主页面→对话的 `sendQuestionToLui` 不等于 nested PIU submit contract；后者仍为 Clarify，并必须复用 shared composer/request owner。

> **涉及组件**：[展开面板](#322-展开面板expand-panel)（与 `sendQuestionToLui` 的区别章节） · [工具 UI 接口总览](#341-工具-ui-接口总览tool-ui-interface-overview)

#### 场景 26：并行工具调用（badge 为 `[UCD目标/Clarify]`）

**用户故事**：主干已能并行调用多个工具；能力卡片显示“并行 N/M”是 `[UCD目标/Clarify]`，因为 canonical batch metadata 尚未进入 public stream/history projection。

**关键约束**：每轮有副作用工具上限 5 个，只读工具上限 20 个；ToolSearch + Skill 同批次强制串行；AskUserQuestion 会中断后续工具执行；结果按模型声明顺序（非完成顺序）写入对话上下文；history 模式不显示并行徽标。

> **涉及组件**：[过程面板](#321-过程面板process-panel)（并行组合 + 并行徽标） · [能力卡片](#332-能力卡片capability-card)（并行徽标）

### 域 B：长时任务与并行工作流

#### 场景 9：长时运行（long-running）与三选择分流

**用户故事**：用户请求批量配置审计 50 台设备。执行超过 10 秒阈值后，能力卡片进入 long-running 扩展态，显示已用时计时器、进度和取消入口。`configAudit` 声明 `outputContextMode: user-choice`——审计结果可能用于后续推理（选择 1/3），也可能用户只想拿到审计报告（选择 2）——卡片底部同时显示**转后台**和**Fork 继续**两个 CTA，由用户显式选择如何处理长时任务（详见 3.4.5 长时任务分流策略）。

```
┌─ 能力卡片（long-running 扩展态）─────────────────────────┐
│  🔧 能力调用：configAudit · ⏳ 执行中（已 45 秒）        │
│  | 已用时 | 45 秒 |                                      │
│  | 进度   | 📊 23/50 台设备 |                             │
│  ℹ️ 已处理 23 台，失败 0 台                              │
│  ℹ️ 此能力可能需要较长时间完成                           │
│                                                          │
│  💡 想同时处理其他事？                                    │
│     [转后台]  [在新分支继续 →]                           │
│                                   [取消执行]             │
└──────────────────────────────────────────────────────────┘

┌─ Composer（执行中，未阻塞）──────────────────────────────┐
│  ℹ️ configAudit 仍在执行（已 45 秒）                     │
│     直接发送将终止任务（触发 supersede）                 │
│  [📎]  检查 Edge-RTR-02 的路由表…                 [发送]  │
└──────────────────────────────────────────────────────────┘
```

**三选择 CTA 可见性**（受 `outputContextMode` 调控）：
- `user-choice`（本场景 configAudit）：转后台 + Fork 继续 都显示
- `required`（输出必须进上下文，如网络诊断）：仅 Fork 继续
- `decoupled`（输出可不进上下文，如 dev server）：仅转后台

**关键约束**：无预估剩余时间；进度可选且累积；三选择 CTA 不阻断 supersede（用户可直接发送新消息触发终止，作为第四条"放弃"路径）；首轮即长时（无 COMPLETED turn）不显示 Fork 继续 CTA（无历史可携带）；转后台不可逆（任务输出不能事后注入上下文）；Fork 继续的原会话仍等待任务完成，输出进入原会话上下文。

> **涉及组件**：[能力卡片](#332-能力卡片capability-card)（long-running 扩展态 + 三选择 CTA） · [输入区](#335-输入区composer)（执行中状态提示） · 详见 [3.4.5 长时任务分流策略](#345-长时任务分流策略)

#### 场景 22：后台分离执行与任务追踪

**用户故事**：用户要求启动开发服务器，Agent 调用 Bash `run_in_background: true`——这是**后台分离执行模式**的当前实例（任务结果不参与对话上下文，模型 turn 不阻塞）。能力卡片返回 `backgroundHandle` 进入终态，卡片底部内联后台任务追踪区。用户在追踪区内查看 stdout/stderr（65536 字节限制），通过 SIGTERM 终止 RUNNING 任务。

> ℹ️ **与场景 9（长时运行）的核心区别**：场景 9 的任务结果进入模型上下文（模型阻塞等待，同一 turn 内完成）；场景 22 的任务结果不进入模型上下文（模型不阻塞，turn 立即完成，用户通过追踪区独立观测）。

```
能力卡片终态 + 追踪区（RUNNING）：
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区                              ⚡ ¹  │
│  ● 会话 A   │  > 🧑 用户：启动开发服务器                  │
│  ▸ 会话 B   │  > 🤖 助手 · ✅ 已完成                      │
│             │  > 好的，我已为你启动开发服务器。           │
│             │  📋 过程面板 ▶ 已完成                       │
│             │    └ 🔧 Bash ✅ 后台任务已启动               │
│             │      ▼ ⏳ npm run dev    [processing] 2m    │
│             │        npm run dev --port 3000     [Kill]  │
└──────────────────────────────────────────────────────────┘

追踪区展开（stdout）：
┌─ 🔧 Bash · ✅ 已完成 ──────────────────────────────┐
│  ▼ ⏳ npm run dev              [processing] 2m     │
│    npm run dev --port 3000                         │
│  stdout                              [↻ 刷新]      │
│  ┌──────────────────────────────────────────────┐ │
│  │ > next dev@14.2.3                             │ │
│  │ - Local: http://localhost:3000                │ │
│  │ ✓ Ready in 1.2s                               │ │
│  └──────────────────────────────────────────────┘ │
│                              [Kill]                │
└────────────────────────────────────────────────────┘

Kill 确认 → 终止后：
┌─ 追踪区（Kill 后）────────────────────────────────┐
│  ▶ ⏹️ npm run dev              [default] 3m12s    │
│    退出码：null（SIGTERM 终止）                    │
└────────────────────────────────────────────────────┘
```

**关键约束**：结果不参与上下文（backgroundHandle 返回后实际输出不回传模型，turn 不阻塞）；当前仅 Bash 工具支持后台分离执行；Kill 发送 SIGTERM；输出限制 65536 字节/流；列表采用一次 REST seed + `BACKGROUND_TASK_*` session stream live update，Kill 用 local override；事件不生成 ProcessPanel message entry；自然完成与 Kill 均不提交 continuation run 或 chat notification；header `⚡` 为后台任务快速查找入口。若未来需要 Agent 恢复后台结果，必须先新增明确 contract。

> **涉及组件**：[能力卡片](#332-能力卡片capability-card)（后台任务追踪区） · [过程面板](#321-过程面板process-panel)

### 域 C：会话组织与检索

#### 场景 12：会话搜索与管理

**用户故事**：用户通过关键词和时间范围搜索历史会话，搜索结果在 540px modal 中分页展示（20 条/页），并可重命名（100 字符限制）或删除（不可撤销确认）。当前收藏数据语义是 favorite turn（收藏回合），不是 session favorite；收藏入口展示被收藏回合及其所属会话信息。

```
搜索会话：
┌─ 搜索 dialog（540px modal）──────────────────────┐
│ [输入关键词…]  [📅 时间范围]                      │
│                                                   │
│ 搜索结果（20 条）                                 │
│ ┌───────────────────────────────────────────────┐ │
│ │ 网络诊断-2026-07-08                  14:30    │ │
│ │ hover → [更多 ▼]                              │ │
│ ├───────────────────────────────────────────────┤ │
│ │ 告警排查-2026-07-07                 昨天       │ │
│ │ hover → [更多 ▼]                              │ │
│ └───────────────────────────────────────────────┘ │
│ [加载更多]                                        │
└───────────────────────────────────────────────────┘

重命名会话：
┌─ 重命名会话 ──────────────────────────────────────┐
│ ┌───────────────────────────────────────────────┐ │
│ │ 网络诊断-2026-07-08-v2                        │ │
│ └───────────────────────────────────────────────┘ │
│                                     18/100        │
│                         [取消]  [确定]             │
└───────────────────────────────────────────────────┘

删除活跃会话：
┌─ 删除会话 ────────────────────────────────────────┐
│ 确定要删除"网络诊断-2026-07-08-v2"吗？此操作不可撤销│
│                         [取消]  [删除]             │
└───────────────────────────────────────────────────┘
（删除活跃会话后：对话区清空 → 导航到 / → 侧边栏回到无选中态）

查看收藏回合：
┌─ 会话列表 ───────────────┐
│ [搜索] [★收藏] [新会话]   │ ← 收藏按钮高亮
│                          │
│ ★ 收藏回合               │
│ 告警排查-07-07            │ ← 所属会话标题
│ “请分析核心告警…”   昨天   │ ← 被收藏回合的问题预览
│ 配置核查-07-06            │
│ “检查路由策略…”     07/06  │
└──────────────────────────┘
```

**关键约束**：搜索 180ms debounce；时间范围 max 90 天；删除活跃会话清空对话区并导航到 `/`；收藏视图展示 favorite turn entries。现有 legacy 方法命名不得被解释为 session favorite contract；若未来需要收藏会话，必须先定义独立聚合语义并通过 roadmap 准入。

> **涉及组件**：[会话列表项](#336-会话列表项session-list-item)

#### 场景 13：分享与派生

**用户故事**：用户从已完成的 ASSISTANT turn 分享对话片段（勾选 turn → 生成链接 → 复制/取消），或从 turn 派生新会话（点击 → busy 态 → 创建新会话 → 导航）。分享和派生模式互斥（分享模式开启时派生按钮不渲染，需先退出）。派生的新会话显示来源 banner（"由 [来源标题] 派生"），发送首条消息后消失。

```
分享对话：
┌─ Turn 2（ASSISTANT 气泡）───────────────────────────┐
│  🤖 助手 · ✅ 已完成                                │
│  ## 诊断结论                                        │
│  Edge-RTR-02 在 08:45 的配置变更中……               │
│                                                    │
│  👍  👎  ⭐  🔗 分享  🔀 派生  ↻ 重试               │
│              ↑                                      │
│              点击分享 → 打开分享对话框               │
└────────────────────────────────────────────────────┘

┌─ 分享对话 ────────────────────────────────────────┐
│ 选择要分享的 turn：                                │
│ ☑ Turn 1: 检查 Edge-RTR-02 丢包问题               │
│ ☐ Turn 2: 查询 DHCP 地址池状态                    │
│ [生成分享链接]                                     │
└───────────────────────────────────────────────────┘

          ↓

┌─ 分享对话 ────────────────────────────────────────┐
│ ✅ 分享链接已生成                                  │
│ https://nextagent.example.com/share/abc123...      │
│ [复制链接]  [取消分享]                             │
└───────────────────────────────────────────────────┘

派生新会话（点击 → busy 态 → 成功导航）：
┌─ Turn 2（ASSISTANT 气泡）───────────────────────────┐
│  🤖 助手 · ✅ 已完成                                │
│  ## 诊断结论                                        │
│  Edge-RTR-02 在 08:45 的配置变更中……               │
│                                                    │
│  👍  👎  ⭐  🔗 分享  🔀 派生(disabled)  ↻ 重试     │
│                          ↑                          │
│                          busy 态：disabled + opacity 0.55
│                          tooltip "正在派生..."，无 spinner
└────────────────────────────────────────────────────┘

          ↓ 成功

┌─ Fork notice banner ──────────────────────────────┐
│ 由 "网络诊断-2026-07-08" 派生                      │
└───────────────────────────────────────────────────┘

┌─ Turn 1（USER 气泡）────────────────────────────────┐
│  🧑 用户                          ← 从派生点复制的  │
│  检查 Edge-RTR-02 丢包问题         上下文            │
└────────────────────────────────────────────────────┘

┌─ Turn 2（ASSISTANT 气泡）───────────────────────────┐
│  🤖 助手 · ✅ 已完成              ← 从派生点复制的  │
│  ## 诊断结论                      上下文            │
│  Edge-RTR-02 在 08:45 的配置变更中……               │
│                                                    │
│  👍  👎  ⭐  🔗 分享  🔀 派生  ↻ 重试               │
└────────────────────────────────────────────────────┘

┌─ Composer ────────────────────────────────────────┐
│ [📎]  输入消息…                          [发送]    │
└───────────────────────────────────────────────────┘

          ↓ 失败（替代路径）

  ⚠️ 派生会话失败，请稍后重试。   ← error toast，原会话不变，按钮恢复

          ↓ 用户在派生会话中发首条消息（banner 消失）

（banner 消失）
┌─ Turn 3（USER 气泡）────────────────────────────────┐
│  🧑 用户                          ← 新消息（首条，  │
│  那配置变更对 OSPF 邻居有什么影响？ 触发 banner 消失）│
└────────────────────────────────────────────────────┘
┌─ Turn 4（ASSISTANT 气泡）───────────────────────────┐
│  🤖 助手 · ⏳ 执行中              ← 新 turn 追加到  │
│  ...                             复制上下文之后      │
└────────────────────────────────────────────────────┘
```

**关键约束**：派生需 COMPLETED 状态且有答案内容（失败/取消/被取代/执行中不可派生）；派生 busy 态为按钮 disabled + opacity 0.55 + tooltip "正在派生..."（无 spinner，图标不变）；派生成功导航到新会话 + 刷新列表（无成功 toast）；派生失败显示 error toast "派生会话失败，请稍后重试。"，保留原会话不导航；fork notice banner 在 history 中持久，首条消息提交后消失（`clearForkNotice` + USER envelope 检测）。

> **涉及组件**：[消息气泡](#331-消息气泡message-bubble)（分享/派生操作） · [会话列表项](#336-会话列表项session-list-item)

### 域 D：错误与异常恢复

#### 场景 5：断线重连

**用户故事**：SSE/WebSocket 传输中断时，UI 经历三阶段连续性状态（连接不稳定 → 已断开 → 已恢复），已收到的内容保持可见。重连时客户端发送 `lastSeenSequence` cursor，后端 replay 缺口事件后恢复 live-tail，用户无感知数据丢失。

```
阶段 5.1：连接不稳定
> 🔴 连接不稳定
> 正在尝试维持连接……已收到的内容保持可见。
> 🤖 助手 · 执行中 ⏳
> （已收到的部分回复内容保持可见）

阶段 5.2：已断开
> ⚫ 已断开
> 点击重连。已收到的对话内容不会丢失。
> 🤖 助手 · 执行中 ⏳
> （已收到的部分回复内容保持可见）
  [重新连接]

阶段 5.3：重连成功
> 🟢 已恢复连接
> 已补齐断线期间遗漏的事件，继续接收实时更新。
> 🤖 助手 · ✅ 已完成
> （完整回复，含断线期间生成的部分已按序补入）
```

**关键约束**：传输关闭 MUST NOT 生成假终态事件（REQUEST_COMPLETED/FAILED/CANCELED）；已收到内容保持可见；重连使用 `lastSeenSequence` cursor 进行 gap replay。

> **涉及组件**：[消息气泡](#331-消息气泡message-bubble)与当前会话 stream status（连接状态指示）。会话列表消费独立 Session Activity，不消费 `continuityPhase`。

#### 场景 6：路径被策略拒绝（CAPABILITY_PATH_REJECTED）

**用户故事**：用户请求读取被后端策略阻止的路径（如 `/etc/secrets/config`），能力卡片渲染安全错误状态，仅显示 `safeErrorCode` + `safeSummary`，不暴露被拒绝的路径、文件系统详情或策略内部。run 不因路径拒绝而失败，模型继续下一轮并给出有用提示。

```
> 🧑 用户
> 读取 /etc/secrets/config 文件

> 🤖 助手 · 执行中 ⏳

> 🔧 能力调用：read · ❌ 失败
> ┌──────────────┬──────────────────────────────┐
> │ 能力 ID      │ read                         │
> │ 错误码       │ CAPABILITY_PATH_REJECTED     │
> │ 失败摘要     │ 路径访问被策略阻止            │
> └──────────────┴──────────────────────────────┘
> ❌ 路径被策略拒绝
> Path access was blocked by policy.

> 🤖 助手 · ✅ 已完成（run 未因路径拒绝而失败）
> 该路径无法访问。我已尝试读取该文件，但被安全策略阻止。
> 请提供项目工作区内的文件路径……
```

**关键约束**：`CAPABILITY_PATH_REJECTED` 不升级为 run 失败；用户可读原因仅从 `safeErrorCode` + `safeSummary` 派生；MUST NOT 暴露被拒绝路径/文件系统详情/策略内部；MUST NOT 暗示能力执行成功。

> **涉及组件**：[能力卡片](#332-能力卡片capability-card)（失败状态） · [消息气泡](#331-消息气泡message-bubble)

### 域 E：交互输入与上下文

#### 场景 3：Pending Input 全 kind 矩阵

**用户故事**：Agent 在执行中需要用户交互——确认高风险操作、回答问题、授权高危变更、人工接管。4 种 kind 视觉区分：AUTHORIZATION 有 2px primary 边框 + 蓝色徽章。

```
┌─ CONFIRMATION ──────────────────────────────────────────┐
│  📝 需要确认                                  ⏱ 4:32    │
│  检测到模拟高风险操作，是否继续执行？                    │
│  风险等级：🟡 中                                         │
│  [继续执行]              [暂不执行]                      │
└──────────────────────────────────────────────────────────┘

┌─ QUESTION ──────────────────────────────────────────────┐
│  请回答以下问题                                ⏱ 4:32    │
│  1. 核查范围是什么？                                     │
│    ○ 全部核心设备  ○ 仅边缘设备  ○ 自定义               │
│  2. 优先检查哪些项？（可多选）                           │
│    ☐ 接口配置  ☐ 路由表  ☐ ACL 规则                    │
│  [取消]                                       [提交]     │
└──────────────────────────────────────────────────────────┘

┌══ AUTHORIZATION ══════════════════════════════════════╗  ← 2px 边框
║  检测到高危配置变更操作        [授权请求] ⏱ 4:32      ║  ← 蓝色徽章
║  此操作将修改核心交换机路由策略……                      ║
║  [拒绝]                        [批准执行]             ║
╚════════════════════════════════════════════════════════╝

┌─ HUMAN_HANDOFF ─────────────────────────────────────────┐
│  人工接管                                     ⏱ 4:32    │
│  接管模式：○ 最终答案  ○ 恢复指令                        │
│  交接内容：[请描述需要人工处理的具体问题…      ] 0/500  │
│  [取消]                                       [提交]     │
└──────────────────────────────────────────────────────────┘
```

**关键交互**：所有 kind 共享同一生命周期：USER_INPUT_REQUIRED → RECEIVED / TIMEOUT / CANCELED。

> **涉及组件**：[交互输入卡片](#333-交互输入卡片pending-input-card)

#### 场景 24：上下文压缩——长对话中的上下文窗口管理

**用户故事**：长对话中上下文窗口接近限制时，系统触发压缩——较早的对话被总结为 SUMMARY 消息，`CONTEXT_COMPACTED` 事件推送双重呈现：过程面板出现 📦 压缩条目（持久），ASSISTANT 气泡内出现瞬时通知（~3 秒后消失）。压缩后 Agent 基于摘要继续回答，用户可通过 `contextVersion` 感知上下文已变化。history 模式下压缩条目由持久化消息重建，瞬时通知不重建（live-only）。

```
阶段 24.2：压缩触发（双重呈现）
┌─ 对话区 ────────────────────────────────────────────────┐
│  ...（Turn 1-5 已折叠，上下文约 92% 已用）               │
│                                                          │
│  Turn 6: 综合诊断报告                                    │
│  > 🧑 用户：综合以上所有诊断结果，生成完整报告           │
│  > 🤖 助手 · 执行中 ⏳                                   │
│                                                          │
│  ┌─ 📋 过程面板（auto-expanded ▼）──────────────────┐   │
│  │  💭 思考 #1 · ⏳ 进行中                             │   │
│  │  ────────                                          │   │
│  │  📦 上下文已压缩            ← 压缩条目（持久）      │   │
│  │  已压缩较早上下文以继续处理当前长回复。              │   │
│  │  （reason: CONTEXT_WINDOW_POLICY）                  │   │
│  │  压缩 3 条消息，剩余 4200 tokens                     │   │
│  │  contextVersion: v2                                 │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  > 🤖 助手回复（流式追加中）...                          │
│                                                          │
│           📦 上下文已压缩              ← 瞬时通知        │
│        （3 秒后自动消失）              （live-only）      │
└──────────────────────────────────────────────────────────┘
```

**关键约束**：压缩是可选事件（仅上下文窗口接近限制时触发）；双重呈现（过程面板条目持久 + 瞬时通知 live-only ~3 秒）；MUST NOT 暴露被压缩的 prompt/模型输出/原始消息正文/上下文引擎内部状态；history 模式 SUMMARY 消息过滤但压缩通知独立重建。

> **涉及组件**：[过程面板](#321-过程面板process-panel)（📦 压缩条目 + 瞬时通知）

### 域 F：编辑与修正

#### 场景 10：请求被取代（Supersede）

**用户故事**：turn 执行中，用户通过编辑按钮或 `/edit` 命令修改原始消息。Composer 进入编辑模式（primary 边框 + 蓝色阴影），用户修改文本后提交，旧 turn 标记为 `SUPERSEDED`，新 turn 以修正后的消息开始。旧消息文本被替换（不保留为独立条目），过程面板为新 turn 重启。

```
10a：原始消息已发送
> 🧑 用户
> 检查 Edge-RTR-01 的丢包问题

> 🤖 助手 · 执行中 ⏳
> ┌─ 📋 过程面板 ──────────────────────┐
> │ 💭 思考 #1 · ⏳ 进行中              │
> └────────────────────────────────────┘

10b：用户点击编辑（Composer 进入 edit 模式）
┌─ Composer（edit 模式）──────────────────────────┐
│ [编辑模式]                                        │ ← primary 边框 + 蓝色阴影
│ 检查 Edge-RTR-02 的丢包问题          [✕] [⬆]   │
└──────────────────────────────────────────────────┘

10c：编辑提交后，旧 turn 被取代
> 🧑 用户
> 检查 Edge-RTR-01 的丢包问题
> 🔁 被取代                                      ← 旧 turn 终态

> 🧑 用户
> 检查 Edge-RTR-02 的丢包问题                    ← 新 turn（编辑后）

> 🤖 助手 · 执行中 ⏳
> ┌─ 📋 过程面板 ──────────────────────┐
> │ 💭 思考 #1 · ⏳ 进行中              │
> └────────────────────────────────────┘
```

**关键约束**：编辑模式草稿与正常 per-session 草稿隔离；旧 turn 终态显示 `🔁 被取代`；取消编辑通过 ✕ 或 Escape；确认编辑通过发送按钮或 Enter。

> **涉及组件**：[输入区](#335-输入区composer)（编辑模式） · [消息气泡](#331-消息气泡message-bubble)（SUPERSEDED 终态） · [过程面板](#321-过程面板process-panel)

### 域 G：委派与能力扩展

#### 场景 14：Sub-agent 委派

**用户故事**：模型将子任务委派给子 agent（如 `network-explorer`），在过程面板中呈现为不透明的单步 Agent 能力卡片——子 agent 的内部思考、工具调用、降级均不可见于父 turn。卡片显示 running 态（子 run 以低优先级执行，父 turn 阻塞等待），完成后只显示业务身份和成功状态，模型基于内部返回数据生成最终回答。

```
14.1：Agent 工具调用中（running）
> 🧑 用户
> 探测核心交换机 Core-SW-01 的邻居拓扑

> 🤖 助手 · 执行中 ⏳

> 📋 过程面板（auto-expanded ▼）
> 💭 思考 #1 · ✅ 已完成（已折叠）
> 🔧 能力调用：Agent · ⏳ 执行中
> ┌──────────┬──────────────────────────────────────┐
> │ 能力 ID  │ Agent                                 │
> │ 参数     │ agentId=network-explorer,             │
> │          │ prompt=探测 Core-SW-01 邻居拓扑       │
> │ 状态     │ 执行中                                │
> └──────────┴──────────────────────────────────────┘
> ℹ️ 子 agent 在独立 session/run 中执行（priority: LOW）
>    父 turn 阻塞等待。内部过程不可见。

14.2：子 agent 执行完成
> 📋 过程面板（auto-expanded ▼）
> 💭 #1 ✅（已折叠）
> 🔧 能力调用：Agent · ✅ 已完成
> ┌──────────┬──────────────────────────────────────┐
> │ 能力 ID  │ Agent                                 │
> │ 状态     │ 已完成                                │
> │ 结果     │ 不显示（STATUS_ONLY）                  │
> └──────────┴──────────────────────────────────────┘

14.3：模型基于子 agent 结果生成最终回答
> 📋 过程面板（auto-collapsed ▶ 已完成）

> 🤖 助手 · ✅ 已完成
> ## Core-SW-01 邻居拓扑
> ┌──────────┬──────────────┬──────────────┬──────┐
> │ 邻居接口  │ 邻居设备      │ 邻居接口     │ 状态 │
> ├──────────┼──────────────┼──────────────┼──────┤
> │ Gi0/1    │ Edge-RTR-01  │ Gi0/0        │ up   │
> │ Gi0/2    │ Access-SW-01 │ Gi0/24       │ up   │
> │ Gi0/3    │ Access-SW-02 │ Gi0/24       │ down │
> └──────────┴──────────────┴──────────────┴──────┘
```

**关键约束**：子 agent 内部过程不透明（单步卡片，子 run 的思考/工具调用/降级不可见）；禁止嵌套委派（子 run 不可调用 Agent 或 AskUserQuestion）；子 run 以 `priority: LOW` 执行。

> **涉及组件**：[能力卡片](#332-能力卡片capability-card)（Agent kind） · [过程面板](#321-过程面板process-panel) · [消息气泡](#331-消息气泡message-bubble)

> 来源：`08-sample-scenarios.md`

---

## 第 5 章：未覆盖的设计场景

以下 7 个场景按设计覆盖程度分 2 类，供产品决策是否补充设计：

### A 类：UCD 完全未设计（1 个）

| 缺口 | 关联域 | 说明 |
|---|---|---|
| 多用户协作 | A/C | 同一会话多人协同，当前是单用户模型 |

### B 类：UCD 部分覆盖（6 个）

| 缺口 | 已覆盖 | 未覆盖 |
|---|---|---|
| 只读分享与权限分级 | 场景 13 分享链接生成 modal | 被分享者只读查看、权限分级、链接撤销 |
| 跨设备主动通知 | 会话内未读结果/失败 Activity 已交付 | 跨设备/跨会话 push、toast 或声音的投递策略；不得重建第二套 unread truth |
| 导出与报告 | `file-download.md` Agent 生成文件下载 | 用户主动导出对话为 PDF/邮件 |
| 后端服务降级/熔断 | `degradation-notice.md` 子系统级降级提示 | 服务整体降级/熔断全局 UI |
| 首次使用引导 | `06` 欢迎状态 + 高频问题 | 结构化 onboarding 教程 |
| 会话内消息搜索 | 旅程 15 会话级搜索 | 消息内容级全文搜索交互 |

> 详细表见 `README.md` "未覆盖与待落地的业务场景"章节。

---

## 附录：深入查阅路径

| 想了解 | 查阅 |
|---|---|
| 用户画像详情 | `00-user-personas.md` |
| 27 条旅程完整步骤 | `01-user-journeys.md` |
| 全屏布局交互时序 | `03-full-ui-layout.md` |
| 区域职责与导航关系 | `04-information-architecture.md` |
| 某个组件的完整规范 | `05-component-specs/` 对应文件 |
| 空/加载/错误状态 | `06-empty-loading-error-states.md` |
| 文案规则 | `07-content-copy.md` |
| 全部 27 个场景的渲染样例 | `08-sample-scenarios.md` |
| 文档导航与快速查阅 | `README.md` |
| think 呈现与安全过滤策略 | 本文 §3.4.4 / `02` 第 1.6 节 |
| 契约层（safe field、事件映射） | `openspec/designs/architecture/conversation-ui-state.md` |
