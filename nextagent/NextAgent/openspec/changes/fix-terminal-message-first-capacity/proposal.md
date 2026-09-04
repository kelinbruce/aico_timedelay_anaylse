# Change：修复终态回答的容量与 Message-first 一致性

## Why

Issue #823 的生产故障不是 terminal Event 单字段超限，而是远端 Gateway 在解析复合提交后拒绝任一 `message.content` 字符数大于 50,000 的 Message。当前 terminal Event 已改为 body-free 且整体受 49,000 UTF-8 bytes 预算保护，但 Direct Workflow 和非 agentic `ApiCall` 会把未经大结果物化的 Capability 输出直接作为 terminal Assistant Message 正文；内容超过 50,000 字符时，terminal composite write 被拒绝，请求没有 durable terminal facts，live 与刷新后页面均持续显示执行中。

当前绕过路径还违反已确认的架构原则：Direct Workflow 与非 agentic `ApiCall` 的业务结果来自 Capability Executor，却通过 `LLM_CONTENT_DELTA` 伪装成 LLM Executor 输出；Runtime 只能从该事件汇总 terminal answer，因而无法按结果来源应用统一的 Capability 大结果保护。

本 change 以三个不可合并的不变量解决问题：

1. LLM Executor 与 Capability Executor 是仅有的业务结果生产者；terminal commit 只消费已确定的终态回答，不再推断所有回答都来自模型。
2. Capability 来源结果在成为 Message 或 terminal answer 前统一物化：不超过 50,000 字符时 inline；超过 50,000 字符时完整原文写入既有 execution workspace `tool-results` 文件，终态 Message 保存有界 preview、`ContentRef` 和 replacement evidence。
3. Gateway 的单个 `message.content.length <= 50,000` 是所有 terminal Message 的物理边界；direct model 输出由 Agent Core 在 50,000 个 UTF-16 code units 内带固定标记有界交付并成功完成，Runtime 对绕过该 producer 保护的超限 terminal 正文继续 fail closed。

## What Changes

- 对 frozen `agent-contracts/runtime` 做最窄 additive refinement：既有 runtime-owned `AgentRunStatePort` 增加必选 `setCapabilityTerminalAnswer(run, context, { content })` handoff。该 handoff 只提交 run-local Capability 终态候选，不持久化、不发布 stream Event；`AgentExecutionOutcome` 的 `COMPLETED/PENDING_INPUT` 控制语义完全不变。
- Direct Workflow 继续使用同一 `WorkflowExecutionService` 和内部 Event 投影，但其完成结果通过 Capability 来源 terminal answer handoff 交给 Runtime，不再发出伪装成模型正文的 final `LLM_CONTENT_DELTA`。
- 非 agentic `ApiCall` 的成功结果使用同一 handoff；既有真实 Capability Result Message、structured delta、checkpoint、hook 和失败语义保持不变。
- 该 handoff 的生产调用方穷尽为 Direct Workflow 与非 agentic `ApiCall` 两类受治理路径；普通 Model Loop、model-driven Capability、Workflow-as-Tool 和其他 Capability 不得调用。两类 direct producer 只有在已经得到预期的成功最终结果时才能提交 handoff。
- Runtime 在 terminal hook 完成后、terminal composite write 前，对 Capability 来源 terminal answer 调用既有 large-content externalizer。物化后的 preview/ref 同时用于 terminal Assistant Message、live terminal presentation、conversation/run history、Task 与 Cron read model。
- terminal Assistant Message 继续是最终回答唯一 durable body owner；terminal Event 继续 body-free、通过 `terminalMessageId` 关联 Message，并保持完整 `inlinePayload` 不超过 49,000 UTF-8 bytes。
- 把 direct model 可见文本硬上限从 150,000 收窄为 Gateway 可提交的 50,000 个 UTF-16 code units；超过上限时 Agent Core 保留有界前缀、追加固定截断标记并以 `REQUEST_COMPLETED` 结束，既有 `MODEL_TEXT_LIMIT_EXCEEDED` 信号保持，后续由 Issue #821 改为 completion limitation。
- Runtime 继续在 terminal composite 前对任何仍超过 50,000 字符的正文 fail closed，作为 producer 被绕过或失效时的纵深防御；本 change 不把模型正文外置为 Capability result。

## 目标与验收边界

- Direct Workflow 与非 agentic `ApiCall` 返回 50,001 字符以上 Capability 结果时，请求成功提交终态；terminal Message 不超过 50,000 字符，并携带可解析的 preview/ref，完整原文存在 owner-scoped execution workspace 文件。
- 50,000 字符及以下的 Direct Workflow 与非 agentic `ApiCall` 结果继续按既有 `PLAIN_TEXT` terminal Assistant Message 显示；不新增来源标签、Capability 卡片、Message role、content type 或前端分支。超长结果只因 Gateway 容量约束显示既有 workspace preview/ref projection。
- 同一已提交 terminal Message projection 是 live、conversation history、run history、Task 和 Cron 的共同正文来源；系统不承诺这些 surface 自动展开完整文件，但不得出现 live 完整正文、history 截断正文的分叉。
- 50,000 字符及以下 Capability 结果保持 inline，不生成不必要的文件或 replacement evidence。
- LLM 来源正文恰好 50,000 字符时原样成功且不产生超限信号；首次超过 50,000 字符时停止消费后缀与未完整 Tool call，保留 surrogate-safe、Markdown-safe 的有界前缀并追加 `[Model output truncated at the 50000-character safety limit.]`，最终 Message 总长不超过 50,000 字符，请求成功完成并恰好产生一次 `MODEL_TEXT_LIMIT_EXCEEDED` 信号。
- 直接绕过 Agent Core 模型输出保护、向 Runtime terminal boundary 提交 50,001 字符正文时必须在 Gateway 调用前安全失败；该负例不是正常 LLM 产品路径的终态语义。
- terminal composite write 的真实失败继续传播；不恢复 `LIVE_ONLY` fallback terminal，因为该事件会制造“在线完成、刷新未完成”的双重事实。
- 除原先会因超过 50,000 字符而无法提交的场景改为成功显示既有 preview/ref 外，Direct Workflow、Workflow-as-Tool、非 agentic `ApiCall` 与 model-driven `ApiCall` 的用户可观察行为必须与修改前一致：答案正文、content type、答案数量、structured presentation 所在区域、过程条目、状态、顺序、pending/failure/cancel 结果均不得改变。
- 删除 Capability 来源的伪 final `LLM_CONTENT_DELTA` 只允许改变内部结果交付方式；live subscriber 在请求完成时必须直接观察到 committed terminal Message projection，且该 Message projection 只出现一次，不得要求刷新、额外请求或前端 fallback。既有 structured `ANSWER` presentation 必须保持，不得通过改变区域隐藏测试 fixture 或 producer 构造的重复正文。
- `frontend/agent-web` 只对 Capability 超长终态答案做本地投影收窄：把既有 canonical `PERSISTED_PREVIEW` 协议文本转换为本地化的用户友好“部分内容”说明。structured presentation 继续只按既有 `toolEventType` 决定区域：`ANSWER` 显示在答案区，`TITLE`、`SUB_TITLE`、`DETAIL`、`SUB_DETAIL` 等显示在执行过程区域；Workflow correlation 不得改写该分类。本 change 不新增公共投影字段、组件、样式或全文交互，也不改动 Message 中供模型回读的原始 replacement 协议。

## 非目标

- 不在本 change 重构 Workflow 内部节点执行器。后续架构 change 再把 Workflow 收敛为由统一 LLM Executor 与 Capability Executor 驱动的复合 Capability；Workflow 控制节点继续由 Workflow engine 拥有。
- 不新增 Workflow `context: inline | fork`、节点级 `modelContext.exports` 或其他“内部过程是否披露”配置。编排后的 Workflow 默认封装内部过程；外层 Model Loop 只消费 recipe 主动组装的最终 Workflow result，需要披露的信息由业务编排显式进入该最终结果。
- 不改变 Workflow 内部 node lifecycle/product 的 Event-owned 基线，不为 Direct Workflow inner node 创建 Tool protocol Message。
- 不处理 Model Loop 的 PIU `ANSWER` 最终展示收编、presentation 与模型语义结果分离、ordinary structured Event body 删除或分页预加载问题；这些由独立方案二（Issue #748）处理。本 change 保留现有过渡路径不等于确认其为长期 owner。
- 不新增 BlobStore 路径、下载 API、全文展开 UI、第三种 limitation kind、第三种 terminal answer origin 或新的 Message role/event type。
- 不在前端解析或自动读取 `tool-results` 文件，不把本地化 preview 文案写回 Message、timeline、Task 或 Cron read model。
- 不给 LLM 输出增加 workspace 外置、ContentRef 或 replacement metadata；模型有界交付与 Capability 全文外置保持两条来源明确的策略。
- 不扩大 Gateway 50,000 字符限制，不修改既有 49,000-byte terminal Event 预算。
- 不通过 terminal commit 自建第二套截断/外置策略；terminal 只复用 Capability result materialization。

## Function 影响

- **修改 `FN-4.1 调用模型`（`model-invocation-contract`）**：把 direct model 可见文本硬上限从 150,000 收窄为 50,000 个 UTF-16 code units，并保持带固定标记、截断后成功的既有语义。
- **修改 `FN-4.5 压缩转储工具结果`（`large-content-references`）**：Capability 来源结果用于模型协议 Message 或直接 terminal answer 时共享同一 50,000 字符物化规则；新增容量质量保证。
- **修改 `FN-4.6 分页查看大结果`（`large-content-readback`）**：不改变 read 行为，只把旧混合 Requirement 中既有的有界分页、`truncated` 与 `nextOffset` 语义收敛到其 canonical spec。
- **修改 `FN-9.1 执行工作流`（`workflow-event-history`）**：Direct Workflow 完成结果通过 Capability terminal handoff 进入 request terminal lifecycle；Workflow-as-Tool 继续返回 outer Capability result 给父 Model Loop。
- **修改 `FN-5.17 技能驱动 API 调用`（`skill-driven-api-call`）**：非 agentic `ApiCall` 结果直接终态化时使用同一 Capability terminal handoff 与大结果物化。
- **修改 `FN-8.1 持久化运行数据`（`gateway-store-provider-ownership`）**：terminal composite 持久化已物化 Message projection 和 body-free Event，保持原子性与 49,000-byte Event 容量边界。
- **修改 `FN-1.2 断线后从上次位置继续`（`ts-stream-history-consistency`）**：live/history 从同一已提交 terminal Message 恢复相同 inline 或 preview/ref projection。
- **修改 `FN-10.10 任务通道`（`agent-task-channel`）**：request summary 返回同一已提交 projection，并完成 touched legacy Requirement 原子迁移。
- **修改 `FN-10.9 Cron 工具`（`cron-task-management-api`）**：execution query 返回同一已提交 projection，不宣称返回外置文件全文。
- **修改 `FN-1.22 展示会话消息正文`（`agent-web-assistant-markdown-rendering`）**：将 terminal answer 中 canonical `PERSISTED_PREVIEW` 的技术协议文本投影为本地化的部分内容说明与有界 preview，live/history 一致；不新增公共字段或全文读取交互。

此外，本 change 直接修改 frozen legacy `ts-core-contracts / Agent Core Uses Runtime-Owned Run State Port`，只增加已确认的必选 Capability terminal handoff、两类允许调用方与 terminal source 冲突规则；该跨 Function 核心契约 refinement 不创建新 Function，也不改变 `AgentExecutionOutcome`。

## Feature 影响

- `F-4.1 接入多种模型`：模型输出容量保护与 Gateway 可提交边界对齐；超限时仍交付已有有界内容而不是整次请求失败。
- `F-9.1 Workflow 执行`：Direct Workflow 的大结果不再阻断终态提交。
- `F-4.4 压缩长对话`：Capability 大结果物化扩展到直接终态 consumer，阈值和引用形态不变。
- `F-5.6 Skill 系统`：非 agentic API 大结果可安全终态化。
- **修改 `F-1.4 查看会话内容`**：外置终态结果在答案区以用户语言显示部分内容，不暴露内部路径和模型回读指令。
- 会话、Task 与 Cron 的最终结果可恢复性增强；Task 与 Cron 不新增用户操作面。

## 依赖与后续

- 前置 `persist-structured-delta-aggregation` 已归档并进入 main；本 change 必须保留其 ordinary Message-first 和 Workflow Event-owned 例外。
- 本 change 归档后，`replace-degradation-notice-with-completion-limitations` 才能基于 stable terminal 语义重生成 delta 并继续实施。
- Issue #844 的后续 Workflow 架构 change 再统一 Direct Workflow 与 Workflow-as-Tool 的内部业务节点执行边界和大结果物化：业务节点只经 LLM Executor 或 Capability Executor 产生结果，控制节点保留在 Workflow engine；两种 caller 继续共享同一 engine，仅最终 result consumer 不同。该后续不增加内部过程披露配置，外层只消费 recipe 显式组装的最终 result。
- Issue #748 的方案二再分离 Capability semantic result、presentation result 与 execution outcome，并消除 ordinary structured presentation 的过渡 Event body及其预加载恢复问题；Workflow inner Event-owned product 是独立例外，不由 #823 改写。
- Issue #827 独立治理前端模型失败码、`retryable` 与行动提示；Issue #828 独立治理 structured timeline 写入的幂等重试与失败恢复。二者均不得混入 #823 terminal capacity 实现。

## 需群内确认

2026-08-25 需求方已确认“LLM Executor 与 Capability Executor 是仅有结果生产者，Capability 结果可直接成为 terminal answer，并复用统一大结果物化”的架构目标，并进一步确认以下 frozen public contract refinement：

- 在既有 `AgentRunStatePort` 增加必选 `setCapabilityTerminalAnswer(run, context, { content }): Promise<void>`；不增加 `contentType`、origin、MessageId、ref 或 metadata 参数。
- 每个 run 至多接受一次 Capability terminal answer；重复提交安全失败，禁止覆盖、拼接或回退为 final `LLM_CONTENT_DELTA`。
- 生产调用方穷尽为 Direct Workflow 与非 agentic ApiCall 的成功 direct-terminal 路径；普通 Model Loop、model-driven Capability、Workflow-as-Tool 和其他 Capability 不得调用。
- 中间 LLM delta 不构成冲突；同一 run 同时形成 final LLM terminal source 与 Capability terminal answer 时必须安全失败，不得按优先级静默选择。
- 方法只写 run-local execution output；只在请求正常 `COMPLETED` 时参与 terminal source selection，失败、取消、supersede 和 pending input 均不得消费它。最终物化、MessageId、replacement evidence 和 composite persistence 仍由 Runtime terminal boundary 拥有。
- 50,000 字符及以下结果继续以现有 `PLAIN_TEXT` terminal Assistant Message 呈现，不增加新的前端展示语义；超长结果显示既有 preview/ref projection。
- 超长 Capability 结果的 Message 仍持久化 canonical `PERSISTED_PREVIEW` 与 replacement evidence；`agent-web` 仅对 terminal answer 进行本地友好投影，不把 `Reason`、`ContentRef`、workspace 路径或 Read 工具指令直接展示给普通用户。该变化不修改 public contract，无需扩大上述群内契约确认范围。
- `AgentExecutionOutcome`、event type、Message role、Gateway port、数据库表、Web API 和前端公共投影字段均不修改。

上述确认已解除生产编码门禁。任何扩大调用方、参数、返回持久化结果、增加其他 public port 或改变 terminal Event/public DTO 的方案都必须重新确认。

2026-08-25 需求方进一步确认 direct model 的容量契约调整：

- Gateway 解析后的单个 `message.content.length` 上限 50,000 字符不可修改，因此 direct model 的 150,000 字符成功截断上限必须收窄为 50,000 个 UTF-16 code units。
- 正文恰好 50,000 字符时原样成功且不产生 `MODEL_TEXT_LIMIT_EXCEEDED`；首次超过时立即停止消费，按既有 surrogate/Markdown 安全规则截断，追加 `[Model output truncated at the 50000-character safety limit.]`，最终总长不超过 50,000 字符并以 `REQUEST_COMPLETED` 结束。
- 当前 change 保留既有 `DEGRADATION_NOTICE(code=MODEL_TEXT_LIMIT_EXCEEDED)` carrier 与固定技术标记；Issue #821 后续接管该成功限制事实的 `completionLimitations` carrier 和本地化标记呈现，但不重新定义 50,000 字符阈值或截断算法。
- LLM 不使用 Capability workspace externalizer，也不新增 Message metadata；Runtime 的 50,000 字符 guard 继续拒绝绕过 Agent Core 保护的原始超限 terminal content。
- 本次补充确认覆盖本 change 原先“LLM 来源正文超过 50,000 字符时请求失败”的条款与测试证据；不改变前一轮已确认的 frozen `AgentRunStatePort` refinement、Capability 来源外置策略或前端公共契约。

该调整修改既有 `FN-4.1 / model-invocation-contract` 的系统质量属性阈值和终态结果，已按项目规则完成补充确认；本 change 无需修改 `agent-contracts`、Gateway port、Web API、stream event shape 或前端字段。
