# Design: Align Conversation Cursor Validation And Error Code

## 设计范围

| Function | Canonical spec | 目标变化 | Delta Requirement |
| --- | --- | --- | --- |
| FN-1.8 查看会话消息 | `session-conversation-preview` | 游标不存在统一 404；长度 ≤64 | `Conversation cursor/anchor existence and length`（MODIFIED/ADDED） |
| FN-1.8 查看会话消息 | `ts-minimal-agent-kernel` | 同上 | 同上 |

## 目标与规范依据

`session-conversation-preview/spec.md` 现有要求：
- :152 `cursor`/`newerCursor`/`anchorMessageId` MUST NOT combine。
- :169 anchored 加载需先校验 same owner/agent/session/visible。
- :217-222 "Stale or hidden anchor fails safely"：anchor 不存在 SHALL return not found or validation/scope error，MUST NOT fall back to latest。

`ts-minimal-agent-kernel/spec.md` :244：stale/hidden/deleted/cross-owner/cross-agent `anchorMessageId` MUST fail closed。

两处 spec 对 `cursor`/`newerCursor` 不存在时返回什么**无规定**，对游标长度上限**无规定**。本次将 anchor 已有的 fail-closed 语义扩展到 `cursor`/`newerCursor`，并新增长度上限约束——属可观察契约变更（HTTP 200→404、新增长度 400），故写真 delta。

## 当前实现

`UserSessionService.listMessages`（`packages/agent-session/src/services/session-preparation.ts:218`）：先 `requireSession` 鉴权，再调 `messageStore.listMessages` 透传三游标，无存在性预检。

store 层行为（`sqlite-gateway-core.ts` `listMessages`）：
- `anchorMessageId` 不存在 → 抛 `SESSION_MESSAGE_ANCHOR_NOT_FOUND`（404）。
- `afterCursor`/`beforeCursor` 不存在 → 返回 `{items:[], hasMore:false}`（200 空）。

memory 服务（服务器侧，本仓库无代码）：anchor 不存在返回空集（200）；长度 >64 返回 `400 size must be between 0 and 64`。

## GAP 分析

| 字段 × 路径 | 当前行为 | 目标行为 | GAP |
| --- | --- | --- | --- |
| anchorMessageId 不存在 / SQLite | 404 NOT_FOUND | 404 NOT_FOUND | 无 |
| anchorMessageId 不存在 / memory | 200 空集 | 404 NOT_FOUND | 服务层缺 anchor 空集二次判定 |
| cursor 不存在 / SQLite | 200 空集 | 404 NOT_FOUND | 服务层缺预检 |
| cursor 不存在 / memory | 200 空集 | 404 NOT_FOUND | 服务层缺预检 |
| newerCursor 不存在 / 两路径 | 200 空集 | 404 NOT_FOUND | 服务层缺预检 |
| 跨会话游标 / 两路径 | 200 空集（SQLite）/ 不可知（memory） | 404 NOT_FOUND | 服务层缺 sessionId 校验 |
| 游标翻到边界 / 两路径 | 200 空集 | 200 空集（保留） | 无 |
| 长度 65–256 / web | 过 AJV，漏到 memory → WM_HTTP_ERROR | web 边界 400 字段级消息 | schema/parser 缺 64 上限 |
| 长度 >256 / web | 400（dev）/ 漏到 memory（部署） | 400 字段级消息 | parser 缺强制 |

## 修改方案

### 1. 服务层预检 `assertCursorResolves`

`listMessages` 内、`messageStore.listMessages` 之前调用。取 `anchorMessageId ?? beforeCursor ?? afterCursor`（三者互斥，取首个非空）；为空（首屏）则跳过。调 `messageStore.loadMessage({tenantId, subjectId, agentId, messageId})`，未解析或 `resolved.sessionId !== query.sessionId` → 抛 `SESSION_MESSAGE_ANCHOR_NOT_FOUND`。

复用 runtime 已有模式（`submit.ts:4858-4862` `loadMessage` 后校验 `sessionId`）。

### 2. anchor 空集二次判定

`anchorMessageId !== undefined && page.items.length === 0` → 抛 `SESSION_MESSAGE_ANCHOR_NOT_FOUND`。覆盖 memory 路径下 hidden anchor 返回空集的缺口。`cursor`/`newerCursor` 模式不判定，边界空集透传。

### 3. 长度上限 64

- `validation-limits.ts` 新增 `WEB_CONVERSATION_CURSOR_MAX_LENGTH = 64`（不动 `WEB_ID_MAX_LENGTH`）。
- `conversation-query.ts` 三字段 `maxLength` 改用之。
- `requests.ts` `parseConversationQuery` 加三字段 `length > 64` 校验，`throwValidation("<field> must not exceed 64 characters.")`。parser 层校验防部署版 schema `maxLength` 不生效的坑。

## 质量属性影响

- **一致性**：SQLite 与 memory 两路径对游标不存在/跨会话统一 404。
- **可靠性**：>64 不再漏到 memory 变 WM_HTTP_ERROR，web 边界显式 400。
- **性能**：每次游标翻页多一次 `loadMessage` 往返。翻页非超高频热路径，正确性优先，可接受。
- **向后兼容**：成功响应契约不变；`cursor`/`newerCursor` 不存在由 200→404 是行为收紧，前端按 404 处理即可（边界空集行为不变）。

## 风险与取舍

- **hidden 游标当边界**：`loadMessage` 不过滤 visible，hidden 游标预检通过、`listMessages` 按 visible 过滤返回空集 → 当边界透传空集（非 NOT_FOUND）。语义：游标是翻页 token，不可见=无更多内容；anchor 是显式定位，不可见=定位失败。此差异为有意取舍，记录于 spec Scenario。
- **服务层 vs store 层**：仅在服务层加预检，不改 SQLite gateway。故 `local-gateway-contract.test.ts` 直接调 gateway 的 `cursor`/`newerCursor` 不存在仍返回空集（gateway 行为不变）；服务层 NOT_FOUND 由 `session-preparation-cursor-validation.test.ts` 覆盖。
- **`session-fork-web.test.ts`**：其 `makeApp` 直接 mock `RuntimeSessionPort.listMessages`，绕过服务层，不受预检影响，无需改。

## 验证策略

- `tsc -b` 干净。
- `session-preparation-cursor-validation.test.ts`：三字段不存在/跨会话→NOT_FOUND；anchor 空集→NOT_FOUND；cursor/newerCursor 边界→空集透传；首屏不预检。
- `schema-validation-boundary.test.ts`：三字段 65→400 字段级消息。
- `local-gateway-contract.test.ts`、`session-fork-web.test.ts` 不回归。
- `openspec validate fix-conversation-cursor-validation --strict`。

## 待确认问题

无。
