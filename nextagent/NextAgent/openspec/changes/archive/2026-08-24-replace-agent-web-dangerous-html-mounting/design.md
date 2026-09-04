# Design: 移除 Agent Web 原始 HTML 直挂载

## 设计范围（Design Scope）

| Function | 目标变化 | delta specs | Function 设计章节 |
|---|---|---|---|
| `FN-1.22 展示会话消息正文` | 已净化 Markdown/Mermaid 输出统一通过 parser mount 进入 DOM，移除生产源码直挂载模式 | `agent-web-assistant-markdown-rendering` | [FN-1.22 展示会话消息正文](#fn-122-展示会话消息正文) |

## FN-1.22 展示会话消息正文

### 目标与规范依据

普通 assistant 正文与 Mermaid 输出必须保持既有净化边界，同时把最终 DOM 挂载收敛到一个可测试组件。该组件不是 sanitizer，只接收上游已净化 HTML。

本 Function 的目标 Requirements：

- canonical spec：`agent-web-assistant-markdown-rendering`
  - `ADDED Sanitized Markdown and Mermaid output uses a dedicated parser mount`

### 当前实现

- Block Markdown 使用 `marked` + `xss` 后通过 `dangerouslySetInnerHTML` 挂载。
- Inline Markdown 使用同一净化流程后通过 `dangerouslySetInnerHTML` 挂载。
- Mermaid 使用 strict 配置与 SVG cleanup 后，连同固定样式通过 `dangerouslySetInnerHTML` 挂载。

### GAP 分析

- 净化与挂载耦合分散，安全读者需要逐点确认 raw HTML assignment 输入已净化。
- 缺少统一组件约束更新时清理旧节点。
- 缺少生产源码防回退断言。

### 修改方案

- 新增 `frontend/agent-web/src/features/chat/components/SanitizedHtml.tsx`，导出 `SanitizedHtmlDiv` 与 `SanitizedHtmlSpan`。
- 组件在 `useLayoutEffect` 中使用 `DOMParser.parseFromString(html, 'text/html')` 生成 detached nodes，并用 `replaceChildren(...parsed.body.childNodes)` 挂载，确保浏览器绘制前完成更新。
- Block Markdown、inline Markdown 与 Mermaid SVG/固定样式调用该组件；上游 `renderMarkdownHtml` 与 `sanitizeSvg` 保持不变。
- 新增测试覆盖节点替换、raw script negative case 与生产源码禁止 `dangerouslySetInnerHTML` / `innerHTML =`。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Sanitized Markdown and Mermaid output uses a dedicated parser mount` | 保持上游净化，统一 parser mount 并防止 raw executable HTML 挂载 | script negative、上游安全测试、源代码边界断言 |
| 可维护性 | `Sanitized Markdown and Mermaid output uses a dedicated parser mount` | 单一挂载 owner 替代三个直挂载点 | 生产源码无 direct raw HTML assignment |
| 可测试性 | `Sanitized Markdown and Mermaid output uses a dedicated parser mount` | 挂载组件可独立验证更新语义 | 更新后旧节点不存在 |

## 验证策略（Verification Strategy）

- unit：验证 parser mount 更新会替换旧节点。
- security/negative：验证 assistant raw HTML 中的 script 不进入 DOM 或执行。
- architecture/source boundary：扫描 `frontend/agent-web/src`，断言生产 TypeScript/TSX 不含 `dangerouslySetInnerHTML` 或直接 `innerHTML` 赋值。
- characterization：运行既有 Markdown 链接/图片安全测试、Mermaid sanitization/lazy rendering 测试和前端 TypeScript build，确认用户可见行为不变。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/agent-web-assistant-markdown-rendering/spec.md`：新增该 Requirement 与 `## Function` 元数据。
- `openspec/designs/functions/D1-会话与流式交互/D1.2-会话生命周期管理/FN-1.22-展示会话消息正文.md`：规格表新增已净化 HTML 挂载方式。
- `frontend/agent-web/ARCHITECTURE.md`：将当前 Markdown/Mermaid 挂载说明从 `dangerouslySetInnerHTML` 更新为统一 parser mount。
- `openspec/designs/spec-to-design-map.md`：无。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/*`：无。
- `openspec/designs/modules/*`：无。
- `openspec/designs/adr/*`：无。

## 风险与取舍（Risks / Trade-offs）

- Parser mount 在 layout effect 中填充，晚于 React host commit 但早于浏览器绘制；现有调用方不在同一 commit 内同步读取子 DOM。若未来出现该需求，需重新设计接口。
- 该组件不承担通用 sanitizer 职责；调用方必须继续使用既有 Markdown/Mermaid 净化边界，避免形成第二套安全规则。
- Source assertion 是架构边界回归门禁，不替代对上游 sanitizer 语义的模型审查。

## 待确认问题（Open Questions）

无。
