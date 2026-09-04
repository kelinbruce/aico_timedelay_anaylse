# Design: Watermark Provider

## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.5 集成外部系统` | 新增 `WatermarkGatewayPort` 作为水印服务的唯一受治理出口，以 REMOTE 部署 | `watermark-gateway` | `FN-10.5 集成外部系统` |
| `FN-10.5 集成外部系统` | channel 层调用水印 port 对 ASSISTANT 正文做透明替换 | `watermark-gateway` | `channel 层水印 transform` |
| `FN-10.5 集成外部系统` | 从 `config/config.json` 读取 `watermarkEnabled` 开关 | `watermark-gateway` | `配置读取` |

本设计定义水印服务的受治理出口、channel 层 transform 逻辑、配置读取和历史回显路径，不授权对 runtime 层核心逻辑的修改。

## 架构决策

### 水印 port 注入模式

水印 port 通过 trusted app composition 注入到 channel 层，参考 `guardrail` pattern。`WatermarkGatewayPort` 定义在 `agent-contracts/gateway`，channel 层通过 `WebWatermarkPort` 本地结构视图消费，composition 边界做适配。

**不修改 runtime 层**：水印 transform 全部在 channel 层完成，不注入 runtime deps。runtime 不感知水印，不持有 `WatermarkGatewayPort` 引用。这与 guardrail 的 `guardBlockedRunIds` 内部状态机制不同——guardrail 在 runtime 内部维护状态，水印走 port 调用是 channel 层的独立注入模式。

历史回显的数据流路径：channel routes（conversation / shared conversation / events 端点）从 `RuntimeSessionPort` 读取已持久化的 messages 和 events，然后在返回客户端之前调用水印 port 做透明替换。runtime 层不参与历史回显的水印逻辑。

具体的 port 接线路径：create-app 在 composition 阶段从 gatewayBindings.watermark 获取 WatermarkGatewayPort，通过 adaptWatermarkGatewayPort 适配为 WebWatermarkPort（将 WatermarkEmbedInput/WatermarkEmbedResult 签名简化为 string -> string），注入到 WebChannelDependencies。SSE stream 路径（deliverWebStream）和 WebSocket 路径（registerWebSocketStream）均从 WebChannelDependencies 获取 watermark port 和 watermarkEnabled flag。历史回显路径（conversation、shared conversation、events 端点）直接从 WebChannelDependencies.watermark 获取 port。

### REMOTE-only

水印是 REMOTE-only 能力，不存在 LOCAL watermark provider 产品包。`deploymentMode: "LOCAL"` 的 watermark gateway entry 在 gateway selection 时被过滤，不创建 binding，以 safe diagnostic 记录忽略原因。系统不在运行时从 LOCAL 回退到 REMOTE 或从 REMOTE 回退到 LOCAL。

测试通过在 test fixture 中显式注入 inline stub 实现 `WebWatermarkPort`（或 REMOTE provider 指向 mock 端点）来验证。

### Fail-open

水印服务调用失败（超时、网络错误、无效响应）时，channel 层 MUST 以原文返回，MUST NOT 阻断 stream 或 API 响应。失败 MUST 在日志中记录，MUST NOT 向客户端暴露错误。

### 不修改持久化数据

水印在每次读取时动态调用外部服务，MUST NOT 修改或写回持久化数据。历史回显每次都重新调用水印服务。原始数据保持不变。

### 配置读取

`watermarkEnabled` 从 agent package 的 `config/config.json` 读取，路径为 `{agentsRoot}/{agentId}/config/config.json`。字段名 `watermarkEnabled`，类型 `boolean`，默认 `false`。文件缺失、字段缺失或类型不正确时返回 `false`，永不抛异常。

配置只控制是否启用水印 transform。channel 层在实际调用时检查 `watermark` port 是否存在——`watermarkEnabled === true` 但没有 `watermark` binding 时，transform 不执行，原文返回。

配置示例（`{agentsRoot}/{agentId}/config/config.json`）：

```json
{
  "watermarkEnabled": true
}
```

集成方还需要在系统级配置的 `gateway.gateways` 数组中添加 REMOTE watermark entry，才会创建 `watermark` binding：

```json
{
  "gatewayId": "remote-watermark",
  "gatewayKind": "watermark",
  "deploymentMode": "REMOTE"
}
```

## channel 层水印 transform

### 作用对象

需要水印的内容：

1. **LLM_CONTENT_DELTA** 的 content — 模型正文（含 workflow LLM 节点输出）
2. **REQUEST_COMPLETED** 的 content — terminal 最终回复
3. **TOOL_STRUCTURED_DELTA** 且 `toolEventType in {DETAIL, ANSWER}` 且 `toolMessageType === "TEXT"` 且 `workflowEventType !== undefined` 的 content — workflow 节点输出的正文文本
4. **历史回显** 中 `role === "ASSISTANT"` 的消息 content（conversation 和 shared conversation 端点）
5. **历史回显 events** 中 REQUEST_COMPLETED 和 workflow TOOL_STRUCTURED_DELTA 的 content（events 端点）

不加水印的内容：
- USER、CAPABILITY_RESULT、SUMMARY 消息
- 思考过程（LLM_THINKING_DELTA）
- CLIP/Bash 工具的 TOOL_STRUCTURED_DELTA（没有 `workflowEventType` 字段）
- CANCELED、FAILED、SUPERSEDED terminal 事件

### 字符长度阈值

所有作用对象 MUST 满足 content 字符长度大于 500 才调用水印服务。长度小于等于 500 的内容原文返回。

### Stream 路径

#### LLM_CONTENT_DELTA

LLM_CONTENT_DELTA 携带累积快照（accumulated snapshot），channel 层跟踪最新的 ASSISTANT delta（`role !== "CAPABILITY_RESULT"` 且有 `content`）。当 `stepId` 变化（两个 delta 都有 stepId 且不同，表示新的 model invocation 或 workflow LLM 节点开始）或 REQUEST_COMPLETED 事件到达时，对最后一条跟踪的 delta 的累积内容做一次水印调用，yield 一个额外的 `LLM_CONTENT_DELTA` delta 带水印内容。

跟踪不限于有 `stepId` 的 delta：runtime 在 model invocation 结束时发出带 `final: true` 且无 `stepId` 的最终答案 delta，该 delta 也被跟踪为水印源。stepId 到无 stepId 的过渡（同一 invocation 内中间快照到 final 快照）不触发 flush，只更新跟踪的 envelope。这确保水印 delta 继承最终答案的 `final` 标记和 lane key，前端不会将其判定为 pending process-content 中间步骤而过滤。

具体逻辑：
1. 维护 `watermarkStepId` 和 `watermarkEnvelope` 状态，保存最后一条 ASSISTANT LLM_CONTENT_DELTA 的完整 envelope（而非仅 content）。
2. 收到 LLM_CONTENT_DELTA 时，如果当前有 content 且 role 非 CAPABILITY_RESULT，更新 `watermarkEnvelope`。如果 `watermarkStepId` 和新 delta 的 `stepId` 都有值且不同，先 flush 上一个 invocation 的水印 delta。
3. flush 时浅拷贝最后一条 delta envelope，保留所有身份字段（`sessionId`、`requestId`、`runId`、`requestContextId`、`sequence`、`timelineEventRef`、`stepId`、`final`、`rootMessageId` 等），只替换 `payload.content` 和 `payload.text` 为水印后文本，`eventId` 追加 `:watermark` 后缀，`metadata` 追加 `watermarked: true`。检查 content 长度 > 500，长度不足或调用失败时不 yield。这样前端 accumulated snapshot 替换逻辑按 lane key（`sessionId + rootMessageId + attemptId + eventType + stepId`）将水印 delta 替换到原文所在的 lane 位置。
4. REQUEST_COMPLETED 到达时，先 flush 最后一个 pending 的水印 delta。

#### TOOL_STRUCTURED_DELTA

inline transform：对满足条件的 TOOL_STRUCTURED_DELTA（workflow DETAIL/ANSWER+TEXT，content > 500）直接替换 `payload.content` 为水印后的内容。失败时原文返回。

#### REQUEST_COMPLETED

先 flush pending 的 LLM_CONTENT_DELTA 水印 delta，然后对 `payload.content` 做 inline transform（content > 500 时替换）。失败时原文返回。

CANCELED、FAILED、SUPERSEDED 不执行水印。

### 历史回显路径

#### Conversation 端点

对 `projectConversation` 返回的 items 中 `role === "ASSISTANT"` 且 `content` 为 string 且长度 > 500 的消息，使用 `Promise.allSettled` 并行调用水印服务。fulfilled 的替换 content，rejected 的保持原文。

#### Shared conversation 端点

同 conversation 端点逻辑，对 `projectSharedConversation` 返回的 messages 中满足条件的 ASSISTANT 消息做并行水印替换。

#### Events 端点

对 events 端点返回的 stream envelopes 中满足以下条件的事件做并行水印替换：
- `eventType === "REQUEST_COMPLETED"` 且 content > 500
- `eventType === "TOOL_STRUCTURED_DELTA"` 且 `toolEventType in {DETAIL, ANSWER}` 且 `toolMessageType === "TEXT"` 且 `workflowEventType !== undefined` 且 content > 500

使用 `Promise.allSettled` 并行调用，fulfilled 的替换 payload.content，rejected 的保持原文。

### 并行调用

历史回显路径使用 `Promise.allSettled` 并行调用水印服务，不限制并发大小。Stream 路径是顺序调用（每个 model invocation 结束时一次）。

## 端点影响

| 端点 | 水印行为 |
|---|---|
| `GET /api/v1/sessions/:sessionId/conversation` | 对 ASSISTANT 消息 content > 500 并行水印 |
| `GET /api/v1/sessions/:sessionId/runs/:runId/events` | 对 REQUEST_COMPLETED 和 workflow TOOL_STRUCTURED_DELTA content > 500 并行水印 |
| `GET /api/v1/shares/:shareId` | 对 ASSISTANT 消息 content > 500 并行水印 |
| `POST /api/v1/sessions/:sessionId/requests` (SSE/WS stream) | stream 路径水印 transform |

## FN-10.5 集成外部系统

### 目标与规范依据

集成方通过外部 URL 提供水印服务，NextAgent 通过 `WatermarkGatewayPort` 受治理出口调用，在 channel 层对返回文本做透明替换。水印默认关闭，通过 `config/config.json` 的 `watermarkEnabled` 字段控制。

canonical spec：`watermark-gateway`（本 change 新增）

### 当前实现

- `agent-contracts/gateway` 定义 `WatermarkGatewayPort`、`WatermarkEmbedInput`、`WatermarkEmbedResult`，`"watermark"` adapter kind 和 `GatewayBindings.watermark`。
- `agent-app/composition/watermark-composition.ts` 实现 `readWatermarkEnabled`，从 `config/config.json` 读取 `watermarkEnabled`。
- `agent-app/composition/channel-composition.ts` 实现 `adaptWatermarkGatewayPort`，将 `WatermarkGatewayPort` 适配为 `WebWatermarkPort`。
- `agent-app/composition/gateway-composition.ts` 过滤 LOCAL watermark entry，合并 watermark binding。
- `agent-channel-common/transports/web-stream-delivery.ts` 定义 `WebWatermarkPort`，实现 stream 路径水印 transform（LLM_CONTENT_DELTA flush、TOOL_STRUCTURED_DELTA inline、REQUEST_COMPLETED inline）。
- `agent-channel-web/routes/requests.ts` 在 conversation、shared conversation、events 端点实现历史回显水印 transform。
- `agent-platform-gateway-remote/watermark/watermark-gateway.ts` 提供 REMOTE watermark provider 参考实现。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 水印服务有唯一受治理出口 | `WatermarkGatewayPort` 已定义并通过 gateway binding 注入 | 无实现 GAP |
| channel 层 transform 不修改 runtime | 水印全部在 channel 层完成，runtime 不感知 | 无实现 GAP |
| 配置默认关闭 | `readWatermarkEnabled` 默认返回 `false` | 无实现 GAP |
| Fail-open | 所有调用路径 catch 异常并原文返回 | 无实现 GAP |
| 不修改持久化数据 | 历史回显每次动态调用，不写回 | 无实现 GAP |
| REMOTE-only | LOCAL entry 被过滤 | 无实现 GAP |

### 修改方案

1. `agent-contracts/gateway` 定义 `WatermarkGatewayPort` 作为水印服务的唯一受治理出口。
2. `agent-app/composition` 在 composition 边界将 `WatermarkGatewayPort` 适配为 `WebWatermarkPort` 并注入 channel 层。
3. `agent-channel-common/transports/web-stream-delivery.ts` 在 stream 路径实现水印 transform。
4. `agent-channel-web/routes/requests.ts` 在历史回显路径实现水印 transform。
5. `agent-platform-gateway-remote` 提供 REMOTE watermark provider 参考实现。

本 Function 无新增黑盒质量目标。实现使用已有 channel transport 和 gateway composition 路径，测试关注 fail-open、阈值过滤、作用对象正确性和历史回显并行调用。

## 边界确认点

1. **CLIP/Bash TOOL_STRUCTURED_DELTA 排除**：只对 `workflowEventType !== undefined` 的 TOOL_STRUCTURED_DELTA 加水印，CLIP/Bash 工具产出（无 `workflowEventType` 字段）不加水印。stream-envelope 投影需在 `copySafeFields` 中新增 `workflowEventType` 字段，否则该字段在投影到 stream envelope 时会被丢弃，导致 watermark 判断永远不命中 workflow 事件。
2. **思考过程排除**：LLM_THINKING_DELTA 不加水印，只对模型返回的正文纯文本内容加水印。
3. **字符长度阈值**：所有作用对象必须满足 content 字符长度大于 500 才调用水印服务。
4. **Fail-open 日志记录**：水印服务调用失败时原文返回，日志记录调用失败，不向客户端暴露错误。
5. **每次调用不持久化**：水印在每次读取时动态调用外部服务，不修改或写回持久化数据。
6. **LOCAL_CONFIGURED_AUTH profile 受控例外**：`registerLocalConfiguredProtectedWebChannel` 是精简注册路径，不注入 watermark（也不注入 guardrail）。该 profile 仅用于 local configured auth 场景的受保护 web channel，不承载完整 channel dependencies。水印在 `DEFAULT_WEB` profile 下生效。此例外与 guardrail 的既有行为一致，适用范围为 `LOCAL_CONFIGURED_AUTH` channelAuthProfile。
