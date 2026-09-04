# Design: 修复幂等键长度超限

## 设计范围

本 change 修改 `FN-11.2 幂等写入`，在其 canonical spec `idempotency-contract` 新增一条 Requirement，约束运行时生成的 `idempotencyKey` 不得超出下游 memory/gateway 服务的长度上限。

- 受影响 Function：`FN-11.2 幂等写入`（MODIFIED）
- delta specs：`specs/idempotency-contract/spec.md`（ADDED Requirement）
- 设计章节：见下“FN-11.2 幂等写入”

## FN-11.2 幂等写入

### 目标与规范依据

运行时生成的幂等键必须在支持重试/重放去重的同时不超出下游服务的长度上限，避免批量 tool call 场景下因键超长被远程 memory 服务拒绝而失败。

本 Function 的目标 Requirements（canonical spec `idempotency-contract`）：

- ADDED `生成的幂等键必须符合下游长度上限`

### 当前实现

`packages/agent-core/src/tools/tool-loop.ts` 的 `appendAssistantToolUseMessage` 为批量 assistant-tool-use 消息生成键，值为 `${runId}:assistant-tool-use:${toolCallIds.join(',')}`，长度随 toolCallId 数量无界增长。`brand()` 仅校验非空，不校验长度。其他同类生成器（如 `deriveCapabilityInvocationIdempotencyKey`）为单 ID 路径，长度有界。本地 `agent-platform-gateway-local` 的 SQLite store 不校验键长度，故本地验证无法暴露超长。

### GAP 分析

| 规范目标 | 当前事实 | 待闭合差距 |
|---|---|---|
| 生成的幂等键 ≤ 256 字符 | 批量键无界拼接，可达数百字符 | 引入长度上限与超长塌缩 |
| 超长塌缩保持确定（重试/重放仍命中同键） | 无塌缩机制 | 用确定性摘要塌缩无界输入 |
| 非超长场景存量行为不变 | literal 拼接 | literal 在上限内时原样保留 |

### 修改方案

- 在 `agent-common` 新增 `IDEMPOTENCY_KEY_MAX_LENGTH = 256` 与 `deriveAssistantToolUseIdempotencyKey(runId, toolCallIds)`：literal `${runId}:assistant-tool-use:${joined}` 不超限时直接返回；超限时返回 `${runId}:assistant-tool-use:h:${sha256(joined).slice(0,16)}`。
- `tool-loop.ts` 调用点改为调用该生成器；保留 `brand` import（本文件其他位置仍使用）。
- owner：`agent-common` 提供生成器，`agent-core` 消费，方向与既有 `deriveCapabilityInvocationIdempotencyKey` 一致。
- 失败路径：不引入新失败路径；消除既有的远程 400 失败。
- 验证关注点：大批量真实 ID ≤ 256、同批次确定重现、小批次保留 literal、不同批次不撞。

### 质量属性影响

可靠性/恢复：塌缩保持相同输入→相同键，重试/重放仍命中同一幂等键，去重语义不变。无新增黑盒质量目标，由功能性 Requirement 派生。

## 长期基线刷新计划

归档前同步：

- stable spec：`openspec/specs/idempotency-contract/spec.md`（新增 Requirement，并补 `## Function` 元数据块）
- Function：`openspec/designs/functions/D11-可靠性与韧性/D11.1-恢复与幂等/FN-11.2-幂等写入.md`（规格表新增“生成的幂等键最大长度”项）
- spec-to-design-map：无变化（`idempotency-contract` 已映射）
- overview / architecture / modules / ADR：无
