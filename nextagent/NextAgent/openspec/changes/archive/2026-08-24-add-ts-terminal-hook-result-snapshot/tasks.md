## 0. 跨 Function 前置门禁

- [x] 0.1 确认 terminal `StreamEnvelope.payload` 使用 `hookResults | hookResultsErrorCode` 作为唯一公共输出，并保持 `HOOK_INVOKED` timeline-only；不把结果写入 `content`、assistant metadata 或 `mutationSummary`，不新增 Hook event type、history API、Gateway DTO/表、alias 或双写窗口
  来源：`FN-10.1`、`FN-2.4`；proposal `目标与非目标`、`What Changes`；design `跨 Function 协作与端到端流程`、`FN-2.4 / 备选方案`
  验证：`$nextagent-skill-review` 人工评审公共 contract 升级证据、owner、breaking 边界和非目标；预期结论 PASS，且用户本次明确要求新增该能力被记录为契约升级确认
  结果：2026-08-12 使用 `$nextagent-skill-review` 完成语义检视，确认 runtime 是 terminal truth owner、Channel 仅做共享投影，且用户已明确授权该公共 payload 升级；结论 PASS

## 1. `FN-10.1 注册和执行钩子`

- [x] 1.1 先补 Hook producer 公开安全边界的 characterization/negative tests：合法 `resultSummary` 与 persisted `HOOK_INVOKED` JSON 语义等价，Runtime 不从其他 Hook/runtime 数据合成结果，并且 `HOOK_INVOKED` event 本身仍不进入公开 stream
  来源：`FN-10.1` + 系统质量属性安全、审计/可追溯性 + Requirement `Hook 结果输出必须满足请求终态公开边界` + Scenarios `Hook 结果进入同一请求终态快照`、`Hook 省略结果时不合成输出`、`Runtime 不替 Hook 执行内容处理`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/lifecycle-hook-execution-core.test.ts tests/agent-kernel/lifecycle-hook-execution-failure.test.ts tests/agent-kernel/run-status-visibility.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts`；预期既有 Hook 事实和 Channel negative baseline 通过，新增的 terminal result 断言在实施前按预期失败
  结果：2026-08-12 聚焦回归纳入上述 4 个文件并通过；`HOOK_INVOKED` 仍为 `TIMELINE_ONLY`，新增 terminal test 证明 `{ a: 1, b: 2 }` 与嵌套 JSON 原样进入快照且未从其他运行数据合成

- [x] 1.2 审查并更新所有实际返回 `resultSummary` 的 built-in Hook，使其仅返回允许进入当前 Owner/Agent Scope terminal stream/history 的数据；不增加字段筛选、摘要、改名、转换、裁剪、脱敏或 mapper
  来源：`FN-10.1` + 系统质量属性安全 + Requirement `Hook 结果输出必须满足请求终态公开边界` + Scenarios `Hook 结果进入同一请求终态快照`、`Runtime 不替 Hook 执行内容处理`；design `FN-10.1 / 修改方案`
  验证：`rg -n "resultSummary" packages tests`，并运行 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/lifecycle-hook-execution-core.test.ts tests/agent-kernel/lifecycle-hook-execution-pending.test.ts tests/agent-kernel/user-query-memory-recall-integration.test.ts`；预期每个 producer 都有公开边界证据，通过校验的 JSON 保持语义等价，不存在新内容处理层
  结果：2026-08-12 `rg` 审查确认生产代码中没有实际返回 `resultSummary` 的 built-in Hook producer，现有命中仅为契约、executor、snapshot builder 与 Channel validator；上述 3 个测试文件随聚焦回归通过，无 producer 改动或内容处理层

- [x] 1.3 完成 `FN-10.1` 聚焦回归，确认 `HookResult`、Plugin SDK、Hook executor、`HOOK_INVOKED` 单事实、failure mode 和非成功省略 `outcome/resultSummary` 语义未因公开终态快照而改变
  来源：design `FN-10.1 / 当前实现`、`FN-10.1 / 修改方案`
  验证：`npm run build && npm run test:contract && npx vitest run --config vitest.config.release.ts tests/agent-kernel/lifecycle-hook-execution-core.test.ts tests/agent-kernel/lifecycle-hook-execution-failure.test.ts tests/agent-kernel/lifecycle-hook-execution-pending.test.ts tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts tests/agent-kernel/lifecycle-hook-trusted-terminal.test.ts`；预期命令全部退出码为 0，未出现第二 Hook 结果契约或 event
  结果：2026-08-12 `npm run build`、`npm run test:contract` 及包含上述 5 个文件的聚焦回归均退出码 0；生产 diff 未修改 `HookResult`、Plugin SDK、executor 或 `HOOK_INVOKED` shape/event vocabulary

## 2. `FN-2.4 查看请求状态`

- [x] 2.1 先为四类 terminal lifecycle 建立目标行为和 characterization tests：无 Hook 返回 `[]`，多 Hook 按 sequence 恰好返回一次，成功 Hook 原样保留 outcome/resultSummary，非成功 Hook 省略该两字段，原 terminal status/content 保持不变
  来源：`FN-2.4` + Requirement `请求终态同步返回 Hook 执行结果快照` + Scenarios `多个 Hook 按执行顺序同步返回`、`无 Hook 的请求返回空数组`、`成功 Hook 保留显式结果`、`非成功 Hook 不伪造结果`、`四类终态使用相同快照契约`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/run-status-visibility.test.ts tests/agent-kernel/terminal-consistency.test.ts tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts packages/agent-runtime/tests/cancel-terminal-content.test.ts packages/agent-runtime/tests/cancel-terminal-content-suppression.test.ts`；预期既有 terminal characterization 通过，新增 `hookResults` 断言在实施前按预期失败
  结果：2026-08-12 上述 5 个文件随聚焦回归通过；另由 `terminal-projection.test.ts` 参数化覆盖四类终态统一 `hookResults: []`，builder test 覆盖成功/非成功和 sequence 顺序，原 status/content 断言保持通过

- [x] 2.2 先补快照完整性、scope 隔离和失败降级的 negative tests：跨 Owner/Agent/session/request/run fact 不进入，多页无丢失/重复，非法 fact、读取失败/超时/不推进和 `49_000 bytes` 超限分别返回固定错误码且不返回部分数组
  来源：`FN-2.4` + 系统质量属性安全 + Requirement `Hook 终态快照必须保持作用域隔离` + Scenario `跨作用域事件不能进入快照`；系统质量属性性能/容量、审计/可追溯性 + Requirement `Hook 终态快照必须保持有界完整性` + Scenarios `较大 Hook 历史被完整聚合`、`非法 Hook fact 显式降级`、`快照超限不截断`；系统质量属性可靠性/恢复 + Requirement `Hook 终态快照不可用时必须保留原请求终态` + Scenario `历史读取失败保持原终态`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/run-status-visibility.test.ts tests/agent-kernel/terminal-consistency.test.ts packages/agent-runtime/tests/run-state-inline-payload-degradation.test.ts packages/agent-runtime/tests/hook-result-snapshot.test.ts`；预期新增 negative 断言在实施前按预期失败，既有终态与 inline payload 边界断言通过
  结果：2026-08-12 新增 builder negative tests 覆盖跨 scope、1000 条分页、不推进、非法 fact、读取异常、5000ms 超时及聚合超限；与既有边界测试共同通过，不返回部分数组

- [x] 2.3 在 `agent-runtime` 既有 terminal owner 中实现私有 Hook snapshot builder：于 `BEFORE_AGENT_TERMINAL` 完成后用可信全坐标从 sequence 0 分页读取 timeline，仅校验并直接复制允许字段，产生完整 `hookResults` 或唯一错误码，不新增内容处理层
  来源：`FN-2.4` + Requirement `请求终态同步返回 Hook 执行结果快照`、系统质量属性 Requirements `Hook 终态快照必须保持作用域隔离`、`Hook 终态快照必须保持有界完整性`、`Hook 终态快照不可用时必须保留原请求终态`；design `FN-2.4 / 修改方案 / 1. 终态提交前构建单次快照`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/run-status-visibility.test.ts tests/agent-kernel/terminal-consistency.test.ts tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts packages/agent-runtime/tests/hook-result-snapshot.test.ts`；预期无 Hook/多 Hook/分页/scope/invalid/read-failure/capacity 断言全部通过，Bash `{ a: 1, b: 2 }` 保持 JSON 语义等价
  结果：2026-08-12 私有 builder 已接在 terminal Hook 完成后，使用可信六维坐标、sequence 0、1000 条分页与 5000ms timeout；上述测试随 14 文件聚焦回归通过，原样结果断言成功

- [x] 2.4 扩展既有 terminal composite commit，使 `hookResults` 或 `hookResultsErrorCode` 与 terminal message/run/event 一次原子提交；幂等重放复用首次 persisted terminal fact，任何快照失败均不改写原 status/content/code/category/retryable
  来源：`FN-2.4` + Requirement `请求终态同步返回 Hook 执行结果快照` + Scenario `四类终态使用相同快照契约`；系统质量属性可靠性/恢复 + Requirement `Hook 终态快照不可用时必须保留原请求终态` + Scenario `历史读取失败保持原终态`；design `FN-2.4 / 修改方案 / 2. 与原终态事实一次提交`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/terminal-consistency.test.ts tests/agent-kernel/run-status-visibility.test.ts packages/agent-runtime/tests/cancel-terminal-content.test.ts packages/agent-runtime/tests/cancel-terminal-content-suppression.test.ts`；预期四类终态、原子失败、幂等重放和原终态保留断言全部通过
  结果：2026-08-12 快照结果仅进入既有 `commitTerminal(...)` 的 terminal event draft，未增加写操作；上述 4 个原子性/幂等/终态内容回归文件通过，降级码不改写原终态字段

- [x] 2.5 扩展 `agent-channel-common` 共享 terminal projector，严格验证并直接投影 persisted `hookResults | hookResultsErrorCode`；SSE、WebSocket、resume 和 REST run-event history 复用同一快照事实，conversation history 不重建，`HOOK_INVOKED` 仍 `TIMELINE_ONLY`
  来源：`FN-2.4` + 系统质量属性可靠性/恢复、可测试性 + Requirement `Hook 终态快照在实时与历史中必须一致` + Scenarios `Live 与 REST history 返回相同快照`、`Resume 复用 persisted terminal 快照`、`Conversation history 不重建 Hook 快照`；design `FN-2.4 / 修改方案 / 3. Channel 只投影 terminal fact`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/terminal-projection.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts tests/contract/session-event-history-contracts.test.ts tests/agent-kernel/run-status-visibility.test.ts`；预期同一 persisted terminal fact 在全部 surface 字段、顺序和值相同，非法 persisted terminal payload 使用既有 projection-failure 边界，conversation 与 `HOOK_INVOKED` negative case 通过
  结果：2026-08-12 共享 projector 已实施字段闭集、枚举、互斥、JSON object 和 `49_000 bytes` UTF-8 容量复验；合法快照、固定错误码、非法/超限 persisted payload、history 与 `HOOK_INVOKED` timeline-only 断言通过。校验器位于既有 `projections/` 同级文件，未新增目录或抽象层

- [x] 2.6 完成 `FN-2.4` 聚焦验证，确认 runtime lifecycle、terminal commit、Gateway timeline 读取和 Channel projection 的唯一路径已闭合，且未新增公共 `agent-contracts` DTO、持久化 shape 或 transport owner 逸出
  来源：design `FN-2.4 / 修改方案`、`验证策略`
  验证：`npm run build && npm run test:contract && npx vitest run --config vitest.config.release.ts tests/agent-kernel/run-status-visibility.test.ts tests/agent-kernel/terminal-consistency.test.ts tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts packages/agent-channel-web/tests/terminal-projection.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts`；预期全部退出码为 0，契约、原子性、scope、失败和投影断言全部通过
  结果：2026-08-12 `npm run build`、`npm run test:contract` 及上述 5 个聚焦文件均通过；`agent-contracts`、Gateway DTO/表和 transport owner 无改动，runtime-private terminal commit 入口必填 snapshot，package 根导出的 `TerminalCommitOptions` 不暴露内部类型；Channel 只共享投影

## 3. 跨 Function 集成与迁移

- [x] 3.1 完成 `HookResult.resultSummary -> HOOK_INVOKED -> terminal hookResults -> StreamEnvelope` 端到端集成：Bash 后 Hook 返回 `{ a: 1, b: 2 }` 时，同一 run 终态恰好返回一个 JSON 语义等价 entry，连接断开续传和 REST history 不变，不产生第二 Hook event 或内容处理
  来源：`FN-10.1`、`FN-2.4`；design `跨 Function 协作与端到端流程`、`跨 Function 质量属性设计`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/lifecycle-hook-execution-core.test.ts tests/agent-kernel/lifecycle-hook-execution-terminal.test.ts tests/agent-kernel/run-status-visibility.test.ts tests/agent-kernel/terminal-consistency.test.ts packages/agent-channel-web/tests/terminal-projection.test.ts packages/agent-channel-web/tests/session-event-history-route.test.ts`；预期 producer、timeline fact、terminal fact 和四个 Channel surface 使用同一 JSON 值且 invocation 计数不变
  结果：2026-08-12 上述 6 个文件随 14 文件聚焦回归通过；真实 lifecycle terminal fact 与共享 projector 均断言 `{ a: 1, b: 2 }`，权威 event 仍只有 `HOOK_INVOKED`，终态仅持久化只读快照

## 4. Change 整体验证

- [x] 4.1 完成公共 terminal contract、runtime lifecycle/terminal commit、Hook producer 安全、Gateway scope、Channel live/history 一致和架构边界的全量门禁；确认不存在部分快照、兼容 alias、平行 DTO/event/table、内容 mapper、`mutationSummary` 扩张或 conversation 投影
  来源：proposal `目标与非目标`、`影响范围`；design `验证策略`、`风险与取舍`
  验证：`npm run build && npm test && npm run test:contract && npm run lint:architecture && openspec validate add-ts-terminal-hook-result-snapshot --strict && openspec validate --all --strict`；预期全部命令退出码为 0，并由 `$nextagent-code-review` / `$nextagent-skill-review` 确认公共 contract 批准、Frozen core contract、runtime/Channel owner、security、KISS、唯一实施路径和验收证据均 PASS
  结果：2026-08-12 全部命令退出码 0：build 通过；`npm test` 159 files / 1992 tests；contract 48 files / 371 tests；architecture 49 files / 304 tests；change strict 与 all strict（248 items）通过。语义检视发现的 Channel 容量复验缺口、runtime 私有类型出口和超长投影文件增量均已修复：超限 persisted payload 进入既有 projection failure，根出口不暴露 snapshot 类型，校验器收敛到既有 `projections/` 同级文件；OpenSpec authoring gate、Frozen core、runtime/Channel owner、scope/security、KISS 和唯一实施路径复核 PASS

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按 design 的“长期基线刷新计划”先合并 `refine-ts-hook-result-event-summary`，再将本 change 归并到两个 stable specs、Functions、Features、architecture 和 modules；复核 `spec-to-design-map` 导航，并确认长期文档没有重复定义 `resultSummary`、`hookResults`、terminal owner、Channel projector 或快照失败语义。
