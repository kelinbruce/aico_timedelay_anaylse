# FN-5.2 调用能力

> 能力域 D5 Capability 能力体系 · 子域 [D5.1 能力治理](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-5.1](../../../features/D5-Capability能力体系/D5.1-能力治理/F-5.1-统一能力治理.md) |
| 主规格 | `capability-catalog` |
| 接口 | 能力调用端口 |

## 描述

系统通过统一调用端口调用 Tool、Skill 或 Agent，完成完整参数诊断、安全执行、结果规范化和受限自动重试，只向调用方交付一个确定的最终结果。

## 前置条件

- 当前 request 的 Agent Scope、Owner Scope、assembly 和 cancellation context 已由可信 runtime/composition 固化。
- 调用方提供 capability identity 和待校验 arguments；可用性、schema 与语义校验属于本 Function 的处理过程，不作为外部前置条件。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 能力标识 | 是 | 要调用的能力 |
| 调用参数 | 是 | 能力输入 |
| 归属坐标 | 是 | 请求/运行/会话标识 |

## 输出

通过公共 schema、状态组合和容量约束的唯一 `CapabilityInvocationResult`。`CapabilityInvocationResult.metadata` 中的顶层 `toolDiagnostics` 和 `sourceTrace` 是有界内部诊断 key，只供本地 canonical `toolOutput` 使用；通用模型投影边界以 exact top-level key 删除这两个 key，不递归扫描 `structuredPayload`、不解析 Tool 业务 payload、不按 capability id 或 Tool 名称建立例外，并保留其他已接受的安全 metadata。`metadata.sourceTrace` 不进入后续模型输入、durable `CAPABILITY_RESULT`、Web/stream/timeline、SafeError、audit、metric、trace 或 `ObservabilityObservationEvent`。

## 处理过程

1. 系统唯一解析目标能力，校验可用性、权限、公共输入 schema 和当前阶段全部可独立判断的本地语义违规。
2. 通过统一调用端口执行；只有幂等、瞬态、retryable 且未取消的失败可在 `maxRetries` 上限内同参重试。
3. 系统保留安全业务错误，规范化未知异常和非法输出，校验 output schema、严格 status/`safeError` 组合与公共单结果容量。
4. 返回唯一最终结果；请求内模型调整只使用规范模型标识、canonical `toolChoice` 和受治理推理选项，不得扩大权限。

## 结果

- 正常或合法空结果：`SUCCEEDED`。
- 复合目标存在可独立使用部分成功：`DEGRADED + safeError`。
- 无可用结果的失败或超时：空业务 payload 与唯一安全错误；取消不重试。
- 调用方只消费最终结果，中间 attempts 不可见。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 调用资格 | 仅调用当前 Agent 范围内已唯一解析且可用的 Capability；缺失或冲突时安全失败 | `capability-catalog`：`Execution Uses Capability Kind And Provider Identity` |
| 单次逻辑调用自动重试 | 初始 attempt 后允许 0..5 次额外 retry；缺省 1，显式 0 或非法值为 0；每次都重新满足瞬态、retryable、幂等与未取消门禁 | `capability-catalog`：`瞬态失败只在统一执行边界安全重试` |
| 公共单结果容量 | 每个规范化最终逻辑 invocation 结果最多 256000 个 UTF-16 code units；容量内不截断，超限显式失败并复用外置回读 | `capability-catalog`：`Capability 结果复用统一容量和转储机制` |
| 内部来源诊断模型隐藏 | `metadata.toolDiagnostics` 和 `metadata.sourceTrace` 只供本地 `toolOutput` 使用；通用模型投影以 exact top-level key 删除，不递归扫描 `structuredPayload`、不按 Tool 名称分支、不删除其他安全 metadata | `capability-catalog`：`Capability 内部来源诊断保持模型不可见` |
| Portal ability 入口配置 | active Agent package 受信 `portal-ability-config` 支持四个独立 boolean 入口开关，默认 `true`，仅明确 `false` 关闭；非法或缺失字段独立回退 `true` | `agent-owned-resource-dynamic-loading`：`Portal ability entry configuration fields and defaults` |
