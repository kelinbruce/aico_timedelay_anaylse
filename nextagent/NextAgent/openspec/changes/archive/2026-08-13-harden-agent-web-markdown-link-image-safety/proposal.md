## Why

用户查看 assistant 正文时，Markdown 渲染管线对 `img` 和 `a` 标签缺少同源安全约束。跨源图片会向第三方泄露 referer 和客户端信息，甚至加载追踪像素；链接缺少 `target="_blank"` 和 `rel="noopener noreferrer"`，且跨源链接直接跳转时用户无法获得离开本系统的安全提示；`javascript:` 等危险协议 URL 可能通过 `data-external-href` 或 `href` 到达 `window.open`，构成脚本执行风险。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 同源图片 URL 渲染为 `<img>` 元素；非同源图片 URL 以纯文本展示，不生成 `<img>` 标签。
- 所有 Markdown 链接 MUST 添加 `target="_blank"` 和 `rel="noopener noreferrer"` 属性。
- 同源链接直接打开；非同源链接 MUST 先弹出确认提示，用户确认后才在新标签页打开，取消则不跳转。
- `javascript:`、`vbscript:` 等危险协议 URL MUST NOT 进入 `window.open` 调用路径。

**非目标：**

- 不修改后端 Web API、stream event、runtime lifecycle 或 `agent-contracts`。
- 不新增 CSP header、服务器端 URL 校验或 URL 白名单配置。
- 不改变 `marked` 解析管线或 `xss` sanitization 基线白名单，只在 renderer override 层和 click handler 层增加安全约束。
- 不修改结构化消息渲染、Mermaid 渲染或 live tail 流式尾部行为。
- 不修改 `i18n` 已有 key 的语义，只在 `markdown` section 下新增外部链接确认提示文案。

## What Changes

- **新增**：`MarkdownContent` 的 marked renderer 增加 `image` override，只对同源 URL 生成 `<img>`，非同源 URL 输出为转义文本。
- **新增**：`MarkdownContent` 的 marked renderer 增加 `link` override，所有链接添加 `target="_blank" rel="noopener noreferrer"`；同源链接保留原始 `href`，非同源链接把真实 URL 存入 `data-external-href` 并把 `href` 设为 `#`。
- **新增**：`MarkdownContent` 增加 `onClickCapture` 拦截非同源链接点击，弹出 antd `Modal.confirm` 确认提示；用户确认后调用 `window.open` 打开真实 URL，取消则阻止跳转。
- **新增**：`src/utils/urlSafety.ts` 提供 `isSameOriginUrl` 和 `isSafeNavigationUrl` 两个纯函数，分别判定同源和可安全导航的协议白名单。
- **新增**：`i18n` 资源在 `markdown` section 下增加 `externalLinkConfirmTitle`、`externalLinkConfirmContent`、`externalLinkConfirmOk` 和 `externalLinkConfirmCancel` 四个 key，支持中英文。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.22 展示会话消息正文` → `specs/agent-web-assistant-markdown-rendering/spec.md`
  - 功能边界：在已完成普通 assistant 正文的 Markdown 渲染管线中增加图片同源过滤、链接安全属性和跨源确认门
  - 系统质量属性：安全
  - 映射说明：canonical spec

## 影响范围（Impact）

- 主要 owner：`frontend/agent-web`
- 主要代码：`MarkdownContent.tsx`、`urlSafety.ts`、`zh-CN.ts`、`en-US.ts` 及对应测试文件
- 主要验证：单元测试覆盖同源判定、协议白名单、图片过滤、链接属性和点击确认流程；前端 TypeScript 编译
- 后端 package、public DTO、数据库和配置不变
