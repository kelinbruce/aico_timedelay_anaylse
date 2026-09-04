## 背景与问题

`parallel-gateway` 比 `start-event`、`end-event` 和 `exclusive-gateway` 更复杂：它引入分支激活、join barrier、waiting branch、分支 budget 和恢复语义。

初始 change 将其拆分为独立 change，以避免将并行编排复杂度与基础 gateway 节点混在一起。初始 change 只持有规格边界，延期实现。

本地执行引擎现已增强，支持真正的并发 fork / join：所有命中分支通过 `Promise.allSettled` 同时启动，支持可配置的失败处理策略（`break` / `wait`）和汇聚超时（`join_timeout`）。

## 变更范围

- `parallel-gateway` 的 ownership 从 `workflow-gateway-nodes` 拆分到本独立 change
- 本地工作流执行引擎现提供并发 fork / join 执行
- `parallel-gateway` 支持 `inputs` 配置：
  - `join_node`：显式 join 节点 ID（覆盖自动解析）
  - `join_on_failure`：`"wait"`（默认，等待所有分支，至少一个正常返回即成功）或 `"break"`（首个分支失败时 abort 其余分支）
  - `join_timeout`：正整数秒，默认 600（超时后 abort 所有分支）
  - 未指定 `join_node` 时默认解析为各分支公共 end_node
- 单分支命中退化为普通 `BRANCH` transition
- 安全失败，reason code 为 `WORKFLOW_PARALLEL_GATEWAY_NO_MATCH` 和 `WORKFLOW_PARALLEL_GATEWAY_JOIN_UNRESOLVED`
- 高级并行恢复（branchId、snapshot/recovery、跨实例 barrier）保持延期

## Capability 影响

### 新增 Capability
- `workflow-parallel-gateway`：并发 fork / join，支持可配置失败策略和超时

### 修改的 Capability
- `workflow-gateway-nodes`：移除 `parallel-gateway` 行为 ownership，只保留基础 gateway 节点

## 影响范围

- `openspec/changes/add-ts-workflow-gateway-nodes/`：移除 parallel 相关内容
- `openspec/changes/add-ts-workflow-parallel-gateway/`：持有 spec、design、tasks 和实现
- `packages/agent-workflow`：`PARALLEL` handler 从 `inputs` 读取 join 配置；engine 并发执行分支
- `packages/agent-contracts`：`FORK_JOIN` transition 扩展 `joinOnFailure` 和 `joinTimeout`

## 基线提升计划

- `openspec/specs/workflow-parallel-gateway/spec.md`：新增 / 更新
- `openspec/designs/architecture/workflow-contracts.md`：补充 parallel gateway 跨模块设计
- `openspec/designs/modules/agent-workflow.md`：补充 parallel gateway handler / execution owner 边界
- `openspec/designs/spec-to-design-map.md`：补充导航

## 验证入口

- `openspec validate --all --strict`
- `npm run build`
- `npm test`（workflow-execution-engine 测试覆盖并发执行、join_node、break、wait、timeout）
