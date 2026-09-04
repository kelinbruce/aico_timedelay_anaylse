## 背景与问题（Why）

当前前端会话列表只能按既有分页加载历史会话，用户无法按曾经提交的问题文本或会话创建时间快速定位历史会话。随着历史会话增长，用户需要依赖标题记忆和分页浏览，容易遗漏网络诊断、配置检查、报告生成等历史任务。

本 change 只解决“会话列表内的轻量搜索和创建时间范围过滤”。它不处理当前会话内 preview mini-map、preview rail、anchor navigation 或双向 conversation cursor；这些能力由独立 change `add-ts-conversation-preview-navigation` 承载。

## 变更范围（What Changes）

- 扩展现有 `GET /api/v1/sessions` 会话列表接口，新增可选查询参数：
  - `q`：按会话标题和 visible USER 消息内容做 ASCII 英文大小写不敏感的字面量子串搜索；trim 后长度最大为 50 个 Unicode code point；全 ASCII 查询最小长度为 3，包含任意非 ASCII code point 的查询最小长度为 2。
  - `createdFrom` / `createdTo`：按会话创建时间做闭区间过滤，使用整数 epoch millis；二者必须同时出现，范围最大固定为 90 天减 1 毫秒。
- 无搜索条件且未传 `limit` 时保持既有会话列表默认页大小；存在合法 `q` 或完整创建时间范围且未传 `limit` 时默认搜索页大小为 20；搜索态 `limit` 最大为 50。
- 查询结果继续复用既有 session-list response shape，不新增搜索专用 entry DTO、命中片段、高亮、结果数量或搜索页。
- `agent-platform-gateway-local` 直接基于现有 `sessions` 和 `messages` 源事实执行受控 SQL 查询；搜索分页对象必须是去重后的 session，使用 `EXISTS` 或等价 session-level 子查询判断 visible USER message 命中；不新增 FTS 表、search document 表、sidecar 表、rebuild/index operation 或 public search-index endpoint。允许补普通 B-tree index 以服务现有表的 scope/filter/order 查询路径。
- 前端在现有会话历史入口增加关键词输入和 AntD 日期范围入口。搜索结果复用原会话列表项、点击、重命名和加载更多交互。
- 普通 expanded Sidebar 未展开最近窗口显示 10 条；普通展开态保持 20 条历史窗口。本地式和沉浸式 Sidebar 搜索入口（包括 collapsed 图标入口）打开对话框；该对话框无搜索条件时显示最近 10 条，搜索态显示 20 条。协作式继续使用现有 PIU History Popover；该 Popover 无搜索条件时显示最近 10 条，搜索态显示 20 条。
- 本地式和沉浸式搜索对话框使用 UI-local query/result state，不覆盖普通 Sidebar 会话列表、收藏视图、展开偏好或 collapsed 状态。协作式 PIU History Popover 继续复用现有 session history store/action，不新增 PIU 专用 search store 或 query namespace。

## 非目标（Non-Goals）

- 不新增全局 `/search`、`/api/v1/sessions/search`、session detail route 或跨会话全文搜索产品面。
- 不搜索 assistant 回答、工具输出、Capability result、hidden message 或不可见历史。
- 不提供分词、拼音、全半角、重音字符、Unicode 特殊大小写折叠、语义相似匹配、相关性排序、命中片段、高亮或结果总数。
- 不新增当前会话 preview route、preview rail、`anchorMessageId`、`newerCursor`、`positionRatio`、conversation search route 或后端 `windowMode/anchor` 字段。
- 普通 expanded Sidebar 未展开最近窗口显示 10 条。

## Capability 影响（Capabilities）

### 新增 Capability

- `session-history-search`：定义会话历史列表按用户问题相关文本和创建时间范围查询的 Web/API、contract、gateway 和前端交互边界。

### 修改的 Capability

- `ts-minimal-agent-kernel`：修改 `GET /api/v1/sessions` public query allowance，新增 `q?`、`createdFrom?`、`createdTo?`，并保持 session-list response DTO shape 不变。
- `agent-web-multi-host-modes`：修改 collaborative PIU 现有 History Popover，使其支持同一会话历史搜索能力，同时不新增 Sidebar、第二入口、宿主 URL 行为或 layout state。

## 影响范围（Impact）

- `agent-channel-web`
  - 扩展 `/api/v1/sessions` query schema、参数校验和 public alias 到 canonical query 的映射。
- `agent-contracts/runtime`
  - 扩展 `RuntimeListSessionsQuery`，承载 canonical `questionSearchText`、`createdAtFrom`、`createdAtTo`。
- `agent-contracts/session`
  - 扩展 `ListUserSessionsQuery`，透传 canonical 搜索条件，保持领域 read model 不使用 public Web alias。
- `agent-contracts/gateway`
  - 扩展 `SessionHistoryRecordQuery`，由 gateway query 接收 canonical 搜索和创建时间过滤条件。
- `agent-session`
  - 透传受控查询条件，不拥有 SQL、Web DTO 或 UI 语义。
- `agent-platform-gateway-local`
  - 通过 SQLite SQL 查询按 owner scope、Agent scope、标题、visible USER 消息和创建时间过滤，并在 SQL 层完成稳定排序与分页；不新增搜索表。
- `frontend/agent-web`
  - 在现有会话历史 UI 中增加搜索输入框、AntD 日期范围入口、local/immersive Sidebar 搜索对话框、collaborative PIU History Popover 搜索增强、搜索态分页加载、最新请求保护、搜索空态和搜索态重命名刷新。

## 验证入口（Validation）

- Web route/schema tests for `/api/v1/sessions?q&createdFrom&createdTo`。
- Gateway-local contract tests for title search、visible USER message search、ASCII case-insensitive literal search、created time inclusive range、90 天最大日期跨度、active-time ordering、pagination、owner+agent scope isolation、literal escaping。
- Frontend component/store tests for debounce search、clear keyword、AntD date range summary display/clear、search-mode 20-entry window、same-list pagination、stale response ignore、search empty state、rename refresh with current filters、local/immersive dialog controls、PIU Popover controls、search lifecycle without URL/localStorage/sessionStorage persistence。
- Architecture review confirms no new search table, no public FTS/search endpoint/DTO/snippet, no result count/highlight, no PIU-specific search store/query namespace, and no ordinary Sidebar recent-window size change.
- `openspec validate add-ts-session-history-search --strict`。
## Scope Correction: Local/Immersive Search Dialog

- Local and immersive Sidebar search SHALL behave like a primary Sidebar action: clicking the search entry opens an in-place dialog and MUST NOT navigate to a route or change the current Sidebar view.
- The local/immersive search dialog SHALL contain the keyword search input, creation-time range controls, result list, load-more action, empty/error/loading states, and the same session row operations available in the ordinary Sidebar list, including rename when the user has write permission.
- The dialog SHALL use the existing `GET /api/v1/sessions` contract and search semantics, but its result state SHALL be UI-local to the dialog so search results do not overwrite the ordinary Sidebar session list, favorites view, expanded preference, or collapsed state.
- Collaborative PIU remains unchanged: it continues to use the existing History Popover and shared session-history store/action path.
