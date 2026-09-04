# 前端文档

本目录是 NextAgent 前端的统一阅读入口，覆盖 `frontend/agent-web` 的宿主形态、开发方式和用户工作流。这里记录经过代码核对的当前事实，但不重新定义产品契约；稳定行为仍以 OpenSpec 为准。

## 范围

- [`frontend/agent-web`](../../frontend/agent-web/)：面向用户的 Web 前端源码，以及 Local、Immersive、Collaborative / PIU 三种宿主接入。
- [`frontend/agent-web-mock-server`](../../frontend/agent-web-mock-server/)：前端独立联调使用的 Web Channel mock，不等同于完整 NextAgent 后端。
- [`packages/agent-dev-workbench`](../../packages/agent-dev-workbench/)：独立的开发调试工作台，不属于 `agent-web` 的产品路由或正式前端 artifact。

## 宿主形态

| 形态 | 定位 | 开发入口 | 正式交付边界 |
| --- | --- | --- | --- |
| Local | 独立开发和测试页面 | `http://127.0.0.1:5173/` | 不作为正式产品页面 artifact |
| Immersive | 由产品页面直接承载的完整业务区 | `http://127.0.0.1:5173/immersive/` | 页面 target，正式构建发布为 `index.html` |
| Collaborative / PIU | 嵌入宿主页面的协作式面板 | `http://127.0.0.1:5173/collaborative/` | `AIAgentPIU.js` 与 `AIAgentPIU.css` |

Local 与 Immersive 使用 `HashRouter` 驱动页面导航；Collaborative 的正式 PIU 不修改宿主 URL，而是通过内部 navigation adapter 选择会话。`/collaborative/` 只是开发态宿主 harness，不是正式 PIU 应用入口。长期宿主边界见 [Agent Web Host Modes](../../openspec/designs/architecture/agent-web-host-modes.md)。

## 文档权威关系

遇到描述不一致时，先判断问题属于哪一类：

1. [`openspec/specs/`](../../openspec/specs/) 定义已经归档的稳定行为契约。
2. [`openspec/changes/`](../../openspec/changes/) 承载尚未归档的变更；其中的目标不能被本文提升为稳定能力。
3. [`openspec/designs/`](../../openspec/designs/) 记录长期架构、模块设计和 ADR。
4. [`frontend/agent-web/ARCHITECTURE.md`](../../frontend/agent-web/ARCHITECTURE.md) 说明当前 package 的实现结构和 owner 边界。
5. [`frontend/agent-web/PRINCIPLE.md`](../../frontend/agent-web/PRINCIPLE.md) 说明界面设计原则。
6. `docs/frontend/` 面向用户和开发者解释如何使用、开发和排查前端。
7. [`docs/apis/agent-web-api-list.md`](../apis/agent-web-api-list.md) 是前端调用后端接口的查询清单，不代替 OpenSpec contract。

## 内容状态

本文档统一使用以下状态，避免把“代码已经存在”和“行为已经稳定”混为一谈：

- **Stable**：已有 `openspec/specs/` 稳定规格。
- **Active change**：由未归档 change 承载，仍可能随评审或实现调整。
- **Implementation-only**：当前代码可观察到该行为，但还没有完整稳定规格；这里只记录现状。
- **Known divergence（已知偏差）**：当前代码实现与 Stable Spec 或 Active change 不一致；文档必须分别说明规格要求和当前实现，不能用其中一方静默覆盖另一方。
- **Documentation-only**：只调整说明和导航，不改变产品行为。

当前需要特别区分的前端内容如下：

| 内容 | 状态 | 规格或代码 owner |
| --- | --- | --- |
| 多宿主、非本地权限控制 | Stable | `agent-web-multi-host-modes`、`agent-web-auth-control` |
| SSE / WebSocket transport 与运行时选择 | Stable | `ts-web-sse-ws-transports` |
| Markdown 附件接入 | Stable | `ts-attachment-intake` |
| 对话分享、点赞/点踩、后台任务控制 | Stable | `conversation-share`、`conversation-annotation`、`agent-web-background-task-control` |
| Pending Input 生命周期与 canonical kind | Stable | `human-pending-input-*`、`question-pending-input` 等稳定规格 |
| Pending Input 响应面板与普通 Composer 的互斥切换/恢复、展示型过期状态和 owning-request 取消委托 | Stable | `agent-web-pending-input-ui` |
| Pending Input 的具体视觉布局、倒计时格式/刷新频率与兼容 kind | Implementation-only | `RespondInput` 当前实现 |
| 已完成普通 assistant 的 Markdown、GFM 风格表格和普通代码语义 | Stable | `agent-web-assistant-markdown-rendering` |
| Composer 键盘与命令、附件队列、根路由首次普通提交会话建立、会话标题、edit-resubmit、欢迎页高频问题、Turn Run Graph 与 Mermaid 的有限行为基线 | Stable | 对应稳定规格 |
| Mermaid 完整 sanitization、raw error 日志安全与精确视觉细节 | Implementation-only；已知安全冲突另行处理 | 当前 renderer 实现 |
| AICO 自定义配置、OperatorsArea 与 CustomPanel | Stable | `aico-config-contract`、`aico-display-control`、`aico-layout-mode`、`aico-piu-injection` |
| 工具结构化增量与结构化消息渲染 | Stable | `tool-structured-delta`、`agent-web-structured-message-rendering` |
| 扩展详情区域 | Stable | `agent-web-expand-panel` |
| 按 turn 返回收藏列表及其定位坐标 | Stable | `conversation-annotation` |
| 点击收藏项后在会话内精确定位目标 turn | Implementation-only | 当前收藏列表与 conversation 定位实现 |
| Agent Dev Workbench | Active change，独立产品面 | `add-ts-dev-agent-workbench` |

## 从哪里开始

- 想了解用户如何完成会话、提问、请求控制、分享和恢复：阅读[前端用户工作流](./user-workflows.md)。
- 想启动、测试或调试前端：阅读[前端开发指南](./development.md)。
- 想定位 entry、state、network 和 rendering owner：阅读[agent-web 实现架构](../../frontend/agent-web/ARCHITECTURE.md)。
- 想核对接口路径和字段：阅读 [agent-web API 清单](../apis/agent-web-api-list.md)。
- 想理解完整打包和后端托管：阅读[部署说明](../developer/12-deployment.md)。
- 想了解全仓测试与调试门禁：阅读[测试与调试](../developer/11-testing-debugging.md)。

## 稳定规格入口

- [多宿主模式](../../openspec/specs/agent-web-multi-host-modes/spec.md)
- [前端权限控制](../../openspec/specs/agent-web-auth-control/spec.md)
- [SSE / WebSocket transport](../../openspec/specs/ts-web-sse-ws-transports/spec.md)
- [Stream 历史一致性](../../openspec/specs/ts-stream-history-consistency/spec.md)
- [Stream 续传与重放](../../openspec/specs/ts-stream-resume-replay/spec.md)
- [附件接入](../../openspec/specs/ts-attachment-intake/spec.md)
- [Skill 查询目录](../../openspec/specs/web-skill-catalog/spec.md)
- [Skill 选择器](../../openspec/specs/skill-selector-ui/spec.md)
- [分类问题](../../openspec/specs/category-question-ui/spec.md)
- [高频问题](../../openspec/specs/high-frequency-question-ui/spec.md)
- [高频问题与 Pin API](../../openspec/specs/frequent-question-api/spec.md)
- [输入联想](../../openspec/specs/question-association-ui/spec.md)
- [回答后问题推荐](../../openspec/specs/question-recommendation/spec.md)
- [用户问题活动](../../openspec/specs/user-question-activity/spec.md)
- [对话过程面板](../../openspec/specs/agent-web-process-panel/spec.md)
- [对话窗格样式](../../openspec/specs/agent-web-chat-pane-styles/spec.md)
- [右侧布局样式](../../openspec/specs/agent-web-right-pane-styles/spec.md)
- [输入区按钮样式](../../openspec/specs/agent-web-composer-button-styles/spec.md)
- [欢迎区样式](../../openspec/specs/agent-web-welcome-block-styles/spec.md)
- [Skill 选择器样式](../../openspec/specs/agent-web-skill-selector-styles/spec.md)
- [对话标注](../../openspec/specs/conversation-annotation/spec.md)
- [对话分享](../../openspec/specs/conversation-share/spec.md)
- [后台任务控制](../../openspec/specs/agent-web-background-task-control/spec.md)
- [Pending Input 生命周期](../../openspec/specs/human-pending-input-core/spec.md)
- [Pending Input 前端响应面](../../openspec/specs/agent-web-pending-input-ui/spec.md)
- [普通 assistant Markdown 渲染](../../openspec/specs/agent-web-assistant-markdown-rendering/spec.md)
- [Composer 交互](../../openspec/specs/agent-web-composer-interaction/spec.md)
- [浏览器附件队列](../../openspec/specs/agent-web-attachment-composer/spec.md)
- [Mermaid 渲染](../../openspec/specs/agent-web-mermaid-rendering/spec.md)
- [Turn Run Graph](../../openspec/specs/agent-web-turn-run-graph/spec.md)
- [会话标题自动生成](../../openspec/specs/session-title-generation/spec.md)
- [会话标题手工更新](../../openspec/specs/session-title-update/spec.md)
- [最新问题编辑重提](../../openspec/specs/request-edit-resubmit/spec.md)
- [AICOConfig contract](../../openspec/specs/aico-config-contract/spec.md)
- [AICO 显示控制](../../openspec/specs/aico-display-control/spec.md)
- [AICO 布局模式](../../openspec/specs/aico-layout-mode/spec.md)
- [AICO PIU 注入](../../openspec/specs/aico-piu-injection/spec.md)
- [工具结构化增量](../../openspec/specs/tool-structured-delta/spec.md)
- [结构化消息渲染](../../openspec/specs/agent-web-structured-message-rendering/spec.md)
- [扩展详情区域](../../openspec/specs/agent-web-expand-panel/spec.md)

完整稳定能力以 [`openspec/specs/`](../../openspec/specs/) 为准。
