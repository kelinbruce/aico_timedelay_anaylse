# UCD 设计文档阅读指南

> 本目录是 NextAgent 对话界面的 UCD 设计表达层，非 OpenSpec 基线，不定义契约。通用界面状态导航入口是 `openspec/designs/architecture/conversation-ui-state.md`；thinking persistence、Event history、fork snapshot 和浏览器 hydration 的权威长期设计是 `openspec/designs/architecture/conversation-process-history.md`。当前事实仍需同时核对 owning stable specs、代码与下述状态基线。

> **状态基线（2026-08-13，`origin/main@4f27c4a9f`）**：`[已实现-主干]` 指代码与测试已进入该主干基线；其规格若仍位于 active change，会在对应段落明确“待归档”，不得据此声称 Stable Spec 已同步。`[UCD目标]` 指尚未交付的目标设计。任务准入以 owning stable/active spec 与 [`docs/roadmap/ucd-capability-delivery.md`](../roadmap/ucd-capability-delivery.md) 为准。

本指南帮助 UCD 设计人员快速定位所需文档。首次阅读请按"阶段 1→5"顺序通读；日常设计按"快速查阅表"直接定位。

---

## 首次阅读路径（5 个阶段，约 90 分钟）

### 阶段 1：理解用户与场景（约 15 分钟）

| 顺序 | 文档 | 一句话描述 | 预估时长 |
|---|---|---|---|
| 1 | [`00-user-personas.md`](00-user-personas.md) | 3 类目标用户（网络运维工程师、运维主管、平台开发者）及其目标与痛点 | 5 分钟 |
| 2 | [`01-user-journeys.md`](01-user-journeys.md) | 27 条用户旅程（提问到答案、附件、pending input、断线重连、历史浏览、压缩、路径拒绝、编辑重发、取消/重试、派生、多轮思考、多会话后台 run、长时运行、会话搜索、Sub-agent 委派、执行中发新消息、页面关闭与重开、查看 Run Graph、查看右侧展开面板富内容、从对话通知集成方打开系统页面、下载 Agent 生成的文件、在扩展面板中审核修改配置并保存、监控后台任务执行、管理定时任务、宿主页面触发 AI 提问、并行工具调用） | 10 分钟 |

**读完应知道**：界面为谁设计、典型使用场景、哪些交互流程必须支持。

### 阶段 2：建立整体视觉框架（约 20 分钟）

| 顺序 | 文档 | 一句话描述 | 预估时长 |
|---|---|---|---|
| 3 | [`03-full-ui-layout.md`](03-full-ui-layout.md) | 全屏静态总览 → 区域拆解 → 单 turn 交互时序 → 多轮交互 → live/history 对比 | 10 分钟 |
| 4 | [`04-information-architecture.md`](04-information-architecture.md) | 区域职责、导航关系、live/history IA 差异、空间分配原则 | 10 分钟 |
| 5 | [`02-dynamic-behavior-and-interaction.md`](02-dynamic-behavior-and-interaction.md) | 执行过程动态时序（per-entry auto-expand/collapse）、滚动行为、通用交互响应模式（hover/click/focus/disabled/loading/error/appear-disappear）、动画参数规范（时长/曲线/reduced-motion） | 10 分钟 |

**读完应知道**：界面有哪些区域、每个区域放什么、区域间如何联动、界面在不同执行阶段如何动态变化、各组件的 hover/focus/click/disabled/loading/error/appear/disappear 统一模式。

> 阶段 2 先读 `03` 第 1 节（全屏总览）建立整体印象，第 2-5 节可在阶段 3/4 按需回查。

### 阶段 3：理解容器与组件层级（约 35 分钟）

**先容器，后叶子**——过程面板是理解对话区的钥匙，先读它。

| 顺序 | 文档 | 层级 | 一句话描述 |
|---|---|---|---|
| 5 | [`05-component-specs/process-panel.md`](05-component-specs/process-panel.md) | 容器级 | 3 种容器状态、7 种条目模板、条目排序、per-entry 展开/折叠，以及按当前 parser/formatter/fallback 分层维护的结果呈现库存 |
| 6 | [`05-component-specs/expand-panel.md`](05-component-specs/expand-panel.md) | 容器级 | 右侧展开面板（PIU/TEXT/FILE/ACTION/地图/图表）、2 种布局类型 × 6 ToolMessageType |
| 7 | [`05-component-specs/message-bubble.md`](05-component-specs/message-bubble.md) | 叶子级 | USER/ASSISTANT 气泡、think 条目内部视觉、终态渲染 |
| 8 | [`05-component-specs/capability-card.md`](05-component-specs/capability-card.md) | 叶子级 | 能力卡片状态机、当前 safeResult parser/专门 formatter/generic fallback 分层呈现、SafeError 失败卡片 |
| 9 | [`05-component-specs/pending-input-card.md`](05-component-specs/pending-input-card.md) | 叶子级 | 4 种 durable kind、7 个前端 accepted identifier、workflow 复用 `QUESTION`，以及等待/应答/超时/取消状态流 |
| 10 | [`05-component-specs/degradation-notice.md`](05-component-specs/degradation-notice.md) | 叶子级 | 降级提示渲染（可选，非每次对话必然出现）、projection failure、live/history 呈现 |
| 11 | [`05-component-specs/composer.md`](05-component-specs/composer.md) | 叶子级 | 输入区、附件 accepted/rejected、草稿缓存、发送/停止切换 |
| 12 | [`05-component-specs/session-list-item.md`](05-component-specs/session-list-item.md) | 叶子级 | 会话列表项、live/历史区分、展开/折叠 |
| 13 | [`05-component-specs/conversation-preview-rail.md`](05-component-specs/conversation-preview-rail.md) | 容器级 | 当前会话 marker 轨道、hover 摘要、点击跳转与长会话虚拟化 |
| 14 | [`05-component-specs/background-task-monitor.md`](05-component-specs/background-task-monitor.md) | 叶子级 | ⚡ 后台任务 header 监控（per-session 快速查找入口、下拉面板、状态矩阵） |
| 15 | [`05-component-specs/sub-window.md`](05-component-specs/sub-window.md) | 叶子级 | `[已实现]` OPERATOR 按钮/点击 dispatch；`[UCD目标]` LINK 导航卡片；ACTION 自动 dispatch 的 replay/idempotency 安全缺口 |
| 16 | [`05-component-specs/file-download.md`](05-component-specs/file-download.md) | 叶子级 | 文件下载卡片（2 content 格式 × 2 下载机制） |
| 17 | [`05-component-specs/cron-task.md`](05-component-specs/cron-task.md) | 叶子级 | Cron 定时任务卡片（创建/列表/删除） |
| 18 | [`05-component-specs/tool-ui-interface-overview.md`](05-component-specs/tool-ui-interface-overview.md) | 跨组件 | 工具 UI 接口总览（8 类接口 × 18+ 工具映射） |
| 19 | [`05-component-specs/tool-output-presentation-policy.md`](05-component-specs/tool-output-presentation-policy.md) | 跨组件 | 已实现三档结果披露与仍属 UCD 目标的 4 策略场景配置框架 |

**读完应知道**：每个组件的视觉状态空间、live/history 差异、组件间不交叉的边界。

### 阶段 4：补全边界状态与文案（约 10 分钟）

| 顺序 | 文档 | 一句话描述 |
|---|---|---|
| 20 | [`06-empty-loading-error-states.md`](06-empty-loading-error-states.md) | 空状态、加载状态、错误状态、设置、键盘快捷键、权限门控、stream resume gap/failure |
| 21 | [`07-content-copy.md`](07-content-copy.md) | 所有场景的用户可读文案，从 safe field 派生规则 |

### 阶段 5：用样例验证设计（约 10 分钟）

| 顺序 | 文档 | 一句话描述 |
|---|---|---|
| 22 | [`08-sample-scenarios.md`](08-sample-scenarios.md) | 27 个场景的界面渲染样例（含 live/history 与 300 轮长会话压力场景），对照组件规范验证视觉设计 |

**读完应能**：把自己的视觉设计稿与样例渲染逐一对照，验证是否覆盖所有状态。

### 阶段 6：产品团队汇报（可选）

| 顺序 | 文档 | 一句话描述 |
|---|---|---|
| 23 | [`09-product-team-briefing.md`](09-product-team-briefing.md) | 面向产品业务团队的自包含澄清文档，从关键场景/全局视图/组件规格与状态/场景样例 4 个视角综述，无需阅读其他 UCD 文件 |

**读完应能**：向产品业务团队澄清 NextAgent 对话界面的 UCD 方案全貌、组件实现状态、关键场景样例。

### 阶段 7：实现缺口分析（面向开发人员）

| 顺序 | 文档 | 一句话描述 |
|---|---|---|
| 23 | [`10-implementation-gap-analysis.md`](10-implementation-gap-analysis.md) | 2026-07-18 形成的 43 项历史差距快照；顶部 disposition overlay 按最新主干/WIP 标出已实现、在建、需澄清与候选项，当前任务状态以 roadmap 里程碑为准 |

**读完应能**：明确哪些 UCD 设计需要补 spec、哪些需要补实现、各自的工作量和优先级。

### 阶段 8：UX 限制参考（面向设计人员）

| 顺序 | 文档 | 一句话描述 |
|---|---|---|
| 24 | [`11-ux-limits-and-constraints.md`](11-ux-limits-and-constraints.md) | 按上述代码基线核对的数量/大小/时间限制（附件双路径、并行工具数、Cron 列表截断、截断阈值、超时等），供设计时避免超出系统能力 |

**读完应能**：在设计界面时准确设置输入框 maxlength、列表截断提示、超时倒计时等，避免设计出超出系统能力的界面。

### 阶段 9：集成方接入指南（面向集成方开发者）

| 顺序 | 文档 | 一句话描述 |
|---|---|---|
| 25 | [`12-integrator-customization-guide.md`](12-integrator-customization-guide.md) | 集成方界面定制能力指南（主题与视觉/布局/文案/行为/组件替换/宿主事件/基础设施），含 HostMode 适用矩阵与关键场景代码示例；逐项区分主干事实与 UCD 目标 |

**读完应能**：明确集成方能定制 NextAgent 界面的哪些部分、通过什么契约字段定制、在自己的宿主模式下哪些定制点可用。

---

## 关键场景覆盖总览

本节按**业务域**聚合 27 旅程 × 26 场景，帮助读者 30 秒看清产品支持哪些关键场景。日常设计时按域下钻到具体旅程/场景；通读时按域顺序阅读比按编号顺序更连贯。

> `01-user-journeys.md` 和 `08-sample-scenarios.md` 的每个旅程/场景标题后均标注了 `[X 域名]` 标签（如 `[B 长时任务与并行工作流]`），翻文档时一眼可见域归属，无需回本表查询。标签字母 A-G 与本表一致。

| 业务域 | 旅程 | 场景 | 域说明 |
|---|---|---|---|
| **A. 核心对话与任务执行** | 1 提问到答案、2 附件上传、12 多轮思考与工具调用、19 查看 Run Graph、20 查看右侧展开面板富内容、21 从对话通知集成方打开系统页面、22 下载 Agent 生成的文件、23 在扩展面板中审核修改配置并保存、25 管理定时任务、27 并行工具调用 | 1 正常路径、2 失败路径、4 附件上传、7 多轮思考与工具调用、16 Run Graph 完整执行流程、17 右侧展开面板——地图故障分布、18 打开 OSS 配置——导航卡片与集成方页面跳转、19 下载区域列表模板、20 在扩展面板中审核修改节能配置、21 开启节能自治——端到端复合场景、23 创建和管理 Cron 定时任务、26 并行工具调用 | 最基础的单轮/多轮任务执行，含附件输入、失败分支、执行流程查看、富内容展开、跨系统页面导航、文件下载、配置审核与保存反馈、定时任务管理、端到端复合场景、并行工具调用 |
| **B. 长时任务与并行工作流** | 13 多会话后台 run、14 长时运行能力、17 执行中发新消息、24 监控后台任务执行 | 8 多会话后台 run、9 长时运行、10 请求被取代、22 后台分离执行与任务追踪 | 长时任务的三条出路：fork 继续（旅程 14）、后台切换（旅程 13）、supersede 终止（旅程 17）；后台分离执行（结果不参与上下文，当前实例 Bash）由 capability-card 内联追踪（旅程 24） |
| **C. 会话组织与检索** | 5 历史对话浏览、11 派生新会话、15 会话搜索与管理 | 12 会话搜索与管理、13 分享与派生 | 会话全生命周期：浏览/搜索/派生/分享/重命名/删除。旅程 5（历史浏览）横切所有场景的 history 视图，无独立场景 |
| **D. 错误与异常恢复** | 4 断线重连、7 路径拒绝、9 取消与重试、10 重试失败请求、18 页面关闭与重开 | 5 断线重连、6 路径被策略拒绝、11 取消与重试、15 页面关闭与重开 | 网络级（断线）到页面级（关闭/重开）中断恢复 + 用户主动控制（取消/重试/拒绝） |
| **E. 交互输入与上下文** | 3 pending input、6 上下文压缩 | 3 Pending Input 全 kind 矩阵、24 上下文压缩——长对话中的上下文窗口管理 | Agent 主动交互（确认/授权/问答）+ 上下文超限压缩 |
| **F. 编辑与修正** | 8 编辑重发 | 10 请求被取代（阶段 10a-10c） | 编辑最近用户消息重发，与 B 共享场景 10（supersede 终态） |
| **G. 委派与能力扩展** | 16 Sub-agent 委派 | 14 Sub-agent 委派 | Agent 调用子 agent 处理专长任务 |

### 域间关系

- **A → B**：A 是基础单轮/多轮执行；B 处理执行时间长的任务的并行/替代路径。旅程 14（长时运行）第 7 步的 fork-to-continue 跨引用旅程 11（派生）+ 旅程 13（后台 run）。
- **A → D**：D 域的中断恢复不是独立场景，而是嵌入 A 域执行过程中——任务执行可能失败（场景 2）、被策略拒绝（场景 6）、网络中断（场景 5），D 域提供恢复路径。
- **A ↔ E**：A 域任务执行中可被 E 域 pending input 暂停（等待用户确认/授权/问答），用户应答后恢复执行；E 域的上下文压缩嵌入 A 域正常路径（旅程 6 压缩嵌入场景 1，无独立场景）。场景 21（端到端复合场景）串联多次 pending input。
- **B 内部三出路**：长时任务执行中用户想干别的 → fork 保留任务（旅程 14）/ 切换会话后台执行（旅程 13）/ 直接发送终止（旅程 17 supersede）。三者互补，非互斥。
- **B → C**：B 的三出路均依赖 C 域会话管理——fork 创建新会话（旅程 11），后台 run 由独立 Session Activity Stream 投影等待输入、运行中和未读终态，supersede 终态在历史中持久。
- **D 覆盖中断谱系**：网络瞬断（旅程 4，cursor 保留）/ 页面关闭（旅程 18，cursor 丢失，cold-start）/ 请求被拒（旅程 7）/ 用户主动取消（旅程 9）/ 失败重试（旅程 10）。
- **D → C**：D 域页面级中断（旅程 18）恢复后需从 C 域会话列表恢复上下文；`continuityPhase` 只属于当前已连接会话的 conversation/stream 状态，不是 session-list row 的数据源。
- **F 与 B 共享场景 10**：编辑重发（旅程 8）和执行中发新消息（旅程 17）后端机制相同（supersede），但用户意图、UI 流程、对话结构不同——场景 10 用阶段 10a-10c（编辑）和 10d（执行中发新消息）区分。
- **G 是 A 的特化执行路径**：sub-agent 委派复用 A 域过程面板和能力卡片，但子 agent 上下文隔离、内部过程不可见（只呈现单步卡片，不展开子 agent 的思考/工具调用）。子 run 以 `priority: "LOW"` 调度（与 B 共享调度模型），父 turn 同步阻塞等待。子 agent 失败由父能力卡片呈现，但不必然升级为父 run 失败。

### 未覆盖与待落地的业务场景

以下 10 个场景按覆盖程度分 3 类，供产品决策是否补充设计或推动 spec/代码落地：

#### A 类：UCD 完全未设计（1 个）

UCD 无任何交互流程/组件/状态设计，需从零开始设计。

| 缺口 | 关联域 | 说明 |
|---|---|---|
| 多用户协作 | A/C | 同一会话多人协同，当前是单用户模型。仅 `00-user-personas.md` 提及"分享对话片段给团队协作"作为用户目标，无交互设计 |

#### B 类：UCD 部分覆盖（6 个）

UCD 有相关设计但不完整，存在明确的设计缺口需补充。

| 缺口 | 关联域 | 已覆盖部分 | 未覆盖部分 |
|---|---|---|---|
| 只读分享与权限分级 | C | 场景 13 设计了分享链接生成 modal（勾选 turn → 生成链接 → 复制/取消） | 被分享者的只读查看体验、权限分级（viewer/editor）、链接撤销管理 UI |
| 跨设备主动通知 | B | 会话内未读结果/失败 Activity 已交付；push/toast/声音与跨设备主动送达仍未设计 | 先定义跨设备通知与投递策略，再决定 push/toast/声音；不得重建第二套 unread truth |
| 导出与报告 | C | `file-download.md` 设计了 Agent 生成文件下载（模板/报告/数据导出） | 用户主动导出整个对话/结果为 PDF/邮件的操作入口和 UI |
| 后端服务降级/熔断 | D | `degradation-notice.md` 设计了子系统级降级提示（`DEGRADATION_NOTICE` 事件，3 类原因） | 服务整体降级/熔断的全局 UI（全页降级 banner、功能受限模式、健康状态指示器） |
| 首次使用引导 | A | `06-empty-loading-error-states.md` 设计了欢迎状态（空状态 + WelcomeState + 高频问题按钮） | 结构化 onboarding（功能引导教程、progressive disclosure、tooltip tour） |
| 会话内消息搜索 | C | 旅程 15 设计了会话级搜索；`session-list-item.md` L248 简略提及滚动到匹配消息位置 | 会话内消息内容级全文搜索的完整交互（搜索框、高亮、上/下导航、结果计数） |

#### C 类：UCD 已设计，需按最新状态继续收敛（3 个）

本类别保留原始设计条目用于追溯；是否还需落地以每行的最新状态为准。

| 缺口 | 关联域 | UCD 设计位置 | spec/代码状态 |
|---|---|---|---|
| CSV/非 Markdown 附件支持 | A | 场景 20/21（CSV 上传→引用→配置审核）、`file-download.md`（CSV 下载） | `[已实现-主干]` 配置后的 staged Web composer 已支持 CSV/TSV/TXT/JSON/XML/LOG 等类型；默认 allowlist 仍仅 `md`/`markdown`，且兼容直传路径仍是 Markdown-only，详见 `11-ux-limits-and-constraints.md` |
| 截断阈值不可配置 | A | `tool-output-presentation-policy.md`（`truncationThreshold` 维度 + 4 层级配置 + 6 场景示例） | 4 层截断常量硬编码（4000 字符/50 项/256 字符/65536 字节），[遗留] |
| 字段级内容扫描式脱敏未实现 | A | `tool-output-presentation-policy.md`（`redactionPolicy=content-scan` + 正则规则 + 脱敏提示视觉） | `[已实现-主干]` 已有 terminal `finalContent` 正则替换和 REMOTE guardrail 整轮拦截，但没有统一的 live thinking/answer 字段级脱敏与 live/history/share 一致策略；先按 `[Clarify]` 收敛安全 owner 与 fail-closed 语义 |

---

## 文件清单

| 编号 | 文件 | 类型 | 层级 |
|---|---|---|---|
| — | [`00-overview-feature-map.md`](00-overview-feature-map.md) | **功能特性总览（推荐入口）** | 全景 |
| 00 | `00-user-personas.md` | 用户研究 | — |
| 01 | `01-user-journeys.md` | 用户研究 | — |
| 02 | `02-dynamic-behavior-and-interaction.md` | 动态行为规范 | 跨组件 |
| 03 | `03-full-ui-layout.md` | 全屏布局 | 全屏级 |
| 04 | `04-information-architecture.md` | 信息架构 | 区域级 |
| 05 | `05-component-specs/process-panel.md` | 组件规范 | 容器级 |
| 05 | `05-component-specs/message-bubble.md` | 组件规范 | 叶子级 |
| 05 | `05-component-specs/capability-card.md` | 组件规范 | 叶子级 |
| 05 | `05-component-specs/pending-input-card.md` | 组件规范 | 叶子级 |
| 05 | `05-component-specs/degradation-notice.md` | 组件规范 | 叶子级 |
| 05 | `05-component-specs/composer.md` | 组件规范 | 叶子级 |
| 05 | `05-component-specs/session-list-item.md` | 组件规范 | 叶子级 |
| 05 | `05-component-specs/conversation-preview-rail.md` | 组件规范 | 容器级 |
| 05 | `05-component-specs/expand-panel.md` | 组件规范 | 容器级 |
| 05 | `05-component-specs/sub-window.md` | 组件规范 | 叶子级 |
| 05 | `05-component-specs/file-download.md` | 组件规范 | 叶子级 |
| 05 | `05-component-specs/cron-task.md` | 组件规范 | 叶子级 |
| 05 | `05-component-specs/background-task-monitor.md` | 组件规范 | 叶子级 |
| 05 | `05-component-specs/tool-ui-interface-overview.md` | 接口总览 | 跨组件 |
| 05 | `05-component-specs/tool-output-presentation-policy.md` | 呈现策略 | 跨组件 |
| 06 | `06-empty-loading-error-states.md` | 状态规范 | — |
| 07 | `07-content-copy.md` | 文案规范 | — |
| 08 | `08-sample-scenarios.md` | 样例验证 | — |
| 09 | `09-product-team-briefing.md` | 产品澄清 | — |
| 10 | `10-implementation-gap-analysis.md` | Gap 分析 | — |
| 11 | `11-ux-limits-and-constraints.md` | UX 限制 | — |
| 12 | `12-integrator-customization-guide.md` | 集成方定制指南 | — |
| 13 | [`13-capability-extension-matrix.md`](13-capability-extension-matrix.md) | 能力×扩展矩阵 | — |

---

## 快速查阅表（日常设计）

熟悉文档后，按**设计任务**直接定位：

| 设计任务 | 直接打开 |
|---|---|
| 查功能特性全景（42 个功能 × 6 列） | `00-overview-feature-map.md` |
| 查集成方界面定制能力（逐项状态） | `12-integrator-customization-guide.md` |
| 查能力×扩展影响矩阵 | [`13-capability-extension-matrix.md`](13-capability-extension-matrix.md) |
| 沉浸式注入自定义 operators | `12` §场景 1 |
| PIU 模式替换高频问题区 | `12` §场景 2 |
| 定制欢迎语与品牌 | `12` §场景 3 |
| 宿主控制 PIU 面板生命周期 | `12` §场景 4 |
| 设计整体布局 | `03` 第 1 节 |
| 设计欢迎状态 | `03` 第 2.7 节 / `06` 欢迎状态章节 |
| 设计 Run Graph 抽屉 | `03` 第 2.6 节 / `05-component-specs/process-panel.md` Run Graph 抽屉章节 |
| 设计右侧展开面板（富内容/PIU） | `05-component-specs/expand-panel.md` |
| 设计导航卡片与集成方页面跳转（OPERATOR LINK） | `05-component-specs/sub-window.md` |
| 设计文件下载卡片（FILE 扩展） | `05-component-specs/file-download.md` |
| 设计交互式 PIU 保存反馈 | `05-component-specs/expand-panel.md`（交互式 PIU 保存→对话反馈章节） |
| 设计后台任务追踪区（backgroundHandle 扩展 ¹） | `05-component-specs/capability-card.md`（commandOutput + backgroundHandle 扩展） |
| 设计后台任务 header 监控（⚡ 下拉面板） | `05-component-specs/background-task-monitor.md` |
| 设计 Cron 定时任务卡片 | `05-component-specs/cron-task.md` |
| 查所有工具的 UI 接口总览 | `05-component-specs/tool-ui-interface-overview.md` |
| 设计工具输出呈现策略（完整/摘要/截断/脱敏） | `05-component-specs/tool-output-presentation-policy.md` |
| 设计过程面板 | `05-component-specs/process-panel.md` |
| 设计消息气泡 | `05-component-specs/message-bubble.md` |
| 设计能力卡片 | `05-component-specs/capability-card.md` |
| 设计 pending input 卡片（4 种 durable kind + 7 个前端 identifier；workflow interrupt 待澄清） | `05-component-specs/pending-input-card.md` |
| 设计降级提示 | `05-component-specs/degradation-notice.md` |
| 设计输入区（编辑/skill/slash/附件） | `05-component-specs/composer.md` |
| 设计会话列表项（搜索/重命名/删除/收藏） | `05-component-specs/session-list-item.md` |
| 设计空/加载/错误状态 | `06-empty-loading-error-states.md` |
| 设计推荐后续问题 | `06-empty-loading-error-states.md` 推荐后续问题章节 |
| 设计分类问题浏览 | `06-empty-loading-error-states.md` 分类问题浏览章节 |
| 设计键盘快捷键 | `06-empty-loading-error-states.md` 键盘快捷键章节 |
| 设计权限门控 | `06-empty-loading-error-states.md` 权限/鉴权门控章节 |
| 查某场景的文案 | `07-content-copy.md` 对应章节 |
| 查某场景怎么渲染 | `08-sample-scenarios.md` 对应场景 |
| 产品团队澄清/汇报 | `09-product-team-briefing.md` |
| 查 live/history 差异 | `03` 第 6 节 / 各组件规范的 live/history 章节 |
| 查交互时序演变 | `03` 第 3 节（单 turn）/ 第 4 节（多轮） |
| 设计动画/过渡/交互响应 | `02-dynamic-behavior-and-interaction.md` |
| 查 per-entry auto-collapse/expand | `02` 第 1.2 节 |
| 查 think/answer 内容安全过滤（可配置） | `02` 第 1.6 节 / `10` B17 |
| 查 think 持久化与 live/history 最终一致 | `process-panel.md` / `conversation-process-history.md` |
| 查平台管理员配置管理 | `10` B18 |
| 查 cron 执行结果会话归属策略（遗留） | `10` B19 / `cron-task.md` 管理面板章节 |
| 查任务输出与上下文解耦原则（等待/转后台/Fork 继续） | `conversation-ui-state.md` 同名章节 / `10` A3, A4, B19, B20 |
| 查工具协议扩展（background/outputContextMode/cancel/progress） | `10` B20 |
| 查 reduced-motion 降级 | `02` 第 4.3 节 |

> ¹ `backgroundHandle` 是 UCD 文档使用的概念术语，非 `bashBackgroundOutputSchema` 中的字面字段。实际 schema 字段为 `taskId` + `backgroundReason`。详见 `capability-card.md`。

---

## Gap 覆盖追踪

以下内容记录 2026-07-18 的 UCD 覆盖整理结果，回答“设计文档是否覆盖”，不等同于当前实现状态，也不能直接作为可领取任务。43 项历史条目的当前 disposition 见 `10-implementation-gap-analysis.md` 顶部 overlay；可分配任务以 roadmap 里程碑为准。

| Gap # | 功能场景 | 主文件 | 章节 | 状态 |
|---|---|---|---|---|
| #1 | Pending input 当前 4 种 durable kind、7 个前端 identifier 与 workflow interrupt 目标路线 | `pending-input-card.md` | 各 kind 详细呈现 | ✅ 已覆盖（workflow 路线待 Clarify） |
| #2 | REQUEST_SUPERSEDED 终态 | `message-bubble.md` | REQUEST_SUPERSEDED 终态 | ✅ 已覆盖 |
| #3 | 编辑已发消息并重发 | `composer.md` | 编辑模式 | ✅ 已覆盖 |
| #4 | REQUEST_CANCELED 子情况 | `message-bubble.md` | REQUEST_CANCELED 子情况 | ✅ 已覆盖 |
| #5 | 重试入口 | `message-bubble.md` | 重试入口 | ✅ 已覆盖 |
| #6 | 会话搜索 | `session-list-item.md` | 搜索 | ✅ 已覆盖 |
| #7 | 会话重命名/删除 | `session-list-item.md` | 重命名 / 删除 | ✅ 已覆盖 |
| #8 | 历史分页加载 | `06-empty-loading-error-states.md` | 历史分页加载 | ✅ 已覆盖 |
| #9 | 欢迎状态 | `06-empty-loading-error-states.md` | 欢迎状态 | ✅ 已覆盖 |
| #10 | 推荐后续问题 | `06-empty-loading-error-states.md` | 推荐后续问题 | ✅ 已覆盖 |
| #11 | 收藏夹 | `session-list-item.md` | 收藏夹 | ✅ 已覆盖 |
| #12 | 设置（主题/语言） | `06-empty-loading-error-states.md` | 设置 | ✅ 已覆盖 |
| #13 | 键盘快捷键 | `06-empty-loading-error-states.md` | 键盘快捷键 | ✅ 已覆盖 |
| #14 | Run Graph 抽屉 | `process-panel.md` | Run Graph 抽屉 | ✅ 已覆盖 |
| #15 | 分享对话 | `07-content-copy.md` | 分享设置文案 | ✅ 已覆盖 |
| #16 | 派生新会话 | `message-bubble.md` | 派生（Fork） | ✅ 已覆盖 |
| #17 | 标注反馈（赞/踩/收藏） | `message-bubble.md` | 标注反馈 | ✅ 已覆盖 |
| #18 | Skill 选择器 | `composer.md` | Skill 选择器 | ✅ 已覆盖 |
| #19 | 分类问题浏览 | `06-empty-loading-error-states.md` | 分类问题浏览 | ✅ 已覆盖 |
| #20 | Slash 命令 | `composer.md` | Slash 命令 | ✅ 已覆盖 |
| #21 | Stream resume gap/failure | `06-empty-loading-error-states.md` | Stream resume gap/failure | ✅ 已覆盖 |
| #22 | 上下文压缩通知 | `process-panel.md` | 上下文压缩通知 | ✅ 已覆盖 |
| #23 | 流式打字机效果 | `message-bubble.md` | 流式打字机效果 | ✅ 已覆盖 |
| #24 | 当前会话预览轨道 | `conversation-preview-rail.md` | 虚拟化 marker、hover 摘要、点击跳转 | ✅ 已实现并覆盖 |
| #25 | 问题收藏（Pin） | `message-bubble.md` | 问题收藏（Pin） | ✅ 已覆盖 |
| #26 | 权限/鉴权门控 | `06-empty-loading-error-states.md` | 权限/鉴权门控 | ✅ 已覆盖 |
| #27 | 附件边缘场景 | `composer.md` | 附件边缘场景 | ✅ 已覆盖 |
| #28 | 附件操作 | `composer.md` | 附件操作 | ✅ 已覆盖 |
| #29 | 后台任务追踪区 | `capability-card.md` | commandOutput + backgroundHandle 扩展 | ✅ 已覆盖 |
| #30 | Cron 定时任务卡片 | `cron-task.md` | 全文 | ✅ 已覆盖（Tool 专门呈现与独立 Dashboard 均已进入主干） |
| #31 | 工具 UI 接口总览 | `tool-ui-interface-overview.md` | 全文 | ✅ 已覆盖 |
| #32 | 工具输出呈现策略 | `tool-output-presentation-policy.md` | 全文 | ✅ 已覆盖（截断阈值可配置/内容扫描脱敏为遗留 gap） |

> 原始 UCD 覆盖整理中的 32 项均已有设计表达；这不表示对应实现均已交付。B16 thinking history continuity、B11 per-entry auto-collapse 和当前会话 preview rail 已进入主干；B17/B18 字段级安全过滤与配置 owner 仍需独立决策。

---

## 契约层查阅（有契约疑问时）

UCD 设计人员**通常不需要**读 `openspec/` 下的契约文档。当遇到"为什么必须这样做"或"这个 field 能不能显示"的问题时，按以下入口查阅：

| 疑问 | 查阅 |
|---|---|
| 某个 stream event 的 safe field 是什么 | 先查 owning stable/active spec、public channel contract 与 `stream-envelope.ts`；长期设计第 1 节只用于导航 |
| live vs history 的根本规则 | 先查 `ts-stream-history-consistency`/resume specs、当前 adapters 与测试；长期设计第 6 节只用于导航 |
| safeResult 安全投影原则与历史呈现矩阵 | 以当前 `stream-envelope.ts`、`safeCapabilityResult.ts`、`processDetails.ts`、相关 specs/tests 为准；长期设计第 2 节已有登记漂移 |
| SafeError code/category 映射 | 查 owning error/safe-projection specs、channel projection 与 formatter；长期设计第 5 节用于导航 |
| pending input 的后端语义 | 查各 pending-input stable specs、common/runtime/channel contracts 与测试；长期设计第 3 节的 5-kind 矩阵已漂移 |
| reconnect/replay 的 cursor 语义 | 查 `ts-stream-resume-replay`/transport specs、current code/tests；长期设计第 4 节用于导航 |

> `conversation-ui-state.md` 是长期设计导航，不是当前事实的单一权威来源。UCD 文件应显式区分导航、当前代码事实和 `[UCD目标]`，并在任务准入前按 owning specs/contracts/code/tests 复核。

---

## 概念组件 → 实际代码映射

UCD 文档按设计概念拆分为 7 个组件规范，但实际代码中并非每个概念都有独立 `.tsx` 文件。UCD 设计人员在理解设计概念时，可参考以下映射了解实现位置。

| UCD 概念组件 | 实际实现位置 | 说明 |
|---|---|---|
| 过程面板 | `features/chat/components/ProcessPanel.tsx` | 唯一直接对应的独立组件 |
| 消息气泡 | `features/chat/components/TurnBlock.tsx` 的用户/AI 渲染区域 | 非独立 React 组件，内联渲染 |
| 能力卡片 | `processDetails.ts` 的 ProcessTimelineEntry(kind=tool) + `AnswerSegments.tsx` 分发 | 结果卡片由 `answerContent.ts` 构建 AnswerSegment → `AnswerSegments.tsx` 渲染 |
| Pending Input 卡片 | `useChatSessionStream.ts`/`userInputStore` 激活 live input；`ChatPage.tsx` 在 composer 上方渲染 `RespondInput.tsx` | terminal event 或 POST success 当前会清空卡片；`processDetails.ts` 另投影独立 system 条目，turn 内 lifecycle/终态卡仍是目标 |
| 降级提示 | `ProcessPanel.tsx` 的 system 条目 + `TurnBlock.tsx` 的 FailedNotice/CanceledNotice | `DEGRADATION_NOTICE` 投影为 ProcessEntry(kind=system) |
| 输入区 | `features/composer/components/MessageInput.tsx`（普通输入） + `ComposerPanel.tsx`（容器） + `RespondInput.tsx`（pending 应答） | `ChatPage.tsx` 在 `activeInput` 存在时以 `RespondInput` 替换 `MessageInput`，两者当前不并存；`ComposerPanel.tsx` 只承载布局 |
| 会话列表项 | `features/sidebar/components/SessionHistoryEntryRow.tsx` | 直接对应 |
| ⚡ 后台任务监控 | `features/background-tasks/components/BackgroundTaskMonitorPanel.tsx` | per-session header 快速查找入口（已实现） |

> 此映射供 UCD 设计人员了解设计概念在代码中的落地位置。UCD 文档描述的是设计概念边界，不要求与代码文件一一对应。

---

## 设计重点检查清单

5 阶段阅读路径回答"怎么通读"，本清单回答"哪些最容易出错、最值得花时间"。UCD 设计人员在通读后，对照本清单逐项确认视觉设计覆盖了这些重点领域。每项标注**复杂度**（视觉状态空间大小）与**踩坑风险**（契约约束容易违反的地方）。

### P0：必须 100% 覆盖

| 重点领域 | 复杂度 | 踩坑风险 | 定位 |
|---|---|---|---|
| 实时 vs 历史双模式 | 同一组件两套呈现 | 完成的 thinking 与 canonical process facts 已最终一致；pending-input lifecycle 卡仍是例外 | `03` 第 5 节 / 各组件 live/history 章节 / `08` 各场景的 history 视图 |
| 过程面板状态空间 | 3 容器状态 × 7 条目模板，并叠加当前专门结果 formatter 与通用 fallback | per-entry 展开/折叠、条目排序及结果库存随代码演进漂移 | `05-component-specs/process-panel.md` |
| 安全字段渲染约束 | — | raw error / path / tool args / policy internals 泄漏 | `07` 通用原则 + 各组件"约束"章节 |

### P1：复杂度高，需重点设计

| 重点领域 | 复杂度 | 踩坑风险 | 定位 |
|---|---|---|---|
| 能力卡片 safeResult 分层呈现 + 长时运行 | parser、普通结果 formatter、补充信息关联路径与 generic fallback 是不同集合，库存随代码演进 | 区分后端投影、前端解析、专门呈现与 fallback；无数据来源时不得虚构进度 | `05-component-specs/capability-card.md`（工具映射 + kind 样例 + 长时运行扩展） |
| 思考 vs 内容二分 | 思考纯文本累积、内容 markdown 拼接 | content delta 误入过程面板 / think delta 误入气泡 | `process-panel.md` 条目排序 / `message-bubble.md` / `08` 场景 7 |
| 多会话后台 run | `WAITING_FOR_INPUT > RUNNING > UNREAD_FAILURE > UNREAD_RESULT > NONE` 五态 | 独立 Activity Stream 已交付；消费未读终态必须等待匹配 presentation 可见，`continuityPhase` 仍不属于列表行 | `05-component-specs/session-list-item.md` / `03` 第 5 节 / `08` 场景 8 |
| 输入区功能矩阵 | 编辑模式 + skill 选择器 + slash 命令 + 附件 + assoc 推荐 | edit 模式草稿隔离 / slash 禁用条件 / 附件校验约束 | `05-component-specs/composer.md` |
| 消息气泡操作矩阵 | 7 种 BubbleActions（赞/踩/收藏/分享/派生/重试/pin）+ 打字机效果 | 权限门控 / 乐观更新回滚 / prefers-reduced-motion 降级 | `05-component-specs/message-bubble.md` |

### P2：边界状态，按需覆盖

| 重点领域 | 复杂度 | 踩坑风险 | 定位 |
|---|---|---|---|
| 当前会话重连状态阶梯 | 5 阶段 `continuityPhase` | 阶段间视觉过渡突兀；不得误投影到 session-list row | `06` / `01-user-journeys.md` 旅程 4 |
| pending input | 4 durable kind + 7 frontend identifier；4 个 lifecycle 状态中只有 live required 卡已实现 | compatibility alias 混淆、终态卡未实现；workflow 必须复用 `QUESTION` | `05-component-specs/pending-input-card.md` |
| 文案安全字段派生 | — | safeErrorCode 原值泄漏给用户 | `07-content-copy.md` 各场景文案表 |
| 27 个场景的边缘约束 | — | partial answer 误展示为完整答案 / safe failure placeholder 误展示为答案 / 长会话请求风暴 | `08-sample-scenarios.md` 各场景约束表 |
| 权限门控 | View/Write 二级权限 + 全页降级 | 无 Write 权限用户误用操作控件 | `06-empty-loading-error-states.md` 权限/鉴权门控章节 |
| Stream resume gap/failure | 3 gap 原因（可重试）+ 7 failure 原因（不定） | gap/failure 混淆 / 不可重试 failure 误自动重试 | `06-empty-loading-error-states.md` Stream resume 章节 |

### 使用方式

1. **通读阶段**：按 5 阶段路径读完，对整体有印象。
2. **设计阶段**：拿出本清单，逐项打开定位文档，确认视觉设计稿覆盖该重点领域的所有状态。
3. **评审阶段**：把设计稿与 `08` 样例场景逐一对照，验证 live 视图与 history 视图都覆盖。

> 本清单是导航工具，不展开具体内容。具体视觉状态空间、约束、样例都在定位文档里。

---

## 阅读约定

### 标记含义

| 标记 | 含义 |
|---|---|
| `▼` / `▶` | 过程面板展开 / 折叠状态 |
| `●` / `▸` | 会话列表 live 会话 / 历史会话 |
| `✅` / `❌` / `⏳` / `⏹️` / `🔁` | 完成 / 失败 / 进行中 / 取消 / 被取代 |
| `💭` / `🔧` / `⚠️` / `📦` | 思考条目 / 能力条目 / 降级提示 / 压缩通知 |
| `[A]`…`[G]` | 旅程/场景标题后的业务域标签，见"关键场景覆盖总览" |

### ASCII 图标说明

文档中的 ASCII 布局是**结构示意**，不是像素级设计稿。实际视觉样式（颜色、间距、字号、图标样式）由 UCD 设计人员根据组件规范决定。

### live 模式 vs history 模式

核心原则（`[UCD目标]`）：**呈现的内容完全相同**，仅流式呈现效果不同。

- **live 模式**：用户在活跃会话中，实时接收 stream event，有打字机效果、running 动画、渐进式披露。
- **history 模式**：用户浏览历史对话，Message history 先建立回合和终态答案，Event history 渐进补齐完成的 thinking 与 canonical process facts。history 不重放未完成 delta、打字机效果或 running 动画。

### 契约约束优先

UCD 设计表达不能违反契约层 safe field 约束。具体约束在每个文档的"契约来源"和"约束"章节标注。当设计表达与契约冲突时，以契约为准。

---

## 设计资源（超出本目录的参考材料）

UCD 设计人员除本目录文档外，还可参考以下资源。这些资源不在 `docs/ucd/` 下，但对视觉设计有直接参考价值。

| 资源 | 路径 | 用途 | 如何使用 |
|---|---|---|---|
| 长期架构导航 | `openspec/designs/architecture/conversation-ui-state.md` | 汇总历史设计意图；其 event、thinking、pending-input 与 safeResult 库存已有登记漂移，不单独作为当前事实来源 | 先用于定位，再以 active/stable specs、public contracts、当前代码与测试交叉核对 |
| i18n 中文资源 | `frontend/agent-web/src/i18n/resources/zh-CN.ts` | 所有用户可见文案的实际字符串值 | `07-content-copy.md` 描述文案规则，此文件包含实际字符串 |
| i18n 英文资源 | `frontend/agent-web/src/i18n/resources/en-US.ts` | 英文对照 | 同上 |
| 过程面板图标 | `frontend/agent-web/src/assets/process-icons/` | 6 种 SVG 图标（think/skill/process-complete/final-complete/circle/collapse），每种有 dark/light 变体 | 设计过程面板条目图标时参考现有风格 |
| 主题样式 | `frontend/agent-web/src/styles/theme.css` | 字体族（`--font-family-app`）、深浅色模式变量、布局约束 | 保持视觉一致性时参考现有设计 token |
| Mock Server | `frontend/agent-web-mock-server/` | 生成确定性流式回复，用于前端联调 | 运行 mock server + 前端，对照 `08-sample-scenarios.md` 验证视觉设计 |
| 可运行前端 | `frontend/agent-web/` | 当前前端实现 | 运行 `npm run dev`，对照设计稿识别差距 |

### Mock Server 运行方式

```bash
# 终端 1：启动 mock server
cd frontend/agent-web-mock-server && npm start

# 终端 2：启动前端
cd frontend/agent-web && npm run dev
```

mock server 支持 3 种模式（通过输入文本触发）：

| 输入文本 | 模式 | 对应样例场景 |
|---|---|---|
| 任意文本（如 `网络健康诊断`） | 正常路径 | 场景 1 |
| `测试：失败` | 失败路径 | 场景 2 |
| `测试：补充输入` | Pending Input | 场景 3 |

---

## 文档维护

- 本目录文件是设计表达层，变更不影响契约层。
- 契约层变更（`conversation-ui-state.md` 或 stable specs）时，需同步检查本目录引用是否过时。
- 新增组件规范时，更新本 README 的文件清单与快速查阅表。
- `08-sample-scenarios.md` 的样例数据基于 `frontend/agent-web-mock-server` 的确定性输出，mock server 变更时需同步更新样例。
