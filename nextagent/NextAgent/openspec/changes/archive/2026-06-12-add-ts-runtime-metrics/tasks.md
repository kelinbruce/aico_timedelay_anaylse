## 1. 规格

- [x] 1.1 定义 METRIC surface 只消费 `add-ts-trace-log-linking` 的 `ObservabilityObservationEvent` stream。
  验证：spec requirement `METRIC surface 必须消费统一 observation stream`。

- [x] 1.2 定义 METRIC 领域对象：`MetricDescriptor`、`MetricSample`、`MetricsRegistry`、`MetricProjectionPolicy`、`MetricsProjector`、`MetricProjectionResult`。
  验证：design `核心对象` 与 spec requirement `Metric domain objects 必须有稳定语义`。

- [x] 1.3 给出完整 metric inventory，逐项说明 type、labels、preferred input、fallback input 和 event 增强需求。
  验证：design / spec 均包含 metric inventory。

- [x] 1.4 定义从 `ObservabilityObservationEvent` 到 `MetricSample` 的 value、label、dedup、source precedence 和 registry write 规则。
  验证：design `从 Observation 到 MetricSample 的映射`。

## 2. 设计

- [x] 2.1 明确唯一产品路径：`ObservabilityProjectorHost` -> `MetricsProjector` -> `MetricsRegistry`。
  验证：design `唯一产品路径`。

- [x] 2.2 明确 metric labels 低基数固定枚举，拒绝 owner/request/path/free-text/raw payload 等高基数字段。
  验证：spec requirement `Metric labels 必须低基数且固定`。

- [x] 2.3 明确 model `usage` 投影为 `model_token_usage_total`，shape 复用 `ModelUsage`，缺失字段省略。
  验证：spec scenario `Model end event emits usage metrics`。

- [x] 2.4 明确 health-owned metrics 由 `add-ts-health-check` 定义，本 change 只提供 registry / label validation primitives。
  验证：spec requirement `Health-owned metrics 由 health change 定义`。

## 3. 实现方案

- [x] 3.1 整改 `packages/agent-observability/src/metrics/metrics-registry.ts`：定义 descriptor inventory、label validation、counter/histogram sample write 和 snapshot。
  验证：unit test 覆盖所有 descriptor、allowed labels、invalid labels、finite non-negative values。

- [x] 3.2 新增或整改 `MetricsProjector`：输入只接受 `ObservabilityObservationEvent`，按 inventory 生成 `MetricSample[]`，输出 `MetricProjectionResult`。
  验证：unit test 覆盖 emitted / skipped_not_covered / skipped_policy_denied / degraded / failed_closed。

- [x] 3.3 实现 request、model、stream、capability、gateway、web entrypoint、degradation 和 projector outcome metrics。
  验证：unit test 覆盖 metric inventory 每一项。

- [x] 3.4 实现 duration / usage 规则：`durationMs / 1000` 写 histogram；`usage.inputTokens/outputTokens/totalTokens` 写 `model_token_usage_total`；缺失字段不补 0、不估算。
  验证：unit test 覆盖 completed / failed / missing usage / invalid usage。

- [x] 3.5 整改 `packages/agent-app/src/composition/create-app.ts`：移除直接写 registry 的 metrics helper / timeline metrics observer 产品路径，注册 `MetricsProjector` 到 `ObservabilityProjectorHost` fixed projector set。
  验证：source test 断言 app product path 不直接调用 metrics registry 或 metrics projector。

- [x] 3.6 整改 entrypoint middleware / wrappers：只生成 `ObservabilityObservationEvent`，不直接写 registry。
  验证：source test 断言 wrappers / middleware 不直接 import `MetricsRegistry`。

- [x] 3.7 添加 architecture / source negative tests：业务 package 不 import metrics registry、metric names、label taxonomy、tracer 或 observability SDK；不存在 per-metric acquisition path 或 metrics replay path。
  验证：`npm run lint:architecture` 或 source tests 覆盖 negative fixtures。

## 4. 验证

- [x] 4.1 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  验证：全部通过。

- [x] 4.2 运行 `openspec validate add-ts-runtime-metrics --strict` 和 `openspec validate --all --strict`。
  验证：全部通过。
