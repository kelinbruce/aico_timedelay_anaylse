# 功能特性总览表

> 长期设计导航：`openspec/designs/architecture/conversation-ui-state.md`。当前事实必须与 stable/active OpenSpec、public contracts、当前代码和测试交叉核对；本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。
>
> **状态基线（2026-08-13，`origin/main@4f27c4a9f`）**：`[已实现-主干]` 指代码与测试已进入该主干基线；规格仍位于 active change 时另行标明待归档，不等于 Stable Spec 已同步。`[UCD目标]` 指尚未交付的目标设计。任务准入以 owning stable/active spec 与 [`docs/roadmap/ucd-capability-delivery.md`](../roadmap/ucd-capability-delivery.md) 为准。

## 目的

本文是一张从"用户能做什么"视角的总览表，回答"NextAgent 给用户提供了哪些功能特性"这个最直接的问题。

**双重用途**：

1. **新成员全景概览**——新开发者/产品成员不读 11 篇主文档 + 15 篇组件规范也能建立"NextAgent 让用户能做什么"的全景认知
2. **干系人能力清单**——高管/产品经理一张表看清系统能力清单与业务价值

## 读者

- 新加入 NextAgent 项目的开发者、产品经理、设计人员
- 需要快速了解系统能力清单的高管与干系人
- 需要对照功能清单查找对应规范与旅程的 UCD 设计人员

## 如何使用本表

1. **快速扫读**：按 8 个功能类别扫读 42 个功能行，建立全景认知
2. **定位深入**：通过"关联旅程"列跳转 `01-user-journeys.md` 了解用户旅程细节，通过"关联规范"列跳转 `05-component-specs/*.md` 了解组件规范
3. **对照实现**：如需了解功能当前的实现状态（已实现 / 部分实现 / 未实现），参见 `10-implementation-gap-analysis.md`

> ℹ️ 本表只描述**目标态**功能。实现 gap 由 `10-implementation-gap-analysis.md` 单独跟踪。

## 功能特性总览

### ▎1. 对话输入与发送（9 个）

核心对话输入能力。

| 功能 | 用户能做什么 | UI 位置 | 用户价值 | 关联旅程 | 关联规范 |
|---|---|---|---|---|---|
| 提问到答案 | 输入问题、发送、收流式回复 | Composer + 对话区 | 核心对话能力，从提问到答案的完整路径 | 旅程 1 | composer.md, message-bubble.md |
| 附件上传 | 拖拽/粘贴/选择附件发送 | Composer | 多模态输入，支持图片/CSV/文件 | 旅程 2 | composer.md |
| pending input 应答 | 对 Agent 的确认/授权/问答应答 | 对话区 pending input 卡片 | 高危操作显式授权，Agent 主动交互 | 旅程 3 | pending-input-card.md |
| 编辑重发 | 修改最近用户消息重发 | 对话区消息气泡 hover | 快速修正，无需重开会话 | 旅程 8 | message-bubble.md |
| 并行工具调用 | 一次对话触发多个工具并行执行 | 过程面板 | 复杂任务并行处理，缩短等待 | 旅程 27 | process-panel.md, capability-card.md |
| Skill 选择与使用 | 在 Composer 选择/切换 Skill，触发对应能力 | Composer SkillSelector | 明确意图定向，激活特定 Agent 能力 | 旅程 1 | composer.md, 12-integrator-customization-guide.md |
| 快捷问题入口 | 点击高频问题/分类问题模板快速发送 | Composer 引导区 | 降低输入成本，引导新用户 | 旅程 1 | composer.md, 12-integrator-customization-guide.md |
| 推荐后续问题 | 查看并点击助手推荐的后续问题 | 助手消息气泡底部 | 引导深入对话，降低思考成本 | 旅程 1 | message-bubble.md |
| Slash 命令 | 输入 `/` 触发命令面板，高亮选择并补全 | Composer slash 面板 | 快速触发指令，减少输入 | 旅程 1 | composer.md |

### ▎2. 过程查看与控制（6 个）

执行过程的可观测与控制。

| 功能 | 用户能做什么 | UI 位置 | 用户价值 | 关联旅程 | 关联规范 |
|---|---|---|---|---|---|
| 多轮思考与工具调用 | 查看思考过程、能力调用、中间结果 | 过程面板 | 过程透明，理解 Agent 推理路径 | 旅程 12 | process-panel.md, capability-card.md |
| Run Graph 查看 | 打开 Run Graph 抽屉查看完整执行时间线 | 过程面板 → Run Graph 抽屉 | 复杂流程回溯，调试与审计 | 旅程 19 | process-panel.md |
| 取消与重试 | 取消执行中请求，重试失败请求 | 能力卡片 + 对话区 | 用户主动控制，错误恢复 | 旅程 9, 10 | capability-card.md, message-bubble.md |
| 执行中发新消息（supersede） | 执行中直接发新消息终止旧请求 | Composer | 不等了就发新问题，旧请求被取代 | 旅程 17 | composer.md, message-bubble.md |
| 降级提示查看 | 查看 capability 降级原因 | 过程面板 | 理解为何结果不完整 | 旅程 12 | degradation-notice.md |
| 快捷键操作 | 通过键盘快捷键执行常用操作（取消/重试/编辑/折叠面板等） | 全局 | 提升效率用户操作速度 | - | 02-dynamic-behavior-and-interaction.md |

### ▎3. 长时任务与后台执行（4 个）

长时任务分流与后台执行。

| 功能 | 用户能做什么 | UI 位置 | 用户价值 | 关联旅程 | 关联规范 |
|---|---|---|---|---|---|
| 三选择分流 | 长时任务执行中选择等待/转后台/Fork 继续 | 能力卡片底部 CTA | 长时任务不阻塞，输出与上下文关系由用户决定 | 旅程 14 | capability-card.md, conversation-ui-state.md |
| 多会话后台 run | 切换会话后原会话 run 继续执行 | 会话列表 `⚡` 指示 | 多会话并行工作，不互相阻塞 | 旅程 13 | session-list-item.md |
| 后台任务监控 | 查看/Kill 后台任务（shell/tool 两类） | 后台任务监控面板 | 转后台任务的可观测与控制 | 旅程 24 | background-task-monitor.md |
| Cron 定时任务管理 `[已实现-主干]` | sidebar route；任务/执行记录 Tab；当前 trusted owner + active Agent scope 下的查询、创建、修改、删除、启停与立即执行 | Cron Dashboard | 定时自动化，任务管理 | 旅程 25 | cron-task.md |

### ▎4. 会话组织与检索（5 个）

会话管理与检索。

| 功能 | 用户能做什么 | UI 位置 | 用户价值 | 关联旅程 | 关联规范 |
|---|---|---|---|---|---|
| 历史对话浏览 | 切换/浏览历史会话 | 会话列表 | 回溯历史工作 | 旅程 5 | session-list-item.md |
| 当前会话快速定位 | 通过 preview marker 悬停查看摘要、点击跳转到长会话目标回合 | 会话列表与主对话区之间的预览轨道 | 在 200～300 轮会话中快速定位，不触发过程请求风暴 | 旅程 5 | conversation-preview-rail.md |
| 会话搜索与管理 | 搜索/重命名/删除会话；查看当前 favorite turn 条目 | 会话列表 + 搜索 dialog | 快速定位历史会话与已收藏回合 | 旅程 15 | session-list-item.md |
| 派生新会话（消息级 fork） | 从已完成 turn 派生新会话 | 对话区消息气泡 | 基于历史点探索不同方向 | 旅程 11 | message-bubble.md |
| 会话分享 | 分享会话链接给他人 | 对话区分享按钮 | 协作与知识传递 | 旅程 11 | message-bubble.md |

### ▎5. 富内容展示与交互（6 个）

富内容呈现与交互。

| 功能 | 用户能做什么 | UI 位置 | 用户价值 | 关联旅程 | 关联规范 |
|---|---|---|---|---|---|
| 右侧展开面板富内容 | 查看地图/图表/PIU 等富内容 | 右侧展开面板 | 复杂结果可视化呈现 | 旅程 20 | expand-panel.md |
| 文件下载 | 下载 Agent 生成的文件 | 对话区文件下载卡片 | 结果落地为可分发文件 | 旅程 22 | file-download.md |
| 扩展面板审核配置保存 | 在扩展面板审核/修改配置并保存反馈 | 右侧展开面板 PIU | 交互式审核，配置反馈到对话 | 旅程 23 | expand-panel.md |
| `[UCD目标/部分实现]` 导航卡片跳转 | 当前 OPERATOR 只渲染普通按钮并支持点击 dispatch；目标 LINK 专门卡片用于通知集成方跳转 | 对话区 OPERATOR 内容 | 跨系统联动，从告警直达配置 | 旅程 21 | sub-window.md |
| 内嵌 PIU/DSL 富内容 | 在对话气泡内查看 PIU/DSL 渲染的富交互组件 | 对话区消息气泡 | 集成方自定义富内容嵌入对话流 | 旅程 20 | message-bubble.md, 12-integrator-customization-guide.md |
| `[已实现/需安全加固]` ACTION 自动触发 | 当前会自动 dispatch，但 live re-render/remount 与 history replay 可能重复触发；未冻结 at-most-once/idempotency | 对话区（隐式触发） | 跨系统自动化联动候选，未完成安全准入 | 旅程 21 | sub-window.md, 12-integrator-customization-guide.md |

### ▎6. 错误与异常恢复（4 个）

异常场景恢复。

| 功能 | 用户能做什么 | UI 位置 | 用户价值 | 关联旅程 | 关联规范 |
|---|---|---|---|---|---|
| 断线重连 | 网络中断后自动重连恢复 | 全局重连提示 | 网络抖动下不丢失工作 | 旅程 4 | 06-empty-loading-error-states.md |
| 路径拒绝提示 | 查看被策略拒绝的原因 | 对话区拒绝消息 | 理解为何操作不被允许 | 旅程 7 | message-bubble.md |
| 页面关闭与重开 | 关闭/刷新后恢复会话状态 | 全局 | 工作连续性，不因关闭丢失 | 旅程 18 | 06-empty-loading-error-states.md |
| 流式恢复 gap 处理 | stream resume 时 gap/failure 提示 | 对话区 | 历史与 live 一致性保障 | 旅程 18 | 06-empty-loading-error-states.md |

### ▎7. 上下文管理（2 个）

上下文窗口管理。

| 功能 | 用户能做什么 | UI 位置 | 用户价值 | 关联旅程 | 关联规范 |
|---|---|---|---|---|---|
| 上下文压缩 | 长对话自动压缩，用户可查看压缩通知 | 过程面板压缩条目 | 长对话不因上下文超限中断 | 旅程 6 | process-panel.md, message-bubble.md |
| 上下文监控 | 查看 active context 状态（设计建议） | 过程面板（待定） | 理解上下文窗口使用情况 | 旅程 6 | process-panel.md |

### ▎8. 集成与扩展（6 个）

嵌入模式与能力扩展。

| 功能 | 用户能做什么 | UI 位置 | 用户价值 | 关联旅程 | 关联规范 |
|---|---|---|---|---|---|
| 嵌入模式切换 | local/immersive/piu 三种模式 | 全局 | 灵活适配部署场景 | - | 04-information-architecture.md |
| Sub-agent 委派 | Agent 调用子 agent 处理专长任务 | 过程面板 Agent 卡片 | 领域专长扩展 | 旅程 16 | capability-card.md |
| 宿主页面触发提问 | 从宿主页面"询问 AI"按钮触发 | PIU 宿主面板 | 集成方页面内嵌 AI 能力 | 旅程 26 | composer.md |
| 宿主历史聊天回放 `[已实现-主干]` | 宿主按 `chatId` 注入 PIU 历史内容，打开协作面板并在消息列表上方展示 | PIU 宿主面板的对话滚动区 | 在不写入 canonical conversation 的前提下展示宿主历史业务内容 | - | 12-integrator-customization-guide.md |
| PIU 协作式嵌入 | 作为面板嵌入宿主页面，支持 docked/floating/maximized/minimized 四态 | PIU docked/floating/maximized/minimized | 宿主产品内嵌 NextAgent，灵活适配工作流 | 旅程 26 | 04-information-architecture.md, 12-integrator-customization-guide.md |
| 自定义功能入口 | 通过 operators 注入自定义按钮/卡片/链接到侧边栏或顶部 | 侧边栏/顶部 operators 区 | 集成方扩展 NextAgent 功能边界，接入自有系统 | - | 12-integrator-customization-guide.md |

## 功能特性 UI 热点图

以下 mockup 标注 42 个功能在界面上的位置。编号沿用各类别表格顺序；`—` 表示全局/跨区域功能，无单一定位点。

```
┌──────────────┬──────────────────────────┬─────────────────────┐
│ 会话列表      │ 对话区                    │ 右侧展开面板        │
│              │                          │                     │
│ [8.5] 自定义 │  ┌─ 过程面板 ──────────┐ │ [5.1] 右侧展开面板  │
│  功能入口    │  │ [2.1] 多轮思考+工具  │ │  富内容（地图/图表  │
│  (operators) │  │ [1.5] 并行工具调用   │ │  /PIU）            │
│              │  │ [2.5] 降级提示查看   │ │                     │
│ [4.1] 历史对  │  │ [7.1] 上下文压缩通知 │ │ [5.3] 扩展面板审核  │
│  话浏览       │  │ [7.2] 上下文监控     │ │  配置保存（PIU）    │
│              │  │ [8.2] Sub-agent 委派│ │                     │
│ [4.2] 搜索    │  │   [2.2] Run Graph   │ │                     │
│  +管理       │  │    查看（抽屉）      │ │                     │
│              │  └─────────────────────┘ │                     │
│ [3.2] 多会话  │  ┌─ 消息流 ────────────┐ │                     │
│  后台 run ⚡  │  │ 🧑 USER 气泡        │ │                     │
│              │  │   [1.4] 编辑重发    │ │                     │
│              │  │   [4.3] 派生新会话  │ │                     │
│              │  │   [4.4] 会话分享    │ │                     │
│              │  │                     │ │                     │
│              │  │ 🤖 ASSISTANT 气泡   │ │                     │
│              │  │   [2.3] 取消/重试   │ │                     │
│              │  │   [5.2] 文件下载    │ │                     │
│              │  │   [5.4] 导航卡片跳转│ │                     │
│              │  │   [5.5] 内嵌 PIU/DSL│ │                     │
│              │  │    富内容           │ │                     │
│              │  │   [6.2] 路径拒绝提示│ │                     │
│              │  │   [6.4] 流式恢复 gap│ │                     │
│              │  │   [1.8] 推荐后续问题│ │                     │
│              │  │ [1.3] pending input │ │                     │
│              │  │   应答卡片          │ │                     │
│              │  └─────────────────────┘ │                     │
│              │  ┌─ Composer ──────────┐ │                     │
│              │  │ [1.1] 提问到答案    │ │                     │
│              │  │ [1.2] 附件上传      │ │                     │
│              │  │ [1.6] Skill 选择    │ │                     │
│              │  │ [1.7] 快捷问题入口  │ │                     │
│              │  │ [1.9] Slash 命令    │ │                     │
│              │  │ [2.4] 执行中发新    │ │                     │
│              │  │   消息（supersede） │ │                     │
│              │  └─────────────────────┘ │                     │
├──────────────┴──────────────────────────┴─────────────────────┤
│ [3.3] 后台任务监控面板（header ⚡ 下拉）                        │
│ [3.4] Cron 定时任务管理面板                                    │
│ [6.1] 断线重连（全局重连提示条）                                │
└───────────────────────────────────────────────────────────────┘

跨区域/全局功能（无单一定位点）：
  [3.1] 三选择分流      — 能力卡片底部 CTA（长时任务触发时出现）
  [2.6] 快捷键操作      — 全局（键盘事件）
  [5.6] ACTION 自动触发 — 对话区（隐式 dispatch，集成方监听）
  [6.3] 页面关闭与重开  — 全局（sessionStorage 恢复）
  [8.1] 嵌入模式切换    — 全局（local/immersive/piu 三种 HostMode）
  [8.3] 宿主页面触发提问 — PIU 宿主面板（仅 piu 模式）
  [8.4] PIU 协作式嵌入   — PIU docked/floating/maximized/minimized（仅 piu 模式）
  [8.6] 宿主历史聊天回放 — PIU 对话滚动区消息列表上方（仅 piu 模式）
```

> ℹ️ 本图展示典型对话场景的功能定位。部分功能（如 [3.1] 三选择分流、[2.2] Run Graph）仅在特定触发条件下出现，非默认可见。

## 与其他 UCD 文档的导航关系

| 方向 | 目标文档 | 用途 |
|---|---|---|
| → | `01-user-journeys.md` | 通过"关联旅程"列了解每个功能的用户旅程细节 |
| → | `05-component-specs/*.md` | 通过"关联规范"列了解每个功能的组件规范 |
| → | `10-implementation-gap-analysis.md` | 了解每个功能当前的实现状态与 gap |
| → | `09-product-team-briefing.md` | 了解目标态能力清单与场景化 UI 表达 |
| ← | `README.md` | 文档索引，本表作为推荐入口 |

## 维护策略

- **新增功能**：在对应类别下追加一行
- **状态变化**：在 `10-implementation-gap-analysis.md` 中跟踪实现状态，本表只描述目标态
- **类别调整**：8 个类别是稳定的分类轴，新增类别需评估是否真的属于新分类
- **列变更**：6 列设计已覆盖 what/where/why + 导航，预计长期稳定
