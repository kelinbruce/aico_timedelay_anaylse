## 背景和现状（Context）

当前 `agent-core` 的 tool loop 在一个模型 round 返回多个 tool call 时按模型顺序逐个执行。该实现易于推理，但会让互不依赖的工具调用串行等待。电信网络诊断任务常见的并列信息收集，例如读取多份配置、查询多类告警线索、执行多个只读检索工具，本质上可以在同一 round 内并发执行。

现有实现与本 change 目标之间的 gap 是：`packages/agent-core/src/tools/tool-loop.ts` 的 `executeToolCallsInOrder` 使用 `for ... await` 逐个调用 capability invocation boundary；同轮后一个 tool call 必须等待前一个 tool call 完成后才会启动。稳定规格中 `AskUserQuestion` 已经定义了 pending-input 工具的特殊顺序语义，因此本 change 不能把 pending-input producer 和普通工具混成一批并行执行。

相关约束：
- `agent-core` 拥有 Agent 内部 request routing 和 tool loop orchestration。
- capability 执行必须继续通过 `CapabilityInvocationPort`，不能直接调用 Tool implementation。
- 每轮 `maxToolCalls` 上限仍由 routing constraint 和 schema 治理，当前最大为 5。
- runtime/session/terminal commit 语义不属于本 change 的修改范围。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 支持同一模型 round 中多个 ordinary tool call 的受控并行 capability invocation。
- 保留 `maxToolCalls`、`maxToolIterations`、routing constraints、risk policy、lifecycle hook、sandbox boundary、safe error 和 terminal consistency。
- 保证下一轮模型看到的 tool result 顺序与模型返回的 tool call 顺序一致。
- 补充 deterministic unit/contract/e2e 覆盖，证明并行启动、顺序回填、失败保留和 pending-input 互斥。

**非目标：**
- 不提升每轮最多 5 个 tool call 的治理上限。
- 不新增用户配置、Web API、runtime command、持久化表或 public Tool invocation protocol。
- 不实现跨 request/run 的全局 tool worker pool。
- 不改变 `AskUserQuestion`、authorization、confirmation、human handoff 等 runtime-owned pending input lifecycle。
- 不为工具副作用推断模型意图；同一 round 的 ordinary tool call 按模型返回的同批行动处理，具体共享状态一致性由对应 Tool dependency 或 capability owner 负责。

## 设计决策（Decisions）

1. **唯一实现路径：在 `agent-core` tool loop 内做批内并行。**  
   继续使用现有 `CapabilityInvocationPort.invoke(...)`。`agent-core` 只改变同一模型 round 内多个 ordinary tool call 的调度方式，不新增 capability contract，不让 runtime 或 channel 参与工具并行。

2. **每轮先做上限检查，再进入任何调度。**  
   `toolCalls.length > maxCalls` 时保持现有 `TOOL_CALL_LIMIT_EXCEEDED` 行为，并且不得启动任何 tool call。该规则避免并行能力绕过 routing constraint。

3. **pending-input producer 保持串行/互斥。**  
   当 batch 中出现 `AskUserQuestion` 这类会创建 runtime-owned pending input 的工具时，tool loop 按模型顺序处理到该 call：该 call 之前的 ordinary tool call 可以作为一个前缀批次并行完成；该 call 创建 pending input 后立即返回 `PENDING_INPUT`；该 call 之后的 tool call 不被解析或调用，直到 run resume。这样与既有 `AskUserQuestion` 规格保持一致。

4. **ordinary batch 使用 prepare -> invoke -> finalize 三阶段。**  
   - prepare：按模型顺序解析 capability descriptor、检查 forbidden capability、`allowSubagents`、sandbox readiness evidence、risk policy，并执行必须位于 invocation 前的 checkpoint/lifecycle hook。prepare 失败时不启动该 batch 的 capability invocation。
   - invoke：对 prepare 成功的 ordinary tool call 创建 promise，并用同一个请求级 `AbortSignal` 调用 `CapabilityInvocationPort.invoke(...)`。实现必须等待所有已启动 promise settle，不能在第一个失败后遗留后台执行。
   - finalize：按原始 tool call 顺序校验 result、追加 model-visible capability result message、合并 `requestLocalState`、执行 after-capability hook、记录 completion/degradation evidence。完成顺序只影响 duration，不影响下一轮模型输入顺序。

5. **失败处理按失败类型分层。**  
   `CapabilityInvocationResult.status` 为 `FAILED` 或 `TIMED_OUT` 时，先按原始顺序写入该 tool call 的 failed tool result；同批其他 successful/degraded result 仍被保留。若失败类别按既有 `shouldTerminateCapabilityFailure` 需要终止请求，则 finalize 完本批已 settled 结果后抛出对应 `AgentError`。  
   如果 invocation 抛出异常、result envelope 不安全或请求级 `AbortSignal` 触发，tool loop 等待同批已启动调用 settle 后按原始顺序选择第一个 fatal error 抛出；请求终态继续由既有 runtime safe error/terminal path 处理。

6. **保持导出兼容，必要时内部改名。**  
   现有测试和调用方使用 `executeToolCallsInOrder`。本 change 不强制改 public export 名称；可以在内部新增 `executeOrdinaryToolCallsInParallel`、`prepareToolCallPlan` 等 helper。若新增更准确的导出名，旧导出必须保留为兼容入口。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 不新增工具权限，不改变 capability resolver/executor/sandbox/risk policy；prepare 失败不启动 ordinary batch invocation；pending-input producer 不并行。 | unit tests 覆盖上限拒绝、risk policy deny 不调用 capability、AskUserQuestion 后续工具不启动；`npm run lint:architecture` |
| 性能/容量 | 单个模型 round 内最多并行启动当前 `maxToolCalls` 个 ordinary invocation，实际最大仍为 5；不引入全局 worker pool。 | controlled-latch unit test 证明第二个 invocation 不等待第一个完成；e2e 验证同轮多工具总耗时低于串行阈值 |
| 可靠性/恢复 | 使用 `Promise.allSettled` 等待所有已启动 invocation，避免后台 promise 逃逸；finalize 按原始顺序写 result，terminal failure 继续走既有 `AgentError`。 | unit tests 覆盖失败结果保留、fatal error 后无未等待 promise；`npm test` |
| 可维护性 | 变更集中在 `agent-core/src/tools/tool-loop.ts`，不引入新 package 依赖或 public contract；helper 以 prepare/invoke/finalize 分层。 | `npm run lint:architecture`、代码审查 |
| 可测试性 | 使用可控 deferred promise/latch 测试并行启动和顺序回填；e2e 使用测试模型返回同轮多个工具。 | `vitest run packages/agent-core/tests ...`、`npm run test:e2e:alpha` 或新增 e2e 入口 |
| 审计/可追溯性 | 继续发出既有 capability start/completed/degradation evidence；并行不新增 event vocabulary。runtime log 补充同轮 batch ordinal/size，并区分 invocation duration 与 ordered-finalize wait duration；result message 顺序保持模型顺序。 | unit/e2e 断言 event、message 和 runtime log；`npm run test:contract` |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 同轮 ordinary tool call 在等待任一 invocation 完成前全部启动 | 2.1 | `vitest run packages/agent-core/tests/parallel-tool-loop.test.ts` |
| tool result 按模型返回顺序回填 | 2.2 | `vitest run packages/agent-core/tests/parallel-tool-loop.test.ts` |
| 单个 safe failed result 不丢弃同批其他结果 | 2.3 | `vitest run packages/agent-core/tests/parallel-tool-loop.test.ts` |
| `AskUserQuestion` pending-input 后续 tool call 不被并行调用 | 2.4 | `vitest run packages/agent-core/tests/parallel-tool-loop.test.ts` |
| 并行 runtime log 可定位批次内具体 tool call 并区分 invoke/finalize 等待耗时 | 2.5 | `vitest run packages/agent-core/tests/parallel-tool-loop.test.ts` |
| e2e 覆盖同轮多工具并行行为 | 3.1 | `npm run test:e2e:alpha` 或仓库现有 e2e 命令中的新增测试文件 |
| OpenSpec 和架构边界保持有效 | 4.1 | `openspec validate --all --strict`、`npm run lint:architecture` |
| 全量构建与测试门禁 | 4.2 | `npm run build`、`npm test`、`npm run test:contract` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-minimal-agent-kernel/spec.md` 主承载 Agent loop 同轮并行、顺序回填、失败保留和 pending-input 互斥；`openspec/specs/builtin-tool-framework/spec.md` 主承载 Tool invocation 可重叠执行和调用隔离。
- 架构和跨模块设计：`openspec/designs/architecture/request-run.md` 主承载 request run 内模型 round -> tool batch -> next model round 的跨模块流程。
- 模块设计：`openspec/designs/modules/agent-core.md` 主承载 tool loop prepare/invoke/finalize 职责；`openspec/designs/modules/agent-capability.md` 主承载 capability invocation boundary 可被并行调用但 contract 不变的事实。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md` 归档前补充上述 spec 到 design 的导航。

## 风险与取舍（Risks / Trade-offs）

- [风险] 并行执行让同一 round 内的工具副作用可能重叠。 -> 每轮最多 5 个；pending-input producer 互斥；Tool 或 controlled dependency 必须保护自身共享状态；本 change 不让 Agent core 推断工具间依赖。
- [风险] completion event 顺序与 result message 顺序可能不同。 -> 设计要求 model-visible result message 按原始顺序，completion evidence 保留各自 toolCallId 和 duration。
- [风险] 第一个 fatal error 出现时其他已启动调用仍在运行。 -> 实现必须等待全部已启动调用 settle 后再返回/抛错，避免后台执行脱离 request lifecycle。
- [取舍] 不新增并行度配置。 -> 当前 per-round 上限已被 schema 限定在 5，新增配置会扩大治理面，不是本需求必需。

## 迁移计划（Migration Plan）

无数据迁移。发布风险集中在 tool loop 行为改变；回滚方式是恢复 `agent-core` tool loop 的串行执行实现，同时保留 OpenSpec change 未归档状态以便重新设计。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-minimal-agent-kernel/spec.md`：并入同轮 ordinary tool call 并行执行、顺序回填、失败保留、取消传播、pending-input 互斥和上限不变。
- `openspec/specs/builtin-tool-framework/spec.md`：并入 Tool invocation 可重叠执行、调用隔离和不新增 Tool-specific public protocol。
- `openspec/designs/architecture/request-run.md`：补充模型 round 内 tool batch execution 流程。
- `openspec/designs/modules/agent-core.md`：补充 tool loop prepare/invoke/finalize 分层职责。
- `openspec/designs/modules/agent-capability.md`：补充 capability invocation boundary 在同一 round 中可被并行调用的消费方式。
- `openspec/designs/spec-to-design-map.md`：补充导航和验证入口。

## 待确认问题（Open Questions）

无。
