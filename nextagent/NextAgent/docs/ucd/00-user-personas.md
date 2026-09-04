# 用户画像

> 长期设计导航：`openspec/designs/architecture/conversation-ui-state.md`。当前事实必须与 stable/active OpenSpec、public contracts、当前代码和测试交叉核对；本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。

NextAgent 对话界面的目标用户是电信网络智能体平台的运维相关人员。以下画像用于驱动界面设计优化决策。

## 画像 A：网络运维工程师

- **角色**：一线网络运维人员，负责日常告警处理、故障定位、配置核查。
- **技术背景**：熟悉电信网络设备（基站、核心网、传输网），熟悉命令行工具与脚本，对 LLM/Agent 有概念性了解但不写代码。
- **目标**：快速把告警或异常现象转化为可执行的排查动作；获取 Agent 给出的根因假设与处置建议；在处置前确认 Agent 调用的命令/查询是否安全。
- **痛点**：
  - 不信任"黑盒"答案，需要看到 Agent 调用了哪些能力、产生了什么输出。
  - 担心 Agent 执行高风险命令（如修改配置、重启设备），需要明确的授权入口。
  - 历史排查记录回溯困难，希望对话能保留可追溯的执行过程。
  - 发送的消息可能有笔误，需要快速编辑重发而非重新组织语言。
  - Agent 执行方向错误时需要快速取消，避免浪费时间等待无用结果。
  - 请求失败后需要一键重试，而非重新输入完整消息。
- **界面诉求**：
  - 能力执行过程可见、可展开、可折叠（live 模式实时观察，history 模式回看终态）。
  - pending input 卡片清晰，授权/确认入口显眼。
  - 失败卡片给出可读原因，不暴露内部策略细节但能区分"策略拒绝"与"执行失败"。
  - 编辑模式、取消运行（ESC 两步确认）、重试入口操作便捷，有明确视觉反馈。
  - 推荐后续问题帮助快速深入排查方向。

## 画像 B：运维主管

- **角色**：运维团队主管，负责审阅复杂故障的处理过程、复盘团队使用 Agent 的情况。
- **技术背景**：资深运维背景，关注流程合规与审计追溯。
- **目标**：浏览历史对话，确认 Agent 辅助处理的过程是否符合规范；评估 Agent 能力使用的有效性与安全性。
- **痛点**：
  - 历史对话中需要回看思考过程与降级提示，还原当时的决策上下文。
  - 需要区分"Agent 给出了完整答案"与"Agent 因失败而只给出部分答案"。
  - 大量历史会话难以定位特定故障的排查记录，需要按关键词和时间搜索。
  - 需要收藏重要的排查案例供团队参考。
- **界面诉求**：
  - `[已实现-主干]` history 浏览时可看到与 live 完成后同形的已持久化过程事实，包括完成的 thinking、能力结果、降级提示和压缩通知；history 不重放打字机效果、running 动画或未完成 delta。pending-input 当前仍只重建独立 process system 条目。
  - 失败 terminal 的部分答案与 safe failure placeholder 视觉可区分。
  - 能力卡片的 second-level details 可展开查看 safe error code/category。
  - 会话搜索支持关键词 + 日期范围，快速定位历史排查记录。
  - 收藏夹功能保存重要案例，与普通会话列表分离浏览。
  - 会话重命名便于归档管理，删除确认避免误操作。

## 画像 C：Agent 平台开发/调测人员（次级）

- **角色**：负责配置 Agent、调试 Skill/Workflow 的开发人员。
- **技术背景**：熟悉 NextAgent 架构与 OpenSpec spec。
- **目标**：在对话界面验证 Agent 行为是否符合 spec，定位能力调用失败原因。
- **界面诉求**：
  - 能力卡片能展示 `safeErrorCode`/`safeErrorCategory`（second-level details）。
  - 完整过程按钮可打开 run-graph drawer 查看全流程 timeline。
  - 断线重连状态阶梯清晰可观察，便于调试 cursor 行为。
  - 从已完成的 turn 派生新会话，探索不同场景下的 Agent 行为差异。
  - 分享对话片段给团队成员协作调试。
  - 键盘快捷键提高调测效率（`Cmd+K` 聚焦、`Cmd+/` 帮助、`Cmd+[`/`]` 切换会话）。
  - Slash 命令快速执行操作（`/help`、`/retry`、`/edit`）。

## 通用假设

- 所有用户均已通过 local configured auth 登录（`ts-local-configured-auth`），界面不展示匿名状态。
- 所有用户使用中文界面（`telecom-bilingual-output` 保证双语输出，UI 默认中文）。
- 用户既可能在桌面浏览器使用，也可能在平板使用；不做手机端优化。

## 画像与契约的对应

| 画像诉求 | 契约层事实来源 |
|---|---|
| 能力执行过程可见 | `conversation-ui-state.md` 第 1 节（`CAPABILITY_STARTED`/`RESULT_DELTA`/`COMPLETED`）与第 2 节的安全投影原则；具体 safeResult kind 与前端呈现库存以当前代码为准，长期设计中的固定数量已登记治理刷新 |
| pending input 授权入口 | 当前 4 种 durable `PendingInputKind` + 前端 7 个 accepted identifier；workflow interrupt 专用 kind/presentation 路线仍为 Clarify |
| 失败卡片可读原因 | 第 5 节（SafeError code/category → 失败卡片） |
| history 内容与 live 完成后相同 | `[已实现-主干]` 完成的 thinking 与 canonical process facts 通过 Event history 恢复，并与 Message history 合并投影；pending-input lifecycle 卡仍是例外 |
| 断线重连状态可观察 | 第 4 节（Reconnect/replay UI 状态阶梯） |
