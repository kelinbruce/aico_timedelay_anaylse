# UCD 能力差距交付里程碑

[返回 Roadmap V2](../nextagent-ts-change-roadmap-v2.md)

本文档把 `docs/ucd/` 的目标交互设计与 2026-08-13 的实现、OpenSpec 和测试基线对齐，形成可认领、可并行、可验收的 change 交付入口。稳定主干基线为 `origin/main@4f27c4a9f`。completed thinking、run event history、fork snapshot、browser history hydration、ProcessPanel activity affordances、跨会话五态 Activity、Capability 业务标题、Cron 管理 API/Dashboard、协作式 PIU 历史聊天回放和三宿主一致性均已进入主干；其中仍位于 active change 的增量在正文明确标注待归档，不声称 Stable Spec 已同步。thinking 字段级脱敏/限长仍是独立 clarify 范围。

`docs/ucd/10-implementation-gap-analysis.md` 保留为 UCD 契约归档时的历史差距快照，不直接作为开发 backlog。规划审查记录见 [UCD 能力差距交付规划审查](./ucd-capability-delivery-review.md)。

## 状态口径

- `ready`：目标、owner、存量增量路径和验收出口唯一，可认领后起草 OpenSpec。
- `blocked`：目标已经明确，但必须等待列明依赖合入或归档并释放冲突面。
- `clarify`：仍有产品、契约、owner 或安全决策，不能创建实施型 change。
- `candidate`：只保留为后续候选，创建前还要重新审查拆分和优先级。
- `active`：OpenSpec change 已建立并通过准入确认，implementation tasks 尚未全部完成。
- `absorbed`：原卡目标已进入另一条 active change 的更完整唯一实施路径，不得再独立认领或实现。
- `implemented`：当前主干已有实现，或对应 change 的 implementation tasks 已完成，不重复立项；若 change 尚未 archive，必须显式标记 `archive pending`，不得冒充 stable spec。

本文档严格区分 `[已实现-主干]`、`[在建-WIP]` 和 `[UCD目标]`。UCD 目标不会因为写入本文档就被视为当前能力。

## 使用方式

1. 团队成员只认领状态为 `ready` 的 change；在本表和对应 change 卡片中填写认领人，并建立与 change id 同名的任务单。
2. 认领后先按卡片输入生成 OpenSpec proposal/design/spec/tasks，通过 `nextagent-skill-review` 后才进入实现。
3. 每个 change 使用独立分支，默认命名为 `codex/<change-id>`；不得把两个 change 合并到同一实现分支。
4. `blocked` 只在依赖合入或归档且冲突面释放后转为 `ready`；`clarify` 和 `candidate` 不得直接实施。
5. 状态变化以仓库文档为准；任务系统只同步认领人、进度和链接，不复制规格正文。

## 可认领并行组 UCD-P1

原 UCD-P1 的 Capability Result、Session Activity、Process Activity 与 Capability 业务标题 change 均已合入并归档；TodoWrite 本地化也已由 `refine-capability-result-card-presentation` 交付。当前没有可直接认领的 UCD-P1 实现卡；已交付或已归档范围不得继续以 active/ready 名义领取。

| Change | UCD gap | 优先级 | 状态 | 主要 owner | 认领人 | 依赖 | 验收出口 |
|---|---|---:|---|---|---|---|---|
| `localize-agent-web-todo-result-presentation` | A8 | P2 | absorbed / implemented | `frontend/agent-web` process presentation | — | 由 `refine-capability-result-card-presentation` 吸收 | Todo 系统摘要、状态和空态已跟随 locale，Agent 生成内容保持原文；不再独立认领 |

并行边界：

- TodoWrite 本地化已经交付；后续只按回归 bug 处理，不恢复原独立 change 卡。
- Session Activity 已由 `cross-session-activity-awareness` 稳定规格统一承载；不得恢复 `refine-session-list-run-awareness` 的第二条 frontend-only 运行态路径。

## 已记录的后续体验 change（暂不进入 Ready 队列）

| Change | 状态 | 主要 owner | 前置条件 | 验收出口 |
|---|---|---|---|---|
| `add-localized-capability-public-identity` | absorbed（由已归档 `refine-capability-process-business-language` 承接） | — | 不再独立实施 | 业务标题和 provider-backed display name 已进入主干；回归按 bug 处理 |
| [`add-shared-conversation-safe-process-details`](https://gitcode.com/gdd_hw/NextAgent/issues/578) | candidate（Issue #578，未创建 OpenSpec） | `agent-session` 只读分享投影 | capability result 前置已归档；仍需与 `add-share-ops-hash-permission` 的分享契约修改面完成协调，并确认投影按创建时冻结还是查看时策略解析 | 分享者可选择是否包含执行详情；只展示受平台安全上限约束的安全投影；严格限制到冻结 `runIds`；权限、过期和删除同步生效；500 步混合过程零逐结果请求 |

`add-localized-capability-public-identity` 已被归档的 `refine-capability-process-business-language` 吸收，不得再独立认领或实施。

分享安全执行详情 change 以 Issue #578 记录业务目标，当前不创建实施型 OpenSpec。它需要先确定分享投影的冻结时点和 share-scoped 跨 Owner Scope 读取边界；`agent-channel-web`、共享安全 projector 和 Agent Web 只做必要协作接入。确认唯一实施路径且前置依赖满足后才能从 `candidate` 转为 `ready`，不得把原始 Capability Result Message 重新引入分享响应。

## 已实现或已有 implementation-complete change 承接

| UCD gap | 主干事实 | 处理 |
|---|---|---|
| A7 文本数据附件 | `add-ts-remote-file-upload` implementation tasks 已完成，active change 尚待 archive | 配置启用的 CSV/TSV/TXT/JSON/XML/LOG 已进入当前主干的统一 staged upload；CSV/TSV 映射 `EXCEL`，其余文本映射 `MARKDOWN`。context 只投影安全 metadata，runtime materialize run-scoped path，由既有 Read/workspace 工具读取；不得另建“正文直接进入 context”的平行实现。 |
| A6/B17 的基础护栏 | `add-ts-safety-guardrails` 与 `refine-stream-guard-blocked-event` 已归档 | 主干已有 REMOTE input/output whole-round guard、`OUTPUT_GUARD_BLOCKED` 和 blocked assistant model-history 隔离；字段级脱敏及其他 surface 是否继续扩展仍在 clarify。 |
| A2/B15 的基础呈现 | `agent-web-ui-interaction` 与现有 ACTION/OPERATOR renderer | 普通 OPERATOR 按钮和宿主事件路径已存在，LINK 专门卡片未实现；模型可控 event key 的 allowlist/scope/确认，以及 ACTION live re-render/history replay 的 at-most-once/idempotency，作为独立安全 clarify，不重复实现 renderer。 |
| B6、C1、C6、C7、C8、C10、C11、C13 | 当前实现和测试 | todoList kind、reconnect/resync、SUPERSEDED、安全失败占位、截断、后台任务追踪、会话搜索和 history 不自动打开 Expand Panel 不再进入 backlog。 |
| B8、B11、B16 thinking/process history continuity | `refine-session-thinking-presentation-contract` 与 `establish-conversation-process-history-continuity` | completed thinking event 持久化、run-scoped history、fork snapshot、message-first browser hydration 和三宿主旅程已进入稳定基线；后续 activity refinement 也已归档，不得重新创建 thinking message、平行 history adapter 或第二套 lifecycle。 |
| B3 跨会话活动与终态提醒 | `cross-session-activity-awareness` | `WAITING_FOR_INPUT`、`RUNNING`、`UNREAD_FAILURE`、`UNREAD_RESULT`、`NONE` 五态、独立 Activity stream、四个会话入口和匹配消费已进入稳定基线。 |
| A5/C4/C9 Cron 管理面与结果呈现 | `cron-task-management-api`、`agent-web-cron-task-dashboard` 与 `refine-capability-result-card-presentation` | Owner + Agent scope 的管理 API、Dashboard、创建/修改/删除/即时执行、执行记录与日期/任务筛选已交付；Cron Tool 的 `cron` safeResult parser 和本地化 create/delete/list 专门呈现也已进入主干。 |
| B12/B13/B14 Process Activity | `agent-web-process-panel` | 活动步骤提示、一次性进入反馈、共享 viewport 跟随、无延迟视觉交接和完成后目录式重开已交付；不得新增第二个 `scrollIntoView` owner。 |
| C2 workflow pending input 路线 | `cross-session-activity-awareness` 与现有 pending-input specs | Workflow 需要输入时复用既有 `QUESTION`；稳定规格明确禁止新增 workflow interrupt durable kind。 |
| B21 集成方定制文档 | `docs/ucd/12-integrator-customization-guide.md` 与现有 multi-host contracts | 作为事实文档持续刷新，不创建实现 change；文档中的过时实现标记不等于新增产品能力。 |

附件实现仍有一个非 UCD 产品缺口的安全加固候选：[`harden-staged-text-file-content-validation`](../nextagent-ts-changes/harden-staged-text-file-content-validation.md)。它保持 `clarify`，不计入 UCD-P1。

## Process activity 交付组 UCD-P2

| Change | 状态 | 前置条件 | UCD gap | 释放条件 |
|---|---|---|---|---|
| `establish-conversation-process-history-continuity` | implemented | 父 change 已合入 | B8、B11、B16 | 已交付并归档，不再认领 |
| `add-agent-web-process-activity-affordances` | implemented（已归档） | process history continuity 已稳定 | B12、B13、B14；B11 浏览器交接 refinement | 已进入 `agent-web-process-panel` 稳定规格和主干，不再认领 |

`add-agent-web-process-activity-affordances` 已在同一个 shared disclosure/viewport owner 内交付活动提示、一次性进入反馈、无延迟交接和目录式重开；没有增加 timer、history adapter、runtime lifecycle、Message/Event 或持久化路径。B7 长答案折叠和 B10 并行批次元数据仍分别保持 `clarify`。B9 当前已消费安全 code/detail；在出现明确用户收益前不为其余字段单独立项。

## 长期设计治理跟进（不进入 Ready 实现队列）

Thinking/history 归档已刷新 `conversation-ui-state.md` 的 23 种 channel event / 22 种 canonical timeline projection + guard relay 口径，并由 `conversation-process-history.md` 自足承载 message/event 分离、持久化、fork、browser hydration 与 disclosure。剩余长期设计治理跟进包括：pending-input 矩阵需按稳定规格的 4 种 durable kind 与 workflow 复用 `QUESTION` 校正；safeResult 矩阵需按 backend/upstream projection、frontend parser、specialized formatter、supplemental-input path 与 generic fallback 分层刷新。

因此，在该长期设计完成归档同步前：

- Stream/thinking/history 当前事实以 stable specs、`conversation-process-history.md` 和本里程碑为入口；旧 UCD 快照中的 WIP 标注不再覆盖稳定基线。
- 任何新增/修改 stream vocabulary、history hydration、thinking 产品路径、pending-input kind/presentation 或 safeResult kind/presentation 的 change，必须先核对 stable/active specs 与当前代码，并把长期 design / spec-to-design map 同步列入归档门禁。
- Pending-input 与 safeResult 的剩余跟进必须由各自 vertical change 或独立 design-sync 承接；当前 UCD-P1 没有 ready 实现卡，也不能把历史条目认领为无 OpenSpec 的直接实现任务。

另一个已确认的治理漂移来自 background-task 的两份 stable spec 和一处生产 schema：`openspec/specs/agent-web-background-task-control/spec.md` 仍描述“最多每 2 秒 REST 轮询”，而主干 `BackgroundTaskHeaderMonitor` 已采用 session mount 一次性 REST seed + `BACKGROUND_TASK_*` canonical stream live update + Kill local override；`openspec/specs/background-task-completion/spec.md` 仍要求显式 Kill 至多提交一次通知续跑，但主干自然完成与 Kill 均只更新 durable 终态/timeline，不创建 continuation run 或 chat notification；`packages/agent-capability/src/builtins/bash/bash-schemas.ts` 的 model-facing `run_in_background` 描述却仍承诺“完成后会收到通知”，会诱导模型等待不存在的 continuation。UCD 已按实际 silent 行为刷新；后续后台任务 contract/design-sync change 必须同时修正 stable specs、schema 与映射，不能恢复第二条 polling lifecycle，也不能在无新契约时恢复 Agent continuation。

## 待澄清 UCD-P3

| Change | 状态 | UCD gap | 必须先回答的问题 |
|---|---|---|---|
| [`add-piu-submit-to-conversation`](../nextagent-ts-changes/add-piu-submit-to-conversation.md) | clarify | B1 | 嵌套 PIU 的用户提交是注入草稿还是立即发送；payload schema、大小、安全过滤和失败恢复如何定义 |
| [`add-session-list-conversation-preview`](../nextagent-ts-changes/add-session-list-conversation-preview.md) | clarify | B3/B4 | sidebar 采用 inline 一行还是 hover/focus card；turn favorite 是否需要独立 session 聚合契约 |
| [`add-agent-web-service-health-surface`](../nextagent-ts-changes/add-agent-web-service-health-surface.md) | clarify | C12 | 浏览器消费 `/health` 还是 `/health/deep`；auth、probe budget、polling、hysteresis 和 submit gating 如何固定 |
| [`harden-user-visible-agent-content-redaction`](../nextagent-ts-changes/harden-user-visible-agent-content-redaction.md) | clarify | A6、B17、B18 | whole-round guard、字段级 redaction、safe-result whitelist 的关系，live/history/share 的 authoritative owner，以及策略配置的 owner、scope、默认值与生效时机 |
| [`harden-action-operator-event-dispatch`](../nextagent-ts-changes/harden-action-operator-event-dispatch.md) | clarify | A2、B15 | 模型提供的 ACTION/OPERATOR event key 如何经过 allowlist、host registration、scope 与必要确认；ACTION live re-render/history replay 的禁派发或 at-most-once/idempotency 边界是什么 |
| [`add-ts-artifact-downloads`](../nextagent-ts-changes/add-ts-artifact-downloads.md) | clarify | A1 | `artifactId` 如何定位 opaque `BlobRef` 并证明 owner/Agent/session 可见性 |
| [`add-ts-long-running-capability-control`](../nextagent-ts-changes/add-ts-long-running-capability-control.md) | clarify | A3、A4、B2、B20 | progress、cancel、background、fork 四条 authority 如何拆成独立 change |
| [`clarify-cron-result-session-navigation-policy`](../nextagent-ts-changes/clarify-cron-result-session-navigation-policy.md) | clarify | B19 | 协调当前 same-session 代码/OpenSpec 与“不得进入原会话 active context”的 UCD 目标；在保留现状或隔离路线中形成唯一、可审计的上下文与导航策略 |
| [`add-agent-web-long-answer-collapse`](../nextagent-ts-changes/add-agent-web-long-answer-collapse.md) | clarify | B7 | 折叠阈值、用户手动覆盖、复制/搜索/accessibility 和 history 行为是什么 |
| [`project-parallel-tool-batch-metadata`](../nextagent-ts-changes/project-parallel-tool-batch-metadata.md) | clarify | B10 | canonical batch metadata 由哪个 backend owner 投影，字段和 replay/history 语义是什么 |
| [`harden-staged-text-file-content-validation`](../nextagent-ts-changes/harden-staged-text-file-content-validation.md) | clarify | 非 UCD gap | 全文件 UTF-8/NUL 检查的容量策略，以及 multipart MIME 是否进入 staged runtime contract |
| [`add-agent-web-structured-onboarding`](../nextagent-ts-changes/add-agent-web-structured-onboarding.md) | candidate | A9 | 首次触发、完成/跳过状态 owner、user/agent/host scope 和 reset 入口 |

Cron 管理面已由 `cron-task-management-api` 与 `agent-web-cron-task-dashboard` 稳定规格承载，不再保留 `add-cron-task-management-surface` clarify 卡。`clarify-cron-result-session-navigation-policy` 仍只处理执行结果的会话归属/导航，不得重建管理 API、Dashboard 或第二套 runtime-owned recurrence lifecycle。

## 不单独创建 change

| UCD gap | 结论 | 后续处理 |
|---|---|---|
| B5 工具输出呈现策略框架 | 已由安全与用户可见 vertical change 承接 | `govern-user-visible-capability-result-projection` 已建立平台安全上限和启动期三档配置；`refine-capability-result-card-presentation` 已把默认 Bash/Python/Rag 详情和 ToolSearch/Cron/TodoWrite 本地化专门呈现带入主干。按场景配置截断阈值和内容扫描的四策略 UCD 目标仍未交付。 |
| B9 其余 degradation 字段 | 当前收益不足 | 已有 code/detail 消费；出现可验证用户旅程时再立项。 |
| B18 独立管理员配置控制面 | 归入 redaction clarify | 安全策略配置本身仍是 B17 的目标依赖；先在 `harden-user-visible-agent-content-redaction` 中确认配置 owner、scope、默认值、生效时机和审计要求。只有确认需要动态管理 UI/API 后，才另立控制面 change。 |
| C3 `clipStream*` 专门前端呈现 | candidate-no-change | `CUSTOM clip_server` 已能生成三种 upstream safe projection，但当前前端 parser/formatter 不识别，统一走安全通用摘要；没有明确用户收益前不为专门模板单独立项。 |
| C5 `httpResponse` | candidate-no-change | 通用安全结果展示可用；只有出现专属交互收益时再立项。 |

## 任务领取与流转

```text
ready → 认领并登记任务单 → openspec-propose → nextagent-skill-review
      → implementation → verification → nextagent-code-review → merge/archive
```

任务单最少包含 change id、负责人、卡片链接、目标分支、OpenSpec 链接、验收命令和当前阻塞。任务单不得成为规格正文的第二份副本。

## 里程碑完成条件

- 当前 `ready` change 被认领后生成通过审查的 OpenSpec change；已归档条目不得重复认领。
- 每个实现 change 有独立分支、独立验收证据和单一主要 owner。
- UCD-P2 已完成并归档；后续 ProcessPanel 体验 change 必须基于当前 stable spec 和共享 viewport owner 增量设计。
- UCD-P3 的产品、契约和安全选择在转为 `ready` 前形成唯一实施路径。
- 历史 gap 快照中的每个条目都能追溯到 implemented、ready、blocked、clarify/candidate 或 not-planned 结论。
