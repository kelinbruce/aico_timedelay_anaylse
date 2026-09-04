## 1. Spec

- [x] 1.1 新增 `redaction-policy` spec，冻结统一 observation 准入 redaction 的 diagnostic candidate 过滤、敏感分类、字段裁剪、字段内容脱敏和失败处理。
  来源：spec requirement "Unified redaction applies before observation handoff"，spec requirement "Sensitive-field classification and action order are explicit"
- [x] 1.2 明确 redaction 必须在 `ObservabilityProjectorHost.acceptObservation(event)` 同步接收边界执行；只有 sanitized `ObservabilityObservationEvent` 可以进入内部异步 handoff。
  来源：spec requirement "Unified redaction applies before observation handoff"
- [x] 1.3 明确 redaction 不改变字段名称、不改变 `ObservabilityObservationEvent` shape；不同 projector 输出同一字段时必须使用同一 sanitized value。
  来源：spec requirement "Unified redaction keeps projector-visible fields consistent"
- [x] 1.4 明确 redaction failure 必须 fail closed，不得回退到 raw 内容。
  来源：spec requirement "Redaction failure is explicit and fail-closed"

## 2. Design

- [x] 2.1 写清 redaction 的唯一职责是决定 observation 字段能否进入异步观测流，以及字段值需要以什么安全形式保留。
  来源：spec requirement "Unified redaction applies before observation handoff"；design 第一性原理
- [x] 2.2 写清 redaction 与 `ObservabilityProjectorHost`、structured logging、trace、audit、metrics、health 的职责边界。
  来源：spec requirement "Redaction is enforced by the shared observation boundary"；design 边界
- [x] 2.3 写清固定敏感分类、字段裁剪 / 字段内容脱敏动作、diagnostic candidate classification / cardinality hint 和固定输入约束。
  来源：spec requirement "Sensitive-field classification and action order are explicit"，spec requirement "Redaction uses deterministic inputs and preconditions"；design 核心判断逻辑
- [x] 2.3.1 写清首版字段级策略表，覆盖 owner scope、`occurredAt`、`boundary`、`operation`、`outcome`、`stableRefs`、`durationMs`、`usage`、safe error fields、kind/category/status fields、diagnostic candidates、degradation evidence 和明确禁止字段。
  来源：spec requirement "Observation field policy is explicit"；design 字段级策略表
- [x] 2.4 写清预算不足、规则不可用和超时时的保守降级策略。
  来源：spec requirement "Redaction failure is explicit and fail-closed"；design 失败与降级
- [x] 2.5 写清 redaction 对 `add-ts-trace-log-linking` `DiagnosticContext` snapshot / `ObservabilityObservationEvent` / `ObservabilityProjectorHost.acceptObservation(event)` 的输入依赖，以及首版 KISS 限制：不实现动态策略语言、用户自定义规则、远端 policy fetch、插件化 classifier、多版本 policy registry、`RedactedObservabilityObservationEvent` 或第二条 redaction event stream。
  来源：design 当前冻结的核心实现策略

## 3. Validation

- [x] 3.1 覆盖 `ObservabilityProjectorHost.acceptObservation(event)` 同步 sanitize 路径，以及 safe error / stream diagnostic / health diagnostic 等非 host 输出边界复用同一字段裁剪规则。
  来源：spec requirement "Unified redaction applies before observation handoff"
- [x] 3.2 覆盖 provider error body、prompt、tool args、attachment content、diagnostic candidate、高基数字段等高风险类别的裁剪。
  来源：spec requirement "Sensitive-field classification and action order are explicit"，spec requirement "Redaction keeps field names and uses bounded safe values"
- [x] 3.2.1 覆盖字段级策略表：owner/time 缺失 fail closed、stable refs 保持 `REF_ONLY`、duration / usage 数值校验、safe error 标准字段、raw path/header/credential 省略、未知字段默认省略。
  来源：spec requirement "Observation field policy is explicit"
- [x] 3.3 覆盖预算不足、多规则命中、字段名保持不变和 fail-closed 场景。
  来源：spec requirement "Redaction failure is explicit and fail-closed"，spec requirement "Sensitive-field classification and action order are explicit"
- [x] 3.4 覆盖 redaction timeout / dependency failure 时的 generic safe output。
  来源：spec requirement "Redaction failure is explicit and fail-closed"


## 4. Implementation

- [x] 4.1 在 `agent-observability` 内定义 `SensitiveCategory`、`RedactionAction` 类型与常量，以及 `sanitizeObservation(event: ObservabilityObservationEvent): ObservabilityObservationEvent` 内部函数。该函数只做字段裁剪和字段内容脱敏，不改变字段名称、不改变 `ObservabilityObservationEvent` shape、不新增 `RedactionOutput` 或 `RedactedObservabilityObservationEvent`。类型全部停留于 `agent-observability` 内部实现，不进入 `agent-contracts`。
  来源：spec requirement "Unified redaction applies before observation handoff"，spec requirement "Sensitive-field classification and action order are explicit"；design 当前冻结的核心实现策略
  验证：`npm run build`；类型断言覆盖全部 category / action 枚举值；`rg "RedactionSurface\|RedactionInput\|RedactionOutput\|RedactedObservabilityObservationEvent" packages/agent-contracts` 无命中。

- [x] 4.2 实现同步 `sanitizeObservation(event: ObservabilityObservationEvent): ObservabilityObservationEvent` 函数，按 spec 定义的 6 步判断顺序执行：识别字段来源 → 命中敏感分类 → 判断字段允许的安全表示形态 → 多规则命中取更严格结果 → 预算不足降级 → 输出 sanitized observation 与 evidence。
  来源：spec requirement "Sensitive-field classification and action order are explicit"；design 当前冻结的核心实现策略
  验证：unit test 覆盖 6 种 RedactionAction 的正常产出（SAFE_VALUE / MASKED_VALUE / SAFE_SUMMARY / REF_ONLY / REASON_CODE_ONLY / OMITTED_BY_POLICY）。

- [x] 4.3 实现 observation ingress redaction：`ObservabilityProjectorHost.acceptObservation(event)` 同步调用 `sanitizeObservation(event)`，只有 sanitized event 可以进入内部 queue / mailbox。diagnostic candidate 默认 omitted，只有声明 classification 且通过统一 policy 的 candidate 可进入 sanitized observation。未知字段默认 `OMITTED_BY_POLICY`。
  来源：spec requirement "Unified redaction keeps projector-visible fields consistent"；spec scenario "Diagnostic candidates are sanitized once"；design 关键约束
  验证：unit test 覆盖同一 provider failure 进入 host 后只产生一份 sanitized observation；LOG / AUDIT / METRIC / TRACE projector mock 读取同一字段时值一致；negative test 断言未分类 candidate 被 omitted，高基数字段默认不能成为 metric label。

- [x] 4.3.1 实现首版 `ObservationFieldPolicy` 表：root shape、owner scope、time、boundary、operation、outcome、stable refs、duration、usage、safe error、kind/category/status、diagnostic candidate、degradation evidence 和 banned raw fields 均按 spec 表处理。
  来源：spec requirement "Observation field policy is explicit"
  验证：unit test 覆盖 `ObservationFieldPolicy` 每一类字段；source test / contract test 断言 `usage` 不新增开放式 key，`traceId` / `spanId` / `traceContext` 不进入 sanitized observation，raw prompt / model output / thinking / tool args/result / attachment body / provider raw body / path / header / credential 均被省略。

- [x] 4.4 实现 fail-closed 降级：预算不足 → REASON_CODE_ONLY → REF_ONLY → OMITTED_BY_POLICY；规则/分类器不可用 → 全部 OMITTED_BY_POLICY + `redactionDegraded: true` / `degradationReason: 'RULES_UNAVAILABLE'`；超时 → 已处理字段保留结果，未处理字段 OMITTED_BY_POLICY + timeout evidence。
  来源：spec requirement "Redaction failure is explicit and fail-closed"；design 失败与降级
  验证：unit test 覆盖 budget exhaustion / rules unavailable / timeout 三条降级路径，断言无 raw 内容泄漏且 degradation evidence 不含敏感细节。

- [x] 4.5 替换或内联现有 `agent-observability` 中 `defaultRedactionPaths` 常量（`redaction.ts`）和 Pino `redact` 配置（`logger.ts`）——把业务 redaction 语义从字符串匹配迁移到统一 `sanitizeObservation()` 调用；logger 只能消费 sanitized observation。
  来源：spec requirement "Unified redaction applies before observation handoff"；design 流程接入
  验证：`npm run build`；`npm test`；grep 确认 `defaultRedactionPaths` 不再被非测试产品路径引用。

- [x] 4.6 收尾验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-ts-redaction-policy --strict`。code review 检查 `agent-contracts` 无新增 redaction category / action / input / output 导出；`defaultRedactionPaths` 不再存在于产品路径。
  来源：AGENTS.md 验证门禁
