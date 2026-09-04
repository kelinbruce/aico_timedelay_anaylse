# add-session-list-conversation-preview

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P3

状态：clarify
类型：product experience candidate
主要 owner：`frontend/agent-web` session navigation
认领人：不可认领
依赖：既有 conversation preview API 与当前会话 preview marker rail

当前状态：
- `ChatPage` 已消费 conversation preview API，呈现当前会话的 marker rail。
- sidebar session list 尚未呈现 preview；这与当前会话 marker rail 是不同用户界面。
- favorite 是 assistant turn annotation，当前没有 session-level favorite 字段或聚合 truth。

目标：
- 在不加载完整 conversation、不中断列表导航的前提下，为 sidebar 中用户主动关注的单个会话提供 bounded safe preview。

进入 `ready` 前必须确认：
- 首版只选择“列表内一行 preview”或“hover/focus 500ms 后显示 card”之一，不同时实现两种路线。
- preview 的缓存容量、TTL、取消过期请求和失败 fallback。
- 是否需要 favorite marker；若需要，先定义 turn annotations 到 session summary 的 owner、查询和更新一致性，不得在前端猜测。

实现约束：
- 复用既有 preview API；不得扩展 minimal session list record，不得加载完整 conversation。
- preview 只展示 safe USER marker/同请求 safe ASSISTANT preview，纯文本截断，不渲染 Markdown/HTML/tool raw content。
- 列表初次渲染不得为每一项发起 N+1 preview 请求。

非目标：
- 不修改 current-conversation marker rail。
- 不创建 session-level favorite persistence、未读服务或跨设备 read receipt。

并行边界：
- clarify 状态不可实施。
- 与 `refine-session-list-run-awareness` 分离；后者不得提前实现本卡能力。
