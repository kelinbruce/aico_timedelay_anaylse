# FN-8.1 持久化运行数据

> 能力域 D8 数据与记忆 · 子域 [D8.1 持久化](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-8.1](../../../features/D8-数据与记忆/D8.1-持久化/F-8.1-本地持久化.md) |
| 主规格 | [`gateway-store-provider-ownership`](../../../../specs/gateway-store-provider-ownership/spec.md) |
| 接口 | 系统内部，Gateway 持久化 |

## 描述

系统按 provider owner 持久化运行数据：Working Memory 拥有 request/session/message/timeline/checkpoint 等工作事实及其复合事务，Long-term Memory 和保留 SQLite stores 各自保持独立 owner。向任一 local/remote timeline gateway 提交 structured presentation record 前，Runtime 必须确定性满足统一的 49,000-byte JSON UTF-8 边界。

## 前置条件

- 系统已选择 capability-complete provider bindings。
- 运行数据已携带可信 Agent Scope、Owner Scope 与必要的 session/request/run 坐标。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 运行数据 | 是 | 请求、会话、消息、时间线、检查点或受支持复合事务事实 |

## 输出

持久化成功事实，或按既有 Gateway contract 显式传播的失败。

## 处理过程

1. 系统按数据能力路由到唯一 provider owner，不跨 provider 双写或运行时 fallback。
2. request/session 复合操作由 Working Memory provider 在 provider-local 单一事务内完成。
3. Runtime 在 `RunTimelineEventStoreGateway.appendEvent` 前测量 structured `inlinePayload` 的 `JSON.stringify` UTF-8 bytes；超过 49,000 时按 structured-delta 规则保形归一化并设置 `truncated=true`。
4. local 与 remote bindings 接收相同 record shape 和容量边界；真实 serialization、认证、连接或 storage failure 不被截断逻辑吞掉。

## 结果

- 正常：目标 provider 按 owner 和事务边界持久化数据。
- 可预防的 structured payload 超限：gateway 收到小于远端拒绝边界的有界 record，请求不因此失败。
- 真实 provider 故障：显式失败并保持既有一致性语义，不伪装成功或 fail-open。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| Provider owner | Working Memory、Long-term Memory 与保留 SQLite stores 各有唯一 capability owner，不双写、不运行时 fallback | `gateway-store-provider-ownership / Gateway stores have one capability provider owner` |
| 复合事务 | request/session 主路径复合事实由同一 Working Memory provider 保持原子边界 | `gateway-store-provider-ownership / Working Memory preserves request and session transaction boundaries` |
| Structured timeline 硬上限 | 非 Workflow structured record 与 Workflow completed product 的 `inlinePayload` 经 JSON 序列化后 UTF-8 bytes ≤49,000，local/remote 同策 | `gateway-store-provider-ownership / 结构化增量记录在统一timeline gateway前有界` |
| 失败语义 | 容量归一化不改变 terminal；真实 serialization、认证、连接或 storage failure 继续传播，不捕获忽略 | `gateway-store-provider-ownership / 结构化增量记录在统一timeline gateway前有界` |
