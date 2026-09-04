# FN-1.11 从消息派生子会话

> 能力域 D1 会话与流式交互 · 子域 [D1.2 会话生命周期管理](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-1.6](../../../features/D1-会话与流式交互/D1.2-会话生命周期管理/F-1.6-基于历史回复新建会话.md) |
| spec | `session-fork-from-message` |
| 接口 | 会话派生接口 |

## 描述

从已持久化、可见的助手消息派生子会话，复制到该消息为止的对话内容及可用的只读过程快照，并把快照中的消息引用改写为子会话拥有的消息标识。

## 前置条件

- 用户已登录。
- 源会话属于当前用户和智能体。
- 源消息存在、可见且可渲染。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 源会话 ID | 是 | 派生来源会话 |
| 锚点消息 ID | 是 | 派生截止的助手消息 |

## 输出

子会话标识；子会话内含复制到锚点的消息前缀和 child-owned、只读的可用过程快照。每条 copied child message 的 `metadata` 携带 child-owned provenance 标记 `forkInherited: true`，仅用于浏览器投影识别消息来自 copied prefix，不携带 source 坐标，也不表达 retry/edit 操作资格。

## 处理过程

1. 校验源会话和消息归属与可见性。
2. 复制从开头到锚点消息的对话内容前缀。
3. 校验快照中的 `messageId` 位于复制前缀，并与过程事件的请求、运行、消息类型和 Tool 调用一致。
4. 将消息、会话、运行分组和过程事件引用改写为子会话标识，初始化子会话上下文为空。
5. 为每条 copied child message 写入 `metadata.forkInherited: true` provenance 标记，递归 fork 时 grandchild 按同一规则重新写入，与 source child 是否已携带标记无关。
6. 任一引用无法安全映射时，整个派生操作失败且不产生部分子会话；成功时子会话独立拥有复制消息和只读过程快照。
7. 不复制源运行状态、检查点、待确认输入、工具状态或源/祖先消息标识；provenance 标记不进入模型上下文语义，也不被后端 retry/edit/cancel 等 lifecycle 合法性判断读取。

## 结果

- 正常：派生子会话成功，子会话含复制的内容前缀。
- 源消息不可见或不可渲染：安全拒绝。
- 权限不足：安全拒绝。
- 引用缺失、跨 cutoff、损坏或不一致：原子失败，不产生部分子会话，诊断不含正文、Tool 输入输出或 id 映射表。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 复制范围 | 锚点内消息前缀及其可用只读过程快照；不复制可操作运行状态 | `session-fork-from-message / Fork atomically materializes child-owned process history` |
| 过程消息引用 | 每个引用映射为对应的子会话消息标识，不保存或回读源/祖先标识 | `session-fork-from-message / 派生过程快照重映射消息引用` |
| 引用失败 | 派生原子失败，不产生部分消息、快照、可用状态或派生元数据 | `session-fork-from-message / 派生消息引用失败保持原子` |
| 继承 provenance 标记 | copied child message 携带 `metadata.forkInherited: true`，仅标识 copied prefix 来源，不携带 source 坐标，不表达 retry/edit 可用性，不进入模型上下文或后端 lifecycle 判断 | `session-fork-from-message / Copied message 携带继承 provenance 标记` |
