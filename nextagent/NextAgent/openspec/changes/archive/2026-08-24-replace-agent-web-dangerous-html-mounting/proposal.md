# Proposal: 移除 Agent Web 原始 HTML 直挂载

## Why

Agent Web 的普通 Markdown 与 Mermaid 渲染已经分别通过 `xss` 与 Mermaid strict/SVG cleanup 完成净化，但最终挂载仍分散使用 `dangerouslySetInnerHTML`。这让安全读者必须在三个调用点分别确认“输入已经净化”，也容易让后续功能复制同一模式，扩大原始 HTML 挂载面。

本次不改变 Markdown 语法、链接/图片安全规则、Mermaid 净化规则或用户可见渲染结果；变化是把已净化 HTML 的最终挂载收敛到一个专门的 parser mount 边界，移除生产源码中的 `dangerouslySetInnerHTML` 与直接 `innerHTML` 赋值。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 已净化的 block Markdown、inline Markdown 与 Mermaid SVG/CSS 通过同一个浏览器挂载组件进入 DOM。
- 挂载组件使用 `DOMParser` 与 `replaceChildren`，更新时清除旧节点，不残留旧正文或旧图表。
- 生产源码不得新增 `dangerouslySetInnerHTML` 或直接 `innerHTML` 赋值。
- 既有 Markdown `xss` 白名单、链接/图片安全逻辑、Mermaid `securityLevel: "strict"`、`htmlLabels: false` 与 SVG cleanup 保持不变。

**非目标：**

- 不新增第二套 HTML sanitizer，不放宽任何元素、属性、URL 或样式白名单。
- 不改变 Markdown/Mermaid 的用户可见样式、交互、懒加载、失败降级或尺寸通知。
- 不处理测试、Node scripts、静态开发工具或插件 HTML asset 中的 HTML 操作。
- 不引入新的前端依赖。

## What Changes

- 新增一个只接受“已净化 HTML”的 Agent Web 挂载组件。
- block Markdown 与 inline Markdown 改用该组件挂载。
- Mermaid 已净化 SVG 与固定样式改用该组件挂载。
- 新增源代码边界断言与注入 negative test，防止回退到直挂载模式。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.22 展示会话消息正文` → `specs/agent-web-assistant-markdown-rendering/spec.md`
  - 功能边界：已净化 Markdown/Mermaid 输出的最终 DOM 挂载必须经过统一 parser mount，禁止生产源码直接使用 raw HTML assignment。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：canonical spec；本 change 不修改既有 Markdown 语义、链接/图片安全 Requirements 或 Mermaid 行为 Requirements。

## 影响范围（Impact）

- Agent Web 用户：Markdown 与 Mermaid 渲染结果、交互和视觉行为保持不变。
- 前端开发者：后续新增渲染入口不能再复制 `dangerouslySetInnerHTML` 模式。
- 测试：覆盖挂载更新、脚本注入 negative case 与生产源码防回退断言。
- 不改变公共 Web API、stream event、runtime command、capability contract、gateway contract 或 persistence。
