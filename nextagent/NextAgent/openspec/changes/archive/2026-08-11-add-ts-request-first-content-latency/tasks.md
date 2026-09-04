## FN-7.5 采集指标

### 1. 规格与测试先行

- [x] 1.1 编写 timeline-observation-mapper 测试：断言首次 `LLM_CONTENT_DELTA` per run 产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation，`durationMs` 等于 `LLM_CONTENT_DELTA.createdAt - REQUEST_ACCEPTED.createdAt`。
  来源：`FN-7.5 + Request 首个内容交付时延必须从 request accepted 测量到首个可见内容 + 首个 LLM_CONTENT_DELTA 产出 observation`
  验证：`npm test -- packages/agent-observability/tests/timeline-observation-mapper.test.ts`，新增 test case 失败前先确认失败。

- [x] 1.1a 编写 timeline-observation-mapper 测试：断言首个 `LLM_CONTENT_DELTA`（携带有效 `stepId`）的 mapper 返回数组同时包含 `MODEL_STREAM_FIRST_VISIBLE_CONTENT` 和 `REQUEST_FIRST_CONTENT_DELIVERED`，且两者 durationMs 不同。
  来源：`FN-7.5 + Request 首个内容交付时延 + 首个 LLM_CONTENT_DELTA 同时产出 per-invocation 和 per-run observation`
  验证：同上 test file。

- [x] 1.1b 编写 timeline-observation-mapper 测试：断言 `LLM_CONTENT_DELTA` 不携带 `stepId` 且 `activeModelStepByRun` 无记录但 `REQUEST_ACCEPTED` 已处理时，仍产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation，且不产出 `MODEL_STREAM_FIRST_VISIBLE_CONTENT`。
  来源：`FN-7.5 + Request 首个内容交付时延 + stepId 缺失但 REQUEST_ACCEPTED 存在时仍产出 per-run observation`
  验证：同上 test file。此测试验证 per-run 检查在 stepId early return 之前执行。

- [x] 1.2 编写 timeline-observation-mapper 测试：断言同 run 第二个 `LLM_CONTENT_DELTA` 不产出额外 `REQUEST_FIRST_CONTENT_DELIVERED` observation。
  来源：`FN-7.5 + Request 首个内容交付时延 + 后续 LLM_CONTENT_DELTA 不重复产出`
  验证：同上 test file。

- [x] 1.3 编写 timeline-observation-mapper 测试：断言多轮 agent loop 中第二轮 model invocation 的首个 `LLM_CONTENT_DELTA` 不产出额外 observation。
  来源：`FN-7.5 + Request 首个内容交付时延 + 多轮 agent loop 只产出一次`
  验证：同上 test file。

- [x] 1.4 编写 timeline-observation-mapper 测试：断言 `REQUEST_ACCEPTED` 缺失时不产出 `REQUEST_FIRST_CONTENT_DELIVERED` observation。
  来源：`FN-7.5 + Request 首个内容交付时延 + REQUEST_ACCEPTED 缺失时跳过`
  验证：同上 test file。

- [x] 1.5 编写 timeline-observation-mapper 测试：断言 run 无 `LLM_CONTENT_DELTA` 终止时不产出 observation，且 terminal event 清理 `firstContentDeliveredByRun`。
  来源：`FN-7.5 + Request 首个内容交付时延 + Run 无内容交付时不产出`、`Terminal 清理 per-run 状态`
  验证：同上 test file。

- [x] 1.6 编写 metrics-registry 测试：断言 `REQUEST_FIRST_CONTENT_DELIVERED` observation 产出 `request_first_content_latency_seconds` histogram sample，label `outcome=success`，value 为 `durationMs / 1000`。
  来源：`FN-7.5 + Metric inventory + Request first content latency 使用 timeline-derived observation`
  验证：`npm test -- packages/agent-observability/tests/metrics-registry.test.ts`。

- [x] 1.7 编写 structured-log-projector 测试：断言 `REQUEST_FIRST_CONTENT_DELIVERED` 映射为 `request.first_content_delivered`，level 为 info。
  来源：design `structured-log-projector.ts` 修改方案
  验证：`npm test -- packages/agent-observability/tests/structured-log-projector.test.ts`。

### 2. 实现

- [x] 2.1 在 `packages/agent-observability/src/trajectory/timeline-observation-mapper.ts` 中将 `TimelineObservationMapper` 返回类型从 `ObservabilityObservationEvent | undefined` 改为 `readonly ObservabilityObservationEvent[]`。所有内部 `return timelineObservationFromRecord(record)` 改为 `const obs = timelineObservationFromRecord(record); return obs === undefined ? [] : [obs];`，所有 `return undefined` 改为 `return []`，`return modelFirstVisibleObservation(...)` 改为 `[modelFirstVisibleObservation(...)]`。
  来源：design `返回类型变更（前置条件）`
  验证：`npm run build` 通过，现有测试编译通过（断言在 2.2 中适配）。

- [x] 2.2 适配 `packages/agent-observability/tests/timeline-observation-mapper.test.ts` 中直接调用 `mapper(record(...))` 的现有断言为数组返回：`expect(mapper(...)[0]).toMatchObject(...)` 或 `expect(mapper(...)).toEqual([expect.objectContaining({...})])`。直接调用 `timelineObservationFromRecord` 的断言不需要改。
  来源：design `返回类型变更（前置条件）`
  验证：`npm test -- packages/agent-observability/tests/timeline-observation-mapper.test.ts`，现有测试全部通过。

- [x] 2.3 适配 `packages/agent-app/src/composition/request-runtime-composition.ts` 中 timeline event listener 的 mapper 消费逻辑，从 `if (observation !== undefined) acceptObservation(observation)` 改为 `for (const observation of observations) acceptObservation(observation)`。
  来源：design `返回类型变更（前置条件）`
  验证：`npm run build` 通过，`npm test -- packages/agent-app/tests/composition.test.ts` 通过。

- [x] 2.4 在 `timeline-observation-mapper.ts` 中新增 `firstContentDeliveredByRun: Set<string>`，在 `LLM_CONTENT_DELTA` handler 中 stepId early return **之前** 新增 per-run first-content 检查和 `REQUEST_FIRST_CONTENT_DELIVERED` observation 生成逻辑，收集到返回数组中。在 `clearRunState` 中新增 `firstContentDelivered.delete(runId)` 清理。
  来源：design `修改方案 1`
  验证：task 1.1-1.5 测试全部通过。

- [x] 2.5 在 `packages/agent-observability/src/metrics/metric-descriptors.ts` 中新增 `request_first_content_latency_seconds` descriptor。
  来源：design `修改方案 2`
  验证：`npm run build` 通过。

- [x] 2.6 在 `packages/agent-observability/src/metrics/metrics-registry.ts` 的 `metricSamplesForObservation` 中新增 `REQUEST_FIRST_CONTENT_DELIVERED` 分支。
  来源：design `修改方案 3`
  验证：task 1.6 测试通过。

- [x] 2.7 在 `packages/agent-observability/src/logging/structured-log-projector.ts` 的 `mapEvent` 中新增 `REQUEST_FIRST_CONTENT_DELIVERED` 到 `request.first_content_delivered` 映射。
  来源：design `修改方案 4`
  验证：task 1.7 测试通过。

### 3. 整体验证

- [x] 3.1 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  验证：全部通过。

- [x] 3.2 运行 `openspec validate add-ts-request-first-content-latency --strict` 和 `openspec validate --all --strict`。
  验证：全部通过。
