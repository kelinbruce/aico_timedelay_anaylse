# FN-1.21 感知跨会话活动

> 能力域 D1 会话与流式交互 · 子域 [D1.2 会话生命周期管理](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-2.4](../../../features/D2-请求运行时/D2.2-请求状态与处理/F-2.4-查看请求状态.md) |
| 主规格 | [`cross-session-activity-awareness`](../../../../specs/cross-session-activity-awareness/spec.md) |
| 接口 | `GET /api/v1/session-activities/stream`（SSE）/ `WS /api/v1/session-activities/ws` / `POST /api/v1/sessions/:sessionId/activity/consume` |

## 描述

系统持续向浏览器投影可信 Owner + Agent 范围内各会话当前需要用户注意的活动，使用户无需逐个打开会话即可识别等待输入、运行中、未读失败和未读结果。

## 前置条件

- 浏览器已通过可信 channel/auth boundary 获得 Owner Scope。
- 当前 Agent Scope 来自可信 app composition、hosted-agent selection 或已持久化 session。
- 宿主为 local、immersive 或 collaborative conversation surface。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 已提交会话/运行事实 | 是 | session、durable latest run、active pending input 与 terminal fact |
| activityId | 消费终态时是 | 当前 terminal unread 的 opaque id |
| observedRunId | 消费终态时是 | 已真实进入 shared conversation projection 的 matching terminal run |

## 输出

- 连接首帧：当前 scope 全部非 `NONE` session 的稀疏 `SNAPSHOT`。
- 后续变化：每次一个 session entry 的 `DELTA`，`NONE` 用于清除。
- 用户界面：四个会话列表入口的统一 trailing marker，以及 collaborative History 的聚合蓝点。

## 处理过程

1. 系统从已提交的会话、运行、待确认输入和终态事实重新判定每个 session 的唯一 Activity 状态。
2. 每个 app instance 通过后端指定的 SSE 或 WebSocket 建立一条全 scope Activity connection，snapshot 后持续接收 delta。
3. local、immersive、collaborative 共用同一 store、selector 和 trailing projection；当前 conversation surface 可见时只在本地抑制 marker。
4. matching terminal presentation 已在可见前台成功投影后，frontend 提交 `activityId + observedRunId`；backend 只在 scope 与两项坐标精确匹配时消费。
5. session 删除发送 `NONE`；进程重启只从 durable in-flight facts 恢复 `RUNNING`/`WAITING_FOR_INPUT`，不复活历史 terminal unread。

## 结果

- 正常：后台会话活动在三个宿主一致可见，matching terminal 查看后清除。
- 重连：用新的首帧 snapshot 全量校正，不使用 cursor 或 revision。
- 迟到、重复或跨 scope 消费：安全不改变当前状态。
- bootstrap、协议或投影失败：关闭/重连 Activity connection，不改变 request lifecycle。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 状态全集与优先级 | `WAITING_FOR_INPUT > RUNNING > UNREAD_FAILURE > UNREAD_RESULT > NONE`；每个 session 至多一个 | `cross-session-activity-awareness / 会话活动状态具有唯一语义和固定优先级` |
| 浏览器连接数 | 每个 app instance 按配置只建立 1 条 Owner + Agent 全 scope Activity connection | `cross-session-activity-awareness / 每个 app instance 使用一条全 scope 会话活动连接` |
| Snapshot | 每次连接恰好 1 个首帧稀疏 snapshot，只含非 `NONE` session | `cross-session-activity-awareness / 首帧稀疏快照与后续 delta 不丢失状态` |
| 容量 | 内部状态数和每个 subscriber 待发送 session 数均不超过该 scope 的实际 session 数 `N` | `cross-session-activity-awareness / 会话活动状态和待发送变化保持有界` |
