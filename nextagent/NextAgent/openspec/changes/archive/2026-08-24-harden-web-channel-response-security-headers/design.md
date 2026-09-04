# Design: Web Channel Response Security Headers

## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| legacy spec `web-channel-api-contract` | 新增与 Agent Web 渲染兼容的 CSP 安全响应头，并让 HSTS 始终发出 | `web-channel-api-contract` | CSP 头新增、HSTS 条件移除 |

## CSP 头新增

### 目标与规范依据

本 Function 的目标 Requirements：
- canonical spec: web-channel-api-contract
- ADDED: Web channel 必须下发 Content-Security-Policy 响应头

Web channel 的 CSP 必须默认只允许同源资源，继续阻止 inline script，同时允许 Agent Web 当前产品路径使用的运行时 `<style>`、style attribute 和 `data:` 图片。

CSP 仅在浏览器渲染 `text/html` 文档时执行。JSON（`application/json`）、SSE（`text/event-stream`）和 WebSocket（101 Switching Protocols）响应上的 CSP 头被浏览器忽略，不会阻断任何功能。三条响应路径统一加同一组 header 是为了简单和不 drift。

### 当前实现

`SECURITY_RESPONSE_HEADERS` 在 `agent-channel-common/security-response-headers.ts` 中统一定义，并由 Fastify `onSend`、SSE hijack 和 WebSocket raw socket 三条响应路径复用。当前值为 `default-src 'self'`。浏览器会据此阻止 Agent Web 的 Ant Design 运行时样式、React style attribute 和 `data:` 图片；现有三个安全响应头测试只断言该精确字符串，本地 release package gate 只验证 HTML 和静态资源可达。

### GAP 分析

- 规范目标：所有响应携带统一 CSP；HTML 页面保留必需样式和图片，同时阻止 inline script。
- 当前事实：CSP 已下发，但 `default-src 'self'` 同时阻止 inline style 和 `data:` 图片，造成打包 UI 样式错乱和破图。
- 差距：策略缺少 `style-src` 和 `img-src` 的最小产品例外，验证也没有覆盖浏览器可观察结果。

### 修改方案

`agent-channel-common` 继续作为唯一 CSP 值 owner，将 `SECURITY_RESPONSE_HEADERS` 中的策略收敛为 `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`。Fastify、SSE 和 WebSocket 不新增分支，只复用该值：

- `default-src 'self'` 保持未显式声明的 script、font、connect 和其他资源类型仅允许同源；inline script 仍因没有 `'unsafe-inline'` 而被阻止。
- `style-src 'self' 'unsafe-inline'` 只开放现有运行时 `<style>` 和 style attribute；不开放 inline script。
- `img-src 'self' data:` 只增加 Agent Web 已使用的 `data:` 图片来源。

不采用 nonce/hash 管线。当前页面同时包含运行时 `<style>` 和 style attribute，nonce 只能覆盖前者；要消除 `'unsafe-inline'` 必须重构前端样式生成路径，超出本 change。也不重复声明 `script-src`、`font-src` 或 `connect-src`，因为它们继续继承 `default-src 'self'`，避免冗余策略漂移。

**质量属性影响（安全）：** CSP 继续阻止 inline script 和跨源资源，只对现有产品渲染必需的 style 与 `data:` image 做窄例外。验证必须同时覆盖允许路径和 inline script 禁止路径。

## HSTS 条件移除

### 目标与规范依据

本 Function 的目标 Requirements：
- canonical spec: web-channel-api-contract
- ADDED: Web channel 必须无条件下发 Strict-Transport-Security 响应头

`shouldEmitHsts(protocol)` 只在 `protocol === 'https'` 时返回 `true`。当 TLS 在反向代理终结时，应用收到 HTTP，HSTS 永远不发出。环境中外部请求是 HTTPS，代理透传 HSTS 头给 HTTPS 客户端，客户端在 HTTPS 上正常生效。若有人绕过代理直接 HTTP 访问应用，浏览器收到 HTTP 上的 HSTS 也会忽略（RFC 6797 强制要求），不会造成危害。

### 当前实现

`shouldEmitHsts` 函数 + `buildSecurityResponseHeaders` 中的条件删除 + `fastify.ts` onSend hook 中的 `removeHeader` 三层判断。

### GAP 分析

- 规范目标：HSTS MUST 在所有响应中发出。
- 当前事实：HSTS 仅在 `protocol === 'https'` 时发出，代理后不生效。
- 差距：`shouldEmitHsts` 条件逻辑阻止 HSTS 在代理后环境中发出。

### 修改方案

删除 `shouldEmitHsts` 函数。删除 `buildSecurityResponseHeaders` 中的 `if (!shouldEmitHsts(...)) { delete headers['Strict-Transport-Security']; }` 逻辑。删除 `fastify.ts` onSend hook 中的 `removeHeader` 逻辑。`SecurityHeadersOptions.protocol` 字段和 WebSocket `protocolForSocket` 函数一并删除，避免遗留 dead code。测试中 HSTS withhold 断言改为始终期望存在。

**质量属性影响（安全）：** HSTS 始终发出确保代理后环境也能收到 HSTS 头。浏览器在 HTTP 上忽略 HSTS（RFC 6797），不存在降级风险。

## 验证策略

| 验证目标 | 验证层级 | 来源 |
|---|---|---|
| CSP 头存在于 onSend 响应 | contract test | `agent-app/tests/security-response-headers.test.ts` |
| CSP 头存在于 buildSecurityResponseHeaders 输出 | contract test | `agent-channel-common/tests/security-response-headers.test.ts` |
| CSP 头存在于 SSE writeHead | contract test | `agent-channel-common/tests/security-response-headers.test.ts` |
| CSP 头存在于 WebSocket 101 和 4xx | contract test | `agent-channel-web/tests/websocket-security-headers.test.ts` |
| CSP 允许 style、`data:` image 且不允许 inline script | contract semantic test | `agent-channel-common/tests/security-response-headers.test.ts` |
| 实际 with-frontend 候选包下发目标 CSP | release package gate | `tests/e2e/release-package/release-package-gate.test.ts` |
| 实际打包页面无 CSP style violation 和破图 | packaged browser verification | `npm run pack:release -- skip` 后启动新候选包并检查浏览器 |
| HSTS 始终存在于 onSend 响应 | contract test | `agent-app/tests/security-response-headers.test.ts` |
| HSTS 始终存在于 buildSecurityResponseHeaders 输出 | contract test | `agent-channel-common/tests/security-response-headers.test.ts` |
| HSTS 始终存在于 SSE writeHead | contract test | `agent-channel-common/tests/security-response-headers.test.ts` |
| HSTS 始终存在于 WebSocket 101 和 4xx | contract test | `agent-channel-web/tests/websocket-security-headers.test.ts` |

## 长期基线刷新计划

- `openspec/specs/web-channel-api-contract/spec.md`：归并 CSP 和 HSTS 始终发出的 Requirement。
- `openspec/designs/modules/agent-channel-web.md`（如存在）：归并安全响应头设计说明。
- `openspec/designs/spec-to-design-map.md`：更新验证入口。
- Function: 无（修改既有 Function，不新增）
- Feature: 无
- overview: 无
- architecture: 无
- ADR: 无
