# Tasks: 移除 Agent Web 原始 HTML 直挂载

## 1. `FN-1.22 展示会话消息正文`

- [x] 1.1 新增 `SanitizedHtml` parser mount 与安全/架构测试：覆盖节点替换、raw script 不进入 DOM/执行，以及生产源码禁止 `dangerouslySetInnerHTML` / `innerHTML =`。
  来源：`FN-1.22` + 系统质量属性（安全、可维护性、可测试性）+ Requirement `Sanitized Markdown and Mermaid output uses a dedicated parser mount` + 全部 Scenarios
  验证：实施前用 `rg 'dangerouslySetInnerHTML|\\binnerHTML\\s*=' frontend/agent-web/src` 确认 3 处 direct mount；在 `frontend/agent-web` 运行 `npm test -- tests/sanitized-html-mount.test.tsx`。
  实际结果（2026-08-22）：实施前 scan 定位 Markdown 2 处与 Mermaid 1 处；新增测试后 3 项通过，包括节点替换、raw script negative case 与源代码边界断言。

- [x] 1.2 将 block Markdown、inline Markdown 与 Mermaid 已净化输出迁移到 `SanitizedHtmlDiv` / `SanitizedHtmlSpan`，保持上游 `xss` 与 `sanitizeSvg` 不变。
  来源：Requirement `Sanitized Markdown and Mermaid output uses a dedicated parser mount` + Scenarios `已净化正文通过统一挂载边界进入 DOM`、`更新时清除旧渲染节点`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/sanitized-html-mount.test.tsx tests/markdown-link-safety.test.tsx tests/lazy-mermaid.component.test.tsx tests/TurnBlock.mermaid-scroll.test.tsx` 与 `npm run build`；预期全部通过。
  实际结果（2026-08-22）：4 个测试文件 27/27 通过；TypeScript build 通过；`rg` 确认生产源码无 direct raw HTML assignment。

## 归档前更新基线检查（非实施任务）

按 design 的“长期基线刷新计划”同步 stable spec、Function 文档与 `frontend/agent-web/ARCHITECTURE.md`；归档前重新运行 strict validation 并确认没有形成第二套 sanitizer owner。
