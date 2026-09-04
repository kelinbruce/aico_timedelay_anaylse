# Tasks: harden-web-channel-response-security-headers

## web-channel-api-contract

- [x] 1. 在 `SECURITY_RESPONSE_HEADERS` 中把 CSP 收敛为 `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`，更新注释并保持三条响应路径复用同一值。
  - 来源：proposal 目标 + design CSP 头新增
  - 验证：`npx vitest run packages/agent-channel-common/tests/security-response-headers.test.ts`
  - 实际：2026-08-19 执行通过，1 个测试文件、8 个测试全部通过。

- [x] 2. 删除 `shouldEmitHsts` 函数，删除 `buildSecurityResponseHeaders` 中的 HSTS 条件删除逻辑，更新 `SecurityHeadersOptions.protocol` 注释和 `buildSecurityResponseHeaders` 文档注释。
  - 来源：proposal 目标 + design HSTS 条件移除
  - 验证：`npx vitest run packages/agent-channel-common/tests/security-response-headers.test.ts`
  - 实际：2026-08-19 执行通过，1 个测试文件、8 个测试全部通过。

- [x] 3. 在 `agent-app/server/fastify.ts` 中移除 `shouldEmitHsts` import 和 re-export，删除 onSend hook 中的 `removeHeader('Strict-Transport-Security')` 逻辑，更新注释。
  - 来源：proposal 变更范围 + design HSTS 条件移除
  - 验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/security-response-headers.test.ts`
  - 实际：2026-08-19 执行通过，1 个测试文件、4 个测试全部通过。

- [x] 4. 在 `agent-channel-web/transports/websocket.ts` 中更新过时注释（移除 shouldEmitHsts 引用）。
  - 来源：proposal 变更范围
  - 验证：`npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/websocket-security-headers.test.ts`
  - 实际：2026-08-19 执行通过，1 个测试文件、3 个测试全部通过。

- [x] 5. 在 `agent-app/tests/security-response-headers.test.ts` 中断言目标 CSP，将 HSTS withhold 测试改为始终期望存在，删除 `shouldEmitHsts` 测试。
  - 来源：design 验证策略
  - 验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/security-response-headers.test.ts`
  - 实际：2026-08-19 执行通过，1 个测试文件、4 个测试全部通过。

- [x] 6. 在 `agent-channel-common/tests/security-response-headers.test.ts` 中断言目标 CSP（普通响应和 SSE），并增加允许 inline style、允许 `data:` image、禁止 inline script 的语义测试。
  - 来源：design 验证策略
  - 验证：`npx vitest run packages/agent-channel-common/tests/security-response-headers.test.ts`
  - 实际：2026-08-19 执行通过，语义测试确认 style 与 `data:` image 允许且 script 未获得 `'unsafe-inline'`。

- [x] 7. 在 `agent-channel-web/tests/websocket-security-headers.test.ts` 中把 `EXPECTED_SECURITY_HEADERS` 更新为目标 CSP，并保持 HSTS 无条件发出断言。
  - 来源：design 验证策略
  - 验证：`npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/websocket-security-headers.test.ts`
  - 实际：2026-08-19 执行通过，1 个测试文件、3 个测试全部通过。

- [x] 8. 运行 `openspec validate harden-web-channel-response-security-headers --strict` 确认 spec 合规。
  - 来源：proposal 验证
  - 预期：通过
  - 实际：2026-08-19 执行通过；`openspec validate --all --strict` 同时为 299/299 通过。

- [x] 9. 运行三个安全头测试文件，确认全部通过。
  - 来源：design 验证策略
  - 预期：全部通过
  - 实际：2026-08-19 三条命令全部通过，共 15 个测试。

- [x] 10. 验证所有改动文件使用 CRLF 换行符。
  - 来源：仓库约定
  - 预期：无 LF/CRLF 混合警告
  - 实际：2026-08-19 校验 9 个改动文件，未发现 lone LF。

- [x] 11. 在本地 release package gate 中断言实际 with-frontend 候选包首页下发目标 CSP。
  - 来源：Web channel 必须下发 Content-Security-Policy 响应头 + Agent Web 在 CSP 下保持可用样式和图片
  - 验证：`npm run test:e2e:release-package`
  - 实际：2026-08-19 执行通过，候选包测试 4/4、报告写入测试 1/1。

- [x] 12. 重建 release package 并从新候选包执行浏览器验证，确认运行时 style 未被 CSP 阻止、`data:` 图片无破图且 inline script 仍被策略禁止。
  - 来源：Agent Web 在 CSP 下保持可用样式和图片 + CSP 继续阻止 inline script
  - 验证：`npm run pack:release -- skip`，启动新候选包后检查 CSP 响应头、浏览器 CSP violation、stylesheet 和 image 加载状态
  - 实际：2026-08-19 打包退出码 0；浏览器确认目标 CSP、31 个 stylesheet、30 个有效动态 stylesheet、6 张图片无破图且无 CSP violation；禁止 inline script 由同一策略的语义测试确认。
