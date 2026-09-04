## ADDED Requirements

### Requirement: Traceable Summary Generation SHALL 保持可继续工作的黑盒能力

Traceable summary generation SHALL 把被覆盖的较旧历史转成 summary draft，该 draft 保留在 context compression 替换该历史之后所需的可用状态。当存在时，draft SHALL 捕获仍然有效的用户意图、已确认的事实、约束、关键的 tool/file/artifact 结果、未解决的错误、待办任务和下一步线索。

#### Scenario: 长会话工作在 summary 替换后继续
- **WHEN** 被覆盖历史包含用户目标、tool 结果、未解决失败和显式的下一步
- **THEN** 返回的 draft SHALL 保留这些对继续工作至关重要的事实
- **AND** 它 SHALL 可被 context compression 用作 `SUMMARY` 消息的内容来源
- **AND** 它 SHALL NOT 退化为只有主题的 summary

### Requirement: Traceable Summary Generation SHALL 产出无持久化副作用的 summary draft

Traceable summary generation SHALL 为被覆盖的消息范围生成一个 `TraceableSummaryDraft`。它 SHALL NOT 写 session 消息、active context 条目、checkpoint 记录、timeline 事件或独立的 summary store 记录。

#### Scenario: Summary draft 没有持久化副作用
- **WHEN** context compression 调用 `TraceableSummaryGenerationPort.generate()`
- **THEN** 实现 SHALL 返回一个 summary draft
- **AND** 它 SHALL NOT 调用 `ActiveContextStoreGateway.commitCompaction`
- **AND** 它 SHALL NOT 独立持久化一条 summary 记录

### Requirement: Traceable Summary Generation SHALL 安全序列化被覆盖消息

模型调用之前，被覆盖消息 SHALL 被序列化为安全的 summary 输入。既有的大内容替换 SHALL 以其冻结的模型可见形式被消费。Secret、credential、不安全的本地路径和外置的大 payload 正文 SHALL NOT 通过 logs、safe errors 或可追溯字段暴露。

#### Scenario: 既有的大内容替换被保留
- **WHEN** 一条被覆盖消息包含已持久化的 preview、专门的 ref 或空标记替换
- **THEN** summary 输入 SHALL 消费该替换形式
- **AND** generator SHALL NOT 重新内联原始的大 payload

### Requirement: Traceable Summary Generation SHALL 以禁用 tools 的方式调用模型

Summary generation SHALL 通过标准模型调用边界调用模型，禁用 tools、配置目标输出预算并传播请求的 `AbortSignal`。

#### Scenario: Tool call 尝试不被执行
- **WHEN** 模型在 summary generation 期间返回一个 tool call 尝试
- **THEN** 该 tool call SHALL NOT 执行
- **AND** 该尝试 SHALL 被视为生成失败

### Requirement: Traceable Summary Generation SHALL 安全解析 summary 输出

实现 SHALL 优先采用 `<summary>` 内容并丢弃 `<analysis>` 内容。如果不存在 `<summary>` 但存在文本输出，实现 MAY 使用全文作为解析 fallback，并 SHALL 记录安全的 fallback 原因。

#### Scenario: Analysis 被丢弃
- **WHEN** 模型返回 `<analysis>draft</analysis><summary>final</summary>`
- **THEN** summary draft 内容 SHALL 为 `final`
- **AND** `draft` SHALL NOT 被返回、持久化、记录日志、流式传输、审计或在 safe errors 中暴露

### Requirement: Traceable Summary Generation SHALL 包含最小可追溯字段

每个成功的 summary draft SHALL 包含内容、来源引用、历史查找关联、生成模式、prompt template 版本、输入 unit 估算和输出 unit 估算。Prompt template SHALL 通过按 purpose 的 prompt template resolver 以 `purpose = SUMMARY_GENERATION` 解析（resolver 契约由 `add-ts-context-prompt-shaping` 拥有，仅在此处消费），并以内置的 `compact-summary/v1` 作为 fallback；`promptTemplateVersion` SHALL 反映已解析的 template 版本。Rehydration 提示在本 slice 中 MAY 为空。

#### Scenario: Draft 携带可追溯 metadata
- **WHEN** summary generation 成功
- **THEN** draft SHALL 包含 presentation-safe 的可追溯 metadata
- **AND** context compression SHALL 能把这些字段嵌入 summary 消息 metadata

### Requirement: Traceable Summary Generation SHALL 保留对继续工作至关重要的状态

成功的 summary draft SHALL 保留足够的可用状态，使后续请求能在较旧历史被替换后继续工作。这包括仍然有效的用户意图、待办任务、关键的 file/artifact 结果、未解决的错误、约束和下一步线索（当这些事实存在于被覆盖范围内时）。
Generator SHALL 通过把 draft 的 `<checklist>` 块与 generator 预分类为存在于被覆盖范围内的类别进行比较，检测缺失的继续关键事实（见“SHALL 通过结构化 checklist 校验继续关键事实”需求）。当某个存在的类别在 `<checklist>` 中缺失、正文为空，或 `<checklist>` 块整体缺失时，port SHALL 把结果归类为无效并返回安全失败。调用方 SHALL 回退到既有的预算降级路径；generator SHALL NOT 在这种情况下产出降级 draft。

#### Scenario: Draft 保留进行中的工作状态
- **WHEN** 被覆盖消息包含文件编辑、未解决失败和来自用户的显式后续工作
- **THEN** 返回的 draft SHALL 在 summary 内容中保留这些可用事实
- **AND** 它 SHALL NOT 退化为丢失继续工作能力的只有主题的 summary

#### Scenario: 继续关键事实丢失被当作安全失败
- **WHEN** 被覆盖消息至少包含一条用户消息，因此 `next_step` 类别存在
- **AND** 模型返回的 draft 所附带的 `<checklist>` 块省略了 `<fact name="next_step">`，或该 fact 正文为空
- **THEN** port SHALL 返回安全失败
- **AND** 它 SHALL NOT 返回降级 draft

#### Scenario: 缺失 checklist 块被当作安全失败
- **WHEN** 被覆盖消息至少包含一条 `CAPABILITY_RESULT`，因此 `tool_outcomes` 类别存在
- **AND** 模型返回带 `<summary>` 内容但没有 `<checklist>` 块的 draft
- **THEN** port SHALL 返回安全失败
- **AND** draft 内容 SHALL NOT 被返回给调用方

### Requirement: Traceable Summary Generation SHALL 通过结构化 checklist 校验继续关键事实

Generator MUST 用固定的、确定性的继续关键类别集合对被覆盖范围做预分类。每个类别当且仅当其对应的消息级规则求值为 true 时存在于被覆盖范围：

- `user_intent`：被覆盖范围包含一条 `role: "USER"` 且内容非空的消息。
- `confirmed_facts`：被覆盖范围包含一条 `role: "ASSISTANT"` 且内容非空的消息。
- `constraints`：被覆盖范围包含一条内容匹配确定性约束标记（`MUST`、`MUST NOT`、`SHALL`、`SHALL NOT` 或 `CONSTRAINT:`）的消息。
- `tool_outcomes`：被覆盖范围至少包含一条 `CAPABILITY_RESULT` 消息。
- `artifact_outcomes`：被覆盖范围至少包含一条 `CAPABILITY_RESULT` 消息，其冻结的 `CapabilityInvocationResult.artifactRefs` 投影携带非空 artifact 引用。
- `unresolved_errors`：被覆盖范围至少包含一条 `CAPABILITY_RESULT` 消息，其冻结的 `CapabilityInvocationResult` 投影携带失败的 `status` 或非空的 `error`（`SafeError`）字段。
- `pending_tasks`：被覆盖范围至少包含一条内容匹配确定性待办标记（`TODO` 或 `FIXME`）的消息。
- `next_step`：被覆盖范围内最后一条消息是内容非空的 `USER` 消息。

模型 prompt MUST 指示模型在 `<summary>` 内容之外，发出一个 `<checklist>` 块，其中为每个存在的类别包含一个 `<fact name="<category>">—</fact>` 条目。不存在的类别 MUST NOT 出现在 `<checklist>` 中。解析器 MUST 提取 `<checklist>` 块并验证：

- 当被覆盖范围内至少一个类别存在时该块存在，
- 每个存在的类别都出现在块中且正文非空，
- 没有任何不存在的类别出现在块中。

`<checklist>` 块内容不暴露给模型可见的 summary；它只被 generator 用于校验。Raw `<checklist>` 正文文本 MUST NOT 出现在 safe errors、logs、audit 事件或可追溯字段中。

Checklist 校验只在解析器匹配到结构化 `<summary>` 块时适用。当解析器回退到全文（不存在非空 `<summary>` 块）时，结果已处于降级 fallback 路径：generator SHALL 记录安全的 fallback 原因，并 SHALL NOT 在该路径上要求或解析 `<checklist>` 块。

如果上述任何检查在结构化路径上失败，port SHALL 返回安全失败。Generator SHALL NOT 在这种情况下返回降级 draft、部分填充的 draft 或跳过 checklist 的 draft。

#### Scenario: 预分类识别出预期类别
- **WHEN** 被覆盖范围包含两条 `USER` 消息、一条 `ASSISTANT` 消息、两条 `CAPABILITY_RESULT` 消息（其中一条携带失败 `status` 或非空 `error`，另一条携带非空 `artifactRefs` 投影）
- **THEN** generator 预分类出的预期类别为 `user_intent`、`confirmed_facts`、`tool_outcomes`、`artifact_outcomes`、`unresolved_errors` 和 `next_step`
- **AND** `constraints` 和 `pending_tasks` 未被分类为存在

#### Scenario: Checklist 对照预分类类别校验通过
- **WHEN** 预期类别为 `user_intent`、`confirmed_facts`、`tool_outcomes` 和 `next_step`
- **AND** 模型返回 `<summary>—</summary><checklist><fact name="user_intent">—</fact><fact name="confirmed_facts">—</fact><fact name="tool_outcomes">—</fact><fact name="next_step">—</fact></checklist>`
- **THEN** generator 接受该 draft 并返回一个 `TraceableSummaryDraft`
- **AND** `<checklist>` 正文文本不包含在返回的 `content` 中

#### Scenario: 空 fact 正文被当作安全失败
- **WHEN** 预期类别包含 `tool_outcomes`
- **AND** 模型返回 `<summary>—</summary><checklist><fact name="tool_outcomes"></fact></checklist>`
- **THEN** port SHALL 返回安全失败
- **AND** draft SHALL NOT 被返回给调用方
