# Spec Delta: web-channel-api-contract

## Function

- 所属 Function：legacy spec（`web-channel-api-contract` 无已确认 Function 映射）
- Function 变更类型：`MODIFIED`
- spec 角色：主规格

## ADDED Requirements

### Requirement: Web channel 必须下发 Content-Security-Policy 响应头

Web channel MUST 在全部常规 HTTP 响应、SSE 响应以及 WebSocket 101 握手和 4xx 降级响应中携带 `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`。三类响应的 CSP 值 MUST 相同，MUST NOT 被传输协议或其他运行时条件改变。

CSP 在浏览器渲染 `text/html` 文档时 MUST 允许同源资源、运行时 `<style>`、style attribute 和 `data:` 图片，MUST 继续阻止没有 nonce 或 hash 的 inline script。JSON、SSE 和 WebSocket 响应上的 CSP 头被浏览器忽略。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：Web channel

#### Scenario: 常规 JSON 响应携带 CSP
- **WHEN** 客户端发送 `GET /api/v1/sessions` 请求
- **THEN** 响应 MUST 携带 `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`

#### Scenario: Agent Web 在 CSP 下保持可用样式和图片
- **WHEN** 浏览器加载 Web channel 提供的 Agent Web 页面，且页面使用运行时 `<style>`、style attribute 和 `data:` 图片
- **THEN** CSP MUST NOT 阻止这些样式和图片
- **AND** 页面 MUST 保持组件样式和图片可用

#### Scenario: CSP 继续阻止 inline script
- **WHEN** 浏览器加载 Web channel 提供的 HTML，且页面包含没有 nonce 或 hash 的 inline script
- **THEN** CSP MUST 阻止该 inline script 执行

#### Scenario: SSE 流响应携带 CSP
- **WHEN** 客户端通过 SSE 连接 Request Execution Stream
- **THEN** SSE 响应 MUST 携带 `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`

#### Scenario: WebSocket 握手响应携带 CSP
- **WHEN** 客户端发起 WebSocket 升级请求
- **THEN** 101 Switching Protocols 握手响应 MUST 携带 `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`

#### Scenario: WebSocket 4xx 降级响应携带 CSP
- **WHEN** WebSocket 升级请求被拒绝（如无效 handshake）
- **THEN** 4xx 错误响应 MUST 携带 `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`

### Requirement: Web channel 必须无条件下发 Strict-Transport-Security 响应头

Web channel MUST 在所有出站响应中无条件携带 `Strict-Transport-Security: max-age=31536000; includeSubDomains` 响应头。该头 MUST NOT 根据外部或内部传输协议以及其他运行时条件被删除或跳过。

该头 MUST 出现在全部常规 HTTP 响应、SSE 响应以及 WebSocket 101 握手和 4xx 降级响应中。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：Web channel

#### Scenario: HTTP 响应携带 HSTS
- **WHEN** 客户端通过 HTTP（代理后）发送请求
- **THEN** 响应 MUST 携带 `Strict-Transport-Security: max-age=31536000; includeSubDomains`

#### Scenario: HTTPS 响应携带 HSTS
- **WHEN** 客户端通过 HTTPS 直接发送请求
- **THEN** 响应 MUST 携带 `Strict-Transport-Security: max-age=31536000; includeSubDomains`

#### Scenario: SSE 流响应携带 HSTS
- **WHEN** 客户端通过 SSE 连接 Request Execution Stream 且应用在 HTTP（代理后）运行
- **THEN** SSE 响应 MUST 携带 `Strict-Transport-Security: max-age=31536000; includeSubDomains`

#### Scenario: WebSocket ws 握手响应携带 HSTS
- **WHEN** 客户端通过 ws（非 TLS）发起 WebSocket 升级请求
- **THEN** 101 握手响应 MUST 携带 `Strict-Transport-Security: max-age=31536000; includeSubDomains`

## Function 变更汇总

### 规格

- **规格项**：CSP 安全响应头
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`；允许 Agent Web 必需的运行时样式和 `data:` 图片，同时继续阻止 inline script
- **依据 Requirements**：`Web channel 必须下发 Content-Security-Policy 响应头`

- **规格项**：HSTS 发出条件
- **变更类型**：修改
- **原规格值**：仅在 `protocol === 'https'` 时发出
- **目标规格值**：所有出站响应无条件发出 `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- **依据 Requirements**：`Web channel 必须无条件下发 Strict-Transport-Security 响应头`
