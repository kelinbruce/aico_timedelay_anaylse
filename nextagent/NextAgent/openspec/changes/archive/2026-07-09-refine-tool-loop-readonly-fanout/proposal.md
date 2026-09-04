# Proposal: 按工具危险性分级放宽 tool loop 每轮 fan-out 并改为可恢复

## 修改的 Capability

- `ts-minimal-agent-kernel`（修改）：tool loop 每轮 tool call 上限由"全批统一上限 5、超额即 terminal 失败"改为按工具危险性分级——只读 capability 独立放宽上限，副作用 capability 维持原上限；正预算超额由 terminal 失败改为可恢复重试，零预算（`model-only` / `maxToolCalls=0`）维持硬失败。

## 现状与问题

电信网络诊断任务常在单轮内并行读取多份配置/代码（例如一次返回 9 个 `Read`）。当前 `agent-core` tool loop 在 `executeToolCallsInOrder` 入口对整批 tool call 做统一上限检查：`toolCalls.length > maxCalls`（`maxCalls` 默认 5、schema 上限 5）即抛 `TOOL_CALL_LIMIT_EXCEEDED`（`retryable: false`），导致整轮零执行并以 `REQUEST_FAILED` 终态结束。该规则把无副作用、已被逐个 risk policy / forbidden capability 校验的只读调用与有副作用的调用一视同仁，频繁误杀合法的并行只读信息收集。

参考 Claude Code：它对 tool call 数量不设硬上限，只读工具与副作用工具按"并发安全"分区，副作用工具靠 per-call 权限门把关；服务端多租户场景下完全照搬并不可行（缺人工逐条权限门、需 fan-out 限界与成本护栏），但"只读无副作用一类可放宽"的思路成立。

## 目标

- 只读 capability（`Read`、`Grep`、`Glob`）每轮 fan-out 独立放宽到 `maxReadOnlyToolCallsPerRound`（默认 20、上限 20），不再受 `maxToolCallsPerRound=5` 约束。
- 副作用 capability 维持 `maxToolCallsPerRound`（默认 5、上限 5）。
- 两类上限独立计数；`model-only` 或 `maxToolCalls=0` 时两类上限同时为 0，任何 tool call 都不执行。
- 正预算超额（`maxCalls>0` 且某类计数超上限）改为可恢复：零执行 + 发布 `DEGRADATION_NOTICE` + 追加 model-visible 纠正消息后重新进入模型 round；连续超额达到 `toolCallLimitRecoveryLimit=3` 才以 safe `REQUEST_FAILED` 结束。
- 保留既有不变量：超额轮不得执行任何 tool call、不得持久化无对应 tool result 的 assistant tool-use 消息；`forbiddenCapabilityIds`、risk policy、sandbox、lifecycle hook、safe error、terminal 语义不变。

## 非目标

- 不把只读上限做成无限（服务端保留 20 的成本/DoS 护栏），不照搬 Claude Code 的"完全不限"。
- 不新增 routing constraint schema 字段（`maxReadOnlyToolCalls` 不进入 `RoutingConstraints`，仅作为 `DefaultAgent` 依赖与 governor 内部产出）。
- 不改 `maxToolCalls` 的 schema 上限 5、不改 `maxToolRounds=50`。
- 不改 `AskUserQuestion`/authorization/confirmation/human handoff pending input 生命周期。
- 不改 capability contract、不新增 public tool invocation protocol、不新增持久化表。

## 受影响的 stable spec / design

- `openspec/specs/ts-minimal-agent-kernel/spec.md`：`最小 Capability Tool 集合` requirement 中的 `tool loop 受最小上限约束` scenario 被重写为分级上限 + 可恢复语义。
- `openspec/designs/modules/agent-core.md`：tool loop 上限分级与可恢复重试落点。
- `openspec/designs/spec-to-design-map.md`：导航更新。

## 依赖与冲突说明

`openspec/changes/refine-ts-tool-loop-fallback-round-limit`（任务已全部完成、待归档）同样 MODIFY 了 `最小 Capability Tool 集合` requirement。为避免两个 active change 同时 MODIFY 同一 requirement 导致 `openspec validate --all --strict` 冲突，**应先归档 `refine-ts-tool-loop-fallback-round-limit`，再应用本 change**。本 change 的 MODIFIED requirement 以 `maxToolRounds=50` 为基线（与该待归档 change 一致）。

## 归档前更新基线

- `openspec/specs/ts-minimal-agent-kernel/spec.md`：并入分级上限与可恢复重试语义。
- `openspec/designs/modules/agent-core.md`：并入 tool loop 分级上限、零预算硬失败、正预算可恢复重试与 `READONLY_CAPABILITY_IDS` 静态白名单落点。
- `openspec/designs/spec-to-design-map.md`：补充导航与验证入口。
- overview / architecture / adr：不受影响。
