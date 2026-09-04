## 1. 轨迹事件模型与输入接线

- [x] 1.1 收敛首版 trajectory vocabulary 为 `CONTEXT_ASSEMBLY_COMPLETED`、`CAPABILITY_SELECTED`、`SANDBOX_EXECUTION_COMPLETED` 和 `MODEL_STREAM_FIRST_VISIBLE_CONTENT`，并以 `requestRunId`、`requestContextId`、`capabilityInvocationId` 等稳定 refs 进入统一 observation/event 映射；不额外引入未落地的 `AGENT_TURN_*` 或独立 `STREAM_VISIBLE_OUTPUT_STARTED` vocabulary。
  验证：`npx.cmd vitest run tests/agent-kernel/trace-log-linking.test.ts packages/agent-observability/tests/trace-projector.test.ts packages/agent-app/tests/runtime-trajectory-observability.test.ts`
  结果：实现命中 `CONTEXT_ASSEMBLY_COMPLETED`、`CAPABILITY_SELECTED`、`SANDBOX_EXECUTION_COMPLETED`、`MODEL_STREAM_FIRST_VISIBLE_CONTENT`；trace/log linking 与 projector 非阻塞约束测试通过。
  来源：归档后稳定 spec、实现收敛和 design 决策 1、4、6。

- [x] 1.2 在 `agent-context-engine` / app-composed runtime observation 中补充 `CONTEXT_ASSEMBLY_COMPLETED` 的安全摘要输入，只允许 budget/compression/degradation/omitted-count 等低基数字段进入 trajectory，不携带 prompt、message body、tool result 正文或附件内容。
  验证：`npx.cmd vitest run tests/agent-kernel/redaction-policy.test.ts packages/agent-app/tests/runtime-trajectory-observability.test.ts`
  结果：预算诊断映射只输出低基数字段；redaction 测试证明 raw/provider/path/secret 类字段不会进入 observation/projector。
  来源：稳定 spec 中 “Context assembly trajectory SHALL record safe decision summaries only”；design 决策 3、6。

- [x] 1.3 在 `agent-core` / capability path / sandbox path 接入 `CAPABILITY_SELECTED` 与 `SANDBOX_EXECUTION_COMPLETED`，保证 capability 选择与受控执行完成是两个可区分的轨迹点，且不泄漏 raw args、raw output、resolved executable path 或 host path。
  验证：`npx.cmd vitest run packages/agent-app/tests/runtime-trajectory-observability.test.ts tests/agent-kernel/runtime-foundation.test.ts`
  结果：`tool.call.start` 与 `tool.call.completed` 分别映射为 capability selection / sandbox completion；grep/bash 路径测试验证 safe summary 与 low-cardinality diagnostics。
  来源：稳定 spec 中 “Capability selection and sandbox execution SHALL be separately observable”；design 决策 3、6。

- [x] 1.4 在首版实现中，用 model wrapper 的 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` 对齐可见输出起点，并确保它能够与同一 `requestRunId` 关联；独立 `STREAM_VISIBLE_OUTPUT_STARTED` 与稳定 turn 骨架显式 deferred，不用伪实现占位。
  验证：`npx.cmd vitest run packages/agent-observability/tests/model-invocation-wrapper.test.ts packages/agent-app/tests/runtime-trajectory-observability.test.ts tests/agent-kernel/run-status-visibility.test.ts tests/agent-kernel/terminal-consistency.test.ts`
  结果：首个可见内容 observation 在 model wrapper 侧落地，且不复制 raw delta/body。
  来源：实现收敛后的稳定 spec；design 决策 2。

## 2. 日志职责分离与 structured trajectory 投影

- [x] 2.1 扩充 `StructuredLogProjector` 和 trajectory structured log coverage，使 `nextagent-observability.log` 成为首版 context/capability-selection/sandbox/first-visible-content/terminal 的主复盘视图。
  验证：`npx.cmd vitest run tests/agent-kernel/logging.test.ts packages/agent-app/tests/runtime-trajectory-observability.test.ts`
  结果：structured logs 统一从 observation stream 投影，trajectory 相关诊断进入 `MODEL_INVOCATION_DIAGNOSTIC`、`CAPABILITY_INVOCATION_DIAGNOSTIC`、`SYSTEM_RUNTIME_DIAGNOSTIC`。
  来源：`structured-logging` stable spec；design 决策 5。

- [x] 2.2 收敛 `nextagent-runtime.log` 与 trajectory structured log 的职责分离，保持 runtime log 只承载运行编排诊断，不把完整 trajectory replay 逻辑继续塞入 runtime direct logs。
  验证：code review 检查点：`runtime-logging` stable spec 对照 `packages/agent-app/src/composition/create-app.ts`、`packages/agent-runtime/src/**`；`npx.cmd vitest run tests/agent-kernel/logging.test.ts`
  结果：runtime 与 structured log 使用两个独立 sink；trajectory replay 走 observation-derived structured log，而不是 runtime 直接日志。
  来源：`runtime-logging` stable spec；design 决策 5。

- [x] 2.3 补充 trajectory degradation / projection failure 的 non-blocking 验证，确保 trajectory 新增轨迹点失败时不影响 request lifecycle、terminal commit、stream projection、capability invocation 或 gateway response。
  验证：`npx.cmd vitest run tests/agent-kernel/trace-log-linking.test.ts packages/agent-observability/tests/trace-projector-negative.test.ts packages/agent-observability/tests/routing-evidence-observability-degradation.test.ts`
  结果：projector host 明确记录 degraded/failed_closed outcome，不阻塞其它 surface 或业务主路径。
  来源：稳定 spec 中 “Trajectory degradation SHALL remain non-blocking”；design 决策 1、5。

- [x] 2.4 增加 architecture / negative tests，断言 trajectory change 不引入第二套 event carrier，不把 trace SDK 字段作为业务主键，也不让 runtime/core/gateway 持有 surface-private observability 输入。
  验证：`npm run lint:architecture`；`npx.cmd vitest run tests/architecture/otel-observability-boundary.test.ts tests/agent-kernel/trace-log-linking.test.ts`
  结果：OTel 与 observability 输入边界测试通过，业务包不泄漏 trace SDK 字段。
  来源：`trace-log-linking` stable spec；design 决策 1、4。

## 3. Characterization 与回归验证

- [x] 3.1 为 tool-use request 增加 characterization tests，验证可以按 `requestRunId`、`requestContextId`、`capabilityInvocationId` 串起 context assembly、capability selection、sandbox execution、first visible content 和 terminal 的主轨迹；稳定 turn ref 显式 deferred。
  验证：`npx.cmd vitest run packages/agent-app/tests/runtime-trajectory-observability.test.ts tests/agent-kernel/runtime-foundation.test.ts tests/agent-kernel/run-status-visibility.test.ts`
  结果：主轨迹 characterization 已覆盖首版已落地 skeleton；未伪装声明 turn-level replay 已实现。
  来源：实现收敛后的稳定 spec；design 决策 2、3。

- [x] 3.2 增加 redaction / observability tests，实际注入 prompt、raw model output、raw tool args/result、free-text reasoning、path、credential、token 等 forbidden content，并断言 trajectory structured log 不包含这些内容。
  验证：`npx.cmd vitest run tests/agent-kernel/redaction-policy.test.ts packages/agent-observability/tests/metrics-registry.test.ts`
  结果：统一 redaction policy 在 observation 入口过滤敏感字段，trajectory 相关 structured log 只能消费 sanitize 后 event。
  来源：稳定 spec 中 context/capability/runtime safety constraints；design 决策 6。

- [x] 3.3 运行 OpenSpec 与常规验证，确认稳定 spec 和实现接线满足门禁。
  验证：`openspec validate --all --strict`、`npm run build`、`npm run test:contract`、`npm run lint:architecture`
  结果：归档前后 OpenSpec 全量校验通过；补充运行 build / contract / architecture gate 以闭环归档后任务状态。
  来源：AGENTS.md 验证门禁；design 验证映射。

- [x] 3.4 将首版 gap 显式收敛：稳定 turn ref 与 `AGENT_TURN_*` 未在本次实现中落地；visible output 首版使用 `MODEL_STREAM_FIRST_VISIBLE_CONTENT`，不再伪称存在独立 `STREAM_VISIBLE_OUTPUT_STARTED` owner。
  验证：code review 检查点：归档后的 tasks/design/稳定 spec 与实现一致，不再保留“已实现 turn skeleton”的隐式表述。
  来源：design 待确认问题收敛；OpenSpec “不得把关键设计选择延迟到实现阶段”的约束。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/agent-execution-trajectory/spec.md`、`trace-log-linking/spec.md`、`structured-logging/spec.md`、`runtime-logging/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/observability.md` 和 `openspec/designs/architecture/runtime.md`。
- 按需更新 `openspec/designs/modules/agent-observability.md`、`agent-runtime.md`、`agent-core.md`、`agent-context-engine.md`。
- 按需新增或更新 `openspec/designs/adr/agent-execution-trajectory-safe-diagnostics.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 trajectory vocabulary、数据 owner 或日志职责边界。
