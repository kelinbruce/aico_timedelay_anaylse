# FN-8.2 检索和写入记忆

> 能力域 D8 数据与记忆 · 子域 [D8.2 记忆](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-8.2](../../../features/D8-数据与记忆/D8.2-记忆/F-8.2-长期记忆.md) |
| 当前状态 | 稳定 |
| 主规格 | `memory-tools` |
| 关联规格 | `memory-core` |
| 接口 | 能力调用端口（记忆工具） |

## 描述

模型通过三个受治理记忆 Tool 显式检索、查看详情或写入长期记忆。读取和写入始终按可信 Owner Scope 与 Agent Scope 隔离；上下文装配不会自动注入记忆，后台 extraction/aging 也不通过这些 Tool 绕回 Capability 主路径。

## 前置条件

- 记忆能力已为当前 Agent 启用，并且长期记忆服务可用。
- 当前请求的 Owner Scope 与 Agent Scope 已由可信边界确定；Tool input 不接受这些字段。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 操作类型 | 是 | `search_memory`、`get_memory_detail` 或 `add_memory` |
| 查询 | 检索时 | 查询、类别、用途、置信度、limit 和 offset 均受 Tool schema 约束 |
| 记忆标识 | 查看详情时 | 当前 scope 内的记忆 id 列表 |
| 记忆内容 | 写入时 | 类别、正文、标签、置信度、brief index 和类别特有内容 |

## 输出

通过公共 output schema 的检索列表、逐项详情结果或写入确认；失败直接使用公共 `safeError`，不返回 memory-specific 失败 envelope。`get_memory_detail` 的成功 `entry` 向模型提供完整 category-specific 结构化业务内容，但不包含 `sourceTrace` 或原始 `source`，也不以其他顶层 provenance 字段返回 session、request、run、message 或 extraction cycle 坐标；当 retained source 可解析时，系统把由 `longTermMemoryId` 关联的来源写入模型隐藏的 `CapabilityInvocationResult.metadata.sourceTrace`，供本地 canonical `toolOutput` 一步定位。该 metadata 与 `structuredPayload` 一并计入公共单结果容量，不进入模型输入、durable `CAPABILITY_RESULT` 或任何 outward surface。

## 处理过程

1. 系统确认目标记忆 Tool 对当前请求可见且可用，拒绝输入中的 owner/agent scope 字段，并一次返回全部公共 schema violations。
2. `search_memory` 按可信 scope、查询条件和分页坐标返回有界结果；disabled 或零条目是可解释的正常结果，storage unavailable/timeout 按真实瞬态事实返回。
3. `get_memory_detail` 对每个 requested id 返回 entry 或正常的 item-level missing；部分 id 不存在不覆盖已成功 entries，global authorization/internal failure 也不能伪装成 item missing。
4. `add_memory` 校验类别及类别特有内容后执行结构化写入；duplicate/version conflict 建议先检索当前 memory 或调整内容，content guard policy 保持真实分类。
5. `search_memory` 与 `get_memory_detail` 的 replay policy 为 `IDEMPOTENT`，只有统一瞬态门禁成立时才同参 retry；`add_memory` 为 `NON_IDEMPOTENT`，不得自动重放。
6. 三个 Tool 返回统一 `safeError`，并复用公共结果校验、`256000` UTF-16 code unit 容量和外置回读，不建立记忆专用失败格式或独立结果上限。
7. 普通 Agent 可根据最终安全错误继续决策；长期记忆写入和后台生命周期不阻塞当前请求终态。

## 结果

- 检索正常：返回有界列表；零条目仍为成功。
- 详情正常：成功 entries 与 item-level missing 可在同一结果中并存。
- 写入正常：返回持久化确认；duplicate/version conflict 不自动重放。
- 记忆不可用或超时：返回真实安全失败；仅幂等读取可在统一门禁内自动 retry。
- 全局授权、可信 context、output 或未知异常：返回公共安全错误，不泄漏记忆正文、scope、storage row 或 provider 原始信息。
- 请求终态：记忆辅助操作失败不覆盖已经独立完成的主请求结果。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| Capability 接入 | 三个 memory Tool 依赖 memory core，并只通过统一 Capability channel 暴露给模型 | `memory-tools`：`Memory tools delivery depends on memory core`、`Memory tools exposure through capability channel` |
| Scope 安全 | memory Tool schema 拒绝 Owner/Agent Scope 输入，实际 scope 只来自可信 invocation context | `memory-tools`：`Memory tool schemas reject owner scope input` |
| 读取语义 | `search_memory` 提供 L1 有界检索，`get_memory_detail` 提供 L2 逐项详情；二者为幂等读取 | `memory-tools`：`search_memory L1 retrieval`、`get_memory_detail L2 retrieval` |
| 写入与失败 | `add_memory` 执行结构化非幂等写入；三 Tool 共用统一安全失败、容量和降级语义 | `memory-tools`：`add_memory structured write`、`Memory tools failure and degradation` |
| 主动召回 L1/L2 诊断码 | L1 未命中继续使用 `NO_MATCH`；L1 取消/失败分别为 `L1_SEARCH_CANCELED`/`L1_SEARCH_FAILED`；L2 取消/失败分别为 `L2_DETAIL_CANCELED`/`L2_DETAIL_FAILED`。任一 L2 失败仍返回无上下文结果，不注入部分详情 | `memory-tools`：`主动召回的 L2 读取有界、响应取消且全有或全无` |
| L2 详情模型可见边界 | 成功 `entry` 包含完整 category-specific 结构化业务内容，但 output schema 和实际结果不含 `sourceTrace` 或原始 `source`；retained source 写入模型隐藏的 `metadata.sourceTrace` 供本地 `toolOutput` 诊断，不进入模型、持久化结果或 outward surfaces；超限返回 `CAPABILITY_RESULT_LIMIT_EXCEEDED` | `memory-tools`：`get_memory_detail L2 retrieval` |
