## 背景和现状

NextAgent 已通过 `ts-run-status-visibility`、`ts-stream-resume-replay`、`ts-stream-history-consistency`、`ts-web-sse-ws-transports`、`agent-web-process-panel`、`question-pending-input`、`authorization-pending-input`、`confirmation-pending-input`、`human-pending-input-core` 等 stable spec 建立了 stream event、capability contract、pending input、reconnect/replay、safeError 的后端语义契约。但 Web UI 消费方的可观察呈现契约大量停留在 `packages/agent-channel-web/src/projections/stream-envelope.ts` 与 `frontend/agent-web/src/features/chat/process/processDetails.ts` 代码里，未 spec 化、未 design 化。

UCD 设计人员在进行对话界面设计优化时，需要一份从 UI 视角整合现有 stream event / capability / pending input / reconnect / safeError 事实的单一视图。当前要拼凑 4+ 个 spec 与源代码才能理解完整状态机，存在 6 处导航空缺：

1. 19 种 `StreamEventType` → UI 状态映射无单一文档（后端 `streamVisibleTimelineEvents` 19 种，前端 `STREAM_EVENT_TYPES` 20 种含 `HOOK_DEGRADED`）。
2. `safeResult.kind` × 呈现矩阵不完整（6 种 kind 有 spec，`todoList` 后端已投影但无 spec，3 种 `clipStream*` 后端无投影代码，`httpResponse` 仅前端客户端解析）。
3. 5 种 pending input kind → UI 渲染矩阵无单一视图。
4. Reconnect/replay UI 状态阶梯图无单一视图。
5. SafeError code/category → 失败卡片映射散乱（`summarizeSafeCapabilityFailure` 代码未 spec 化）。
6. Live vs History 状态分叉未显式文档化。

同时存在 4 处窄 gap 无 spec 覆盖：`ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED`、`CONTEXT_COMPACTED` 三个 stream event 在 `stream-envelope.ts` 投影但无 spec；`CAPABILITY_PATH_REJECTED` safeError code 在 `summarizeSafeCapabilityFailure` 映射但无 spec。

约束：

- 本 change 是 **spec-only / design-only**，不改任何代码。
- `ts-run-status-visibility` 已是 stream event canonical vocabulary 与失败可见性的 owner，新增 requirement 必须落在该 capability，避免"规范性事实只能有一个主文档"原则被破坏。
- 现有 stable spec 的契约不得被重复定义；新设计文档只能引用、导航或摘要。
- Live 与 History 是同一对话的两种消费模式，差异只能描述，不能引入新的状态机分支。

相关方：UCD 设计人员（主要读者）、前端工程师（实现消费方）、后端契约 owner（spec 维护者）。

## 目标和非目标

### 目标

1. 补齐 4 处窄 spec gap，使 `ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED`、`CONTEXT_COMPACTED` stream event 与 `CAPABILITY_PATH_REJECTED` safeError code 的前端消费契约有 stable spec 主承载。
2. 新增稳定设计文档 `openspec/designs/architecture/conversation-ui-state.md`，承载 6 处导航空缺，作为 UCD 设计人员的权威入口。
3. 通过 `docs/ucd/` 设计表达文档，将契约层事实转译为 UCD 设计人员可直接消费的组件规范、信息架构与文案。
4. 显式记录 3 处 deferred gap（`todoList` safeResult.kind、`clipStreamEvent`/`clipStreamCompletion`/`clipStreamResult`、pending input 前端状态机），留给后续 change 收敛。

### 非目标

- 不修改任何代码（前端、后端、contract、event 均不变）。
- 不新增 capability；`ts-run-status-visibility` 是唯一被修改的 capability。
- 不收敛 3 处 deferred gap；本 change 只记录其存在与位置。
- 不重复定义现有 stable spec 的状态机、API schema、数据 owner 或接口语义。
- 不引入新的 long-term ADR；本 change 的设计选择是"补 gap + 整合导航"，无新的技术取舍需要 ADR 化。
- 不覆盖 `docs/ucd/` 内部组件视觉规范的具体样式决策（颜色、间距、字号），这些由 UCD 设计人员在组件规范内自行决定，只要不违反契约层 safe field 约束。

## 设计决策

### 决策 1：修改 `ts-run-status-visibility`，不新增 capability

**选择**：4 个新 requirement 全部加入 `ts-run-status-visibility`，不创建 `web-channel/conversation-ui-contract` 之类的新 capability。

**理由**：

- `ts-run-status-visibility` 已是 `StreamEventType` canonical vocabulary 的 owner（见现有 `Canonical stream projection vocabulary 约束` requirement），所有 19 种事件类型在该 spec 定义。
- `ts-run-status-visibility` 已是 failure visibility 的 owner（见现有 `显式 projection failure visibility` requirement），`CAPABILITY_PATH_REJECTED` 是 failure visibility 的子集。
- 创建新 capability 会违反 `openspec/config.yaml` 的"规范性事实只能有一个主文档"原则，导致 stream event vocabulary 出现两个主文档。
- `ts-stream-resume-replay`、`ts-stream-history-consistency`、`ts-web-sse-ws-transports` 各自承担 transport / replay / history 语义，不适合承载"前端消费契约"。

**放弃的备选方案**：

- 新增 `web-channel/conversation-ui-contract` capability：被放弃，因为会导致 stream event vocabulary 与失败可见性出现两个主文档，违反配置原则。
- 把 4 个 requirement 分散到 `ts-attachment-intake`、`context-engine`、`capability-spi`：被放弃，因为这些 capability 的主职责是 runtime 语义而不是 web channel 投影，把前端消费契约放进去会污染 runtime capability 的边界。

### 决策 2：新增 `conversation-ui-state.md` 架构设计文档，承载 6 处导航空缺

**选择**：在 `openspec/designs/architecture/` 新增 `conversation-ui-state.md`，作为 UCD 设计人员的单一入口。文档结构按 6 处导航空缺组织，全部引用现有 specs，不重复定义契约。

**理由**：

- `openspec/designs/architecture/` 是"架构和跨模块设计，承载跨模块流程、系统范围、数据 ownership、安全、可观测、部署、质量属性、核心契约、跨模块状态机和接口语义"的目录。6 处导航空缺本质上是跨 `agent-channel-web`、`agent-runtime`、`agent-session`、`agent-context-engine`、`agent-capability` 的跨模块 UI 状态机，归 architecture。
- `openspec/designs/modules/` 是模块设计目录，承载单一模块职责。UI 状态机跨多个模块，不适合 modules。
- 现有 `request-status-visibility.md`、`stream-projection.md`、`web-stream-transports.md` 已在 architecture 目录承担同类跨模块视图角色，`conversation-ui-state.md` 与之并列。
- `docs/ucd/` 是非 OpenSpec 基线的设计表达层，不能承担契约责任；契约必须先在 OpenSpec 内有主承载，`docs/ucd/` 才能引用。

**文档承载的 6 处导航空缺**：

1. **19 种 StreamEventType → UI 状态映射表**：按 `REQUEST_ACCEPTED`、`LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED`、`TOOL_STRUCTURED_DELTA`、`DEGRADATION_NOTICE`、`REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED`、`USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT`、`USER_INPUT_CANCELED`、`ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED`、`CONTEXT_COMPACTED` 列出 UI 渲染责任、safe field 约束、live/history 重建标注。标注前端 `HOOK_DEGRADED` 差异。引用 `ts-run-status-visibility` 的 canonical vocabulary 与 `ts-stream-history-consistency` 的 history 规则。
2. **safeResult.kind × 呈现矩阵**：覆盖 `commandOutput`、`fileRead`、`fileList`、`fileWrite`、`todoList`、`clipStreamEvent`、`clipStreamCompletion`、`clipStreamResult`、`skillLoaded`、`httpResponse`、unknown 兜底。6 种已 spec 的标注主承载 spec；`todoList` 标注"后端已投影 + spec deferred"；3 种 `clipStream*` 标注"后端无投影代码"；`httpResponse` 标注"前端专用"。引用 `ts-run-status-visibility` 的 `Capability result stream payload MUST expose only safe result projections` requirement。
3. **5 种 pending input kind → UI 渲染矩阵**：覆盖 `question`、`authorization`、`confirmation`、`human-handoff`、`workflow-interrupt`。每种标注 safe field、answer shape、terminal projection（`USER_INPUT_RECEIVED`/`TIMEOUT`/`CANCELED`）。引用 `question-pending-input`、`authorization-pending-input`、`confirmation-pending-input`、`human-pending-input-core`、`human-pending-input-timeout`、`human-handoff`、`workflow-interaction-nodes`。
4. **Reconnect/replay UI 状态阶梯图**：从 `connected` → `degraded`（gap detected）→ `disconnected`（transport close）→ `reconnecting`（cursor-based resume）→ `replayed`（gap filled）→ `live-tail`（new events）的状态流转，标注每个状态的 UI 视觉契约与 `ts-stream-resume-replay` 的 cursor 语义对应关系。引用 `ts-stream-resume-replay`、`ts-web-sse-ws-transports`。
5. **SafeError code/category → 失败卡片映射**：覆盖 `CAPABILITY_PATH_REJECTED`、`CAPABILITY_TIMEOUT`、`CAPABILITY_BLOCKED`、`CAPABILITY_FAILED`、`CAPABILITY_RATE_LIMITED`、`CAPABILITY_POLICY_VIOLATION`（如代码中存在）等 safeErrorCode，以及 `MODEL_PROVIDER_ERROR`、`MODEL_RATE_LIMITED` 等 safeErrorCategory。每种标注卡片视觉、`safeSummary` 渲染位置、是否允许重试。引用 `ts-run-status-visibility` 的 `显式 projection failure visibility` requirement 与本 change 新增的 `CAPABILITY_PATH_REJECTED` requirement。
6. **Live vs History 状态分叉**：核心原则"内容相同，仅流式效果不同"——思考过程、降级提示、压缩通知、能力卡片、助手回答在 history 均可见。按 `SessionMessageRecord.role`（USER、ASSISTANT answer/think、CAPABILITY_RESULT、DEGRADATION、CONTEXT_COMPACTED 持久化；ASSISTANT_TOOL_USE、SUMMARY 过滤）列出 live 模式与 history 模式的差异（仅流式呈现效果：打字机、running 动画、渐进式披露）。Transient streaming 事件（`CAPABILITY_STARTED`、`CAPABILITY_COMPLETED`、`ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED`）不在 history 重建，但其终态内容由持久化消息承载，内容不缺失。引用 `ts-stream-history-consistency` 的 `History Uses Visible Messages` 与 `stream replay SHALL NOT reconstruct final conversation history` 规则。

### 决策 3：新增 `docs/ucd/` 设计表达层，非 OpenSpec 基线

**选择**：在 `docs/ucd/` 下新增 15 个文件（含 README 阅读指南），作为 UCD 设计人员的界面设计参考。文件不进入 `openspec/`，不参与 `openspec validate`。

**理由**：

- OpenSpec 基线只承载契约与跨模块设计事实；UCD 设计表达（人物画像、用户旅程、信息架构、组件视觉规范、空/加载/错误状态、文案）是设计转译产物，不属于规范性事实。
- 把 UCD 表达放进 OpenSpec 会让 `openspec validate` 检查设计表达细节，违反 KISS。
- 把 UCD 表达放进 `openspec/designs/` 会让稳定设计目录承担非契约内容，破坏 `designs/` 的"按审查问题组织"原则。
- `docs/ucd/` 引用 `conversation-ui-state.md` 作为事实来源，组件规范显式区分 live 模式与 history 模式的呈现差异，确保设计表达不偏离契约。

**`docs/ucd/` 文件结构**：

```
docs/ucd/
├── README.md
├── 00-user-personas.md
├── 01-user-journeys.md
├── 03-full-ui-layout.md
├── 04-information-architecture.md
├── 05-component-specs/
│   ├── process-panel.md
│   ├── message-bubble.md
│   ├── capability-card.md
│   ├── pending-input-card.md
│   ├── degradation-notice.md
│   ├── composer.md
│   └── session-list-item.md
├── 06-empty-loading-error-states.md
├── 07-content-copy.md
└── 08-sample-scenarios.md
```

编号 02 预留给后续可能新增的"信息架构详图"。`03-full-ui-layout.md` 承载从整体到局部的渐进式视图（全屏静态总览 → 区域拆解 → 单 turn 交互时序全屏演变 → 多轮交互全屏演变 → live/history 全屏对比），供 UCD 设计人员建立整体到局部细节的理解。`08-sample-scenarios.md` 承载由 `frontend/agent-web-mock-server` 真实生成的典型场景样例数据（正常路径、失败路径、pending input、附件上传、Live vs History 验证），供 UCD 设计人员直接对照组件规范验证视觉设计。样例数据是确定性的，可重复运行获取。

### 决策 4：3 处 deferred gap 显式记录在 design.md，不收敛

**选择**：在 design.md "Implementation-vs-spec gap" 章节记录 3 处复杂 gap，留给后续 change。

**理由**：

- `todoList` safeResult.kind：涉及 `TodoWrite` tool 的语义、`describeSafeCapabilityResult` 的 todoList 分支、todo 状态机的持久化策略，收敛需要先确认 todo 是否形成独立 capability。
- `clipStreamEvent` / `clipStreamCompletion` / `clipStreamResult`：后端 `stream-envelope.ts` 中无投影代码，`processDetails.ts` 的 default 分支兜底渲染。需先确认 CLIP capability 的 spec 归属并实现后端投影，再定义 safe projection 契约。
- Pending input 前端状态机（`USER_INPUT_REQUIRED` → answer → `RECEIVED`/`TIMEOUT`/`CANCELED` 的完整 UI 状态流转）：涉及 5 种 pending input kind 的统一状态机、answer idempotency 的前端表现、late answer 的 UI 处理，收敛需要先确认是否形成 `pending-input-ui-contract` capability。

把这 3 处 gap 强行塞进本 change 会让 spec 范围爆炸，违反"最小、清晰、职责单一的方案"原则。

### 决策 5：Live vs History 分叉只描述，不引入新状态机

**选择**：在 `conversation-ui-state.md` 第 6 节描述 live 模式与 history 模式的 UI 呈现差异，全部基于现有 `ts-stream-history-consistency` 的 `History Uses Visible Messages` 规则与 `SessionMessageRecord.role` 持久化事实。

**理由**：

- Live 与 History 不是两个独立状态机，而是同一对话的两种消费模式。
- 引入"history mode state machine"会与 `ts-stream-history-consistency` 的 history 规则重复定义。
- UCD 设计人员需要的是"live 与 history 的呈现差异清单"——核心原则是内容相同、仅流式效果不同，而不是新的状态机。

## 质量属性设计

### 安全

- **设计结论**：4 个新 requirement 全部强化 safe field 约束。`ATTACHMENT_ACCEPTED`/`ATTACHMENT_REJECTED` 禁止暴露 content bytes、local path、credential、raw validation detail、policy internals；`CONTEXT_COMPACTED` 禁止暴露 compacted prompt content、model output、raw message bodies、internal context-engine state；`CAPABILITY_PATH_REJECTED` 禁止暴露 rejected path、file system detail、policy internals。这些约束在 `stream-envelope.ts` 已实现，本 change 只将其 spec 化。
- **验证入口**：`ts-run-status-visibility` 的 safe error tests、redaction tests、`openspec validate --strict`。
- **不适用理由**：无新代码，无新攻击面。

### 性能/容量

- **设计结论**：本 change 是文档变更，无运行时性能影响。`conversation-ui-state.md` 与 `docs/ucd/` 不引入新的查询、缓存或持久化路径。
- **验证入口**：N/A。
- **不适用理由**：spec-only change，无代码行为变化。

### 可靠性/恢复

- **设计结论**：Live 与 history 呈现的内容完全相同——思考过程、降级提示、压缩通知、能力卡片、助手回答在两种模式下均可见。唯一差异是流式呈现效果（打字机、running 动画）。`ATTACHMENT_ACCEPTED`/`ATTACHMENT_REJECTED` 作为流式瞬态不在 history 重建，但附件状态通过持久化 attachment metadata 呈现，内容不缺失。`CONTEXT_COMPACTED` 由持久化消息重建，在 history 可见。`SUMMARY` message 在 history envelopes 中被过滤。这与 `ts-stream-history-consistency` 的 `stream replay SHALL NOT reconstruct final conversation history` 一致——history 重建基于持久化消息，不是 stream replay。
- **验证入口**：`ts-stream-history-consistency` 的 conversation history tests、opening reconcile tests。
- **不适用理由**：无新恢复路径。

### 可维护性

- **设计结论**：6 处导航空缺收敛到 `conversation-ui-state.md` 单一入口，UCD 设计人员不再需要拼凑 4+ spec 与源代码。3 处 deferred gap 显式记录位置，避免后续 change 重复审计。
- **验证入口**：`conversation-ui-state.md` 内部链接指向现有 stable specs；`openspec validate --strict` 通过。
- **不适用理由**：无。

### 可测试性

- **设计结论**：4 个新 requirement 的 WHEN/THEN 场景可直接转译为 contract test。`conversation-ui-state.md` 的 6 处导航表是文档，不需要独立测试；其引用的现有 specs 各自有 stream projection tests、status visibility tests、safe error tests。
- **验证入口**：`ts-run-status-visibility` 现有 test suite 覆盖 safe projection；4 个新 requirement 的 history 禁止 reconstruct 场景可由现有 conversation history tests 框架扩展（但本 change 不新增测试任务，因为是 spec-only）。
- **不适用理由**：本 change 不新增测试。

### 审计/可追溯性

- **设计结论**：4 个新 requirement 全部引用现有 `StreamEnvelope` 的 `timelineEventRef` 与 `SessionMessageRecord` 持久化事实，不引入新的 audit surface。`CAPABILITY_PATH_REJECTED` 的 safeErrorCode 是 audit-safe 的，不泄漏 path 或 policy internals。
- **验证入口**：`ts-run-status-visibility` 的 safe error tests、`invocation-audit` 的 capability audit contract tests。
- **不适用理由**：无新 audit 事件。

## 验证映射

| 关键约束 | 对应 task | 验证入口 |
|---|---|---|
| `ATTACHMENT_ACCEPTED` envelope 暴露 safe fields only | tasks.md 文档任务 | `openspec validate add-ucd-conversation-interface-contract --strict` |
| `ATTACHMENT_REJECTED` envelope 不泄漏 raw validation error | tasks.md 文档任务 | `openspec validate add-ucd-conversation-interface-contract --strict` |
| `CONTEXT_COMPACTED` envelope 不泄漏 compacted content | tasks.md 文档任务 | `openspec validate add-ucd-conversation-interface-contract --strict` |
| `CAPABILITY_PATH_REJECTED` 不泄漏 rejected path | tasks.md 文档任务 | `openspec validate add-ucd-conversation-interface-contract --strict` |
| `conversation-ui-state.md` 承载 6 处导航空缺 | tasks.md 文档任务 | 文档审阅、`openspec validate --strict` |
| `docs/ucd/` 15 个文件引用契约层 | tasks.md 文档任务 | 文档审阅 |
| 3 处 deferred gap 显式记录 | tasks.md 文档任务 | design.md "Implementation-vs-spec gap" 章节 |
| 无代码改动 | tasks.md 显式无代码任务 | `git diff` 无代码变更 |

## 文档承载决策

| 事实类型 | 主承载文档 | 备注 |
|---|---|---|
| 4 个新 requirement 的行为契约 | `openspec/specs/ts-run-status-visibility/spec.md`（归档时合并） | `ts-run-status-visibility` 是 stream event vocabulary 与 failure visibility 的 owner |
| 19 种 StreamEventType canonical vocabulary | `openspec/specs/ts-run-status-visibility/spec.md` | 不重复定义 |
| Stream replay / resume cursor 语义 | `openspec/specs/ts-stream-resume-replay/spec.md` | 不重复定义 |
| History uses visible messages 规则 | `openspec/specs/ts-stream-history-consistency/spec.md` | 不重复定义 |
| SSE/WS transport 等价 | `openspec/specs/ts-web-sse-ws-transports/spec.md` | 不重复定义 |
| Pending input runtime 语义 | `question-pending-input`、`authorization-pending-input`、`confirmation-pending-input`、`human-pending-input-core`、`human-pending-input-timeout`、`human-handoff`、`workflow-interaction-nodes` | 不重复定义 |
| 6 处导航空缺的跨模块 UI 状态机 | `openspec/designs/architecture/conversation-ui-state.md`（归档时新增） | 引用上述 specs，不重复定义 |
| spec → design 导航 | `openspec/designs/spec-to-design-map.md`（归档时新增条目） | `ts-run-status-visibility` → `conversation-ui-state.md` |
| UCD 设计表达（人物画像、旅程、IA、组件规范、状态、文案） | `docs/ucd/`（非 OpenSpec 基线） | 引用 `conversation-ui-state.md` 作为事实来源 |
| 项目背景与 UCD 文档用途 | `openspec/overview.md`（归档时补充） | 一句话背景说明 |
| 3 处 deferred gap | `openspec/changes/add-ucd-conversation-interface-contract/design.md` "Implementation-vs-spec gap" 章节 | 留给后续 change |

## Implementation-vs-spec gap（deferred）

以下 3 处 gap 在本 change 显式记录，**不收敛**，留给后续 change：

### Gap 1：`todoList` safeResult.kind 无 spec

- **代码现状**：`stream-envelope.ts` 的 `projectSafeCapabilityResultProjection` 支持 `todoList` kind；`processDetails.ts` 的 `describeSafeCapabilityResult` 有 `todoList` 分支，渲染 todo 列表。
- **缺什么**：`ts-run-status-visibility` 的 `Capability result stream payload MUST expose only safe result projections` requirement 未列举 `todoList` 的 safe field 约束；`TodoWrite` tool 的 todo 状态机持久化策略无 spec。
- **后续 change 建议**：新增 `ts-todowrite-tool` capability（已存在于 active changes 列表 `add-ts-todowrite-tool`），在其中定义 todo safe projection 契约。

### Gap 2：`clipStreamEvent` / `clipStreamCompletion` / `clipStreamResult` safeResult.kind 后端无投影实现

- **代码现状**：`stream-envelope.ts` 的 `projectSafeCapabilityResultProjection`（L377-414）中**无任何 clipStream 投影代码**，经代码验证 grep 不到 `clipStream` 关键词。`processDetails.ts` 的 `describeSafeCapabilityResult` default 分支兜底渲染（即 CLIP kind fall through 到 generic）。
- **缺什么**：3 种 CLIP stream kind 在后端无投影实现，仅 `conversation-ui-state.md` 设计意图中提及。CLIP capability 的 safe projection 边界无 spec。
- **后续 change 建议**：先确认 CLIP capability 的 spec 归属（`api-backed-tool-source` 还是新 capability），实现后端投影后再定义 CLIP stream safe projection 契约。
- **`httpResponse` kind（相关）**：后端 `stream-envelope.ts` 无 `httpResponse` 投影分支，前端 `safeCapabilityResult.ts` 从 raw `http_request` 工具结果客户端解析。不走后端 safe projection 管道。此 kind 是否需要后端 spec 化取决于 `http_request` 工具是否形成独立 capability。

### Gap 3：Pending input 前端状态机无单一 spec

- **代码现状**：前端按 `USER_INPUT_REQUIRED` → answer → `USER_INPUT_RECEIVED`/`USER_INPUT_TIMEOUT`/`USER_INPUT_CANCELED` 渲染，但 5 种 pending input kind 的统一前端状态机、answer idempotency 的前端表现、late answer 的 UI 处理散在 `question-pending-input`、`authorization-pending-input`、`confirmation-pending-input`、`human-pending-input-core`、`human-handoff` 各 spec。
- **缺什么**：5 种 pending input kind 的统一 UI 状态流转图无单一 spec；`conversation-ui-state.md` 第 3 节会整合呈现矩阵，但只引用现有 specs，不定义新的状态机。
- **后续 change 建议**：评估是否形成 `pending-input-ui-contract` capability，或继续由各 pending input spec 各自承载前端状态机。

## 风险与取舍

- **[风险] `conversation-ui-state.md` 与现有 specs 的内容重复** → 缓解：设计文档只引用、导航或摘要，不重复定义状态机、API schema、数据 owner；6 处导航表明确标注每个事实的主承载 spec。
- **[风险] `docs/ucd/` 与 `conversation-ui-state.md` 内容漂移** → 缓解：`docs/ucd/` 每个组件规范显式引用 `conversation-ui-state.md` 的章节；UCD 设计表达变更不影响契约层，契约层变更需同步检查 `docs/ucd/` 引用。
- **[风险] 3 处 deferred gap 长期不被收敛** → 缓解：design.md "Implementation-vs-spec gap" 章节显式记录，后续 change 可直接引用；`conversation-ui-state.md` 第 2 节标注 3 个 deferred kind 的代码现状。
- **[取舍] 不新增测试**：本 change 是 spec-only，4 个新 requirement 的 WHEN/THEN 场景在代码已实现，现有 test suite 已覆盖 safe projection；新增测试任务会让 spec-only change 变成 code change，违反用户明确约束。
- **[取舍] `docs/ucd/` 编号留空 02**：预留扩展空间，避免后续新增"信息架构详图"时被迫重新编号。

## 迁移计划

本 change 是 spec-only / design-only，无代码迁移、无部署步骤、无回滚策略。归档时执行以下文档迁移：

1. 合并 4 个新 requirement 到 `openspec/specs/ts-run-status-visibility/spec.md`。
2. 新增 `openspec/designs/architecture/conversation-ui-state.md`。
3. 在 `openspec/designs/spec-to-design-map.md` 新增 `ts-run-status-visibility` → `conversation-ui-state.md` 导航条目。
4. 在 `openspec/overview.md` 补充 UCD 设计文档背景说明。
5. `docs/ucd/` 15 个文件直接以最终路径创建，无需迁移。

## 归档前更新基线（Baseline Promotion Plan）

### 行为契约

- `openspec/specs/ts-run-status-visibility/spec.md`：合并 4 个新 requirement（`Attachment Accepted Stream Event Visibility`、`Attachment Rejected Stream Event Visibility`、`Context Compacted Stream Event Visibility`、`Capability Path Rejected Failure Visibility`）。

### 长期背景

- `openspec/overview.md`：补充"Web UI 消费方契约由 `designs/architecture/conversation-ui-state.md` 整合，UCD 设计表达文档位于 `docs/ucd/`"的背景说明。

### 设计视图

- `openspec/designs/architecture/conversation-ui-state.md`：新增稳定设计文档，承载 6 处导航空缺（19 种 StreamEventType → UI 状态映射、safeResult.kind 呈现矩阵、5 种 pending input kind 渲染矩阵、reconnect/replay 状态阶梯、SafeError code/category → 失败卡片映射、Live vs History 状态分叉）。
- `openspec/designs/modules/`：无新增。本 change 不涉及单一模块职责变化。
- `openspec/designs/adr/`：无新增。本 change 的设计决策（修改现有 capability、新增 architecture 设计文档、新增非基线 UCD 目录、deferred gap 不收敛、Live vs History 只描述）是流程性取舍，不属于长期有效技术决策。
- `openspec/designs/spec-to-design-map.md`：新增 `ts-run-status-visibility` → `conversation-ui-state.md` 导航条目。

### 验证入口

- `openspec validate add-ucd-conversation-interface-contract --strict` 通过。
- `npm run lint:architecture` 不受影响（无代码变化）。
- design.md 与现有 specs 不冲突：`ts-run-status-visibility`、`ts-stream-resume-replay`、`ts-stream-history-consistency`、`ts-web-sse-ws-transports`、`agent-web-process-panel`、`question-pending-input`、`authorization-pending-input`、`confirmation-pending-input`、`human-pending-input-core`、`human-pending-input-timeout`、`human-handoff`、`workflow-interaction-nodes` 的契约不被重复定义。

## 待确认问题

无。本 change 范围、4 处窄 gap、6 处导航空缺、3 处 deferred gap、文档归属、`docs/ucd/` 结构均已确认。
