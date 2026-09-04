## 背景与问题（Why）

NextAgent 的 stream event、capability contract 和 run status visibility 已通过 `ts-run-status-visibility`、`ts-stream-resume-replay`、`ts-stream-history-consistency`、`ts-web-sse-ws-transports` 等 stable spec 建立。但这些契约分散在多个 spec 中，且消费方（Web UI）的可观察呈现契约大量停留在 `packages/agent-channel-web/src/projections/stream-envelope.ts` 代码里，未 spec 化。

当前问题：

1. **UCD 设计人员缺乏权威参考**。界面设计优化需要一份从 UI 视角整合现有 stream event / capability / pending input / reconnect / safeError 事实的单一视图。当前要拼凑 4+ 个 spec 和源代码才能理解完整状态机。
2. **19 种 StreamEventType → UI 状态映射无单一文档**。事件 vocabulary 在 `ts-run-status-visibility`，但前端消费契约散在 `agent-web-process-panel`、`e2e-ui-interaction` 和代码里。前端 `contracts.ts` 声明 20 种（多 `HOOK_DEGRADED`），后端 `streamVisibleTimelineEvents` 19 种，存在差异。
3. **safeResult.kind × 呈现矩阵不完整**。6 种 kind 在 `ts-run-status-visibility` 有 spec（`commandOutput`/`fileRead`/`fileList`/`fileWrite`/`skillLoaded`/unknown），`todoList` 后端已投影但无 spec scenario，3 种 `clipStream*` 后端无投影代码（仅设计意图提及），`httpResponse` 仅前端客户端解析。
4. **5 种 pending input kind → UI 渲染矩阵无单一视图**。后端语义在各自 spec，前端渲染契约缺。
5. **Reconnect/replay UI 状态阶梯图无单一视图**。cursor 语义在 `ts-stream-resume-replay`，但 "degraded/disconnected" 视觉契约未 spec 化。
6. **SafeError code/category → 失败卡片映射散乱**。`stream-envelope.ts` 的 `summarizeSafeCapabilityFailure` 映射代码未 spec 化。
7. **Live vs History 状态分叉未显式文档化**。`ts-stream-history-consistency` 定义了 "history uses visible messages, stream replay SHALL NOT reconstruct final conversation history"，但 live 体验与 history 浏览的 UI 状态差异（思考过程丢失、降级提示丢失、附件状态丢失、上下文压缩不可见、过程动画丢失等）没有单一文档说明。
8. **4 处窄 gap 无 spec 覆盖**：`ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED`、`CONTEXT_COMPACTED` 三个 stream event 在 `stream-envelope.ts` 投影但无 spec；`CAPABILITY_PATH_REJECTED` safeError code 在 `summarizeSafeCapabilityFailure` 映射但无 spec。

## 变更范围（What Changes）

本 change 是 **spec-only / design-only** 变更，**不改任何代码**，输出文档以支撑 UCD 设计人员完成界面设计优化。变更包含三层：

### 1. 修改 `ts-run-status-visibility` capability，补 4 处窄 gap

新增 4 个 requirement，覆盖：
- `ATTACHMENT_ACCEPTED` stream event 前端消费契约
- `ATTACHMENT_REJECTED` stream event 前端消费契约
- `CONTEXT_COMPACTED` stream event 前端消费契约
- `CAPABILITY_PATH_REJECTED` safeError code 失败呈现契约

### 2. 新增 `openspec/designs/architecture/conversation-ui-state.md` 设计文档

承载 6 处导航空缺，全部引用现有 specs，不重复定义契约：
- 19 种 StreamEventType → UI 状态映射表
- safeResult.kind × 呈现矩阵（6 已 spec + todoList spec deferred + 3 clipStream* 后端未实现 + httpResponse 前端专用 + unknown 兜底）
- 5 种 pending input kind → UI 渲染矩阵
- Reconnect/replay UI 状态阶梯图
- SafeError code/category → 失败卡片映射
- Live vs History 状态分叉

### 3. 新增 `docs/ucd/` 设计表达文档（非 OpenSpec 基线）

作为 UCD 设计人员的界面设计参考，引用 `conversation-ui-state.md` 作为事实来源。文档集包含 12 篇主文档 + 14 篇组件规范：

**主文档（12 篇）**：
- `README.md`（阅读指南，5 阶段渐进路径 + 快速查阅表 + 设计重点检查清单 + 契约层入口）
- `00-user-personas.md`（目标用户画像）
- `01-user-journeys.md`（核心用户旅程，含三选择分流框架）
- `02-dynamic-behavior-and-interaction.md`（动态行为与交互响应规范，跨组件共用）
- `03-full-ui-layout.md`（整体到局部的渐进式视图）
- `04-information-architecture.md`（信息架构）
- `06-empty-loading-error-states.md`（空/加载/错误状态）
- `07-content-copy.md`（文案规范）
- `08-sample-scenarios.md`（mock server 生成的场景样例数据）
- `09-product-team-briefing.md`（产品团队简报，目标态能力清单）
- `10-implementation-gap-analysis.md`（实现 gap 分析，42 项 gap）
- `11-ux-limits-and-constraints.md`（UX 限制与约束）

**组件规范（14 篇）**：
- `05-component-specs/{process-panel, message-bubble, capability-card, pending-input-card, degradation-notice, composer, session-list-item}.md`（核心 7 组件）
- `05-component-specs/{background-task-monitor, cron-task, expand-panel, file-download, sub-window}.md`（长时任务与富内容 5 组件）
- `05-component-specs/{tool-output-presentation-policy, tool-ui-interface-overview}.md`（工具输出呈现策略与接口总览 2 篇）

**功能特性总览表（1 篇，本 change 新增）**：
- `00-overview-feature-map.md`（8 个功能类别 × 32 个功能 × 6 列的功能特性总览表，双重用途：新成员全景概览 + 干系人能力清单）

每个组件规范显式区分 live 模式与 history 模式的呈现差异，并引用 `02-dynamic-behavior-and-interaction.md` 定义跨组件共用的动态行为与交互响应模式。`03-full-ui-layout.md` 承载从整体到局部的渐进式视图（全屏静态总览 → 区域拆解 → 单 turn 交互时序全屏演变 → 多轮交互全屏演变 → live/history 全屏对比），供 UCD 设计人员建立整体到局部细节的理解。`08-sample-scenarios.md` 承载由 mock server 真实生成的典型场景样例数据，供 UCD 设计人员直接对照组件规范验证视觉设计。

### 显式 deferred gap

以下 3 处复杂 gap 在 design.md "Implementation-vs-spec gap" 章节记录，**本 change 不收敛**，留给后续 change：
- `todoList` safeResult.kind
- `clipStreamEvent` / `clipStreamCompletion` / `clipStreamResult`
- Pending input 前端状态机（USER_INPUT_REQUIRED → answer → RECEIVED/TIMEOUT/CANCELED 的完整 UI 状态流转）

## Capability 影响（Capabilities）

### 新增 Capability

（无）

### 修改的 Capability

- `ts-run-status-visibility`：新增 4 个 requirement 覆盖 `ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED`、`CONTEXT_COMPACTED` stream event 的前端消费契约，以及 `CAPABILITY_PATH_REJECTED` safeError code 的失败呈现契约。该 capability 是 stream event canonical vocabulary 与失败可见性的 owner，补 gap 符合"规范性事实只能有一个主文档"原则。

## 影响范围（Impact）

- **Specs**：`openspec/specs/ts-run-status-visibility/spec.md` 在归档时合并 4 个新 requirement。
- **Designs**：
  - `openspec/designs/architecture/conversation-ui-state.md` 新增稳定设计文档。
  - `openspec/designs/spec-to-design-map.md` 新增导航条目，指向 `conversation-ui-state.md`。
- **Overview**：`openspec/overview.md` 补充 UCD 设计文档的存在与用途背景。
- **docs/ucd/**：新增目录（非 OpenSpec 基线），含 README 阅读指南 + 主文档（00-11）+ 14 篇组件规范 + `00-overview-feature-map.md` 功能特性总览表，共 27 个文件。
- **代码**：零改动（前端、后端、contract、event 均不变）。
- **测试**：无新增测试（spec-only change，无代码行为变化）。
- **依赖**：无新增依赖。
- **运维**：无影响。

## 归档前更新基线（Baseline Promotion Plan）

### 行为契约
- `openspec/specs/ts-run-status-visibility/spec.md`：合并 4 个新 requirement（ATTACHMENT_ACCEPTED/REJECTED、CONTEXT_COMPACTED、CAPABILITY_PATH_REJECTED）。

### 长期背景
- `openspec/overview.md`：补充"Web UI 消费方契约由 `designs/architecture/conversation-ui-state.md` 整合，UCD 设计表达文档位于 `docs/ucd/`"的背景说明。

### 设计视图
- `openspec/designs/architecture/conversation-ui-state.md`：新增稳定设计文档，承载 6 处导航空缺（StreamEventType → UI 状态映射、safeResult.kind 呈现矩阵、pending input 渲染矩阵、reconnect/replay 状态阶梯、SafeError 失败卡片映射、Live vs History 状态分叉）。
- `openspec/designs/modules/`：无（本 change 不涉及模块设计变化）。
- `openspec/designs/adr/`：无（无长期技术决策需要 ADR 化）。
- `openspec/designs/spec-to-design-map.md`：新增 `ts-run-status-visibility` → `conversation-ui-state.md` 的导航条目。

### 验证入口
- `openspec validate add-ucd-conversation-interface-contract --strict` 通过。
- `npm run lint:architecture` 不受影响（无代码变化）。
- design.md 与现有 specs 不冲突：`ts-run-status-visibility`、`ts-stream-resume-replay`、`ts-stream-history-consistency`、`ts-web-sse-ws-transports`、`agent-web-process-panel`、`question-pending-input`、`authorization-pending-input`、`confirmation-pending-input`、`human-pending-input-core` 的契约不被重复定义。
