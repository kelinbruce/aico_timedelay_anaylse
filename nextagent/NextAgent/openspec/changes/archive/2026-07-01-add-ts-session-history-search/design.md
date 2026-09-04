## 背景和现状（Context）

当前会话列表链路已经存在：
1. `frontend/agent-web` 通过 `sessionService.listSessions()` 请求 `/api/v1/sessions?offset&limit`。
2. `agent-channel-web` 解析 query，并通过 `RuntimeSessionPort.listSessions()` 读取会话页。
3. `agent-runtime` 补上可信 Agent scope 后调用 `UserSessionPort.listSessions()`。
4. `agent-session` 将领域查询映射为 gateway 查询。
5. `agent-platform-gateway-local` 从 SQLite `sessions` 表读取会话，并为返回页内会话补充 run summary。

本 change 只扩展这个会话列表链路，不引入当前会话 preview/anchor/navigation。

## 目标和非目标（Goals / Non-Goals）

目标：
- 在现有会话列表中增加轻量搜索能力，不新增页面或独立搜索 endpoint。
- `q` 搜索会话标题和 visible USER 消息内容，表达“用户问过什么”，并对 ASCII 英文字母大小写不敏感。
- 支持按会话创建时间范围过滤，前端以浏览器本地时间选择，后端只比较整数 epoch millis。
- 保持 owner scope 和 Agent scope 隔离。
- local/immersive Sidebar 搜索入口使用对话框承载搜索 workflow，且 query/result state 只属于该对话框；collaborative PIU History Popover 继续复用现有 session history store/action。
- 直接查询现有 `sessions`、`messages` 表，不新增 FTS/search document/sidecar 表。

非目标：
- 不搜索 assistant、tool、Capability result、hidden message。
- 不实现全文搜索、相关性排序、命中片段、高亮、结果总数或搜索索引维护。
- 不改变当前会话 conversation read、preview rail、anchor navigation 或双向 cursor。
- 普通 expanded Sidebar 未展开最近窗口显示 10 条。

## 设计决策（Decisions）

### D1：会话列表搜索复用 `GET /api/v1/sessions`

public API 入口保持为：

```http
GET /api/v1/sessions?offset=0&limit=20&q=网络延迟&createdFrom=1782403200000&createdTo=1783007999999
```

Web query 参数固定为 `q`、`createdFrom`、`createdTo`、`offset`、`limit`。`agent-channel-web` 将其转换为内部 canonical 字段：

```ts
interface RuntimeListSessionsQuery {
  readonly identityContext: IdentityContext;
  readonly offset: number;
  readonly limit: number;
  readonly questionSearchText?: string;
  readonly createdAtFrom?: EpochMillis;
  readonly createdAtTo?: EpochMillis;
}
```

`q` 是 public Web alias，只停留在 channel schema/route 层；`questionSearchText` 表达领域语义。`q.trim()` 后为空时不生成 `questionSearchText`。非空查询最大长度固定为 50 个 Unicode code point；全 ASCII 查询最小长度为 3；包含任意非 ASCII code point 的查询最小长度为 2，用于覆盖“告警”“小区”“切片”等常见中文电信短词。无合法搜索条件且未显式提供 `limit` 时继续使用既有普通会话列表默认值。存在合法 `q` 或完整时间范围且未显式提供 `limit` 时使用搜索页大小 20；搜索 `limit` 最大为 50。

### D2：搜索源事实只包含标题和 visible USER 消息

搜索语义固定为：

```text
asciiCaseInsensitiveLiteralContains(session.title, questionSearchText)
OR asciiCaseInsensitiveLiteralContains(visible USER message.content, questionSearchText)
```

标题不区分 `titleSource=manual` 或 `titleSource=automatic`。消息搜索只接受 `role=USER` 且 `visible=true`。`%`、`_`、`\` 等 LIKE 控制字符必须按字面量转义。搜索结果以 session 为分页对象；同一 session 内多个 visible USER 消息命中时，该 session 仍只能出现一次，且重复命中不得影响 `offset/limit/hasMore`。

### D3：创建时间使用 epoch millis，范围最大固定 90 天

前端日期范围选择器显示和解释浏览器本地时间，用户选择精确到秒。前端向后端传递整数 epoch millis；后端不接收日期字符串，不使用服务端时区，只校验并比较数值。

`createdFrom` 和 `createdTo` 必须同时出现，必须满足 `createdFrom <= createdTo`，且跨度不得超过 90 天减 1 毫秒。只出现一端、非整数、非有限数或超跨度均 fail closed。

### D4：gateway-local 不新增搜索表

`agent-platform-gateway-local` 必须直接基于现有 `sessions` 和 `messages` 源事实执行 SQL 查询。实现不得新增：
- FTS 表。
- search document 表。
- sidecar 表。
- rebuild/index operation。
- public search-index endpoint 或 DTO。

允许按现有 migration 规则补普通 B-tree index，以改善现有表上的 owner/agent/session scope、created time、message role/visible、sort/join 查询路径。分页必须在去重后的 session 结果集上执行，推荐使用 `EXISTS` 或等价 session-level 子查询完成 visible USER message 命中判断，再按 `updatedAt DESC, sessionId ASC` 排序并使用 `LIMIT limit+1 OFFSET offset` 判断 `hasMore`，不做 `COUNT(*)`。run summary 只对返回页内 entries 补充。

### D5：前端按 host surface 固定状态 owner

Local/immersive Sidebar search entry opens a dialog. The dialog owns UI-local state for:
- committed keyword。
- committed created time range。
- offset/limit。
- latest request guard。
- rename refresh。

The dialog MUST NOT overwrite the ordinary Sidebar session list, favorites/recent view, expanded preference, collapsed state, URL, localStorage, or sessionStorage.

Collaborative PIU History Popover continues to use the existing session history store/action path for the same query/page/latest-request semantics. It MUST NOT introduce a PIU-specific search store, dedicated query namespace, parallel business state, route, or search endpoint. PIU only continues to write the existing `nextagent:AIAgentPIU:activeSessionId`.

### D6：普通 Sidebar 最近窗口不变

普通 expanded Sidebar 未展开最近窗口显示 10 条；普通展开态保持 20 条历史窗口。Local/immersive search dialog 和 PIU History Popover 在无搜索条件时显示最近 10 条；搜索态首屏显示 20 条搜索窗口。

## 风险与取舍（Risks / Trade-offs）

- SQL 字面量子串搜索在大量历史或高命中率查询下可能变慢。本 change 明确不承诺大规模全文低延迟；通过关键词长度、日期跨度、页大小、无 total count、无 snippet/highlight 和 SQL 下推控制风险。
- 不新增搜索表意味着不会复制持久化搜索文档，也不会引入索引回填和一致性维护成本。
- collapsed Sidebar 仅提供 icon 入口打开同一个 local/immersive search dialog，不新增 collapsed 专用 Popover，也不改变普通展开偏好。

## 迁移计划（Migration Plan）

本 change 不需要新增私有搜索表、FTS 表、search document 表或索引回填。若实现需要改善查询路径，可按现有 gateway-local schema migration 规则补普通 B-tree index。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/session-history-search/spec.md`：归档会话历史搜索行为契约。
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：更新 `GET /api/v1/sessions` query 白名单和搜索态默认页大小，保持 session list response shape 不变。
- `openspec/specs/agent-web-multi-host-modes/spec.md`：补充 collaborative PIU History Popover 支持同一会话历史搜索能力。
- `openspec/designs/architecture/core-contracts.md`：补充 session list query 对 `questionSearchText`、`createdAtFrom`、`createdAtTo` 的受控 contract 扩展。
- `openspec/designs/modules/agent-channel-web.md`、`openspec/designs/modules/agent-session.md`、`openspec/designs/modules/agent-platform-gateway-local.md`：补充 Web query schema、领域透传和 SQLite scoped SQL 查询职责。
- `openspec/designs/spec-to-design-map.md`：新增 `session-history-search` 导航。

## 待确认问题（Open Questions）

无。
## Design Correction: Local/Immersive Dialog State

The local and immersive Sidebar search entry now opens a dialog instead of embedding search controls directly into Sidebar-specific surfaces. This keeps the current Sidebar view unchanged while moving the search workflow into a contained UI surface.

The dialog reuses the existing `/api/v1/sessions` query contract, keyword/date rules, row styling, open-session behavior, rename permission handling, and load-more behavior. Its `query`, `entries`, `offset`, `hasMore`, loading/error state, and latest-request guard are local to the dialog. This avoids mutating the global Sidebar session list or forcing the Sidebar out of its current favorites/recent view during local/immersive search. Rename from the dialog calls the same title API, updates the currently loaded Sidebar title for the matching session id, and refreshes the dialog window under the current filters.

The collaborative PIU History Popover stays on the existing shared session-history store/action path. No PIU-specific query namespace, second history entry, route, search endpoint, snippet/highlight/result-count DTO, or persisted search state is introduced.
