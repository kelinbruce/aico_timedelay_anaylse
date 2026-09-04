## 1. Spec

- [x] 1.1 补强 `system-health-check` spec，冻结 primary / deep health endpoint 的业务语义、真实检查边界、输出契约和失败处理。
- [x] 1.2 明确 `HealthProbe` 是 composition contract：业务模块暴露 safe public check，`agent-app` 适配，`agent-observability` evaluator 消费。
- [x] 1.3 明确 health probe metrics 的语义和 labels 由本 change 拥有，写入机制复用 `add-ts-runtime-metrics` 的 registry / label validation primitives，不定义第二套 metrics registry。

## 2. Design

- [x] 2.1 写清 primary health 是 bounded live check，deep health 才运行最小真实检查。
- [x] 2.2 写清 `HealthEvaluator`、`HealthProbe`、safe diagnostics、timeout / AbortSignal 和 critical 聚合语义。
- [x] 2.3 写清 `agent-channel-web` 只做 route projection 和 HTTP status mapping，不拥有 health 判断逻辑。
- [x] 2.4 写清 health response 不是 metric sample，不得作为 metric replay 来源。
- [x] 2.5 写清 health probe metrics 与 `add-ts-runtime-metrics` 的依赖关系和降级行为：`add-ts-health-check` owns metric semantic / labels，`add-ts-runtime-metrics` owns registry / generic label validation primitives。

## 3. Validation

- [x] 3.1 覆盖 `GET /health` primary 正常路径、base authority timeout / exception、HTTP `200` / `503` mapping 和 safe response schema。
- [x] 3.2 覆盖 `GET /health/deep` deep checks：全部成功、critical failure、timeout、AbortSignal cancellation、预算受限。
- [x] 3.3 覆盖 `HealthProbe` composition 边界：业务 owner 不 import observability SDK、metrics registry、tracer、logger、audit writer、metric names 或 health response internals。
- [x] 3.4 覆盖 health diagnostics 安全裁剪：raw error、stack trace、path、secret、prompt、model output、raw provider detail 不进入 response。
- [x] 3.5 覆盖 health probe metrics：evaluator 完成后写 `health_probe_total` / `health_probe_duration_seconds`；registry unavailable 或 invalid label 不改变 health response truth。

## 4. Implementation

- [x] 4.1 在 `agent-observability` 内定义最小 health model 和 `HealthProbe` / `HealthEvaluator`；类型不进入 `agent-contracts`。
- [x] 4.2 实现 primary health evaluator，不运行 registered probes。
- [x] 4.3 实现 deep health evaluator，运行 `agent-app` 注册的 probes，并受 timeout / AbortSignal 约束。
- [x] 4.4 实现 safe diagnostics redaction / sanitization。
- [x] 4.5 接入 `agent-channel-web` 的 `GET /health` / `GET /health/deep` projection。
- [x] 4.6 在 `add-ts-runtime-metrics` registry / label validation primitives 可用后，复用其写入 `health_probe_total` / `health_probe_duration_seconds`；本 change 只定义 health-owned metric semantic / labels，不定义第二套 registry。
- [x] 4.7 收尾验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-ts-health-check --strict`。
