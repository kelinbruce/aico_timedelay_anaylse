## 背景与问题

`add-ts-context-compression` 已经把 summary compression 的编排闭环建立起来：`assemble()` 能发现 prior history 超预算、选择 covered prefix、调用 `TraceableSummaryGenerationPort`、提交 summary message，并让 `render()` 消费已提交 summary。

但当前产品路径还缺真实的 summary generator。测试里可以用 fake port 返回 summary，真实运行时却还没有一个默认实现把 covered messages 转成安全 prompt、调用模型、解析输出，并返回 `TraceableSummaryDraft`。

它具体解决三个黑盒问题：

1. **长会话压缩只能靠 fake summary**：Context Engine 已能提交 summary，但产品路径没有默认 summary draft 来源。
2. **普通摘要容易丢失继续工作的状态**：只概括主题会丢掉“刚才修到哪、哪些文件改过、哪个错误还没解决、下一步该做什么”。
3. **摘要生成不能越权成为压缩/持久化 owner**：summary generator 只能生成 draft，不能自己写 session message、改 active context 或绕过 compression 边界。

本 change 解决的是最小真实生成闭环：

```text
covered SessionMessage[]
  -> safe summary input
  -> model call with tools disabled
  -> parse model output
  -> TraceableSummaryDraft
```

本 change 引入的 `<checklist>` 块、`<fact name="<category>">` 校验与 8 个固定 continuation-critical 分类（`user_intent`、`confirmed_facts`、`constraints`、`tool_outcomes`、`artifact_outcomes`、`unresolved_errors`、`pending_tasks`、`next_step`）是本 slice 的行为合约。generator 必须在 prompt 中要求 model 与 `<summary>` 同时输出 `<checklist>`，对 covered range 做确定性预分类，对缺失 / 为空的 `<fact>` 触发 safe failure，不产生 degraded draft。

`TraceableSummaryGenerationPort`、`TraceableSummaryGenerationRequest` 与 `TraceableSummaryDraft` 的 public DTO shape 由 `refine-ts-context-assembly-contracts` 冻结并归属 `agent-contracts/context`。本 change owns 默认 summary generator 行为、prompt/input 安全处理、输出解析与 draft validation；不得重新定义并行 `TraceableSummaryDraft` shape，也不得隐式回退到无 metadata 的精简 shape。

## 黑盒目标

- 把 covered `SessionMessage[]`（领域 read model）转成一份可继续工作的 `TraceableSummaryDraft`，保留用户意图、已确认事实 / 约束、关键工具 / 文件 / artifact 结果、未解决错误、待办与下一步线索。
- 通过标准模型调用边界执行：tools 禁用、传 `AbortSignal`、不向用户 stream、配置目标输出预算；任何工具调用企图视为生成失败且不执行。
- 输出解析优先 `<summary>` 内容、永远丢弃 `<analysis>`；无包裹但有非空文本走全文本 fallback；空输出视为失败。
- 仅返回草稿，不写 session message、不改 active context、不绕过 compression 边界。
- 失败路径不污染日志 / safe error 的可追溯字段。

## 关键验收场景

以下场景帮助读者在阅读本提案时即对齐本 slice 的黑盒行为；它们与 `specs/traceable-summary-generation/spec.md` 的 `Scenario: Analysis is discarded` 和 `Scenario: Draft preserves active work state` 一致。

- **正常 `<summary>` 解析**：当模型返回 `<analysis>...</analysis><summary>final summary content</summary>` 时，draft `content` SHALL 等于 `final summary content`；`<analysis>` 块 SHALL 不进入 `content`、不被记录到 logs / safe error / audit / timeline。
- **无 `<summary>` 的全文 fallback**：当模型仅返回非空文本（无 `<summary>` 包裹）时，draft `content` SHALL 等于该文本，generator SHALL 记录 presentation-safe `safeFallbackReason`，禁止把 raw prompt / raw messages 写入该 reason。
- **continuation-critical 状态保留**：当 covered messages 包含用户原始意图、已确认事实、关键工具结果、未解决错误、待办与下一步线索时，draft `content` SHALL 保留这些事实，且 SHALL NOT 退化为 topic-only 摘要。

## 变更范围

- 新增默认 `TraceableSummaryGenerationPort` 实现。
- 将 covered `SessionMessage`（领域 read model）序列化为 summary model input。
- 对 summary input 做最小安全处理：使用已有 large-content replacement 形态，不重新内联外置大内容；避免 raw secret/credential/path 进入 logs 或 safe error。
- 通过标准 model invocation boundary 调用模型，并禁用 tools。
- 解析 `<summary>...</summary>`；丢弃 `<analysis>`；无 `<summary>` 时允许全文 fallback。
- 返回 `TraceableSummaryDraft`，包含 content、source references、history lookup linkage、generation mode、prompt template version 和 input/output unit estimate。
- 提供 tests 证明 draft 可被 context compression fake consumer 消费。

## 非目标

- 不决定何时压缩、压哪段或保留哪段 tail。
- 不写 `session_messages`、`active_context_items`、checkpoint 或 timeline。
- 不实现 prompt template registry 或启动时模板 fail-fast。
- 不实现 prompt-too-long retry。
- 不实现 normal/aggressive/truncated/capped 多级 escalation。
- 不实现复杂 rehydration hints。
- 不执行 tool、skill 或 agent capability。
- 不处理 session memory 或 long-term memory。

## 模块影响

- `agent-context-engine`
  - 新增默认 traceable summary generation 实现。
  - 在 app composition 中可注入给 context compression。
- `agent-model`
  - 只通过标准 model invocation contract 被调用。
  - 不拥有摘要策略、prompt 构造或 context compression 对象。
- 测试
  - 覆盖 prompt 构造、tools disabled、abort propagation、output parsing、安全字段和 continuation-critical 摘要行为。

## 与相邻 change 的关系

- `add-ts-context-compression`：拥有压缩触发、covered prefix、retained tail、summary message 构造和 active context commit。本 change 只返回 draft。
- `add-ts-context-prompt-shaping`：拥有 by-purpose prompt template resolver 契约（`SYSTEM_PROMPT` / `SUMMARY_GENERATION`）。本 change 以 `purpose = SUMMARY_GENERATION` 消费该 resolver，内置 `compact-summary/v1` 作为 built-in fallback，不定义 resolver。
- `add-ts-large-content-references`：拥有大内容外置和 replacement。summary generator 消费已冻结 replacement，不重新内联原始大内容。
- 后续 change：若需要模板 registry、PTL retry、多级 escalation 或复杂 rehydration hints，应另行提出黑盒目标和规格。
