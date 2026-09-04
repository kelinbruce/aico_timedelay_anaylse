## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.22 展示会话消息正文` | 图片同源过滤、链接安全属性与跨源确认门 | `agent-web-assistant-markdown-rendering` | `FN-1.22 展示会话消息正文` |

## `FN-1.22 展示会话消息正文`

### 目标与规范依据

本设计满足 proposal 中定义的图片同源过滤和链接安全约束目标。

#### 本 Function 的目标 Requirements

canonical spec：`agent-web-assistant-markdown-rendering`

- `ADDED`：`Markdown 图片仅渲染同源 URL`
- `ADDED`：`Markdown 链接安全属性与跨源确认门`

### 当前实现

`MarkdownContent.tsx` 使用 `marked` 解析 Markdown，再经 `xss` sanitization 后通过 `dangerouslySetInnerHTML` 渲染。已有 renderer override 覆盖 `checkbox`、`html`、`image` 和 `link`，其中 `image` 和 `link` 使用 marked 默认实现，不对 URL 做同源或协议检查。`xss` 白名单允许 `a` 标签的 `target`、`href`、`title` 属性，但不检查 `href` 值中的协议安全性。没有 click handler 拦截链接导航行为。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 图片同源过滤 | `image` renderer 使用 marked 默认实现，所有 URL 均生成 `<img>` | 需增加同源判定，非同源 URL 输出为文本 |
| 链接安全属性 | `link` renderer 使用 marked 默认实现，不添加 `target` 和 `rel` | 需在 renderer override 中统一添加 |
| 跨源确认门 | 无 click handler 拦截链接点击 | 需增加 `onClickCapture` 和 `Modal.confirm` |
| 协议白名单 | 无协议检查，`javascript:` URL 可到达 `window.open` | 需增加 `isSafeNavigationUrl` 协议白名单 |

### 修改方案

#### urlSafety.ts

新增 `isSameOriginUrl` 和 `isSafeNavigationUrl` 两个纯函数：

- `isSameOriginUrl(url)`：判定 URL 是否与 `window.location` 同源。相对路径（`/`、`./`、`../`）、fragment（`#`）、`data:` URI 和 `mailto:`/`tel:` 协议视为同源。绝对 URL 通过 `new URL()` 解析后比较 protocol、hostname 和 port。SSR 环境下绝对 URL 默认返回 `false`。
- `isSafeNavigationUrl(url)`：判定 URL 是否可安全用于 `window.open`。仅允许 `http:`、`https:` 协议和 protocol-relative `//` URL。其他协议（`javascript:`、`vbscript:`、`data:`、`file:` 等）返回 `false`。

#### MarkdownContent.tsx renderer overrides

`image` renderer（arrow function）：检查 `href` 是否同源。同源则生成 `<img>` 标签，非同源则返回 `escapeHtml(href)` 作为纯文本。

`link` renderer（`function` 形式以保留 `this.parser`）：先调用 `isSameOriginUrl` 判定同源。如果非同源且 `isSafeNavigationUrl` 返回 `false`（危险协议），直接返回 `escapeHtml(href)` 作为纯文本。同源链接保留原始 `href` 并添加 `target="_blank" rel="noopener noreferrer"`。非同源安全链接把真实 URL 存入 `data-external-href`、`href` 设为 `#`、添加 `class="markdown-external-link"` 和安全属性。

`xss` 白名单扩展：`a` 标签新增 `rel`、`data-external-href`、`class` 三个属性。

#### MarkdownContent.tsx click handler

在组件根 `div` 上添加 `onClickCapture`。handler 检查点击目标是否为 `a[data-external-href]` 元素。如果是，阻止默认导航，读取 `data-external-href` 值，用 `isSafeNavigationUrl` 校验协议白名单。通过校验后弹出 `Modal.confirm` 确认提示，用户确认后调用 `window.open(externalUrl, '_blank', 'noopener,noreferrer')`。未通过校验或用户取消则不执行任何导航。

#### i18n 资源

在 `zh-CN.ts` 和 `en-US.ts` 的 `markdown` section 下新增 `externalLinkConfirmTitle`、`externalLinkConfirmContent`、`externalLinkConfirmOk` 和 `externalLinkConfirmCancel` 四个 key。

#### 测试导出

`renderMarkdownHtml` 函数保持非导出，新增 `__renderMarkdownHtmlForTest` 导出 wrapper 供测试调用，遵循现有 `__resetMarkdownContentTestState` 的命名约定。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Markdown 图片仅渲染同源 URL`、`Markdown 链接安全属性与跨源确认门` | 同源判定 + 协议白名单 + click handler 拦截 + 确认门 | 同源/跨源图片渲染、链接属性、确认流程、危险协议阻断 |

## 验证策略（Verification Strategy）

- `isSameOriginUrl` 和 `isSafeNavigationUrl` 的纯函数行为由单元测试覆盖（`urlSafety.test.ts`），包括同源/跨源绝对 URL、相对路径、fragment、`data:` URI、`mailto:`/`tel:`、`javascript:`、`vbscript:`、空字符串和无法解析的 URL。
- 图片过滤、链接属性、确认流程和协议阻断由组件测试覆盖（`markdown-link-safety.test.tsx`），使用 `react-dom/client` + `flushSync` 渲染和 mock `Modal.confirm`。
- TypeScript 编译验证修改文件无类型错误。
- 前端 build 验证无编译错误。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/agent-web-assistant-markdown-rendering/spec.md`：归并两个新增 Requirements
- `openspec/designs/functions/D1-会话与流式交互/D1.2-会话生命周期管理/FN-1.22-展示会话消息正文.md`：更新处理过程和规格表，增加图片同源过滤和链接安全约束
- `openspec/designs/spec-to-design-map.md`：无新增导航
- `openspec/overview.md`：无
- `openspec/designs/architecture/`：无
- `openspec/designs/modules/`：无
- `openspec/designs/adr/`：无

## 风险与取舍（Risks / Trade-offs）

- 非同源图片以文本展示可能降低正文可读性，但安全优先于展示完整性。
- 跨源链接确认门增加一次用户交互，但防止了无意识的外部跳转。
- `data-external-href` 存储真实 URL，但 click handler 的协议白名单作为最后一道防线，即使 DOM 被篡改也不会打开危险协议 URL。

## 待确认问题（Open Questions）

无。
