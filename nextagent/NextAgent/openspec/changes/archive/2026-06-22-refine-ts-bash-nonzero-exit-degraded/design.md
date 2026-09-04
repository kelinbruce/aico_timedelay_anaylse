## 背景和现状（Context）

当前 Bash tool 的实现把 sandbox 返回的非零 exit code 视为 capability failure：`bash-tool.ts` 在 exit code 非 0 时抛出 `ToolFailedResultError(..., "SANDBOX_EXECUTION_FAILED", "INTERNAL")`，`BuiltinToolsExecutor` 将其包装成 `CapabilityInvocationResult.status="FAILED"`，`agent-core/tool-loop.ts` 随后按 `FAILED + INTERNAL` 立即终止 run。

这条路径的直接结果是：

- 模型拿不到已经有界且可安全暴露的命令执行结果；
- 同一次 request 内无法根据 stderr/stdout 做自修正；
- Bash 与 Python tool 的非零退出语义不一致，工具体验分裂。

现有架构并不缺少“可继续的失败结果”通道。`CapabilityInvocationResult.status="DEGRADED"` 已经是 stable contract，`agent-core` 也已支持 “发出 degradation notice，同时把 structured payload 作为 tool result 继续喂给模型”。因此本次问题不需要引入新的 result DTO、tool-loop 分支或 runtime 状态，只需要把 Bash 对非零退出的语义映射收敛到既有 `DEGRADED` 通道。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 将 Bash 的“命令已执行但 exit code 非 0”改为 `DEGRADED` 结构化结果。
- 保证该结果继续进入当前 request 的 tool result / context assembly / 后续模型步骤。
- 保持真正的执行边界失败继续终止 run，避免把平台或安全错误误降级成普通命令结果。
- 让 Bash 与 Python tool 在“非零退出仍是结构化结果”这个维度上保持一致。

**非目标：**

- 不修改 risk policy、sandbox gateway contract 或 `CapabilityInvocationResult` contract。
- 不改变 timeout、policy rejection、platform unsupported、sandbox unavailable、invalid response shape、output overflow 的终止语义。
- 不新增用户可见 stream event 类型，也不修改 terminal run status contract。

## 设计决策（Decisions）

1. **唯一选定方案：Bash 非零退出改为 `DEGRADED`，并保留现有 structured payload shape。**
   - 在 `packages/agent-capability/src/builtins/bash/bash-tool.ts` 中，exit code 非 0 不再抛 `ToolFailedResultError`，而是抛 `ToolDegradedResultError`。
   - `structuredPayload` 继续使用已有 Bash business output shape：`stdout`、`stderr`、`exitCode`、`stdoutTruncated`、`stderrTruncated`。
   - `reasonCode` 继续使用稳定 code `SANDBOX_EXECUTION_FAILED`，这样 `agent-core` 和 stream 投影还能产生可追踪的 degradation notice。

2. **只放宽“命令已执行并返回非零 exit code”这一类业务失败。**
   - timeout 仍走 `ToolTimedOutResultError`
   - output overflow 仍走 failed result
   - invalid sandbox response shape 仍走 validation failure
   - platform unsupported / sandbox unavailable / canceled 仍保持 safe failed outcome

3. **不新增 tool-loop 特判。**
   - 选用现有 `DEGRADED` 消费路径，避免在 `agent-core` 新增 “Bash 特例”。
   - 这样修改局限在 `agent-capability` 的结果分类，符合“同形同策”：已经有结构化 payload 的可继续结果统一走 `DEGRADED`。

4. **失败结果持久化增强与本 change 兼容但不是核心机制。**
   - 当前仓库已补了 failed `CAPABILITY_RESULT` 保存 `payload.result` 的实现，它对平台失败等仍有价值。
   - 本次 change 不依赖该增强来实现“继续喂给模型”；真正让模型继续的是 `DEGRADED` 语义本身。

5. **放弃的备选方案：保持 `FAILED`，但把 category 改成 recoverable 或 `retryable=true`。**
   - 该方案虽然改动小，但语义扭曲：命令已执行且业务失败，并不是输入校验失败或临时可重试。
   - 继续保留 `FAILED` 也会让 capability 结果语义更难理解，不如直接复用已经存在的 `DEGRADED` 通道。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 只放宽已进入 sandbox 后的非零 exit code；policy rejection、sandbox unavailable、platform unsupported 等边界失败不降级为业务结果。继续只暴露有界 `stdout/stderr` 与稳定 safe reason code。 | `packages/agent-capability/tests/bash-capability.test.ts` negative cases；`tests/agent-kernel/tool-loop.test.ts` |
| 性能/容量 | 不新增模型轮次上限、stream 事件类型或额外持久化表；仅复用既有 `DEGRADED` 路径。payload 仍受现有限长约束。 | 既有 `assertCapabilityResultSafe` 路径；`tests/agent-kernel/tool-loop.test.ts` |
| 可靠性/恢复 | 非零退出不再错误终止可恢复的工具轮；真正的边界失败仍然终止 run，避免恢复语义被稀释。 | `tests/agent-kernel/tool-loop.test.ts`；Bash contract tests |
| 可维护性 | 不新增 Bash 特殊消费分支，只在 result mapping 层修正分类，保持 `agent-core` 通用结果消费模型不变。 | code review 检查点：`bash-tool.ts` 使用 `ToolDegradedResultError`；`tool-loop.ts` 无 Bash 特例 |
| 可测试性 | 通过 Bash capability tests 断言分类，通过 tool-loop characterization 断言 `DEGRADED` 会继续进入后续模型步骤。 | `npm test -- --run packages/agent-capability/tests/bash-capability.test.ts tests/agent-kernel/tool-loop.test.ts` |
| 审计/可追溯性 | 仍使用稳定 reason code `SANDBOX_EXECUTION_FAILED` 和既有 degradation notice；不新增 raw command/raw output 审计面。 | Bash tests + stream/tool-loop tests；code review 检查点：无新增原始输出泄露 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Bash 非零 exit code 必须映射为 `DEGRADED` structured result | 1.1 | `npm test -- --run packages/agent-capability/tests/bash-capability.test.ts` |
| 真正的 sandbox/platform failure 仍必须保持 failed/timed-out outcome | 1.2 | `npm test -- --run packages/agent-capability/tests/bash-capability.test.ts` |
| `DEGRADED` Bash 结果必须继续进入后续模型步骤 | 2.1 | `npm test -- --run tests/agent-kernel/tool-loop.test.ts` |
| 不得新增 Bash 特例 tool-loop 终止/继续规则 | 2.2 | code review 检查点：`packages/agent-core/src/tools/tool-loop.ts` 无 capability-specific 分支 |
| 变更文档与实现必须一致并可归档 | 3.1 | `openspec validate --all --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/bash-tool/spec.md`
- 架构和跨模块设计：无新增主承载；现有 `openspec/designs/architecture/capability-spi.md` 已承载 `DEGRADED` 通道
- 模块设计：如 archive 时确认需要补充执行类 tool 的结果映射一致性，则由 `openspec/designs/modules/agent-capability.md` 主承载
- ADR：无
- 导航：如 archive 时新增模块设计更新，则同步 `openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] 某些既有测试或调用方可能依赖 Bash 非零退出立即终止 run。 -> 通过 characterization tests 明确只有“命令已执行且非零退出”改为继续；平台/边界失败保持终止。
- [风险] 降级后模型可能多走一轮，带来额外 token 消耗。 -> 保持既有 tool round / call limit，不新增无限恢复通道。
- [取舍] 选择 `DEGRADED` 而不是 `FAILED + retryable`。 -> 语义更准确，也更符合现有 stable capability contract。

## 迁移计划（Migration Plan）

无。该变更只影响当前 active change 代码路径与行为契约，不涉及数据迁移或发布顺序调整。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/bash-tool/spec.md`：同步 Bash 非零 exit code 作为 degraded structured result 的稳定行为
- `openspec/designs/modules/agent-capability.md`：如归档评审认为需要保留“执行类 tool 结果分类一致性”设计事实，则补充模块设计
- `openspec/designs/spec-to-design-map.md`：仅在上项发生时更新导航
- 其余长期文档无必需更新

## 待确认问题（Open Questions）

无
