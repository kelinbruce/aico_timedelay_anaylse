# add-ts-context-budget-explainability

## 1. 解决的问题是什么

模型每次请求只能容纳有限的输入窗口，但一次电信网络智能体请求要同时塞入：当前用户输入、可见历史、附件投影、能力披露、运行时上下文、以及可能很大的工具结果。这些内容经常超出窗口预算，系统必须做取舍。

当前缺一份统一规格回答"超预算时怎么取舍、取舍依据是否可被观察"，导致两类真实风险（派生自 `docs/nextagent-ts-requirements-v2.md` 的 P2-S27 与 P2-B14）：

- **输入侧**：长历史、附件、记忆进入同一请求时，没有统一预算和降级规则，结果会随机丢内容、行为不稳定，甚至为塞入历史而挤掉当前请求本身。
- **输出侧**：模型输出超过窗口或消息大小限制时，系统可能返回一个"看似正常、实际被截断"的不完整答案，用户无法判断结果是否完整。

本 change 要补上的缺口是：把上下文预算处理固化成一次**同步决策关口**，对输入侧预算和输出侧长度都产出**可解释、机器可读、且不泄露敏感原文**的取舍依据，绝不静默截断。

## 2. 黑盒目标

- 历史上下文最多使用模型窗口 60% 预算；超出部分必须先压缩、裁剪、摘要或降级，而不是动当前请求。
- 当前请求是 minimum safe current-request context（最低安全线），含 root user message、当前请求协议必需消息和 latest-request-required attachment context；这条基线不进入 60% 历史预算，也不可被省略。
- 若最低安全线本身超预算，返回显式 insufficient-context（safe error 或显式降级），不得删掉 request-critical 内容伪装成功。
- 超预算降级时，为每个上下文源类别和每个 role group 产出安全证据：保留/压缩/摘要/引用/省略/拒绝的状态、估算 units、reason code、owning boundary；证据不含 raw prompt、raw message、raw tool args/result、附件正文、路径、credential、高基数标识。
- 输出长度受限时，结果必须表达为显式 continuation / partial-result / failure，不静默截断；本 change 不提供自动续写能力，只保证显式提示。
- 当预算或输出窗口降级影响用户可见语义时，通过 runtime-owned degradation 事实投影 presentation-safe 的 `DEGRADATION_NOTICE`。

## 3. 核心设计和规格

本 change 是 Context Assembly 流水线（历史选择 → 附件上下文 → **预算策略** → 压缩 → 提示词组装）中的**第 3 段：预算策略**。它在一次同步上下文装配内作为决策关口。关口位置与不变量固定，预算分配与降级算法由可插拔的 `ContextBudgetPolicyPort` 承担，默认注入 `DefaultProportionalBudgetPolicy`。关口流程：

1. 收集候选上下文，计算 `availableInputUnits`；
2. 判定 minimum safe current-request context，并作为硬基线保护（不变量）；
3. 由注入的 policy 分配 prior-history 预算并降级超额部分（默认 policy：`historyBudgetCapUnits = floor(availableInputUnits * 0.60)`）；
4. 产出 source-category 与 role-level explainability，形成可执行 decision contract（不变量）；
5. 在残余压力高时标记 `PRE_SEND_CHECK_REQUIRED`（默认 policy 阈值 0.885），并在输出侧做 output-window guard（不变量）。

任何替换 policy 可调整预算比例、降级顺序与阈值，但不得破坏第 2、4、5 步及 output guard 的关口不变量。

explainability 是稳定**决策契约**而非单纯预算数值：下游可据此观察"正常继续 / 必须压缩降级 / 必须发送前检查 / 必须显式失败"。详细行为以三个 delta spec 为准。

## 4. 变更范围（What Changes）

### 修改的 Capability

- **`ts-run-status-visibility`（MODIFIED）**：补充"budget/output 驱动的用户可见降级必须经 runtime-owned degradation 事实投影""`DEGRADATION_NOTICE` 必须 presentation-safe"。该基线由 `add-ts-run-status-visibility`（ADDED）创建，MODIFIED 精确匹配其 requirement "Run Status Visibility Source Of Truth"。

### 新增的 Capability

- **`query-policy`（ADDED）**：本 change 是 `query-policy` capability 的第一个 delta，用 `## ADDED Requirements` 建立基线，承载可插拔 `ContextBudgetPolicyPort` 与固定决策关口不变量、默认 policy 的 60% history budget cap 与 lower-priority 优先降级、observable selection reasons（source-category + role-level evidence）、budget-stage explainability 与 pre-send check。理由：预算 decision contract 与可替换 policy 边界是本 change 的核心产出，由本 change 建档职责最纯。
- **`context-engine`（ADDED）**：本 change 向 `context-engine` 追加"render 前完成 budget explainability""minimum safe current-request context 含 latest-request attachment 且不进 60% cap""output-window safety 显式化"三组**新** requirement，故用 `## ADDED Requirements`。这些 requirement 名称在现有基线（由 `add-ts-context-history-selection` 等 change 经 ADDED 建立）中不存在，不构成对既有 requirement 的 MODIFIED。

### 不单独建 delta 的相邻 capability

- **`request-attachments`**：本 change **不**新增 `request-attachments` delta。附件在预算竞争下的语义（latest-request-required attachment 属 minimum safe context、历史附件可在 prior-history 预算内显式降级）作为 `context-engine` 的 minimum safe context requirement 的一部分表达；`request-attachments` 基线本身由专管附件的 `add-ts-attachment-request-context-flow` 负责，避免本 change MODIFIED 一个无人 ADDED 的悬空基线。

## 5. 前置门禁（Archive Order Gate）

本 change 的 `ts-run-status-visibility` delta 是 MODIFIED，依赖其基线先由对应 change 归档创建；否则该 MODIFIED delta 无法叠加：

- `add-ts-run-status-visibility`（创建 `ts-run-status-visibility` 基线，ADDED）必须先归档；本 change 对 requirement "Run Status Visibility Source Of Truth" 的 MODIFIED 才能叠加。

`query-policy` 与 `context-engine` 两个 delta 均为 ADDED，由本 change 自身建立/追加，无外部归档前置（`context-engine` 与 `add-ts-context-history-selection` 等 change 各自 ADD 不冲突的 requirement，互不依赖归档顺序）。若归档时发现 `ts-run-status-visibility` 基线未就位，本 change 的对应 MODIFIED delta 须延期，不得部分验收。

## 6. 影响范围（Impact）

- **代码**：主要影响 `agent-context-engine`（budget 决策与 explainability 产出）与 `agent-observability`（structured log / metric / safe evidence）；runtime 投影 degradation notice。
- **测试**：覆盖 60% cap、minimum safe exceed、pre-send check、source-category/role-level evidence、large result 降级优先级、output-window continuation/partial/failure 与 `DEGRADATION_NOTICE`。
- **范围限定**：本 change 为 spec-only delta，`agent-context-engine` 实现与 npm workspace 脚手架尚未建立，实现任务在后续 change 落地。

## 7. 非目标（Non-Goals）

- 不定义具体 summary 生成算法或 prompt（归 `add-ts-context-compression` / `add-ts-traceable-summary-generation`）。
- 不定义大内容 projection / offload 算法（归 `add-ts-large-content-references`）。
- 不新增 durable budget record、独立 explainability API 或异步预算任务。
- 不提供输出自动续写能力，只保证显式提示。
- 不把 reason contract 改成自由文本说明书。

## 8. 归档前更新基线（Baseline Promotion Plan）

归档时把稳定结论提炼到长期文档（依据 `openspec/config.yaml` 的归档规则）：

- 行为契约：新增 `openspec/specs/query-policy/spec.md`；更新 `openspec/specs/context-engine/spec.md`、`openspec/specs/ts-run-status-visibility/spec.md`。
- 问题背景与目标：汇总到 `openspec/overview.md`。
- 架构与跨模块设计：预算决策关口、explainability decision contract、degradation notice ownership 汇总到 `openspec/designs/architecture/` 下对应主题文档。
- 模块职责：`agent-context-engine` 的 budget 职责汇总到 `openspec/designs/modules/agent-context-engine.md`。
- 导航：在 `openspec/designs/spec-to-design-map.md` 补 spec→design 链接。
