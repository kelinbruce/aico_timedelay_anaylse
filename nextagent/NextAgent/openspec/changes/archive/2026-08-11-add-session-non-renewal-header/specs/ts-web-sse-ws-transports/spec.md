# Spec Delta: ts-web-sse-ws-transports

## MODIFIED Requirements

### Requirement: 会话非续期请求头
浏览器端自动重连的 SSE 流连接和关联诊断 HTTP 请求 MUST 携带 `x-non-renewal-session: true` 请求头，告知后端或外部网关该请求属于自动维持的流式连接或探针，MUST NOT 续期当前会话超时计时器。

前端 `connectStream` 的 `headers` 参数 MUST 只作用于 SSE fetch 调用。WebSocket transport MUST NOT 携带该头，因为浏览器 WebSocket API 不支持自定义 HTTP header；WebSocket 的会话续期控制由后续 OpenSpec change 通过 subprotocol 或 query parameter 扩展。

`x-non-renewal-session` 头的值 MUST 精确为字符串 `true`。该头 MUST NOT 从客户端请求体、模型输出、capability 参数或用户 metadata 派生。该头 MUST NOT 携带 credential、owner scope、agent scope 或任何高基数字段。

**需求类别**：安全性需求

#### Scenario: SSE 流连接携带非续期头
- **WHEN** 浏览器通过 SSE fetch 打开 Session Activity Projection Stream 或 Request Execution Stream
- **THEN** fetch 请求 MUST 携带 `x-non-renewal-session: true` 请求头
- **AND** 后端或外部网关收到该头时 MUST NOT 续期当前会话超时计时器
- **AND** 该头 MUST NOT 出现在 stream event payload、timeline event、audit log 或 safe error 中

#### Scenario: auth probe HTTP 请求携带非续期头
- **WHEN** 浏览器在 stream 断连时发送 auth probe HTTP 请求（`GET /api/v1/sessions?offset=0&limit=1`）
- **THEN** 该请求 MUST 携带 `x-non-renewal-session: true` 请求头
- **AND** 后端或外部网关收到该头时 MUST NOT 续期当前会话超时计时器

#### Scenario: WebSocket 不携带非续期头
- **WHEN** 浏览器通过 WebSocket 打开 stream 连接
- **THEN** WebSocket 连接 MUST NOT 携带 `x-non-renewal-session` 请求头或 query parameter
- **AND** WebSocket 的会话续期控制 MUST NOT 由本 spec 定义，MUST 通过后续独立 OpenSpec change 扩展

#### Scenario: 用户主动请求不携带非续期头
- **WHEN** 用户通过 Web channel 主动提交请求（submit、retry、edit、cancel、answer pending input 等）
- **THEN** 这些 HTTP 请求 MUST NOT 携带 `x-non-renewal-session` 头
- **AND** 后端或外部网关 MUST 正常续期当前会话超时计时器
