## ADDED Requirements

### Requirement: Web channel 公开 API MUST 拥有完整的请求规格

Web channel public API SHALL 为暴露给 agent-web 的每个端点（包括 REST、SSE、WebSocket、local auth 和 health 端点）维护完整的请求规格。请求规格 MUST 标识 HTTP method 或 WebSocket path、path 参数、query 参数、header、JSON body、multipart 字段和 no-body 情形。路由不接受的参数 MUST 在下游 runtime/session/capability port 被调用之前被 schema 校验或已文档化的 transport 校验拒绝。

#### Scenario: REST 路由请求 schema 覆盖
- **WHEN** 一个公开 REST 路由注册在 `/api/v1` 或 `/health` 下
- **THEN** 该路由 MUST 为每个被接受的 path、query、header、body 或 multipart 字段拥有显式请求规格
- **AND** 不支持的请求字段 MUST 在 runtime/session/capability/gateway port 被调用之前 fail closed
- **AND** 可信 owner scope 和可信 agent scope MUST NOT 从请求体、query、path 或客户端 metadata 接受

#### Scenario: Stream 路由请求 schema 覆盖
- **WHEN** Web channel 为某个 session 暴露 SSE 或 WebSocket stream
- **THEN** stream 请求规格 MUST 定义 `sessionId`、可选 `lastSeenSequence`、可选 `requestId` 和可选 `runId`
- **AND** 不支持的 stream query 参数 MUST 以安全校验错误失败
- **AND** SSE 与 WebSocket MUST 使用等价的请求解析语义，除非某个 transport 专属需求另有明确说明

#### Scenario: Multipart 请求 schema 覆盖
- **WHEN** 一个 submit 或 edit 端点接受 `multipart/form-data`
- **THEN** 请求规格 MUST 列出每个被接受的文本字段和文件 part
- **AND** 不支持的 multipart 字段 MUST 以安全校验错误失败
- **AND** multipart 接入 MUST NOT 允许客户端提供的 owner scope、agent scope、已接受 request id、run id、attachment id 或持久化事实

### Requirement: Web channel 公开 API MUST 拥有完整的成功响应规格

Web channel public API SHALL 为暴露给 agent-web 的每个端点维护完整的成功响应规格。成功响应规格 MUST 定义 HTTP status、content type、顶层响应形状、字段名、字段类型、可选性、enum 值和 no-content 响应。内部领域对象、gateway record、数据库 row 和原始 runtime 事实 MUST NOT 作为公开 Web DTO 暴露。

#### Scenario: REST 路由响应 schema 覆盖
- **WHEN** 一个公开 REST 路由返回成功响应
- **THEN** 响应规格 MUST 定义精确的公开 DTO 形状或 `204 No Content`
- **AND** 实现必须为该路由注册或以其他方式校验等价的响应 schema
- **AND** 响应 MUST NOT 暴露 gateway `*Record` 对象、数据库 row 形状、raw provider error、prompt 内容、模型输出 delta、超出预期公开投影的 capability 参数/结果、credential 值或 host 文件路径

#### Scenario: Stream 响应规格覆盖
- **WHEN** SSE 或 WebSocket 发出 stream 数据
- **THEN** 响应规格 MUST 定义 agent-web 使用的 `StreamEnvelope` 帧形状和事件类型词汇
- **AND** stream payload MUST 保持为 canonical timeline 事实的 channel-safe 投影
- **AND** transport 诊断 MUST NOT 伪造成功的 terminal 事件或暴露原始 timeline payload

#### Scenario: Auth 与 health 响应规格覆盖
- **WHEN** local auth 或 health 路由被启用
- **THEN** 其成功响应 MUST 具有已文档化的 DTO 字段和 status code
- **AND** auth challenge 响应 MUST 与成功 login/logout DTO 分开文档化
- **AND** health 响应 MUST 同时文档化健康与不健康状态的响应形状

### Requirement: Web channel 公开 API MUST 暴露安全错误码规格

Web channel public API SHALL 为暴露给 agent-web 的每个端点定义安全错误响应。错误响应 MUST 使用带安全 `code` 和安全 `message` 的一致公开形状，除非某个既有 transport 协议要求已文档化的 challenge 响应。错误文档 MUST 列出端点专属的本地错误码、预期的 HTTP status code 和客户端可见的安全 reason。错误响应 MUST NOT 暴露 raw provider error、stack trace、prompt 内容、模型输出、capability 参数/结果、credential 值、本地文件路径、未授权的对象存在性或高基数内部细节。

#### Scenario: AgentError 映射已文档化且稳定
- **WHEN** 一个 `AgentError` 穿越 Web channel 边界
- **THEN** Web channel MUST 将 `VALIDATION` 映射为 400、`AUTHORIZATION` 映射为 403、`NOT_FOUND` 映射为 404、`CONFLICT` 映射为 409、`UNAVAILABLE` 映射为 503
- **AND** local auth required MUST 产生已文档化的 401 challenge 或安全错误响应
- **AND** 公开响应 MUST 包含安全 `code` 和安全 `message`

#### Scenario: 路由本地错误使用安全错误形状
- **WHEN** 路由本地校验、缺失依赖、服务不可用、缺失输出或 not-found 情形由 Web channel 直接返回
- **THEN** 响应 MUST 使用已文档化的安全错误形状
- **AND** 错误码 MUST 列在该端点的错误规格中
- **AND** 路由本地错误 MUST NOT 返回未文档化的纯字符串错误体

#### Scenario: Share 与 stream 协议错误已文档化
- **WHEN** share 查看返回 forbidden、not-found 或 expired 结果
- **THEN** 端点规格 MUST 文档化对应的安全错误码和 HTTP status
- **WHEN** WebSocket 建立在协议升级前失败
- **THEN** 失败响应 MUST 使用已文档化的安全错误体和 status code

### Requirement: Web channel API 文档 MUST 与可执行 schema 和路由投影保持对齐

权威的 Web channel API 文档 SHALL 与可执行路由 schema 和公开 DTO 投影保持对齐。`docs/agent-web-api-list.md` MUST 列出暴露给 agent-web 的每个端点，并为每个端点提供请求参数、成功响应字段和错误码。`docs/developer/10-api-reference.md` MUST 保持为简明参考，并 MUST 链接到权威 Web channel API 列表，而不是定义冲突的字段细节。

#### Scenario: 端点清单保持完整
- **WHEN** 路由注册表暴露、移除或重命名一个面向 agent-web 的端点
- **THEN** 权威 API 文档 MUST 在同一 change 中更新
- **AND** 路由/schema 覆盖测试 MUST 检测到未文档化的公开端点

#### Scenario: 字段示例与 schema 一致
- **WHEN** API 文档包含请求、响应或错误体的示例 JSON
- **THEN** 示例 MUST 使用与可执行 schema 或已文档化投影代码一致的字段名、enum 值和可选性
- **AND** 公开 DTO 中不存在的过时别名 MUST 被更正或移除

#### Scenario: 文档不重新定义内部所有权
- **WHEN** API 文档描述一个 Web channel 响应
- **THEN** 它 MUST 只描述公开 DTO 和安全投影
- **AND** 它 MUST NOT 在拥有该内容的 spec/design 之外重新定义 runtime lifecycle、session 所有权、gateway record 所有权或 provider adapter 行为

### Requirement: Web channel API 完整性 MUST 可验证

Web channel API 完整性 SHALL 由可重复的验证守护。测试或验证脚本 MUST 验证公开 Web channel 端点的路由/schema 覆盖、安全错误形状覆盖和文档对齐。该验证 MUST 在不依赖活跃外部 model provider 的情况下运行。

#### Scenario: schema 覆盖验证检测缺失的路由规格
- **WHEN** 一个公开 Web channel 路由缺少必要的请求或响应 schema 覆盖
- **THEN** 验证 MUST 失败，并给出标识该路由和缺失 schema 类别的消息

#### Scenario: 安全错误验证检测不安全或不完整的错误
- **WHEN** 一个 Web channel 路由返回的路由本地错误缺少安全 `code` 和安全 `message`
- **THEN** 验证 MUST 失败
- **AND** 失败的路由和 status code MUST 能从测试输出中识别

#### Scenario: 文档对齐验证检测漂移
- **WHEN** 权威 API 文档命名的响应字段或 enum 值与可执行 schema 或投影测试冲突
- **THEN** 验证 MUST 失败
- **AND** 失败结果 MUST 标识端点以及不匹配的字段或 enum 值
