## 1. `FN-1.22 展示会话消息正文`

- [x] 1.1 编写 `isSameOriginUrl` 和 `isSafeNavigationUrl` 纯函数测试，覆盖同源/跨源绝对 URL、相对路径、fragment、`data:` URI、`mailto:`/`tel:`、`javascript:`、`vbscript:`、空字符串和无法解析的 URL
  来源：`FN-1.22` + 系统质量属性 + `Markdown 图片仅渲染同源 URL` + 同源图片渲染为 img 元素；`FN-1.22` + 系统质量属性 + `Markdown 链接安全属性与跨源确认门` + data-external-href 中的危险协议被 click handler 阻断
  验证：`cd frontend/agent-web && node node_modules/vitest/vitest.mjs run tests/urlSafety.test.ts`

- [x] 1.2 编写图片同源过滤测试，覆盖同源图片渲染为 `<img>`、跨源图片展示为文本、`data:` URI 渲染为 `<img>`、`javascript:` 协议展示为文本
  来源：`FN-1.22` + 系统质量属性 + `Markdown 图片仅渲染同源 URL` + 全部 Scenario
  验证：`cd frontend/agent-web && node node_modules/vitest/vitest.mjs run tests/markdown-link-safety.test.tsx`

- [x] 1.3 编写链接安全属性与跨源确认门测试，覆盖 `target="_blank" rel="noopener noreferrer"`、同源链接保留 `href`、跨源链接使用 `data-external-href`、点击确认流程、用户确认后打开、用户取消不跳转、`javascript:` 链接展示为文本、`data-external-href` 中危险协议被阻断
  来源：`FN-1.22` + 系统质量属性 + `Markdown 链接安全属性与跨源确认门` + 全部 Scenario
  验证：`cd frontend/agent-web && node node_modules/vitest/vitest.mjs run tests/markdown-link-safety.test.tsx`

- [x] 1.4 实现 `urlSafety.ts` 中的 `isSameOriginUrl` 和 `isSafeNavigationUrl` 函数
  来源：`FN-1.22` + 系统质量属性 + `Markdown 图片仅渲染同源 URL` + `Markdown 链接安全属性与跨源确认门`
  验证：`cd frontend/agent-web && node node_modules/vitest/vitest.mjs run tests/urlSafety.test.ts`

- [x] 1.5 实现 `MarkdownContent.tsx` 中的 `image` renderer override、`link` renderer override、`xss` 白名单扩展和 `onClickCapture` click handler
  来源：`FN-1.22` + 系统质量属性 + `Markdown 图片仅渲染同源 URL` + `Markdown 链接安全属性与跨源确认门`
  验证：`cd frontend/agent-web && node node_modules/vitest/vitest.mjs run tests/markdown-link-safety.test.tsx`

- [x] 1.6 实现 `i18n` 资源中 `markdown` section 的外部链接确认提示 key
  来源：`FN-1.22` + 系统质量属性 + `Markdown 链接安全属性与跨源确认门` + 点击跨源链接弹出确认提示
  验证：`cd frontend/agent-web && node node_modules/typescript/bin/tsc --noEmit`

## 2. Change 整体验证

- [x] 2.1 运行前端 TypeScript 编译和全量测试，确认修改文件无类型错误且全部测试通过
  来源：proposal 影响范围 + design 验证策略
  验证：`cd frontend/agent-web && node node_modules/typescript/bin/tsc --noEmit && node node_modules/vitest/vitest.mjs run tests/urlSafety.test.ts tests/markdown-link-safety.test.tsx`

- [x] 2.2 运行 strict OpenSpec validation 和模型检视
  来源：proposal 影响范围 + design 验证策略
  验证：根目录运行 `openspec validate --all --strict`、`$nextagent-skill-review` 和 `$nextagent-code-review`

## 归档前更新基线检查（非实施任务）

按 design 的"长期基线刷新计划"归并两个新增 Requirements 到 stable spec，并更新 Function 文档的处理过程和规格表。
