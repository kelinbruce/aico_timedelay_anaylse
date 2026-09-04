## 背景与问题（Why）

当智能体无法安全完成任务、需要人工判断或人工直接给出最终答复时，系统需要把当前 run 转入人工接管 pending。handoff 不能变成独立工单系统或第二套会话状态机；它必须复用 runtime-owned pending input，并保持原 run、checkpoint、terminal commit 和 stream/history 边界一致。

This change only defines the runtime answer outcome for `PendingInputKind.HUMAN_HANDOFF`. It does not define a ticketing system, operator workbench, assignment/claim flow, queue, SLA, external review platform, or operator identity model.

本 change 只定义 `PendingInputKind.HUMAN_HANDOFF` 在进入 pending 后的 answer 语义：人工可以终结原 run，也可以提供恢复指令让原 run 继续。

## 变更范围（What Changes）

- 定义 handoff answer 只支持两条路径：
  - `[["final_answer"],["..."]]`
  - `[["resume_instruction"],["..."]]`
- final answer 由 runtime 作为原 run 的 terminal answer 提交，不再调用模型继续生成。
- resume instruction 作为受控人工介入输入恢复原 run，不创建新 root request。
- timeout/cancel 不合成 final answer 或 resume instruction。
- 不新增 handoff workbench、队列、独立 assignment、独立人审状态机或 pending object 字段。

## 架构约束下的修改说明

- 需要修改：只修改 `HUMAN_HANDOFF` kind 的 runtime answer validation、final-answer terminal commit、resume-instruction continuation、timeout/cancel outcome 和 safe projection tests。
- 修改后的变化：handoff 是 original run 的 pending branch；人工 final answer 直接由 runtime terminal-commit，resume instruction 只作为 continuation input，不作为新 root user message。
- 影响：可以支持人工接管的最小黑盒能力，但不会引入工单、分派、认领、多人工协作、外部人审平台或长期队列。
- 非目标补充：不定义 handoff producer 或触发规则；进入 pending 前的 intent 提交只能复用 pending input core 已冻结的 producer boundary。
- 边界：handoff 不新增 pending object 字段或独立 API；channel 不暴露 operator/private/assignment state；model 不改写人工 final answer。

## Capability 影响（Capabilities）

### 新增 Capability

- `human-handoff`：type-specific behavior for `PendingInputKind.HUMAN_HANDOFF`。

### 修改的 Capability

无。

## 影响范围（Impact）

- 依赖：`refine-ts-pending-input-contracts`、`add-ts-human-pending-input-core`、`add-ts-human-pending-input-timeout`；本 change 只消费 `refine` 定义的 `multiple` / `custom` question 约束和 answer shape 来拒绝 custom/multi 语义，不新增 handoff-specific persistence field。
- 影响 package：`agent-runtime` handoff outcome/resume、channel projection、terminal commit tests、observability safe summary。
- 非目标：不实现工单分派、多人协作、审批台、外部人审平台、长时任务队列或单独 handoff API。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/human-handoff/spec.md`：新增 human handoff 行为契约。
- runtime/user-interaction architecture：补充 final answer 与 resume instruction 两条路径。
- `agent-runtime`、`agent-channel-web`、observability 模块文档：补充职责和安全投影。
- `openspec/designs/spec-to-design-map.md`：补充导航。
