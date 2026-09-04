## 背景

`publishTimelineEvent` 是进程内投递：持久化事件后 push 到当前 Pod 的 subscriber queue。多 Pod 部署下，Pod A 处理请求时持久化的 timeline 事件，不会出现在 Pod B 的 in-process subscriber 里。如果 SSE 连接落在 Pod B，前端收不到 Pod A 产生的事件。

## 方案

在 `streamOwned` 和 `streamLiveTailOwned` 的 live 阶段加入 DB 兜底轮询：

1. in-process subscriber 用 `crossPodPollIntervalMs`（2 秒）等待，而非默认 5 分钟。
2. 空闲时查 DB（`readTimelineEventsWithTimeout`），按 `afterSequence = subscriber.lastSeenSequence` 获取增量事件。
3. DB 有事件则去重（`sequence <= lastSeenSequence` 跳过）后投递，重置空闲计数。
4. DB 无事件则累计空闲次数，达 `crossPodMaxIdlePolls`（150 次 × 2 秒 = 5 分钟）后结束流。

### 同形同策

`streamOwned` 和 `streamLiveTailOwned` 的 DB 兜底逻辑抽取为公共方法 `pollCrossPodEvents`，参数化差异（`requestId`/`runId` 过滤、`closeOnTerminal` 检查），避免重复代码。

### 状态同步

DB 兜底投递时同步 `subscriber.pendingInputActive`，与 `publishTimelineEvent` 的进程内行为一致。投递后调用 `rememberStreamSequence` 维护 high-water。

### 安全约束

- DB 查询复用既有 `readTimelineEventsWithTimeout`，有 `timelineReadTimeoutMs`（5 秒）超时保护。
- 查询带 `tenantId`/`subjectId`/`agentId`/`sessionId` scope 过滤，不泄露跨 scope 事件。
- 不暴露 `runId`/`contextId` 等内部 runtime 诊断字段。