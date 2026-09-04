## 1. 规格

- [x] 1.1 定义 LOG surface 只消费 `add-ts-trace-log-linking` 的 `ObservabilityObservationEvent` stream。
  验证：spec requirement `LOG surface 必须消费统一 observation stream`。

- [x] 1.2 定义 LOG 领域对象：`StructuredLogEntry`、`StructuredLogProjector`、`StructuredLogTransport`、`StructuredLogProjectionPolicy` 和 logging degradation evidence。
  验证：design `核心对象` 与 spec requirement `StructuredLogEntry 必须 schema-stable`。

- [x] 1.3 给出完整 LOG coverage 清单，逐项说明 timeline event、event 状态、增强需求、owner-deferred event 或 wrapper / middleware / system producer 来源。
  验证：design / spec 均包含 LOG coverage inventory。

- [x] 1.4 定义从 `ObservabilityObservationEvent` 到 `StructuredLogEntry` 的字段映射、redaction、schema validation 和失败策略。
  验证：design `从 Observation 到 StructuredLogEntry 的映射`。

## 2. 设计

- [x] 2.1 明确唯一产品路径：`ObservabilityProjectorHost` -> `StructuredLogProjector` -> `StructuredLogTransport`。
  验证：design `唯一产品路径`。

- [x] 2.2 明确 `durationMs` 可选、`usage` 复用 `ModelUsage` shape，不引入 `model*` 前缀字段。
  验证：spec scenario `Model usage shape is preserved`。

- [x] 2.3 明确 system runtime log 只能从 system observation event 生成。
  验证：spec requirement `System runtime logs 必须通过 system observation`。

- [x] 2.4 明确 LOG output 不作为 audit / metric / health / trace 的输入真相。
  验证：spec requirement `LOG output 不得成为其它 surface 的输入真相`。

## 3. 实现方案

- [x] 3.1 整改 `packages/agent-observability/src/logging/structured-log-projector.ts`：实现 fixed `StructuredLogProjector`，输入只接受 `ObservabilityObservationEvent`，输出 `SurfaceProjectionResult`。
  验证：unit test 覆盖 emitted / skipped_not_covered / skipped_policy_denied / degraded / failed_closed。

- [x] 3.2 实现 LOG coverage policy：覆盖 request、terminal、model、capability、stream visible diagnostics、degradation、gateway、hook/policy、attachment、safe error、large content、web entrypoint、system runtime 和 logging degraded。
  验证：unit test 覆盖 coverage 清单每一项。

- [x] 3.3 实现 observation -> `StructuredLogEntry` 映射：稳定 event、level、ownerScope、correlation、processState、costLatency、costUsage 和 safeSummary。
  验证：unit test 覆盖缺失 optional refs、省略不可用 duration/usage、非法 usage、raw payload 拒绝。

- [x] 3.4 整改 `packages/agent-observability/src/logging/logger.ts`：保留为 projector-to-transport wrapper，不作为业务 package logger API。
  验证：source test 断言业务 package 不 import logger helper / Pino / transport。

- [x] 3.5 整改 `packages/agent-app/src/composition/create-app.ts`：移除 request hook、system observation、timeline listener 中直接 projector/logger 调用，统一通过 `ObservabilityProjectorHost.acceptObservation(event): void`。
  验证：source test 断言 app product path 不直接调用 `structuredLogProjector.project()` 或 logger write。

- [x] 3.6 添加 architecture / source negative tests：wrapper 不直接写 LOG sink，不存在 structured-log-only observation event、logging event bus、日志回放生成其它 surface 输入路径。
  验证：`npm run lint:architecture` 或 source tests 覆盖 negative fixtures。

## 4. 验证

- [x] 4.1 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  验证：全部通过。

- [x] 4.2 运行 `openspec validate add-ts-structured-logging --strict` 和 `openspec validate --all --strict`。
  验证：全部通过。
