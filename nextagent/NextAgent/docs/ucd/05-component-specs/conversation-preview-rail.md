# 组件规范：当前会话预览轨道（Conversation Preview Rail）

> 权威行为来源：`openspec/specs/session-conversation-preview/spec.md`。过程历史调度来源：`openspec/specs/agent-web-process-panel/spec.md` 与 `openspec/designs/architecture/conversation-process-history.md`。本文是 UCD 设计表达层，不定义新的 API 或运行时契约。

> **状态基线（2026-08-13）**：该轨道已由当前会话对话区消费，不属于 sidebar session list item，也不是跨会话内容预览。

## 职责

预览轨道位于会话列表与主对话区之间，帮助用户在长会话中：

- 扫描当前会话的回合分布和摘要。
- 悬停 marker 查看有界摘要。
- 点击 marker 跳转到目标回合。
- 在目标回合尚未加载时，加载对应消息页并完成定位。

轨道不拥有 Message、Event 或 process lifecycle truth；它只发布用户导航意图，并复用 chat workspace 的消息分页和过程历史调度。

## 数据与虚拟化

- 初始窗口加载最新 100 个 preview item。
- 轨道必须采用虚拟化渲染，不能为完整长会话一次创建全部 marker DOM。
- placeholder marker 只表示未加载范围；hover placeholder 不触发请求、不显示伪摘要。
- 快速滚动时最多维护 2 个 preview 请求，不得为每个经过的窗口发起查询。

## 交互状态

| 状态 | 视觉和行为 |
|---|---|
| default | marker 显示回合位置和最小状态提示 |
| hover | 显示有界摘要卡；不触发 Event history 请求 |
| selected | marker 与主对话区当前回合建立明确高亮关联 |
| loading target | 保持 marker 稳定，在目标定位区域显示局部 loading |
| unavailable | marker 保留，摘要或过程详情显示安全不可用，不阻塞消息导航 |

## 与过程历史加载的协作

1. Hover 只读取 preview 数据，不提升 process history 优先级。
2. Click 产生显式导航目标；目标 Message 页优先加载。
3. 目标回合进入可视区后，其 run Event 查询进入显式优先队列。
4. 中间经过的回合不因动画滚动或 scrollbar drag 逐一触发 Event 请求。
5. 用户快速点击多个 marker 时只保留最终导航意图；已经发出的安全只读请求允许完成并进入缓存。

## 边界

- Sidebar 会话摘要是另一个尚未交付的产品能力，不能复用本轨道的 per-session API 形成 N+1 请求。
- 预览摘要不得包含原始 thinking、工具参数、credential、文件路径或 raw error。
- 轨道不得绕过 Message/Event 查询的 Agent Scope 与 Owner Scope。
- 宿主模式只能调整容器尺寸与视觉 token，不能实现平行的预览、缓存或 history hydration 语义。

## 验收场景

- 200～300 轮会话快速滚轮滚动时，轨道保持可操作，不为每个中间窗口请求过程 Event。
- 拖动 scrollbar thumb 到远端并释放时，只为最终可视范围调度过程历史。
- Hover 多个 marker 时，Event 请求数不增加。
- 点击未加载 marker 后，目标 Message 可定位，过程详情随后渐进出现。
- 页面刷新、切换会话再返回后，轨道与主对话区定位一致，不出现跨会话回填。
