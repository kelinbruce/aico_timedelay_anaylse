# Align Conversation Cursor Validation And Error Code

## Why

`GET /api/v1/sessions/{sessionId}/conversation` 的三个游标字段（`cursor`、`newerCursor`、`anchorMessageId`）与底层 memory 服务的规格存在两层不对齐，已由服务器 pod 内直连 NAIE Memory 实测确认。

**存在性语义不对齐**：`anchorMessageId` 指向不存在的消息时，本地 SQLite gateway 抛 `SESSION_MESSAGE_ANCHOR_NOT_FOUND`（HTTP 404），但服务器侧 memory 服务对该场景返回空集（HTTP 200），服务层 `UserSessionService.listMessages` 原样透传 `items: []`，调用方无法区分"锚点不存在"与"空会话"。`cursor`/`newerCursor` 指向不存在的消息时两条路径均返回空集，伪造或已删除的游标被静默吞掉。

**长度上限不对齐**：web schema 与文档将三字段上限定为 `WEB_ID_MAX_LENGTH=256`，而 memory 服务的硬上限是 64（实测 `size must be between 0 and 64`）。长度 65–256 的值通过 AJV 校验后漏到 memory，memory 返回 400，被透传成难看的 `WM_HTTP_ERROR`；服务器侧部署版本的 schema `maxLength` 甚至未真正生效，>64 全部漏到 memory。

根因：memory 是服务器侧独立服务，本仓库无其代码；共享服务层 `UserSessionService.listMessages`（编译成服务器用的 `session-preparation.js`）对游标不做存在性预检，直接透传 store 结果；长度上限沿用全 ID 共用的 256 常量，未对齐 memory 的 64。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- `cursor`、`newerCursor`、`anchorMessageId` 任一指向本会话内不存在（或跨会话）的消息时，统一返回 `404` + `SafeError { code: "SESSION_MESSAGE_ANCHOR_NOT_FOUND", category: "NOT_FOUND" }`，不返回 200 空页。
- 游标存在但翻到该方向边界（无更多消息）时仍返回 `200` 空页，保留正常翻页语义。
- `cursor`/`newerCursor`/`anchorMessageId` 长度上限对齐到 memory 的 64；web schema 与 route parser 双重强制，>64 在 web 边界返回字段级 400，不漏到 memory。
- 校验落在共享服务层 `UserSessionService.listMessages`，使 SQLite 与 memory 两条路径行为一致。

**非目标：**

- 不改 `sqlite-gateway-core` 的 `listMessages` 分支语义（本地 SQLite 的 `cursor`/`newerCursor` 空集行为保留；anchor 已抛错保留）。
- 不改成功响应 schema、分页语义、`cursor`/`newerCursor`/`anchorMessageId` 互斥规则、preview 路由。
- 不引入新 SafeError code（复用既有 `SESSION_MESSAGE_ANCHOR_NOT_FOUND`）。
- 不改 `WEB_ID_MAX_LENGTH=256`（它被 sessionId/requestId 等全 ID 共用），仅为 conversation 三字段引入独立 64 上限。
- 不改 hidden 游标的"当边界透传空集"取舍（仅 `anchorMessageId` hidden 抛 NOT_FOUND；`cursor`/`newerCursor` hidden 当边界）。

## What Changes

- `UserSessionService.listMessages` 在调 `messageStore.listMessages` 之前增加 `assertCursorResolves` 预检：对 `anchorMessageId`/`beforeCursor`/`afterCursor` 任一非空值，用 `messageStore.loadMessage` 解析；未解析到或 `resolved.sessionId !== query.sessionId`（跨会话）时抛 `SESSION_MESSAGE_ANCHOR_NOT_FOUND`。`loadMessage` 不过滤 visible、不限定 session，故需 sessionId 校验防跨会话泄露。
- `anchorMessageId` 模式下，预检通过后若 store 返回 `items` 为空（memory 路径下 hidden anchor 返回空集的缺口），仍抛 `SESSION_MESSAGE_ANCHOR_NOT_FOUND`——可见 anchor 必在其自身页内，空集 ⟺ anchor 不可见/定位失败。
- `cursor`/`newerCursor` 模式：预检通过后透传 store 结果，边界空集保留。
- 新增 `WEB_CONVERSATION_CURSOR_MAX_LENGTH = 64`；`conversationQuery` 三字段改用之；`parseConversationQuery` 加 parser 层长度校验，返回字段级消息 `"<field> must not exceed 64 characters."`。

本 change 不包含破坏性公共契约变更（仅收紧错误码与长度上限，不改成功响应契约）。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.8 查看会话消息` → `specs/session-conversation-preview/spec.md`、`specs/ts-minimal-agent-kernel/spec.md`
  - 功能边界：补充游标存在性预检与长度上限对齐，使三字段不存在时统一返回 404 `SESSION_MESSAGE_ANCHOR_NOT_FOUND`、长度 ≤64 在 web 边界强制。
  - 系统质量属性：可靠性、一致性、可测试性。
  - 映射说明：`session-conversation-preview` 与 `ts-minimal-agent-kernel` 均为 canonical spec，本 change 同时固化 delta。

## 影响范围（Impact）

- API 调用方：传入不存在或跨会话的 `cursor`/`newerCursor`/`anchorMessageId` 时由 `200 items:[]` 改为 `404 SESSION_MESSAGE_ANCHOR_NOT_FOUND`；长度 >64 由底层 `WM_HTTP_ERROR` 改为字段级 `400`。前端翻页到边界的空集行为不变。
- Agent 开发者与平台集成方：无需修改公共 API schema；成功响应契约不变。
- 运维人员：失败路径产生显式 `SafeError`，不暴露 memory 内部 400 文案或对话内容。
- 主要受影响范围为 `agent-session` 服务层 `UserSessionService.listMessages` 与 `agent-channel-web` 的 conversation schema/parser。
