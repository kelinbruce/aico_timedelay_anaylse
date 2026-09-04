## 设计概览

本 change 实现一个最小默认 `TraceableSummaryGenerationPort`。它的职责是把 Context Engine 传入的 covered messages 转成安全摘要草稿。

它要解决的问题不是“做一个漂亮摘要”，而是“给 summary compression 一个真实、可测试、不会越权的 draft 生成来源”。draft 的价值在于让较早历史被替换后，后续请求仍能继续当前工作。

黑盒效果：

```text
covered messages 中存在：
  - 用户原始意图
  - 已确认事实/约束
  - 工具结果
  - 文件或 artifact 结果
  - 错误、待办、下一步

generate() 返回：
  - 非空 summary content
  - safe traceability metadata
  - 不包含 persistence 状态
```

```text
TraceableSummaryGenerationRequest
  -> serialize covered messages
  -> build compact summary prompt
  -> call ModelInvocationService with tools disabled
  -> parse summary output
  -> TraceableSummaryDraft
```

它不拥有 active context、session persistence、checkpoint、timeline 或 compression decision。

## 输入处理

输入来自 `refine-ts-context-assembly-contracts` 冻结、归 `agent-contracts/context` 的 DTO，不重新定义平行 shape。

需要消费的关键字段：

- `identityContext`
- `agentId`
- `agentVersion`
- `sessionId`
- `requestId`
- `runId`
- `locale`
- `purpose`
- `coveredMessages`
- `coveredMessageRefs`
- `retainedTailMessageRefs`
- `targetBudgetUnits`

序列化时保留消息顺序、role 和边界。对于 `CAPABILITY_RESULT` 和已有 large-content replacement，只使用当前 message 中已经冻结的模型可见安全形态，不重新读取或内联外部大内容。

## Prompt

本 slice 通过 by-purpose prompt template resolver 以 `purpose = SUMMARY_GENERATION` 解析摘要 prompt，复用 system prompt 的 `PromptTemplate` 体系（支持 agent package / app config / built-in fallback）。该 resolver 契约由 `add-ts-context-prompt-shaping` 拥有，本 change 仅消费它；内置 `compact-summary/v1` 作为 built-in fallback。后续若需要扩展模板能力，由 prompt-shaping 或独立 change 负责。

prompt 必须说明：

- 不允许调用工具；
- 只输出摘要；
- 保留 continuation-critical 信息；
- 不要编造未在 covered messages 中出现的事实；
- 输出优先使用 `<summary>...</summary>`，并在该 block 之后附带 `<checklist>...</checklist>` 块，为 generator 预分类为 present 的每个 continuation-critical 分类输出一个 `<fact name="<category>">…</fact>` 条目；不应包含预分类为 absent 的分类；`<checklist>` 块正文不进入 `<summary>` content。

摘要至少应覆盖：

- 当前仍有效的用户意图；
- 关键事实、结论、约束；
- 重要工具结果或 artifact 结论；
- 未解决错误和待办；
- 下一步线索。

## 模型调用

模型调用通过标准 model invocation boundary 完成。summary generator 不接触 provider SDK。

调用要求：

- tools 为空；
- 传入 `AbortSignal`；
- 不向用户 stream；
- 使用目标输出预算；
- 如果模型返回 tool call attempt，视为 generation failure，不执行 tool。

## 输出解析

解析规则：

1. 如果存在 `<summary>...</summary>`，按以下顺序处理：`<summary>` open tag 带属性（例如 `<summary class="x">`）视为 invalid，触发 safe failure；空 `<summary></summary>` 视为无匹配，跳过该 block 继续匹配后续 block 或落入全文 fallback；带平衡嵌套标签的 `<summary>` 视为合法，原样返回捕获内容；多条 `<summary>` 时取首个非空匹配，其余 block 忽略。命中结构化 `<summary>` 的路径称为 structured path，必须继续执行下方第 6 步 checklist 校验。
2. `<analysis>` 永远丢弃。
3. 如果没有任何非空 `<summary>` 但有非空文本，使用全文 fallback：全文 fallback 是降级路径，不要求也不解析 `<checklist>`，直接以全文为 content 返回，并记录 safe fallback reason；跳过第 6 / 7 步。
4. 空输出失败。
5. 结果 content 必须非空。
6. checklist 校验仅适用于第 1 步命中的 structured path：解析 `<checklist>...</checklist>` 块，使用非贪婪 regex 扫描取首个匹配；如果在覆盖范围内至少一个分类被预分类为 present 但缺少对应的 `<fact name="<category>">` 或该 `<fact>` 为空，或整个 `<checklist>` 块缺失，视为安全失败。
7. structured path 下，覆盖范围内任何分类均不为 present 时，不要求 `<checklist>` 块；模型若输出空 `<checklist>` 也视为合法，跳过该步骤。

## Draft

成功返回的 `TraceableSummaryDraft` 至少包含：

- `content`
- `sourceReferences`
- `historyLookupLinkage`
- `rehydrationHints`
- `generationMode`
- `promptTemplateVersion`
- `inputUnitEstimate`
- `outputUnitEstimate`

`TraceableSummaryGenerationPort`、`TraceableSummaryGenerationRequest` 与 `TraceableSummaryDraft` 的 public DTO shape 由 `refine-ts-context-assembly-contracts` 冻结并归属 `agent-contracts/context`。本 change owns 默认 summary generator 行为、prompt/input 安全处理、输出解析与 draft validation；不得重新定义并行 `TraceableSummaryDraft` shape，也不得隐式回退到无 metadata 的精简 shape。

本 slice 中：

- `generationMode` 默认为 `normal`。
- `promptTemplateVersion` 取自 by-purpose resolver 解析出的模板版本；命中 built-in fallback 时为稳定内置版本号 `compact-summary/v1`。
- `sourceReferences` 和 `historyLookupLinkage` 只包含 presentation-safe refs/counts，不包含 raw content。
- `rehydrationHints` 是 DTO 必含字段（本 slice 允许为空数组）；复杂 hint 由后续 change 扩展。

## 失败处理

以下情况返回 safe failure / throw `AgentError`，不得返回伪成功 draft：

- model call canceled；
- model call failed；
- model returned tool call attempt；
- parsed summary 为空；
- output 明显无效；
- `<checklist>` 块缺失或某个 present 分类对应的 `<fact>` 为空；
- parser 检测到 `<summary>` open tag 带属性（例如 `<summary class="x">`），视为 safe failure。

失败日志和 safe error 不得包含 raw prompt、raw messages、raw summary、tool result、attachment content、local path、credential 或 secret。

## 后续归属

- Context compression 消费 draft，构造 summary message 并提交 active context。
- 本 change 不负责持久化和 active context commit。
- 复杂模板、prompt-too-long retry、多级 escalation、复杂 rehydration hints 后续另开 change。
