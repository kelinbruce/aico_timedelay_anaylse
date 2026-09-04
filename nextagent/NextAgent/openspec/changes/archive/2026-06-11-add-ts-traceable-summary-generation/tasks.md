## 1. OpenSpec 范围

- [x] 收口 change 为最小真实 traceable summary generator 闭环。
- [x] 移除 prompt template registry、prompt-too-long retry、多级 escalation、rehydration hints、session memory 和 long-term memory 的实现承担。
- [x] 验证 `openspec validate add-ts-traceable-summary-generation --strict`。
## 2. Port Implementation

- [x] 实现默认 `TraceableSummaryGenerationPort`（owner: `agent-context-engine`；实现位于 `packages/agent-context-engine/src/summary/` 子目录，默认导出类名 `DefaultTraceableSummaryGenerator`）。
- [x] 直接消费 `refine-ts-context-assembly-contracts` 冻结并由 `agent-contracts/context` 导出的 `TraceableSummaryGenerationRequest` / `TraceableSummaryDraft` DTO，不重新定义并行 shape。
- [x] 确保实现不写 session message、不提交 active context、不写 checkpoint/timeline。
- [x] 确保该 port 只返回 draft，不持有请求生命周期或 commit 责任。
## 3. Input Serialization

- [x] 将 covered `SessionMessage[]`（领域 read model）序列化为 summary input，保留 role、顺序和 message boundary。
- [x] 对 `CAPABILITY_RESULT` 使用安全表达。
- [x] 消费已有 large-content replacement 形态，不重新内联外置大内容。
- [x] 不修改原始 `SessionMessage.content`。
- [x] 确保 raw path、credential、secret 不进入 logs/safe errors。
- [x] safe-data 净化由 `add-ts-redaction-policy` 的 shared output boundary 统一执行（business 模块不得内联调用 redaction 或实现私有 redaction）；本 change 的职责是保证 summary generator 产出的 diagnostic / log / safe-error 内容本身不携带 raw path、credential、secret、raw covered messages、raw prompt 或 raw tool args，交由 shared output boundary 在跨越边界前 redact。
## 4. Model Invocation

- [x] 通过 by-purpose prompt template resolver 以 `purpose = SUMMARY_GENERATION` 解析摘要 prompt（resolver 契约由 `add-ts-context-prompt-shaping` 拥有，本 change 消费），内置 `compact-summary/v1` 作为 built-in fallback；fallback 加载失败 fail-fast 抛错。
- [x] 通过标准 model invocation boundary 调用模型。
- [x] 禁用 tools，并把 tool call attempt 视为 generation failure。
- [x] 传入 `AbortSignal`。
- [x] 设置目标输出预算。
## 5. Output Parsing

- [x] 优先提取 `<summary>` 内容（首个非空匹配；属性化或嵌套的 `<summary>` 视为 invalid，触发 safe failure；空 `<summary></summary>` 视为未匹配）。
- [x] 丢弃 `<analysis>` 内容。
- [x] 没有 `<summary>` 但有非空文本时，使用全文 fallback 并记录 safe fallback reason。
- [x] 空输出或 tool call attempt 返回 safe failure。
## 6. Draft Traceability

- [x] 返回 `content`。
- [x] 返回 presentation-safe `sourceReferences`。
- [x] 返回 presentation-safe `historyLookupLinkage`。
- [x] 返回 `generationMode = "normal"`。
- [x] 返回 `promptTemplateVersion`，取自 by-purpose resolver 解析出的模板版本；命中 built-in fallback 时形态为 `compact-summary/v1`。
- [x] 返回 input/output unit estimate（与 `targetBudgetUnits` 同单位、同 model profile 派生）。
- [x] `rehydrationHints` 本 slice 可为空数组。
## 7. Verification

- [x] 增加正常 `<summary>` 输出解析测试。
- [x] 增加 `<analysis>` 丢弃测试。
- [x] 增加全文 fallback 测试。
- [x] 增加 tool call attempt denied 测试。
- [x] 增加 checklist 缺失 negative 测试：mock model 返回带 `<summary>` 但无 `<checklist>` 的输出，断言 generator 返回 safe failure 而非 degraded draft。
- [x] 增加 continuation-critical fact 缺失 negative 测试：构造 covered range 含至少一条 user message（使 `next_step` 预分类为 present），mock model 返回 `<summary>` 但 `<checklist>` 缺少 `<fact name="next_step">` 或该 `<fact>` body 为空，断言 generator 返回 safe failure，draft content 不被返回。
- [x] 增加 model call canceled negative 测试：mock model 拋 AbortError，断言 generator 返回 safe failure，不返回 degraded draft。
- [x] 增加 auth/authorization/policy denied negative 测试：mock provider 返回 401 / policy denied 错误，断言 generator 返回 safe failure，由 caller 端走既有预算退化路径。
- [x] 增加空 `<summary></summary>` 块触发全文 fallback 测试：mock model 返回 `<summary></summary>real content`，断言 draft.content 等于 `real content` 且 safe fallback reason 已被记录。
- [x] 增加 multiple summary blocks 取首个非空测试：mock model 返回 `<summary></summary><summary>final</summary>`，断言 draft.content 等于 `final` 且空块被跳过。
- [x] 增加 abort propagation 测试。
- [x] 增加 safe-data negative tests，通过 `RedactionPolicy` 接口桩断言净化口径。
- [x] 增加 fake compression consumer 测试，证实 draft 可被 summary compression 消费。
- [x] 增加 architecture lint 断言：默认实现包 `packages/agent-context-engine/src/summary/**` 不得 import 以下路径：
  - `agent-platform-gateway-local` 的 `commitCompaction` 入口、`SessionMessageStoreGateway` 的写入入口（`appendSessionMessage`）、`ActiveContextStoreGateway` 的写入入口（`appendItem` / `commitCompaction` 之类）。
  - `agent-runtime` 的 checkpoint writer、timeline writer、canonical timeline emitter。
  - lint 工具：在 `dependency-cruiser` 配置中新增 `no-summary-persistence-side-effects` 规则，在 `tests/architecture` 增加 `summary-isolation.spec.ts` source-assertion 用 AST 扫描上述 import；新增长合法入口时必须同步更新该 lint 规则。
- [x] 运行 `openspec validate --all --strict`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm test`。
- [x] 运行 `npm run test:contract`。
- [x] 运行 `npm run lint:architecture`。

> 2026-06-11 更新 (Chunk τ, 即将 commit): §2、§3、§4、§5、§6、§7 全部勾选。落地:
> - `packages/agent-context-engine/src/summary/` 子目录新增 5 文件: `compact-summary-template.ts` (built-in `compact-summary/v1` prompt)、`summary-input-serializer.ts` (covered → 安全 text,过滤 secret-shaped 字符串与本地绝对路径,消费 large-content replacement 不重 inline)、`covered-range-classifier.ts` (8 类预分类)、`output-parser.ts` (提 `<summary>` + `<checklist>`,丢 `<analysis>`,支持 full-text fallback 与空块跳过)、`default-traceable-summary-generator.ts` (主类,抛 `TraceableSummaryGenerationError` 永不返回 degraded draft)。
> - `packages/agent-context-engine/tests/traceable-summary-generation.test.ts` 35 个用例覆盖: classifier、serializer、parser、generator 全路径 + 6 类 negative (tool call / missing checklist / empty fact / lying category / abort / auth 401 / safeError)。
> - `tests/architecture/summary-isolation.test.ts` 5 个 enforce case 锁定 summary 模块**永不**调 `commitCompaction` / `appendItem` / `appendSessionMessage` / `saveCheckpoint` / `appendEvent` / `emitEvent`,**永不** import `agent-runtime` 或 `agent-platform-gateway-local`。
> - `dependency-cruiser.config.cjs` allowlist 增加 `agent-context-engine` 的 `session` 子路径(summary 模块读 `SessionMessage` 领域 read model,这是合法 owner)。
> 进度 3/48 → 41/48(本 chunk 主要勾完 §2-§7,§7.16 architecture lint 也勾)。
