# FN-1.22 展示会话消息正文

> 能力域 D1 会话与流式交互 · 子域 [D1.2 会话生命周期管理](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-1.4](../../../features/D1-会话与流式交互/D1.2-会话生命周期管理/F-1.4-查看会话内容.md) |
| 主规格 | [`agent-web-assistant-markdown-rendering`](../../../../specs/agent-web-assistant-markdown-rendering/spec.md) |
| 接口 | 无新增接口；消费会话消息和 Web stream 的既有安全正文投影 |

## 描述

系统把已完成普通 assistant 正文展示为安全、语义一致且在宽窄视口下可读的 Markdown 内容，并在不改变消息事实的前提下保留点分标识符、任务状态和表格列对齐。正文中的图片仅渲染同源 URL，链接统一携带安全属性，跨源链接需用户确认后才能跳转。

## 前置条件

- 用户已获准查看目标会话。
- 普通 assistant turn 已完成并具有可见安全正文。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| assistant 正文 | 是 | 已由既有会话或 stream 投影提供的安全可见文本 |
| viewport 可用宽度 | 是 | 当前共享消息列的响应式可用宽度 |

## 输出

安全的 Markdown 语义结构。点分标识符保持在原文本块内，GFM 任务项显示不可交互状态，表格保留列对齐；窄视口下宽表和 Mermaid 分别在自身容器内横向滚动。

## 处理过程

1. 系统识别已完成普通 assistant 正文中的受支持 Markdown、代码和已验证 GFM table 结构。
2. 系统保留点分标识符和真实有序列表各自的语义边界。
3. 系统把任务标记展示为不可交互状态，并拒绝原始输入控件、事件属性和脚本获得执行能力。
4. 系统保留表格分隔行声明的列对齐，并按当前 viewport 提供表格或 Mermaid 的局部横向滚动。
5. 系统在共享响应式消息列内展示正文，并为 composer footer surface 保留不透出历史文字的底部安全区。
6. 系统只把同源图片 URL 渲染为 <img> 元素，非同源图片 URL 以转义文本展示；危险协议 URL 不生成图片标签。
7. 系统为所有链接添加 target="_blank" 和 rel="noopener noreferrer"，同源链接保留原始 href 直接打开，跨源链接通过 data-external-href 和确认提示门拦截跳转；危险协议 URL 被协议白名单阻断。

## 结果

- 正常：正文语义、任务状态、表格对齐及响应式可读性保持一致。
- 不可信 HTML：不生成可交互输入控件或可执行处理器。
- 跨源图片：非同源图片 URL 以转义文本展示，不生成 <img> 标签。
- 跨源链接：用户点击跨源链接时弹出确认提示，确认后在新标签页打开，取消则不跳转；危险协议 URL 被协议白名单阻断。
- 窄视口：表格和 Mermaid 保持至少 `560px` 的内部可读结构，不产生页面级横向溢出。
- 宽视口：所有模型返回内容继续使用共享消息列，不增加内容类型级固定最大宽度。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 文本结构 | 点分标识符保持所属块；真实有序列表边界继续生效 | `agent-web-assistant-markdown-rendering / 点分标识符保持所属正文结构` |
| 任务状态安全 | 仅展示不可交互 checkbox 语义；原始输入和可执行载荷 fail closed | `agent-web-assistant-markdown-rendering / 任务列表以受控不可交互状态展示` |
| 表格语义 | 左、右、居中和默认列对齐作用于同列表头及数据单元格 | `agent-web-assistant-markdown-rendering / GFM 表格保留列对齐语义` |
| 响应式可读性 | 表格与 Mermaid 内部最小宽度 `560px` 并各自横向滚动；共享消息列无子类型级固定最大宽度 | `agent-web-assistant-markdown-rendering / 消息正文在宽窄视口保持可读` |
| 图片同源过滤 | 仅同源 URL（相对路径、fragment、`data:` URI）渲染为 `<img>`；非同源 URL 以转义文本展示 | `agent-web-assistant-markdown-rendering / Markdown 图片仅渲染同源 URL` |
| 链接安全属性 | 所有链接 `target="_blank"` `rel="noopener noreferrer"`；跨源链接需确认后跳转；协议白名单仅 `http:`、`https:`、`//` | `agent-web-assistant-markdown-rendering / Markdown 链接安全属性与跨源确认门` |
