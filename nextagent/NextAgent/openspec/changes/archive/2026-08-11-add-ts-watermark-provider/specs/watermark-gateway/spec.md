# watermark-gateway Delta

## ADDED Requirements

### Requirement: WatermarkGatewayPort is the sole governed egress to the watermark service

系统 SHALL 新增 gateway adapter kind `watermark` 与 `WatermarkGatewayPort`，作为 NextAgent 对外部水印服务调用的唯一受治理出口。`WatermarkGatewayPort` MUST 暴露 `embedWatermark` 操作：接受 `WatermarkEmbedInput`（含 `text` 字符串），返回 `WatermarkEmbedResult`（含 `success`、`watermarkedText`、`errorCode`、`errorDesc`）。NextAgent 的 channel 层 MUST 经 `WatermarkGatewayPort` 调用水印服务，MUST NOT 绕过 gateway 直连水印 HTTP 端点、在模块内 new HTTP client 或持有水印服务私有 client/endpoint/credential。

`WatermarkGatewayPort` MUST 通过 trusted app composition 注入的 `GatewayBindings.watermark` 获得，MUST NOT 由 runtime 动态 import、远程加载或 hot reload。`WatermarkGatewayPort` MUST NOT 暴露水印服务原始 endpoint、credential 或私有 SDK 类型，只暴露稳定 port 操作与 safe 诊断。

水印服务端点 MUST 只能由 NextAgent 后端经 `WatermarkGatewayPort` 调用；前端/客户端 MUST NOT 直接调用任何水印服务端点，也 MUST NOT 持有或获知水印服务 endpoint。前端/客户端只与 NextAgent 自有的 web channel 端点交互；水印对前端透明，由 NextAgent 后端在 channel 层决定。

#### Scenario: Watermark call goes through the gateway port

- **WHEN** 启用水印的部署需要对返回内容添加水印
- **THEN** channel 层 MUST 经 `WatermarkGatewayPort` 调用外部水印服务
- **AND** MUST NOT 直接发起对水印服务的 HTTP 调用

#### Scenario: Frontend never calls watermark service directly

- **WHEN** 前端/客户端发起请求或读取历史
- **THEN** 前端/客户端 MUST 只调用 NextAgent 自有 web channel 端点
- **AND** MUST NOT 直接调用水印服务端点
- **AND** 水印服务 endpoint MUST NOT 出现在前端可见的 bootstrap projection 或任何前端可达响应中

### Requirement: Watermark requires a REMOTE gateway entry and provider

水印 SHALL 只在配置了 `deploymentMode: "REMOTE"` 的 watermark gateway entry 且注入了 REMOTE watermark provider 时生效。`deploymentMode: "LOCAL"` 的 watermark gateway entry SHALL 在 gateway selection 时被过滤（不创建 binding、不执行水印 transform），并以 safe diagnostic 记录忽略原因，MUST NOT 因此 fail。

不存在 LOCAL watermark provider 产品包——水印是 REMOTE-only 能力。测试通过在 test fixture 中显式注入 inline stub 实现 `WatermarkGatewayPort`（或 REMOTE provider 指向 mock 端点）来验证，MUST NOT 依赖 LOCAL 产品运行时的水印来源。系统 MUST NOT 在运行时从 LOCAL 回退到 REMOTE 或从 REMOTE 回退到 LOCAL watermark adapter。

#### Scenario: LOCAL watermark entry is filtered

- **WHEN** source configuration 含 `deploymentMode: "LOCAL"` 的 watermark gateway entry
- **THEN** gateway selection MUST 过滤该 entry，不创建 `watermark` binding
- **AND** 水印 transform MUST 不生效

#### Scenario: REMOTE watermark entry creates binding

- **WHEN** source configuration 含 `deploymentMode: "REMOTE"` 的 watermark gateway entry 且注入了 REMOTE watermark provider
- **THEN** startup MUST resolve REMOTE provider 并创建 `watermark` binding
- **AND** 水印 transform 按配置生效

### Requirement: Watermark is disabled by default and controlled by config

水印默认关闭。集成方通过 agent package 的 `config/config.json` 中 `watermarkEnabled` 字段（boolean）控制是否启用水印。系统 MUST 读取 `watermarkEnabled`，`config/config.json` 文件缺失、`watermarkEnabled` 字段缺失或类型不正确时 MUST 返回 `false`，MUST NOT 抛异常。channel 层在实际调用时检查 `watermark` port 是否存在——`watermarkEnabled === true` 但没有 `watermark` binding 时，transform 不执行，原文返回。

#### Scenario: Watermark disabled by default

- **WHEN** `config/config.json` 不存在或不含 `watermarkEnabled` 字段
- **THEN** 水印 transform MUST 不执行
- **AND** 所有返回内容 MUST 为原文

#### Scenario: Watermark enabled by config

- **WHEN** `config/config.json` 含 `watermarkEnabled: true` 且 gateway bindings 中存在 `watermark` binding
- **THEN** channel 层 MUST 对满足条件的内容执行水印 transform

#### Scenario: Watermark binding absent disables transform

- **WHEN** `watermarkEnabled` 为 `true` 但 gateway bindings 中不存在 `watermark` binding
- **THEN** 水印 transform MUST 不执行
- **AND** 所有返回内容 MUST 为原文

### Requirement: Watermark transform targets ASSISTANT content above 500 characters

水印 transform 只作用于以下内容，且每项 MUST 满足 content 字符长度大于 500：

1. `LLM_CONTENT_DELTA` 的 content — 模型正文（含 workflow LLM 节点输出）。
2. `REQUEST_COMPLETED` 的 content — terminal 最终回复。
3. `TOOL_STRUCTURED_DELTA` 且 `toolEventType in {DETAIL, ANSWER}` 且 `toolMessageType === "TEXT"` 且 `workflowEventType !== undefined` 的 content — workflow 节点输出的正文文本。
4. 历史回显中 `role === "ASSISTANT"` 的消息 content（conversation 和 shared conversation 端点）。
5. 历史回显 events 中 REQUEST_COMPLETED 和 workflow TOOL_STRUCTURED_DELTA 的 content（events 端点）。

系统 MUST NOT 对以下内容加水印：USER、CAPABILITY_RESULT、SUMMARY 消息；思考过程（LLM_THINKING_DELTA）；CLIP/Bash 工具的 TOOL_STRUCTURED_DELTA（没有 `workflowEventType` 字段）；CANCELED、FAILED、SUPERSEDED terminal 事件。content 长度小于等于 500 的内容 MUST 原文返回。

#### Scenario: Short content is not watermarked

- **WHEN** 满足作用对象条件但 content 字符长度 <= 500
- **THEN** 水印服务 MUST NOT 被调用
- **AND** content MUST 原文返回

#### Scenario: Non-ASSISTANT history messages are not watermarked

- **WHEN** 历史回显中消息 role 不为 `ASSISTANT`
- **THEN** 水印 transform MUST 不作用于该消息
- **AND** content MUST 原文返回

#### Scenario: CLIP/Bash TOOL_STRUCTURED_DELTA is not watermarked

- **WHEN** TOOL_STRUCTURED_DELTA 没有 `workflowEventType` 字段（CLIP/Bash 工具产出）
- **THEN** 水印 transform MUST 不作用于该事件
- **AND** content MUST 原文返回

#### Scenario: Thinking content is not watermarked

- **WHEN** 收到 LLM_THINKING_DELTA 事件
- **THEN** 水印 transform MUST 不作用于该事件

### Requirement: Stream path yields watermark delta at each model invocation end

在 stream 路径中，channel 层 MUST 跟踪最新的 ASSISTANT `LLM_CONTENT_DELTA`（`role !== "CAPABILITY_RESULT"` 且有 `content`）。当 `stepId` 变化（两个 delta 都有 stepId 且不同，表示新的 model invocation 或 workflow LLM 节点开始）或 `REQUEST_COMPLETED` 事件到达时，channel 层 MUST 对最后一条跟踪的 `LLM_CONTENT_DELTA` 的累积 content 做一次水印调用（content > 500 时），yield 一条 `LLM_CONTENT_DELTA` delta 带水印内容。该水印 delta MUST 是原 delta envelope 的浅拷贝：保留原 envelope 的所有身份字段（`sessionId`、`requestId`、`runId`、`requestContextId`、`sequence`、`timelineEventRef`、`stepId`、`final`、`rootMessageId` 等），只替换 `payload.content` 和 `payload.text` 为水印后文本，`eventId` 在原值后追加 `:watermark` 后缀以标识为水印 delta 且不被前端去重 skip。这样前端 accumulated snapshot 替换逻辑按 lane key（`sessionId + rootMessageId + attemptId + eventType + stepId`）将水印 delta 替换到原文所在的 lane 位置。`REQUEST_COMPLETED` 到达时 MUST 先 flush pending 的 LLM_CONTENT_DELTA 水印 delta，然后对 terminal content 做 inline transform（content > 500 时替换 `payload.content`）。

跟踪条件不限于有 `stepId` 的 delta：runtime 在 model invocation 结束时会发出带 `final: true` 且无 `stepId` 的最终答案 delta，该 delta MUST 被跟踪为水印源。stepId 到无 stepId 的过渡（同一 invocation 内的中间快照到 final 快照）MUST NOT 触发 flush，只更新跟踪的 envelope。

`TOOL_STRUCTURED_DELTA` 的水印 MUST 做 inline transform：直接替换 `payload.content` 为水印后的内容。CANCELED、FAILED、SUPERSEDED terminal 事件 MUST NOT 执行水印。

#### Scenario: Watermark delta yielded on stepId change

- **WHEN** stream 中 LLM_CONTENT_DELTA 的 `stepId` 从 A 变为 B，且 A 的累积 content > 500
- **THEN** channel 层 MUST yield 一条 `LLM_CONTENT_DELTA` delta，payload 携带 A 的水印后 content
- **AND** 该 delta MUST 是原 delta envelope 的浅拷贝，保留所有身份字段（`runId`、`requestContextId`、`rootMessageId`、`stepId`、`sequence` 等）
- **AND** 该 delta 的 eventId MUST 在原 eventId 后追加 `:watermark` 后缀以可标识为水印 delta
- **AND** 该 delta 的 `metadata` MUST 包含 `watermarked: true` 标记

#### Scenario: Watermark delta tracks final answer delta without stepId

- **WHEN** stream 中先收到带 `stepId` 的中间 LLM_CONTENT_DELTA，后收到无 `stepId` 但带 `final: true` 的最终答案 LLM_CONTENT_DELTA，然后 `REQUEST_COMPLETED` 到达，且最终答案 content > 500
- **THEN** channel 层 MUST 以最终答案 delta 为水印源 yield 水印 delta
- **AND** 水印 delta MUST 继承最终答案 delta 的 `final: true` 标记
- **AND** 中间快照到 final 快照的过渡 MUST NOT 触发额外 flush

#### Scenario: Watermark delta flushed on REQUEST_COMPLETED

- **WHEN** `REQUEST_COMPLETED` 到达且存在 pending 的 LLM_CONTENT_DELTA 水印 delta（content > 500）
- **THEN** channel 层 MUST 先 yield 水印 delta
- **AND** 然后对 `REQUEST_COMPLETED` 的 content 做 inline transform（content > 500 时）

#### Scenario: TOOL_STRUCTURED_DELTA inline transform for workflow

- **WHEN** stream 中收到 `TOOL_STRUCTURED_DELTA` 且 `toolEventType in {DETAIL, ANSWER}` 且 `toolMessageType === "TEXT"` 且 `workflowEventType !== undefined` 且 content > 500
- **THEN** channel 层 MUST 对 `payload.content` 做 inline transform 替换为水印后内容

#### Scenario: Canceled run does not execute watermark

- **WHEN** terminal 事件为 CANCELED、FAILED 或 SUPERSEDED
- **THEN** 水印 transform MUST NOT 执行

### Requirement: History replay applies watermark with parallel fail-open calls

历史回显路径（conversation 端点、shared conversation 端点、events 端点）MUST 使用 `Promise.allSettled` 并行调用水印服务。对每个满足条件的消息或事件，并行发起水印调用；fulfilled 的替换 content，rejected 的保持原文。不限制并发大小。

conversation 和 shared conversation 端点对 `role === "ASSISTANT"` 且 `content` 为 string 且长度 > 500 的消息做并行水印替换。events 端点对 `eventType === "REQUEST_COMPLETED"`（content > 500）和 `TOOL_STRUCTURED_DELTA`（workflow DETAIL/ANSWER+TEXT，content > 500）的事件做并行水印替换。

#### Scenario: Conversation endpoint parallel watermark

- **WHEN** conversation 端点返回多个 ASSISTANT 消息且 content > 500
- **THEN** channel 层 MUST 使用 `Promise.allSettled` 并行调用水印服务
- **AND** fulfilled 的替换 content，rejected 的保持原文

#### Scenario: Shared conversation endpoint parallel watermark

- **WHEN** shared conversation 端点返回多个 ASSISTANT 消息且 content > 500
- **THEN** channel 层 MUST 使用 `Promise.allSettled` 并行调用水印服务
- **AND** fulfilled 的替换 content，rejected 的保持原文

#### Scenario: Events endpoint parallel watermark

- **WHEN** events 端点返回多个 REQUEST_COMPLETED 和 workflow TOOL_STRUCTURED_DELTA 事件且 content > 500
- **THEN** channel 层 MUST 使用 `Promise.allSettled` 并行调用水印服务
- **AND** fulfilled 的替换 payload.content，rejected 的保持原文

### Requirement: Watermark service failure degrades to original content

水印服务调用失败（超时、网络错误、无效响应、非 2xx 状态码）时，channel 层 MUST 以原文返回，MUST NOT 阻断 stream 或 API 响应。失败 MUST 在日志中记录调用失败，MUST NOT 向客户端暴露错误或错误详情。水印服务返回 `success: false` 时，MUST 视为服务拒绝并原文返回。响应体缺少 `success` 或 `watermarkedText` 字段时，MUST 视为调用失败并原文返回。

#### Scenario: Watermark service timeout returns original content

- **WHEN** 水印服务调用超时
- **THEN** channel 层 MUST 以原文返回 content
- **AND** MUST NOT 阻断 stream 或 API 响应
- **AND** MUST 在日志中记录调用失败

#### Scenario: Watermark service returns invalid response

- **WHEN** 水印服务返回非 2xx 状态码、`success: false` 或响应体缺少 `watermarkedText` string 字段
- **THEN** channel 层 MUST 以原文返回 content
- **AND** MUST NOT 向客户端暴露错误详情

### Requirement: Watermark does not modify persisted data

水印 transform MUST NOT 修改或写回持久化数据。水印在每次读取时动态调用外部水印服务。历史回显每次都重新调用水印服务，不依赖之前的水印结果。持久化存储中的原始 content MUST NOT 被水印后的 content 覆盖。

#### Scenario: Persisted data unchanged after watermark

- **WHEN** 水印 transform 对历史回显内容做了水印替换
- **THEN** 持久化存储中的原始 content MUST NOT 被修改
- **AND** 下次读取同一数据时 MUST 重新调用水印服务

### Requirement: Watermark port is injected at composition boundary as channel-layer adapter

`WatermarkGatewayPort` MUST 在 composition 边界被适配为 `WebWatermarkPort`（channel 层本地结构视图），并注入到 `WebStreamDeliveryRequest` 和 `WebChannelDependencies`。channel 层 MUST NOT 直接 import `WatermarkGatewayPort`（agent-contracts/gateway），MUST 只通过 `WebWatermarkPort` 消费水印能力。`WebWatermarkPort` MUST 只暴露 `applyWatermark(content: string, signal?: AbortSignal): Promise<string>` 操作。

水印 port 的注入 MUST NOT 修改 runtime 层依赖。runtime MUST NOT 持有 `WatermarkGatewayPort` 或 `WebWatermarkPort` 引用。水印 transform 全部在 channel 层完成。

#### Scenario: Channel layer uses WebWatermarkPort

- **WHEN** channel 层需要调用水印服务
- **THEN** channel 层 MUST 通过 `WebWatermarkPort` 调用
- **AND** MUST NOT 直接 import 或使用 `WatermarkGatewayPort`

#### Scenario: Runtime does not hold watermark port reference

- **WHEN** 水印功能启用
- **THEN** runtime 层 MUST NOT 持有 `WatermarkGatewayPort` 或 `WebWatermarkPort` 引用
- **AND** 水印 transform MUST 全部在 channel 层完成

### Requirement: REMOTE watermark provider reference implementation calls external URL

`agent-platform-gateway-remote` SHALL 提供 `createWatermarkProvider` 参考实现，创建 REMOTE `GatewayProvider`，调用外部水印服务 URL 的 `POST /rest/naie/inter/compliancehub/watermark/v1/embed` 端点。请求体为 JSON `{ text: string }`，响应体为 JSON `{ success: boolean, watermarkedText: string, errorCode: string, errorDesc: string }`。该实现 MUST 设置超时（默认 10 秒），MUST 接受 `AbortSignal` 用于取消。该实现作为参考供集成方使用或替换。

#### Scenario: Reference provider calls external URL

- **WHEN** REMOTE watermark provider 接收到 `embedWatermark` 调用
- **THEN** provider MUST 向 `{endpoint}/rest/naie/inter/compliancehub/watermark/v1/embed` 发送 POST 请求
- **AND** 请求体 MUST 为 `{ text: string }` JSON
- **AND** 响应体 MUST 包含 `success` boolean 和 `watermarkedText` string 字段

#### Scenario: Reference provider timeout

- **WHEN** 外部水印服务在超时时间内未响应
- **THEN** provider MUST abort 请求并抛出异常
- **AND** channel 层 MUST 以原文返回（fail-open）
