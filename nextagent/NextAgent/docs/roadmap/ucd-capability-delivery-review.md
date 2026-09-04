# UCD 能力差距交付规划审查

审查对象：`ucd-capability-delivery` roadmap one-pager 与其引用的 UCD change 输入卡片

原检查日期：2026-07-21；当前处置复核：2026-07-28

原稳定代码基线：`origin/main@e18429b0`

当前稳定代码基线：`origin/main@5add5932`。原外部依赖 `refine-session-thinking-presentation-contract` 与 successor `establish-conversation-process-history-continuity` 已依次合入，并在归档同步中关闭 UCD-R11 及 UCD-R18 的 thinking/history 部分。下方 Findings 保留 2026-07-21 的原始审查证据；涉及旧 commit、WIP 和 blocked 状态时按本段与当前 roadmap 覆盖。

## 审查结果

状态：PASS WITH FOLLOW-UP（thinking/history delivery follow-up 已关闭；pending-input、safeResult 与 background-task drift 仍开放）

本结论只表示规划已经把未决问题挡在实施准入之外。`refine-session-list-run-awareness` 已由 `add-ts-cross-session-activity-awareness` 吸收；后者已完成产品、交互、数据、恢复与实现边界确认，并以 `refine-ts-session-activity-stream-boundary` 作为串行 contract prerequisite。该 refinement及downstream change现已通过semantic review与strict validation，Activity可以按唯一具名的Session Activity Projection Stream边界进入后续实现。`localize-agent-web-todo-result-presentation` 仍是另一张 Ready 卡；其他 `clarify` 和 `candidate` 卡仍不得直接实施。`conversation-ui-state` 的 event/thinking/history 已刷新，pending-input 与 safeResult 库存以及 background-task stable specs/model-facing schema 仍需后续同步。

## 2026-07-28 后续准入更新

本次增量核对代码基线为 `HEAD@02fef4cf`。

UCD-R16 原先只允许消费 session list 中的 `hasInFlightRequest`，因为当时没有 terminal unread/viewed truth。后续讨论已经形成唯一增量路径：

- `agent-session` 拥有 Owner Scope + Agent Scope 下的进程内会话活动投影，从 durable latest run、active pending input 与 committed terminal facts 派生五态。
- 每个 app instance 使用一条独立于当前会话 Request Execution Stream 和列表分页的 Session Activity Projection Stream；初始发送非 `NONE` 稀疏快照，之后只发送单会话语义 delta。该流不使用 `StreamEnvelope`、timeline sequence、resume cursor 或 `RuntimeSessionPort.streamEvents(...)`。
- 终态提醒由 opaque `activityId` 与已呈现 terminal `observedRunId` 双重匹配消费；`isConversationSurfaceVisible`只提供必要的宿主表面可见证据，匹配terminal presentation成功且document可见后才提交，其他在线实例同步收到 `NONE`。
- collaborative 顶部 History trigger 在存在不处于用户当前查看conversation surface中的非 `NONE` 活动时显示 locale-backed 蓝点；当前active且surface-visible会话只在本地排除，不等于消费backend unread，打开 History Popover 本身也不清除蓝点或消费终态活动。
- 首版明确不新增 activity/observation表、`feedSequence`、revision或resume cursor；进程重启不恢复历史终态未读，但会从 durable facts恢复仍运行或仍等待输入的会话。
- `agent-contracts/session` 与 `agent-contracts/runtime` 只做 additive contract；public Web DTO继续归 `agent-channel-web` schema/projection，不新增不存在的 `agent-contracts/web`。

该决策把 UCD-R16 从“独立候选”提升为一个 contract refinement 加一个 downstream vertical change 的串行交付链，同时保留 UCD-R3 对 preview 与 favorite 不得混入的拆分结论。原 Findings 作为历史证据保留；涉及 session run awareness 的旧 Ready 结论以本节和当前 roadmap 为准。

## Findings

| ID | 严重级别 | 领域 | 位置 | 问题 | 处理结果 |
|---|---|---|---|---|---|
| UCD-R1 | BLOCKER | PIU interaction | 原 `add-aico-piu-submit-bridge` | 初稿把 B1 设计成 collaborative host callback；UCD 实际要求嵌套 ToolMessageType PIU 把用户结果反馈到会话。 | 删除错误卡，改为 `add-piu-submit-to-conversation` clarify；草稿/立即发送、schema 和失败恢复未确认前不得实施。 |
| UCD-R2 | BLOCKER | Attachment context | 原 `extend-staged-attachment-text-data-support` | A7 已由 `add-ts-remote-file-upload` 的主干实现承接（implementation tasks 完成、archive pending）；初稿又要求正文进入 context，与当前 metadata + materialized path + Read 路径冲突。 | A7 关闭为 implemented；原卡转为非 UCD 的 staged text validation security clarify，不把 active change 冒充 stable spec。 |
| UCD-R3 | HIGH | Session navigation | 原 `refine-session-list-run-awareness-and-preview` | run-awareness、sidebar preview 和 turn favorite 聚合是三种语义，不能作为一个 Ready change。 | preview 继续独立 clarify，未定义 session favorite 字段；原 frontend-only run-awareness卡已被 `add-ts-cross-session-activity-awareness` 吸收。 |
| UCD-R4 | HIGH | Health policy | `add-agent-web-service-health-surface` | `/health` 与 `/health/deep` 的语义、浏览器消费权限、polling、hysteresis 和 submit gating 未形成唯一路径。 | 改为 clarify。 |
| UCD-R5 | HIGH | Parallel delivery | 原 UCD-P1 | 原 5 张 Ready 卡中 4 张集中在 `frontend/agent-web`，且共享 i18n 与测试面，“5 个不同主 owner”不成立。 | Ready 收敛为 2 张；明确逻辑无依赖但存在共享文件合并协调。 |
| UCD-R6 | HIGH | Workflow pending input | `add-workflow-interrupt-pending-input-ui` | 当前只有 4 种 durable kind；workflow producer 使用 `QUESTION + WORKFLOW_NODE/INTERRUPT producerRef + 空 questions`，但 Web safe projection 不暴露 producerRef，前端也没有专用分支，未知 kind 还会兼容性降级成可提交自由文本的 `CLARIFICATION`。 | 从 blocked 改为 clarify；先确认新增 durable kind 或可信 producerRef-derived presentation 唯一路线，并定义不可识别/空问题的 fail-closed 行为。 |
| UCD-R7 | HIGH | Content safety | `harden-user-visible-agent-content-redaction` | 最新主干已归档 safety guardrails，但 whole-round block 不等于字段级 redaction，也未自动覆盖 thinking/tool result/share。 | 以 guardrail 为 current baseline 重写为 clarify，不预设 `agent-channel-web` 是 authoritative owner。 |
| UCD-R8 | HIGH | Cron ownership | `add-ts-recurring-agent-tasks` | 旧候选把 recurrence lifecycle 交给 runtime，与 `add-ts-cron-tools` 已落主干的 Cron backend scheduling ownership 重叠；后者 implementation tasks 完成但 active change 尚待 archive。 | 旧卡标记 re-scope；管理面与结果 session/navigation 分为两个 clarify 输入，并在使用 stable-spec 口径前完成 archive/design sync。 |
| UCD-R9 | MEDIUM | Process presentation | `add-agent-web-process-activity-affordances` | 长答案、parallel batch projection、degradation 和 activity affordance 被打包到同一卡，跨 owner 且部分已有实现。 | 前端 blocked 卡只保留 B11-B14；B7/B10 分别 clarify；B9 不单独立项。 |
| UCD-R10 | HIGH | Security | ACTION/OPERATOR | 当前结构化呈现已存在，但模型可控 event key 缺少明确 allowlist、host registration、scope 和确认策略；ACTION render effect 还可能在 live re-render、remount 或 history replay 时重复 dispatch。 | 新增 `harden-action-operator-event-dispatch` clarify，不重复创建 renderer；进入 Ready 前必须冻结 history 禁派发或 live-only at-most-once/idempotency 边界并覆盖重复渲染 negative tests。 |
| UCD-R11 | HIGH | Delivery truth | thinking/history dependency | `662baf33` 虽已推送且完成 18/19，但尚未合入主干。 | 里程碑显式标为 `[在建-WIP]`，下游 continuity/activity 保持 blocked。 |
| UCD-R12 | HIGH | Cron architecture | B19 result ownership | 当前 `add-ts-cron-tools` active change/代码把 occurrence 写回创建任务的 session，而 UCD 目标要求后台结果不进入原会话 active context；两者尚未通过架构决策协调。 | clarify 优先评估派生 session、schedule execution session 或独立结果日志；若保留当前 same-session 路线，必须显式说明 context 影响并先做 architecture/spec refinement。 |
| UCD-R13 | HIGH | Security configuration | B18 disposition | 初稿把 B18 标为 not-planned，与 thinking/answer 安全过滤的既有目标依赖冲突。 | B18 配置决策并入 redaction clarify；是否需要独立动态管理员控制面留待 owner/scope/default/lifetime 决策后再定。 |
| UCD-R14 | HIGH | UCD current facts | UX limits | 流事件仍使用旧 17 项词汇，附件提示仍把 compatibility 3 个/5 MiB/Markdown-only 当产品主路径。 | 按 23 项 channel contract、22 项 canonical timeline projection、guard relay 例外和 frontend compatibility 词汇重写；附件 UI 改为消费 bootstrap effective 配置。 |
| UCD-R15 | MEDIUM | Todo fallback | Ready A8 | 初稿要求 formatter 处理 unknown status，但当前 safe-result reader 会先 fail closed。 | 固定为既有 reader 拒绝非法 todoList，走 generic safe-summary fallback；本 change 不扩大 parser/schema。 |
| UCD-R16 | MEDIUM | Session run awareness | Ready B3 | 终态角标需要 unread/viewed lifecycle，但初稿没有该 truth，和“不新增未读服务”冲突；Activity stream 还会碰到稳定 Request Execution Stream 契约。 | 2026-07-28 已确认进程内活动投影、终态匹配消费、History trigger蓝点与全 scope稀疏连接；不建观察表，恢复限制显式化。先由 `refine-ts-session-activity-stream-boundary` 冻结唯一具名例外，再由 `add-ts-cross-session-activity-awareness` 实现。 |
| UCD-R17 | MEDIUM | Review coverage | 群内确认清单 | parallel batch projection 与 long-running contract 拆分未显式进入群内确认清单。 | 补入 canonical batch/public projection owner，以及 capability metadata/runtime command/stream/background view 变化决策。 |
| UCD-R18 | HIGH | Long-term design drift | `openspec/designs/architecture/conversation-ui-state.md` | 导航性长期设计仍写 19/20 个 event，并把 thinking history hydration 当成既成事实；稳定主干实际为 23 个 channel event、22 个 canonical timeline projection + guard relay 例外，thinking 仍未持久化。 | UCD 已停止引用旧数量并显式登记治理跟进；thinking/history successor 或独立 design-sync change 必须在归档前刷新长期 design 与 spec-to-design map。此 follow-up 不进入当前 Ready 实现队列。 |
| UCD-R19 | HIGH | Spec/schema drift | `agent-web-background-task-control`、`background-task-completion`、Bash `run_in_background` schema | 两份 stable spec 仍分别要求 2 秒 REST polling和显式 Kill 通知续跑；主干已改为一次 REST seed + canonical stream + Kill local override，且自然完成/Kill 都不创建 continuation/chat notification，但 model-facing schema 仍承诺“完成后会通知”。 | UCD 当前事实按 silent 行为刷新；后台任务后续 change 必须同步 stable specs、schema 和 design map，禁止恢复平行 polling lifecycle，也不能让模型等待不存在的通知。此 follow-up 不影响当前 UCD-P1 交付卡。 |
| UCD-R20 | HIGH | Long-term design drift | `conversation-ui-state.md` safeResult matrix | 同一文档一处声称 CLIP 后端无投影、另一处又称代码已投影；矩阵也未反映当前 `toolSearch`、`cron`、`workflowResult` 与 frontend parser/formatter/fallback 分层。 | UCD 已改为按 backend/upstream projection、frontend parser、specialized formatter、generic fallback 分层，不再维护固定 kind/template 总数；后续 safeResult vertical change 或独立 design-sync 必须刷新长期 design 与 spec-to-design map。 |
| UCD-R21 | HIGH | Long-term design drift | `conversation-ui-state.md` pending-input matrix | 长期设计声称 5 种 durable kind；当前 common contract 只有 4 种，workflow interrupt 由 producerRef 区分且该字段未进入 Web safe projection。 | UCD 已分开记录 4 种 durable kind、7 个 frontend accepted identifier 和 workflow Clarify；pending-input vertical 或独立 design-sync 必须刷新长期 design/spec map。 |

## 需群内确认

- `add-ts-artifact-downloads`：确认 artifact durable content locator、Agent/session visibility、cleanup/expiry 和 gateway contract。
- `add-workflow-interrupt-pending-input-ui`：确认新增 `PendingInputKind.WORKFLOW_INTERRUPT`，还是从 `PendingInputProducerRef.WORKFLOW_NODE/INTERRUPT` 派生 presentation kind。
- `harden-user-visible-agent-content-redaction`：确认 whole-round guard、字段级 redaction、safe-result whitelist 的关系，authoritative scan/persistence owner，以及 B18 策略配置的 owner、scope、默认值、生效时机和审计要求。
- `add-agent-web-service-health-surface`：确认浏览器可消费的 health endpoint、auth policy、probe budget 和 submit gating。
- Cron 管理与结果归属：确认管理 API scope/owner，以及 occurrence 的 session、context 和导航策略。
- `harden-action-operator-event-dispatch`：确认可信 host action catalog/allowlist、scope、需要用户确认的操作类别，以及 live re-render/history replay 的禁派发或 at-most-once/idempotency 规则。
- `project-parallel-tool-batch-metadata`：确认 canonical batch fact、public stream/history projection 字段与 owning contract。
- `add-ts-long-running-capability-control`：拆分后逐项确认 capability metadata、runtime command、stream event、`BackgroundTaskView` 是否变化及其 owner。

上述事项均不在 Ready 集合中；确认完成前不得创建实施型 OpenSpec。

## 约束对齐

| 约束来源 | 结果 | 备注 |
|---|---|---|
| architecture | PASS WITH FOLLOW-UP | Session activity truth由 `agent-session` 派生，runtime lifecycle仍是 canonical owner，Web与frontend只投影；Activity 获得唯一 Session Activity Projection Stream例外但不进入 Request Execution Stream。Cron、artifact、security、health及其余pending-input/safeResult漂移仍按既有门禁处理。 |
| core contracts | PASS | 前置 refinement只修改稳定规格解释，不改TypeScript类型；downstream change只向 `agent-contracts/session` 与 `agent-contracts/runtime` 增加 additive契约，不修改既有 run、pending-input、timeline、list、`StreamEnvelope`或detail-stream vocabulary。 |
| roadmap owner boundaries | PASS | Session activity由单一 `agent-session` owner负责，channel/frontend只是投影与消费；todo change保持独立owner，不宣称零文件冲突。 |
| roadmap change rules | PASS | Ready 卡有独立用户可见目标；候选能力组和未决契约没有伪装成实施 change。 |
| current code | PASS WITH FOLLOW-UP | 已按 `e18429b0` 核对 session DTO、PIU、attachment、Cron、health、guardrail、todo formatter、safeResult 分层与 background-task stream/无-continuation 事实；Bash schema 的过时完成通知承诺已登记为非 Ready follow-up。`957f6db1..e18429b0` 只涉及 app startup degradation 与 Skill manifest/body leakage 加固，不改变本规划的 UCD capability 结论；thinking 仅按未合入分支 `662baf33` 记录。 |
| engineering principles | PASS | 删除重复附件实现和第二套 recurrence lifecycle，按 KISS/SOLID 收窄到单 owner、唯一目标路径。 |

## Ready 卡完整性

| 必需项 | 结果 | 备注 |
|---|---|---|
| 触发机制 | PASS | Session activity只在相关 committed fact与durable delete变化时重算；todo仍由result render触发。 |
| 输入和前置条件 | PASS | Session activity复用latest run、active pending input与terminal timeline，并以前置stream refinement作为实施门禁；Sidebar、SearchDialog、immersive CardList与collaborative Popover四个用户可见入口共享activity selector/trailing slot，不强制共享完整row。todo复用safeResult和locale context。 |
| 输出和副作用 | PASS | Session activity输出五态稀疏投影与匹配消费；不改变runtime lifecycle，终态未读不持久化。 |
| 核心决策逻辑 | PASS | 五态优先级、snapshot/delta、真实查看、旧activityId no-op及新run覆盖均唯一；todo fallback不变。 |
| 存量代码基线 | PASS | 已定位runtime listener、gateway readers、delete gap、ER/IR transport、frontend store/row和三宿主入口。 |
| 增量实施路径 | PASS | 先完成stream contract refinement，再新增进程内owner与additive ports；仅复用SSE/WS framing primitive，不复用execution envelope/cursor/store。不建表、不新增timeline vocabulary。 |
| 失败和降级 | PASS | Activity失败与主lifecycle隔离；重启只恢复运行/等待，历史终态提醒可丢失；todo generic fallback保持。 |
| 验收示例 | PASS | Contract、service、transport、frontend、三宿主与两浏览器旅程均有定向测试出口。 |

## Roadmap 规则覆盖

| 检查项 | 结果 | 备注 |
|---|---|---|
| 输入模板字段 | PASS | Ready 卡包含状态、类型、owner、依赖、目标、规格/契约输入、约束、非目标、验收和并行边界。 |
| 创建前覆盖检查 | PASS | implemented/ready/blocked/clarify/candidate/not-planned 分流明确。 |
| release scope | PASS | UCD 视图不改变 P0-P5 release scope。 |
| 并行边界 | PASS | Stream refinement与session activity implementation必须串行；session activity与todo Ready卡逻辑无依赖，共享i18n资源按认领说明协调，不宣称物理文件零冲突。 |
| 第一性原理/KISS/SOLID | PASS | 用户价值驱动拆分，移除跨 owner 能力包和重复 lifecycle。 |
| 唯一可实施路径 | PASS | 仅 Ready 卡具有唯一路径；有路线选择的卡全部保持 clarify。 |

## 建议下一步

1. `refine-ts-session-activity-stream-boundary` 与 `add-ts-cross-session-activity-awareness` 已完成semantic review和strict validation；下一步可按downstream tasks顺序进入独立实现分支。
2. Todo Ready卡可独立建立 OpenSpec；若与session activity并行实施，先协调共享i18n文件写入范围。
3. 对其余群内确认项逐项形成决策；只有 owner、contract和验收路径唯一后才转为Ready。
4. Process history continuity已交付；只复审process activity剩余B12-B14，B11不得重复立项。
