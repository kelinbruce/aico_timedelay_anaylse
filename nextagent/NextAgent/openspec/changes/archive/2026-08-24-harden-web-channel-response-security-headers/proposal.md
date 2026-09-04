# harden-web-channel-response-security-headers

## 背景与问题（Why）

Web channel 在常规 HTTP、SSE 和 WebSocket 三类出站响应中下发统一安全响应头。当前存在两个问题：

1. **缺少与产品页面兼容的 Content-Security-Policy**：Web channel 必须阻止 inline script 和跨源资源加载，同时不能阻断 Agent Web 正常渲染所需的运行时样式和 `data:` 图片。仅下发 `default-src 'self'` 会使 Ant Design 组件退化为浏览器默认样式并产生破图，不满足可用的安全默认值。

2. **Strict-Transport-Security 在代理后不生效**：`shouldEmitHsts` 只在 `protocol === 'https'` 时发出 HSTS。当 TLS 在反向代理或负载均衡器终结时，应用收到的是 HTTP，`request.protocol` 为 `'http'`，HSTS 永远不发出。环境中外部请求是 HTTPS，但应用无法感知。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Web channel 下发统一 CSP：默认只允许同源资源，允许页面运行时样式和 `data:` 图片，并继续禁止 inline script。
- 去掉 `shouldEmitHsts` 的 HTTPS 条件判断，HSTS 始终发出。
- 三条响应路径（onSend、SSE hijack、WebSocket raw socket）均覆盖上述变更。
- 安全响应头测试同步更新。

**非目标：**

- 不重构前端运行时样式、图标或 Mermaid 渲染管线。
- 不引入 CSP nonce/hash 注入管线；当前页面同时依赖运行时 `<style>` 和 style attribute，使用 nonce 不能单独闭合现有渲染路径。
- 不新增 `trustProxy` 配置；HSTS 始终发出，不需要区分 HTTP/HTTPS。
- 不修改其他安全头的值或条件。

## 变更范围（What Changes）

- `web-channel-api-contract` spec 新增 Requirement：Content-Security-Policy 安全响应头及 Agent Web 渲染兼容边界。
- `web-channel-api-contract` spec 新增 Requirement：Strict-Transport-Security 始终发出。
- 常规 HTTP、SSE 和 WebSocket 响应使用同一 CSP 值和无条件 HSTS 行为。
- 安全响应头测试和本地 release package gate 同步覆盖 CSP、浏览器安全边界和 HSTS 断言。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- legacy spec `web-channel-api-contract` -> `specs/web-channel-api-contract/spec.md`
  - 功能边界：补充 CSP、Agent Web 渲染兼容边界和 HSTS 始终发出的行为约束。
  - 系统质量属性：安全。
  - 映射说明：legacy spec 无已确认 Function 映射；本次只修改安全响应头 Requirements，不创建新 Function 或新 spec。

## 影响范围（Impact）

- 主要 owner：`agent-channel-common`、`agent-app`。
- 涉及代码：`security-response-headers.ts`、`fastify.ts`、`websocket.ts`。
- 涉及测试：`agent-channel-common/tests/security-response-headers.test.ts`、`agent-app/tests/security-response-headers.test.ts`、`agent-channel-web/tests/websocket-security-headers.test.ts`、`tests/e2e/release-package/release-package-gate.test.ts`。
- 后端 package、public DTO、数据库和配置不变。

## 验证（Validation）

- `npx vitest run packages/agent-channel-common/tests/security-response-headers.test.ts`
- `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/security-response-headers.test.ts`
- `npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/websocket-security-headers.test.ts`
- `npm run test:e2e:release-package`
- `openspec validate harden-web-channel-response-security-headers --strict`
