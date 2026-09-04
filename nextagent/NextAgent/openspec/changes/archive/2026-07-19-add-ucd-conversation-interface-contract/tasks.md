## 1. 行为规格 delta

- [x] 1.1 新增 `Attachment Accepted Stream Event Visibility` requirement，覆盖 `ATTACHMENT_ACCEPTED` envelope safe fields、frontend 渲染、history 禁止 reconstruct 三个 scenario
  验证：`openspec validate add-ucd-conversation-interface-contract --strict`
  来源：proposal "变更范围" 第 1 层、design 决策 1
- [x] 1.2 新增 `Attachment Rejected Stream Event Visibility` requirement，覆盖 `ATTACHMENT_REJECTED` envelope safe fields（含 `reasonCode`/`safeSummary`）、frontend 安全 reason 渲染、history 禁止 reconstruct 三个 scenario
  验证：`openspec validate add-ucd-conversation-interface-contract --strict`
  来源：proposal "变更范围" 第 1 层、design 决策 1
- [x] 1.3 新增 `Context Compacted Stream Event Visibility` requirement，覆盖 `CONTEXT_COMPACTED` envelope safe fields（含 `contextVersion`/`summaryMessageId`/`safeSummary`/`tokenEstimate`）、frontend 压缩通知渲染、history 过滤 `SUMMARY` 三个 scenario
  验证：`openspec validate add-ucd-conversation-interface-contract --strict`
  来源：proposal "变更范围" 第 1 层、design 决策 1
- [x] 1.4 新增 `Capability Path Rejected Failure Visibility` requirement，覆盖 `CAPABILITY_PATH_REJECTED` safeErrorCode + safeSummary 投影、frontend 安全失败卡片、不升级为 run failure 三个 scenario
  验证：`openspec validate add-ucd-conversation-interface-contract --strict`
  来源：proposal "变更范围" 第 1 层、design 决策 1
- [x] 1.5 确认 4 个新 requirement 全部以 SHALL/MUST 表达，不与现有 `ts-run-status-visibility` requirement 重复定义状态机或 vocabulary
  验证：`openspec validate add-ucd-conversation-interface-contract --strict` + code review 检查 requirement 名称不与基线重复
  来源：design 决策 1、config.yaml "规范性事实只能有一个主文档"

## 2. 架构设计文档

- [x] 2.1 新增 `openspec/designs/architecture/conversation-ui-state.md`，承载第 1 节"19 种 StreamEventType → UI 状态映射表"，覆盖全部 19 种事件类型的 UI 渲染责任、safe field 约束、live/history 重建标注
  验证：文档审阅；映射表覆盖 `packages/agent-contracts/src/channel/index.ts` 的 18 种 StreamEventType；引用 `ts-run-status-visibility` canonical vocabulary 与 `ts-stream-history-consistency` history 规则
  来源：proposal "变更范围" 第 2 层、design 决策 2
- [x] 2.2 在 `conversation-ui-state.md` 新增第 2 节"9 种 safeResult.kind × 呈现矩阵"，覆盖 `commandOutput`、`fileRead`、`fileList`、`fileWrite`、`todoList`、`clipStreamEvent`、`clipStreamCompletion`、`clipStreamResult`、`skillLoaded`；6 种已 spec kind 标注主承载 spec，3 种 deferred kind 标注代码现状
  验证：文档审阅；kind 列表与 `stream-envelope.ts` 的 `projectSafeCapabilityResultProjection` switch 分支一致；引用 `ts-run-status-visibility` 的 `Capability result stream payload MUST expose only safe result projections` requirement
  来源：proposal "变更范围" 第 2 层、design 决策 2、design "Implementation-vs-spec gap" Gap 1/2
- [x] 2.3 在 `conversation-ui-state.md` 新增第 3 节"5 种 pending input kind → UI 渲染矩阵"，覆盖 `question`、`authorization`、`confirmation`、`human-handoff`、`workflow-interrupt`；每种标注 safe field、answer shape、terminal projection
  验证：文档审阅；引用 `question-pending-input`、`authorization-pending-input`、`confirmation-pending-input`、`human-pending-input-core`、`human-pending-input-timeout`、`human-handoff`、`workflow-interaction-nodes`，不重复定义状态机
  来源：proposal "变更范围" 第 2 层、design 决策 2
- [x] 2.4 在 `conversation-ui-state.md` 新增第 4 节"Reconnect/replay UI 状态阶梯图"，覆盖 connected → degraded → disconnected → reconnecting → replayed → live-tail 状态流转，标注每个状态的 UI 视觉契约与 cursor 语义对应关系
  验证：文档审阅；引用 `ts-stream-resume-replay` 的 lastSeenSequence/activeRun bootstrap/gap recovery 与 `ts-web-sse-ws-transports` 的 transport 等价规则
  来源：proposal "变更范围" 第 2 层、design 决策 2
- [x] 2.5 在 `conversation-ui-state.md` 新增第 5 节"SafeError code/category → 失败卡片映射"，覆盖 `CAPABILITY_PATH_REJECTED`、`CAPABILITY_TIMEOUT`、`CAPABILITY_BLOCKED`、`CAPABILITY_FAILED` 等 safeErrorCode 与 `MODEL_PROVIDER_ERROR`、`MODEL_RATE_LIMITED` 等 safeErrorCategory，每种标注卡片视觉、`safeSummary` 渲染位置、是否允许重试
  验证：文档审阅；code list 与 `stream-envelope.ts` 的 `summarizeSafeCapabilityFailure` 映射一致；引用 `ts-run-status-visibility` 的 `显式 projection failure visibility` requirement 与本 change 1.4 新增 requirement
  来源：proposal "变更范围" 第 2 层、design 决策 2
- [x] 2.6 在 `conversation-ui-state.md` 新增第 6 节"Live vs History 状态分叉"，按核心原则"内容相同，仅流式效果不同"描述 live 模式与 history 模式的 UI 呈现差异
  验证：文档审阅；role 过滤规则与 `frontend/agent-web/src/features/chat/adapters/conversationAdapter.ts` 的 `conversationMessagesToHistoryEnvelopes` 一致；引用 `ts-stream-history-consistency` 的 `History Uses Visible Messages` 规则
  来源：proposal "变更范围" 第 2 层、design 决策 2、design 决策 5
- [x] 2.7 确认 `conversation-ui-state.md` 全文只引用、导航或摘要现有 specs，不重复定义状态机、API schema、数据 owner 或接口语义
  验证：文档审阅 + `openspec validate add-ucd-conversation-interface-contract --strict`；检查无" SHALL/MUST 重新定义"语句
  来源：design 决策 2、config.yaml "规范性事实只能有一个主文档"

## 3. spec-to-design 导航

- [x] 3.1 在 `openspec/designs/spec-to-design-map.md` 新增 `ts-run-status-visibility` 行的"设计主承载"列补充 `conversation-ui-state.md`，或新增独立导航条目
  验证：`openspec validate add-ucd-conversation-interface-contract --strict`；spec-to-design-map.md 行内容与现有 `ts-run-status-visibility` 行不冲突
  来源：proposal "归档前更新基线"、design "文档承载决策"

## 4. overview 背景说明

- [x] 4.1 在 `openspec/overview.md` 补充"Web UI 消费方契约由 `designs/architecture/conversation-ui-state.md` 整合，UCD 设计表达文档位于 `docs/ucd/`"的背景说明
  验证：文档审阅；overview.md 不重复定义契约
  来源：proposal "归档前更新基线"、design "文档承载决策"

## 5. UCD 设计表达文档

- [x] 5.1 新增 `docs/ucd/README.md`，作为 UCD 设计人员的文档入口，承载 5 阶段渐进式阅读路径（用户与场景 → 整体视觉框架 → 容器与组件层级 → 边界状态与文案 → 样例验证）、文件清单、快速查阅表、设计重点检查清单（P0/P1/P2 重点领域 + 指向现有文档定位）、契约层查阅入口、阅读约定
  验证：文档审阅；阅读路径覆盖全部 14 个内容文件；快速查阅表按设计任务索引；设计重点检查清单覆盖 P0/P1/P2 三级重点领域
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.2 新增 `docs/ucd/00-user-personas.md`，定义对话界面的目标用户画像（电信网络运维人员、运维主管等），引用 `conversation-ui-state.md` 作为契约来源
  验证：文档审阅；persona 不与现有产品定位冲突
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.3 新增 `docs/ucd/01-user-journeys.md`，定义从新建会话、提问、附件上传、能力执行、pending input 应答、断线重连到历史浏览的核心用户旅程
  验证：文档审阅；旅程覆盖 `conversation-ui-state.md` 第 1/3/4/6 节描述的状态
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.4 新增 `docs/ucd/03-full-ui-layout.md`，承载从整体到局部的渐进式视图（全屏静态总览 → 区域拆解 → 单 turn 交互时序全屏演变 → 多轮交互全屏演变 → live/history 全屏对比），每个视图标注对应组件规范与契约章节
  验证：文档审阅；全屏视图覆盖 04-IA 的所有区域并填充真实内容；交互时序覆盖过程面板 auto-expand/collapse 与 Composer 发送/停止切换
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.5 新增 `docs/ucd/04-information-architecture.md`，定义对话界面的信息架构（会话列表、对话区、过程面板、composer、pending input 区、降级提示区）
  验证：文档审阅；IA 与 `conversation-ui-state.md` 6 节内容对齐
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.6 新增 `docs/ucd/05-component-specs/process-panel.md`，定义过程面板容器组件规范（3 种容器状态、7 种条目模板、条目排序规则、展开态组合、折叠态摘要、9 种 capability success kind 子模板索引、SafeError 子模板索引、live/history 差异），条目内部视觉引用各叶子组件规范
  验证：文档审阅；容器状态引用 `ProcessPanel.tsx` 的 `ProcessPanelMode` 与 `processDetails.ts` 的 `resolveExecutionDetailsPhase`；条目排序引用 `flushThinking` 规则；live/history 引用 `conversation-ui-state.md` 第 6 节
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.7 新增 `docs/ucd/05-component-specs/message-bubble.md`，定义消息气泡组件规范，显式区分 live 模式与 history 模式的呈现差异
  验证：文档审阅；live/history 差异引用 `conversation-ui-state.md` 第 6 节
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.8 新增 `docs/ucd/05-component-specs/capability-card.md`，定义能力卡片组件规范（覆盖 9 种 safeResult.kind 呈现 + SafeError 失败卡片），显式区分 live/history
  验证：文档审阅；kind 与 failure 映射引用 `conversation-ui-state.md` 第 2/5 节
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.9 新增 `docs/ucd/05-component-specs/pending-input-card.md`，定义 pending input 卡片组件规范（覆盖 5 种 pending input kind），显式区分 live/history
  验证：文档审阅；kind 列表引用 `conversation-ui-state.md` 第 3 节
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.10 新增 `docs/ucd/05-component-specs/degradation-notice.md`，定义降级提示组件规范（覆盖 `DEGRADATION_NOTICE` stream event + `CAPABILITY_PATH_REJECTED` 等失败卡片入口）
  验证：文档审阅；引用 `conversation-ui-state.md` 第 1/5 节
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.11 新增 `docs/ucd/05-component-specs/composer.md`，定义输入区组件规范（含附件上传 accepted/rejected 状态反馈、`USER_INPUT_REQUIRED` 应答入口）
  验证：文档审阅；附件状态引用本 change 1.1/1.2 requirement，pending input 引用 `conversation-ui-state.md` 第 3 节
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.12 新增 `docs/ucd/05-component-specs/session-list-item.md`，定义会话列表项组件规范（含历史会话预览、live 会话进行中标识）
  验证：文档审阅；live/history 差异引用 `conversation-ui-state.md` 第 6 节
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.13 新增 `docs/ucd/06-empty-loading-error-states.md`，定义空状态、加载状态、错误状态（含 `REQUEST_FAILED`、断线、重连中、`CAPABILITY_PATH_REJECTED` 等）
  验证：文档审阅；状态来源引用 `conversation-ui-state.md` 第 1/4/5 节
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.14 新增 `docs/ucd/07-content-copy.md`，定义对话界面的文案规范（含附件 accepted/rejected、能力失败、pending input、压缩通知、断线重连等场景的用户可读文案）
  验证：文档审阅；文案场景覆盖本 change 4 个新 requirement 的 safe field 渲染需求
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.15 新增 `docs/ucd/08-sample-scenarios.md`，承载由 mock server 真实生成的典型场景样例数据（正常路径、失败路径、pending input、附件上传、多轮思考与工具调用）+ Live vs History 验证
  验证：文档审阅；样例数据由 `frontend/agent-web-mock-server` 实际运行生成；每个场景标注对应 UCD 组件规范与契约层章节
  来源：proposal "变更范围" 第 3 层、design 决策 3
- [x] 5.16 新增 `docs/ucd/02-dynamic-behavior-and-interaction.md`，承载跨组件共用的动态行为与交互响应规范（执行过程动态时序含 per-entry auto-expand/collapse、滚动行为与焦点跟随、7 维通用交互响应模式 hover/click/focus/disabled/loading/error/appear-disappear、动画参数规范时长/曲线/reduced-motion、14 组件动态行为速查表）
  验证：文档审阅；所有 `[已实现]` 项有代码位置引用；`[UCD 设计建议]` 项明确标注
  来源：proposal "变更范围" 第 3 层、scope drift 补全
- [x] 5.17 新增 `docs/ucd/09-product-team-briefing.md`，承载产品团队简报（目标态能力清单、场景化 UI 表达、不写实现 gap，gap 由 10 单独跟踪）
  验证：文档审阅；只呈现目标态；引用 `01-user-journeys.md` 旅程与 `03-full-ui-layout.md` 区域
  来源：proposal "变更范围" 第 3 层、scope drift 补全
- [x] 5.18 新增 `docs/ucd/10-implementation-gap-analysis.md`，承载实现 gap 分析（43 项 gap：A 类 spec gap + B 类 UCD 设计 gap B1-B21），每项标注用户场景、业务价值、设计要点、缺口、待补齐
  验证：文档审阅；统计与 README 计数一致（合计 43 项）
  来源：proposal "变更范围" 第 3 层、scope drift 补全
- [x] 5.19 新增 `docs/ucd/11-ux-limits-and-constraints.md`，承载 UX 限制与约束（上下文窗口、流式延迟、并发工具、移动端适配等）
  验证：文档审阅；限制项引用对应 spec 契约
  来源：proposal "变更范围" 第 3 层、scope drift 补全
- [x] 5.20 新增 `docs/ucd/05-component-specs/background-task-monitor.md`，定义后台任务监控组件规范（shell/tool 两类任务、Kill 操作、Badge 计数、下拉面板）
  验证：文档审阅；引用 `01-user-journeys.md` 旅程 24
  来源：proposal "变更范围" 第 3 层、scope drift 补全
- [x] 5.21 新增 `docs/ucd/05-component-specs/cron-task.md`，定义 Cron 定时任务组件规范（创建/列出/删除、Tab 分离运行中/已结束、nextRunAt 倒计时）
  验证：文档审阅；引用 `01-user-journeys.md` 旅程 25
  来源：proposal "变更范围" 第 3 层、scope drift 补全
- [x] 5.22 新增 `docs/ucd/05-component-specs/expand-panel.md`，定义右侧展开面板组件规范（地图/图表/PIU 等富内容、PIU 布局切换 docked/floating/maximized）
  验证：文档审阅；引用 `01-user-journeys.md` 旅程 20、23
  来源：proposal "变更范围" 第 3 层、scope drift 补全
- [x] 5.23 新增 `docs/ucd/05-component-specs/file-download.md`，定义文件下载卡片组件规范（Agent 生成文件下载、loading/success/failure 三态）
  验证：文档审阅；引用 `01-user-journeys.md` 旅程 22
  来源：proposal "变更范围" 第 3 层、scope drift 补全
- [x] 5.24 新增 `docs/ucd/05-component-specs/sub-window.md`，定义导航卡片组件规范（从对话通知跳转集成方系统页面、CustomEvent 分发）
  验证：文档审阅；引用 `01-user-journeys.md` 旅程 21
  来源：proposal "变更范围" 第 3 层、scope drift 补全
- [x] 5.25 新增 `docs/ucd/05-component-specs/tool-output-presentation-policy.md`，定义工具输出呈现策略（safeResult.kind × 呈现矩阵、dev/prod 过滤策略、think 呈现与安全过滤）
  验证：文档审阅；引用 `conversation-ui-state.md` 第 2 节
  来源：proposal "变更范围" 第 3 层、scope drift 补全
- [x] 5.26 新增 `docs/ucd/05-component-specs/tool-ui-interface-overview.md`，定义工具 UI 接口总览（TOOL_STRUCTURED_DELTA 7×6 分发矩阵、safeResult.kind 8 种、Custom channel 扩展）
  验证：文档审阅；引用 `conversation-ui-state.md` 第 2 节
  来源：proposal "变更范围" 第 3 层、scope drift 补全
- [x] 5.27 新增 `docs/ucd/00-overview-feature-map.md`，承载功能特性总览表（8 个功能类别 × 40 个功能 × 6 列：功能/用户能做什么/UI 位置/用户价值/关联旅程/关联规范），双重用途：新成员全景概览 + 干系人能力清单
  验证：文档审阅；40 个功能覆盖全部 14 篇组件规范；关联旅程列引用 `01-user-journeys.md` 旅程编号，无对应用 `-`；关联规范列引用 `05-component-specs/*.md` 文件名
  来源：proposal "变更范围" 第 3 层、集成方扩展点与用户功能交叉映射
- [x] 5.28 新增 `docs/ucd/12-integrator-customization-guide.md`，承载集成方界面定制能力指南（7 类 × 38 项 + HostMode 适用矩阵 + 5 个关键场景代码示例 + 已知缺口 + 导航关系）
  验证：文档审阅；38 项能力覆盖 aico-config-contract/aico-piu-injection/agent-web-multi-host-modes spec 全部扩展点；5 个场景示例可执行
  来源：proposal "变更范围" 第 3 层、集成方定制能力梳理（38 项扩展点）

## 6. deferred gap 记录

- [x] 6.1 确认 design.md "Implementation-vs-spec gap" 章节记录 3 处 deferred gap（`todoList` safeResult.kind、3 个 `clipStream*` kind、pending input 前端状态机），每处标注代码现状、缺什么、后续 change 建议
  验证：文档审阅；gap 列表与本 change 范围一致，不在本 change 内收敛
  来源：proposal "显式 deferred gap"、design 决策 4

## 7. 无代码改动确认

- [x] 7.1 确认本 change 不修改任何代码（前端、后端、contract、event 均不变）
  验证：`git diff main -- ':!openspec/' ':!docs/ucd/'` 无输出；`npm run lint:architecture` 不受影响
  来源：proposal "影响范围 - 代码：零改动"、design 决策 4

## 8. 归档前基线更新

- [x] 8.1 归档前合并 4 个新 requirement 到 `openspec/specs/ts-run-status-visibility/spec.md`
  验证：`openspec validate --all --strict`；合并后基线 spec 无 requirement 名称冲突
  来源：proposal "归档前更新基线"、design "归档前更新基线"
- [x] 8.2 归档前确认 `conversation-ui-state.md`、`spec-to-design-map.md` 条目、`overview.md` 背景说明已落地到长期设计基线
  验证：`openspec validate --all --strict`；长期设计文档引用不指向 active change 路径
  来源：proposal "归档前更新基线"、design "归档前更新基线"
