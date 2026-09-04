## 背景

`parallel-gateway` 需要处理并发分支激活、join barrier、安全诊断，以及潜在的 waiting branch、budget 和恢复语义。它的复杂度高于基础 gateway 节点。

初始 change 将其从 `workflow-gateway-nodes` 拆分出来，以保持基础 gateway change 的聚焦。本地执行引擎现已增强，支持真正的并发 fork / join。

## 目标 / 非目标

**目标：**
- 在本地引擎中为 `parallel-gateway` 提供并发 fork / join 执行
- 通过 `inputs` 支持可配置的 join 行为：`join_node`、`join_on_failure`、`join_timeout`
- 为零命中和 join 无法解析场景保持安全失败

**非目标：**
- 不做分布式调度或跨实例 barrier
- 不做分支 budget / snapshot / recovery（延期至后续 change）
- 不做 `branchId` 追踪（延期）

## 设计决策

1. **并发执行**：所有命中分支通过 `Promise.allSettled` 同时启动。每个分支接收相同的输入变量。输出在所有分支 settle 后按分支声明顺序合并。
2. **Wait 策略（默认）**：当 `join_on_failure` 为 `"wait"` 或未指定时，引擎等待所有分支完成；至少一个分支正常到达 join 即整体 COMPLETED，全部分支失败才 FAILED。
3. **Break 策略**：当 `join_on_failure` 为 `"break"` 时，引擎在首个分支失败后通过共享的 `AbortController` 立即 abort 其余分支，整体 FAILED。
4. **Join 超时**：`join_timeout` 未指定时默认 600 秒；定时器在指定时长后 abort 所有未完成分支，整体 FAILED。
5. **Join 节点解析**：当提供 `inputs.join_node` 时覆盖自动解析；未指定时默认解析为各分支公共 end_node，无公共 end_node 则 safe failure。
6. **单分支退化**：当仅一个分支条件满足时，handler 返回 `BRANCH` transition 而非 `FORK_JOIN`。
7. **FORK_JOIN transition 扩展**：transition 类型携带 `joinOnFailure` 和 `joinTimeout` 从 handler 传递到 engine，保持 input 解析在 handler、执行在 engine 的职责分离。

## 质量属性

| 质量属性 | 设计结论 | 验证方式 |
|---|---|---|
| 安全性 | 安全失败附带 reason code；诊断信息不含 payload | `npm run test:contract` |
| 性能 | 并发分支执行降低 I/O 密集型分支的总延迟 | execution-engine tests |
| 可靠性 / 恢复 | 第一版不做 snapshot/recovery；延期至后续 change | code review |
| 可维护性 | Join 配置在 handler 解析、在 engine 执行；fork/join 单一 owner | OpenSpec review |
| 可测试性 | 并发执行、break、wait、timeout 均有测试覆盖 | `npm test` |
| 可审计 / 可追溯 | Spec owner 明确；实现入口已文档化 | OpenSpec review |

## 验证映射

| 约束 | Task | 验证方式 |
|---|---|---|
| 并发 fork/join | 2.1 | execution-engine tests |
| Join 配置 inputs | 2.2 | execution-engine tests |
| Break 失败策略 | 2.3 | execution-engine tests |
| Wait 失败策略 | 2.4 | execution-engine tests |
| Wait 容错成功（部分分支失败） | 2.4 | execution-engine tests |
| 默认 join_on_failure=wait | 2.4 | execution-engine tests |
| Join 超时 | 2.5 | execution-engine tests |
| 默认 join_timeout=600s | 2.5 | execution-engine tests |
| join_node 缺省解析为 end_node | 2.2 | execution-engine tests |
| 安全失败 reason code | 2.6 | execution-engine tests |
| 无高级恢复语义 | 3.1 | code review |
| 无跨分支依赖 | 3.2 | execution-engine tests |

## 文档归属

- 行为契约：`specs/workflow-parallel-gateway/spec.md`
- 架构设计：`openspec/designs/architecture/workflow-contracts.md`（归档前更新）
- 模块设计：`openspec/designs/modules/agent-workflow.md`（归档前更新）
- ADR：无
- 导航：`openspec/designs/spec-to-design-map.md`（归档前更新）

## 风险 / 取舍

- [风险] 并发变量合并：若两个分支写同一个 key，按声明顺序后写入的覆盖先写入的。这是并发执行的预期行为，已在 spec 中文档化。
- [风险] 无分支级取消传播到下游服务。分支接收 aborted 信号；是否配合取决于 node handler 是否检查 `signal.aborted`。
- [取舍] `Promise.allSettled` 在 `break` 模式下仍等待所有分支。被 abort 的分支应快速返回，但不检查 abort 信号的不规范 handler 可能延迟 join。
- [风险] 并发分支内的跨分支 `dependsOn` 不安全，因为所有分支共享同一个 `nodeResults` 数组，`assertDependenciesSatisfied` 可能产生竞态。spec 将此文档化为约束：跨分支依赖仅在 join 节点之后有效。

## 迁移计划

无。先前的顺序 fork/join 是内部实现细节，未暴露在公开契约中。

## 基线提升计划

- `openspec/specs/workflow-parallel-gateway/spec.md`
- `openspec/designs/architecture/workflow-contracts.md`
- `openspec/designs/modules/agent-workflow.md`
- `openspec/designs/spec-to-design-map.md`

## 待解问题

无。
