## 0. 公共契约升级确认

- [x] 0.1 确认采用公共 `HookResult.resultSummary?: JsonObject` 作为唯一输出入口，并保持 `HOOK_INVOKED` timeline-only；不扩展 `mutationSummary`，不新增 Hook stream event、专用 `HookResultSummary` 类型或结果处理层
  来源：用户确认“`resultSummary` 提供 Hook 执行后结果输出，不要额外处理”；proposal `What Changes`；design `修改方案 / 1. 公共契约直接复用 JsonObject`
  验证：OpenSpec review 必须确认公共核心契约变更边界、owner、非目标和 breaking consumer 迁移均已明确
  结果：`$nextagent-skill-review` 确认公共契约批准证据、runtime owner、timeline-only 边界、breaking consumer 迁移和非目标完整，结论 PASS

## 1. `FN-10.1 注册和执行钩子`

- [x] 1.1 先补公共 contract 与 kernel characterization：证明当前 `HookResult` 不能携带 `resultSummary`，并固定既有 `HOOK_INVOKED` timeline-only、`mutationSummary` 只含 mutation kind/字段名、background model Hook 不合成 request-run event 的行为
  来源：proposal `Why`、`目标与非目标`；Requirement `Hook 结果可以直接携带执行后结果输出`；design `当前实现`、`GAP 分析`
  验证：`npm run test:contract`；`npx vitest run --config vitest.config.release.ts tests/agent-kernel/lifecycle-hook-execution-core.test.ts tests/agent-kernel/lifecycle-hook-execution-failure.test.ts tests/agent-kernel/run-status-visibility.test.ts`；预期新增 contract 断言实施前失败，既有边界断言通过
  结果：新增断言实施前产生预期 7 个失败；实施后 `npm run test:contract` 通过 48 files / 371 tests，聚焦 Hook/Channel 回归通过 5 files / 88 tests

- [x] 1.2 在 `agent-contracts/runtime` 的两个 `HookResult` union branch 增加唯一的 `resultSummary?: JsonObject`，由 `agent-plugin-sdk` 复用现有 public export；不得新增 `HookResultSummary`、平行 DTO 或 private import
  来源：Requirement `Hook 结果可以直接携带执行后结果输出` + Scenarios `Hook 返回的结果对象被原样接受`、`Hook 可以省略结果输出`；design `修改方案 / 1. 公共契约直接复用 JsonObject`
  验证：`npm run build && npm run test:contract`；预期合法嵌套 JSON object 可编译，非 object 静态类型被拒绝，SDK 与 runtime contract 单一来源
  结果：`npm run build` 与 `npm run test:contract` 退出码为 0；contract test 覆盖合法 object 和非 object `@ts-expect-error`，SDK 继续直接 re-export runtime `HookResult`

- [x] 1.3 在既有 `LifecycleHookStageExecutor` 结果校验入口验证可选 `resultSummary` 的 JSON object 合法性，并复用 runtime persisted event 的既有 `49_000 bytes` inline payload 上限检查完整待写 event；非法结果统一产生 `LIFECYCLE_HOOK_RESULT_INVALID`，在任何 mutation、control 或 pending effect 应用前失败
  来源：Requirement `Hook 结果可以直接携带执行后结果输出` + Scenario `非法结果输出使整个 Hook 结果无效`；design `修改方案 / 2. effect 应用前只校验 JSON 与完整 event 容量`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/lifecycle-hook-execution-core.test.ts tests/agent-kernel/lifecycle-hook-execution-pending.test.ts tests/agent-kernel/lifecycle-hook-execution-failure.test.ts packages/agent-runtime/tests/run-state-inline-payload-degradation.test.ts`；预期 null/array 顶层、undefined/function/symbol/bigint/NaN/Infinity、循环引用和完整 event 超限均被触发并断言无部分 side effect，合法边界仍持久化
  结果：聚焦 release suite 通过 17 files / 326 tests；非法 JSON、循环引用、稀疏数组、Date 和完整 event 超限均记录 `INVALID_RESULT`，控制结果未生效

- [x] 1.4 从同一个 validated Hook result 直接把 `resultSummary` 赋值给同一条 `HOOK_INVOKED.inlinePayload.resultSummary`；允许仅为异步事实稳定性生成 JSON 语义等价的 detached value，不得新增摘要生成、字段筛选/改名、转换、裁剪、脱敏、补全、排序或业务 mapper
  来源：Requirement `Hook 结果可以直接携带执行后结果输出` + Scenario `Hook 返回的结果对象被原样接受`；Requirement `Hook 结果输出必须由 Hook 明确负责 timeline 安全性` + Scenario `Runtime 不改写 Hook 提供的结果输出`；design `修改方案 / 2`、`3`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/lifecycle-hook-execution-core.test.ts tests/agent-kernel/lifecycle-hook-execution-pending.test.ts`；预期包含 Unicode key/value、嵌套 object/array、string/number/boolean/null 的对象与 event 值 JSON 语义等价，Hook 返回后 mutation 不改变已记录值
  结果：Bash `a:1, b:2` 黑盒路径及嵌套 Unicode/array/scalar/null 对象保持 JSON 语义等价；实现仅进行 JSON validation/detach 后直接赋值，无内容 mapper

- [x] 1.5 收敛普通和 trusted terminal Hook 的 `HOOK_INVOKED` 状态语义：所有应形成 timeline fact 的 invocation 写 resolved `failureMode`；成功写真实 `outcome` 和可选 `resultSummary`；timeout、throw/unavailable、invalid-result 写对应非成功 `status` 并省略 `outcome/resultSummary`；保持 `mutationSummary` 和 background model 边界不变
  来源：Requirement `Every hook invocation produces a timeline-only observability fact` + Scenarios `Hook 结果输出进入同一条 invocation fact`、`省略结果输出时事件不合成字段`、`非成功 invocation 不伪造控制结论`；Requirement `Lifecycle-changing hook outcomes are recorded in HOOK_INVOKED without default client projection`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/lifecycle-hook-execution-core.test.ts tests/agent-kernel/lifecycle-hook-execution-failure.test.ts tests/agent-kernel/lifecycle-hook-execution-pending.test.ts tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts tests/agent-kernel/lifecycle-hook-trusted-terminal.test.ts tests/agent-kernel/user-query-memory-recall-integration.test.ts`；预期 success/failure truth table、pending correlation、mutation summary 和既有 diagnostics 全部通过
  结果：聚焦 release suite 通过 17 files / 326 tests；普通与 trusted terminal 的 success/timeout/failure/invalid-result truth table 均通过

- [x] 1.6 新增 Channel negative case：携带任意合法 `resultSummary` 的 `HOOK_INVOKED` 仍返回 `TIMELINE_ONLY`，不进入 `StreamEventType`、SSE/WebSocket envelope 或 Web run-event history response
  来源：Requirement `Hook 结果输出必须由 Hook 明确负责 timeline 安全性`；Requirement `Lifecycle-changing hook outcomes are recorded in HOOK_INVOKED without default client projection`；design `修改方案 / 4. 保持 timeline 与 Channel 单一边界`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-channel-common/tests packages/agent-channel-web/tests/session-event-history-route.test.ts tests/agent-kernel/run-status-visibility.test.ts`；预期 `HOOK_INVOKED` 在所有公开 Channel surface 均不可见，既有公开事件无回归
  结果：携带 `{ a: 1, b: 2 }` 的 `HOOK_INVOKED` 投影结果仍为 `TIMELINE_ONLY`，Web run-event history negative case 通过

## 2. Change 整体验证

- [x] 2.1 完成公共契约、runtime lifecycle、timeline-only observability、Plugin SDK、开发工作台与 Channel 隔离的定向回归；确认不存在兼容 alias、重复 validator、平行 DTO、字段级 summary schema、内容 mapper、`mutationSummary` 语义扩大或普通 Agent Web 投影
  来源：proposal `目标与非目标`、`影响范围`；design `修改方案`、`验证策略`
  验证：`npm run build && npm test && npm run test:contract && npm run lint:architecture && openspec validate refine-ts-hook-result-event-summary --strict && openspec validate --all --strict`；预期全部命令退出码为 0，并在 `$nextagent-code-review` / `$nextagent-skill-review` 中确认公共契约批准证据、KISS、唯一实施路径和安全边界闭合
  结果：全部命令退出码为 0；`npm test` 通过 158 files / 1976 tests，architecture 通过 49 files / 304 tests，OpenSpec 全量 247 items 通过；语义检视结论 PASS

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 stable spec、Function、Feature、architecture 和 modules；复核 `spec-to-design-map` 导航仍正确，并确认长期文档没有重复定义 `resultSummary` schema、runtime owner、timeline payload 或 Channel 可见性。
