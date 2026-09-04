# FN-1.13 查看收藏列表

> 能力域 D1 会话与流式交互 · 子域 [D1.3 对话标注与分享](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-1.7](../../../features/D1-会话与流式交互/D1.3-对话标注与分享/F-1.7-标注对话.md) |
| 主规格 | `favorite-turn-list` |
| 遗留规格 | `conversation-annotation` |
| 接口 | `GET /api/v1/favorites` |

## 描述

用户在 Local 与 Immersive 主内容区域通过 `#/favorites` 查看按 session 分组的分页收藏内容，左侧最近会话列表保持可见；收藏专用 URL 支持直达、刷新和浏览器前进/后退恢复。收藏主内容使用当前语言下的收藏列表页面名称和不带页内返回操作的统一 Agent Web Header，离开收藏继续由宿主导航或扩展容器关闭入口决定。回答/问题 Tab 通过 `favoriteType` 参数切换；关键词搜索和精确到秒的起止时间过滤由服务端在可信 scope 内先过滤再分页。同一 session 的收藏 turn 收敛为一张可展开的会话分组卡片，展开时复用既有会话读取契约展示 USER/ASSISTANT 正文并复用共享 Markdown 渲染。组内取消收藏经确认后按当前 Tab 写入。主内容入口选择互不耦合。Collaborative/PIU 从既有更多菜单在与记忆管理相同的左侧扩展内容容器复用同一收藏面板。

## 前置条件

- 用户已登录。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| offset | 否 | 分页偏移，默认 0 |
| limit | 否 | 分页大小，默认 50，上限 100 |

## 输出

```json
{
  "entries": [
    { "sessionId": "sess_123", "favoriteCount": 3 }
  ],
  "offset": 0,
  "limit": 50,
  "hasMore": false
}
```

## 处理过程

1. Local/Immersive shell 从 `#/favorites` 恢复收藏主内容及其激活反馈；Collaborative/PIU 通过与记忆管理相同的左侧扩展内容容器展示同一内容。
2. 收藏页面在统一 Header 中只展示收藏标题；离开收藏、切换路由或关闭 PIU 扩展容器继续使用宿主已有入口。回答/问题 Tab 通过 `favoriteType` 复用同一查询、分组和卡片结构，切换时重置页码及上一 Tab 的临时读取状态。
3. 过滤区按关键词和可分别快捷清除的收藏日期时间筛选；服务端在可信 Owner/Agent Scope 内先过滤再分页。
4. 内容占满 padding 内可用宽度，完整有界收藏窗口按 `sessionId` 分组后以每页 15 个 session 的显式分页器展示，全部收起时以 8px 会话卡片间距完整显示且无列表滚动条。
5. 展开会话后目标卡片优先顶部对齐且正文起始位置保持可见；摘要卡最大 56px，展开后以紧凑内边距读取并用共享 Markdown 渲染按内容自然高度的智能体回答。
6. 确认取消成功后按当前 Tab 更新对应收藏字段（`isFavorited` 或 `isQuestionFavorited`）和分组。

## 结果

- 布局：收藏标题栏与其他首批 Agent Web 主内容页面保持同形且不展示页内返回操作。
- 正常：返回按 session 分组的分页收藏内容。
- 无收藏：返回空态。
- 读取失败：保持收藏内容视图为当前主内容，显示安全错误反馈和重试入口。
- 取消收藏成功：turn 从分组移除，显示成功反馈，不打开会话。
- 取消收藏失败：turn 保留，显示安全失败反馈并允许重试。

## 规格

| 规格项 | 规格值 | 状态 | 来源 |
|---|---|---|---|
| 默认分页 | 50 | 已定义 | `conversation-annotation` |
| 分页上限 | 100 | 已定义 | `conversation-annotation` |
| 收藏专用 URL | `#/favorites`；直达、刷新和浏览器前进/后退恢复收藏主内容和激活反馈 | 稳定 | `favorite-turn-list`：`Local 与 Immersive 收藏内容视图`、`主内容入口选择互不耦合` |
| 会话分组分页 | 每页默认 15 个 session 分组；显式分页器切换；全部收起时无滚动条 | 稳定 | `favorite-turn-list`：`Local 与 Immersive 收藏内容视图` |
| 回答/问题 Tab | `favoriteType=ANSWER|QUESTION`，省略时等同 `ANSWER`；切换时重置页码和临时读取状态 | 稳定 | `favorite-turn-list`：`收藏内容必须支持回答与问题分类` |
| 接口过滤 | `keyword`（<=50 字符）、`favoritedFrom`、`favoritedTo`（毫秒级）；服务端先过滤再分页 | 稳定 | `favorite-turn-list`：`Local 与 Immersive 收藏内容视图` |
| 主内容入口互斥 | 任一时刻只显示一个主内容视图；非对话入口至多一个激活；临时交互不改变当前主内容 | 稳定 | `favorite-turn-list`：`主内容入口选择互不耦合` |
