## Why

用户执行包含一个或多个 Tool 轮次的任务时，Tool 调用前的公开执行说明会在执行详情中按真实时序显示，但同一说明还会被带入后续 model step 的进行中累计正文，并曾进入终止轮次的最终 Assistant Message。用户因此在不同 step 的待定位置或过程区与最终答案区看到重复正文；后者还会在刷新或重新打开会话后继续存在。

该行为破坏了过程说明与最终答案的事实边界，也使 live、history 和后续上下文对同一轮输出的解释不一致。该问题具有稳定复现路径，需要在继续扩展过程历史之前修复这一边界。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Tool 轮次的公开执行说明只在其真实时序位置的执行详情中出现一次。
- 具有非空 `stepId` 的非终态 `LLM_CONTENT_DELTA` 只累计该 model step 的公开正文，不继承其他 step 的正文。
- 最终 Assistant Message 只包含终止模型轮次形成的最终回答，不包含先前 Tool 轮次的公开执行说明。
- live stream、刷新后的 history 和后续模型上下文继续使用各自权威事实，并对多 Tool 轮次产生一致结果。
- 无 Tool 调用、Tool 调用失败、输出续写和终态 hook 路径保持既有安全终止与恢复语义。

**非目标：**

- 不改变 Tool 轮次说明、Tool 调用或 Tool 结果的消息与事件归属。
- 不新增 stream event、Web API、Gateway contract、持久化表、配置项或前端去重规则。
- 不修改 `RunTimelineEvent`、`StreamEnvelope`、`StreamEventType` 或 payload runtime schema。
- 不重写已经持久化的历史会话，也不通过字符串相似度推断或删除旧正文。
- 不改变模型可见的 Tool 调用与 Tool 结果上下文配对。

## What Changes

- 修改多轮 Tool 执行的终态答案语义：先前 Tool 轮次的公开说明继续作为过程事实保留，但不得成为最终 Assistant Message 的正文前缀。
- 收紧 model live delta 的累计边界：`metadata.accumulated=true` 表示同一 `stepId` lane 内累计；新 `stepId` 不得携带此前 step 的正文。
- 修改 live 与 history 的可观察结果：同一 Tool 轮次说明最多显示一次，最终答案只显示终止轮次回答；刷新不得重新产生跨区域重复。
- 保持单轮无 Tool 请求、输出续写、失败和取消路径的既有终态结果与安全边界。

## Feature 影响（Features）

### 新增 Feature

无。

### 修改的 Feature

- `F-1.1 实时查看处理过程`：过程说明与最终回答保持唯一展示位置，live 与 history 不再跨区域重复同一 Tool 轮次正文。

### 移除的 Feature

无。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.1 查看会话消息流` → `specs/ts-web-sse-ws-transports/spec.md`
  - 功能边界：多轮 Tool 请求的过程说明按时序显示一次，最终 Assistant Message 只承载终止模型轮次的最终回答；SSE、WebSocket 与 history 保持一致。
  - 系统质量属性：可靠性/恢复、可测试性。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- 用户看到的多轮 Tool 执行结果不再在过程区和最终答案区重复。
- Web stream 与会话 history 的字段和事件类型不变；既有按 `stepId` 分 lane 的调用方无需迁移，任何把不同 `stepId` 当作请求级累计快照的外部消费者必须改为按 `stepId` 分组。
- 受影响验证集中在 Agent Core 多轮执行、终态提交、会话消息恢复和 Web 投影组合路径。

## 需群内确认

- **已确认（2026-08-07）**：Agent Core 产生的、具有非空 `stepId` 且 `final !== true` 的 model `LLM_CONTENT_DELTA`，其 `content`/`text` 为当前 `stepId` lane 内的累计公开正文；同一 step 内保留 output continuation 累计，跨 step 不继承正文。该 refinement 不修改事件类型、字段、runtime schema、terminal final event、Gateway、持久化、可信 scope 或 Workflow 投影。
- 确认来源：用户在当前 Codex 任务中明确回复“同意契约，继续”；群平台、群名称、消息链接、消息 ID 和明确确认人未提供，归档前可补充。
