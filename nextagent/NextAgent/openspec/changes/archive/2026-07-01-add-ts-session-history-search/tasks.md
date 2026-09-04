## 1. Contract 与 Web API

- [x] 1.1 扩展 `RuntimeListSessionsQuery`、`ListUserSessionsQuery` 和 `SessionHistoryRecordQuery`，新增 canonical `questionSearchText?: string`、`createdAtFrom?: EpochMillis`、`createdAtTo?: EpochMillis`，不把 Web 参数名 `q` 下沉到内部 contract。  
  验证：`npm run test:contract`；code review 检查 `agent-contracts/runtime`、`agent-contracts/session`、`agent-contracts/gateway` 不新增名为 `q` 的内部 query 字段。
- [x] 1.2 扩展 `agent-channel-web` 的 `/api/v1/sessions` query schema 和 route 解析：接受 `q`、`createdFrom`、`createdTo`、`offset`、`limit`；仅将合法 `q` 映射为 `questionSearchText`：trim 后最大 50 个 Unicode code point、全 ASCII 查询最小 3 个 code point、包含任意非 ASCII code point 的查询最小 2 个 code point；将完整且合法的时间参数映射为 epoch millis canonical 字段。  
  验证：Web route/schema tests 断言合法 ASCII `q`、合法中文短词 `q=告警` 和合法 `createdFrom/createdTo` 被传给 `RuntimeSessionPort.listSessions()` 的 canonical 字段；断言缺省或空白 `q` 不生成 `questionSearchText`；断言搜索态未传 `limit` 时默认页大小为 20，无搜索条件时保留普通列表默认页大小。
- [x] 1.3 补充 Web API negative validation：`q.trim()` 为空以外的非法短查询（1 个 code point，或全 ASCII 且长度为 2）、超过 50 个 Unicode code point、只传 `createdFrom` 或只传 `createdTo`、`createdFrom > createdTo`、`createdFrom/createdTo` epoch millis 范围超过 90 天减 1 毫秒、非整数或非有限 epoch millis、负数 `offset`、搜索态非正或超过 50 的 `limit` 均返回请求校验错误。  
  验证：Web route/schema tests 实际请求非法参数并断言 400/validation error，不返回会话列表。

## 2. Session 与 Gateway 查询

- [x] 2.1 在 `agent-session` 中透传 canonical 搜索条件到 gateway query，不引入 Web alias、SQL 片段或 UI 语义。  
  验证：`npm run lint:architecture`；unit/contract test 断言 `UserSessionService.listSessions()` 把 `questionSearchText/createdAtFrom/createdAtTo` 传入 `SessionStoreGateway.listSessions()`。
- [x] 2.2 在 `agent-platform-gateway-local` 中实现 SQLite SQL 下推的受控会话搜索：搜索文本只来自同 scope 的 `sessions.title` 与 `role=USER`、`visible=1` 的 `messages.content`；查询按 `tenantId/subjectId/agentId/sessionId` scope 建模，并在 SQL 层完成标题/visible USER 消息匹配、创建时间过滤、排序和分页；message 命中必须通过 `EXISTS` 或等价 session-level 子查询判断，分页对象是去重后的 session，不是 message match row。  
  验证：gateway-local search tests 覆盖标题更新后命中、visible USER append 后命中、同一 session 多条 USER message 命中时结果只出现一次且 `hasMore` 不被重复命中撑大、USER message 变为 hidden 后不再命中、assistant/tool/Capability result 不命中、跨 owner/cross-agent 隔离。
- [x] 2.3 实现 ASCII 大小写不敏感字面量搜索，LIKE/INSTR 等 SQL 匹配必须安全转义 `%`、`_`、`\`，不得把用户输入解释为通配符。  
  验证：gateway-local contract tests 覆盖 `cpu` 命中 `CPU`、`CPU` 命中 `cpu`、`%/_/\` 字符按字面量匹配；code review 确认没有分词搜索、相关性排序、语义搜索或 JS 全量内存过滤。
- [x] 2.4 实现创建时间闭区间过滤、对去重后 session 结果集按 `updatedAt DESC, sessionId ASC` 稳定排序、`LIMIT limit+1 OFFSET offset` 分页和 `hasMore` 判断；run summary 只对返回页内 entries 补充。  
  验证：gateway-local contract tests 覆盖 createdAt inclusive boundary、active-time ordering、same updatedAt sessionId tie-break、第一页/第二页分页和 `hasMore`；code review 确认过滤/分页在 SQL 层完成、无 JS 全量内存过滤、无 `COUNT(*)`、无按 message match row 分页。
- [x] 2.5 确认不新增搜索持久化结构：不得新增 FTS 表、search document 表、sidecar 表、rebuild/index operation、public search-index endpoint 或搜索 DTO；仅允许按现有 migration 规则补普通 B-tree index。  
  验证：architecture review 检查 schema、gateway contracts、routes 和 tasks 无上述新增结构。

## 3. 前端搜索状态与交互

- [x] 3.1 扩展 `frontend/agent-web` 的 session service/store：支持当前 host runtime 的单 active committed `searchText`、`createdAtFrom`、`createdAtTo` 查询条件；普通 expanded Sidebar 未展开最近窗口显示 10 条，普通展开态使用 20 条历史窗口；搜索态首屏请求 `limit=20` 并展示 20 条搜索窗口；加载更多继续带相同条件和 `limit=20`；清空全部条件后恢复普通列表及其既有展开偏好；使用 latest request guard。
  验证：frontend store/service tests 断言请求 URL/query、offset reset、普通最近 10 条、普通展开 20 条、search-mode visible window、append pagination、普通态恢复行为和 stale response ignore。
- [x] 3.2 在 Sidebar 会话列表区域增加搜索输入框：placeholder 使用 `sessionHistory.searchPlaceholder` i18n；空值显示搜索图标；非法短查询（1 个 code point，或全 ASCII 且长度为 2）时在输入框内部右侧显示 icon-only 提示状态并通过 Tooltip 或等价悬浮提示/accessible label 提示“ASCII 至少 3 个字符，中文等非 ASCII 至少 2 个字符”，不发起关键词请求且不推动下方会话列表；合法非空查询时显示可点击清除图标；文本变更经过组件级短 debounce 间隔后查询，具体数值为前端实现常量；IME composition 期间不查询；点击清除立即清空关键词并保留日期条件重新查询。  
  验证：frontend component tests 使用 fake timers 和 composition events 断言 debounce、IME、ASCII 短关键词不请求、单字中文不请求、两字中文可请求、短关键词提示不占用列表布局、清除行为、i18n 文案和 a11y。
- [x] 3.3 在搜索框外右侧增加日期图标入口和创建时间范围选择：日期图标触发日期范围选择浮层；侧栏常驻区域不内联显示完整 RangePicker；不新增自定义日期组件或新依赖；不设置隐藏默认日期范围；完整范围选择后触发查询；按浏览器本地时间转换整数 epoch millis；范围最大固定 90 天；选择后在搜索行下方显示低强调级别、次级文字的紧凑日期范围摘要；清除后摘要消失且不清除关键词。  
  验证：frontend component tests 断言日期图标触发日期范围选择浮层、日期选择请求参数、90 天最大跨度阻止、紧凑摘要显示/清除行为、关键词保留、a11y 和悬浮提示；browser QA 检查摘要不重叠、不挤压、不溢出。
- [x] 3.4 保持搜索结果列表与原会话列表一致：复用现有列表项、点击、重命名和加载更多；搜索态使用自身 20 条可见窗口，不覆盖普通列表展开偏好；搜索态重命名后保留当前关键词、创建时间范围和已加载窗口刷新列表；搜索态空结果使用 `sessionHistory.noMatchesTitle` i18n；不增加命中片段、高亮、结果数量或独立搜索结果组件。  
  验证：frontend component tests 覆盖搜索态 20 条可见窗口、加载更多、清空条件后恢复普通展开偏好、重命名后按当前过滤条件刷新、搜索空态和 i18n；code review 检查无 `matchedQuestion`、highlight、result count、独立 search page/list DTO。
- [x] 3.5 支持 collapsed Sidebar 搜索入口打开 local/immersive search dialog：78px collapsed Sidebar 不显示会话行，提供一个 icon-only 搜索入口；点击或键盘触发后打开同一个搜索对话框；对话框复用搜索输入、日期图标入口、紧凑日期范围摘要、清除、debounce、IME、aria-label 和悬浮提示规则；无搜索条件显示最近 10 条，搜索态显示 20 条窗口；对话框打开/关闭不改变 collapsed 状态、不写入普通展开偏好，也不覆盖普通 Sidebar 会话列表或收藏视图；选择会话沿用 local/immersive 导航并关闭对话框；query 不写入 URL、localStorage 或 sessionStorage。
  验证：frontend component tests 覆盖 collapsed 入口、同一 dialog 复用控件、最近 10 条、搜索态 20 条、刷新/remount 清空 query、选择会话导航并关闭；browser QA 覆盖 dialog 位置和列表滚动。
- [x] 3.6 增强 collaborative PIU 现有 History Popover：不新增 Sidebar、第二个历史入口、PIU 专用搜索 store 或 PIU 专用 query namespace；Popover 内容复用搜索输入、日期图标入口、紧凑日期范围摘要、清除、debounce、IME、aria-label 和悬浮提示规则及 i18n 资源；无搜索条件保持最近 10 条和滚动加载更多；搜索态显示 20 条窗口并携带当前条件加载更多；选择会话继续通过 PIU runtime state/sessionStorage，不改变宿主页 URL；Popover 打开/关闭不改变 docked/floating/maximized layout state。  
  验证：frontend PIU component/runtime tests 覆盖 History Popover 搜索增强、最近 10 条、搜索态 20 条、选择会话写入既有 `nextagent:AIAgentPIU:activeSessionId` 且不改 URL、不改 layout；browser QA 覆盖 docked/floating/maximized。

## 4. 集成验证与收口

- [x] 4.1 运行 OpenSpec 严格校验并修复本 change 的规格问题。  
  验证：`openspec validate add-ts-session-history-search --strict`。
- [x] 4.2 运行相关后端验证，覆盖 Web route、contract、gateway-local 和架构边界。  
  验证：`npm run test:contract`、相关 `npm test -- <focused test files>`、`npm run lint:architecture`。
- [x] 4.3 运行相关前端验证，覆盖搜索输入、AntD 日期范围、清除、请求乱序、搜索空态、搜索态重命名、加载更多、local/immersive search dialog、collaborative PIU History Popover、i18n 文案、搜索条件生命周期和构建。
  验证：`npm test -- <frontend focused test files>`、`frontend/agent-web npm run build`。
- [x] 4.4 做一次实现后架构 review：确认没有新增全局 `/search` endpoint、没有 public 全文搜索 endpoint/DTO/snippet、没有 `COUNT(*)`、没有 JS 全量内存过滤、没有私有 FTS/search document/sidecar 表、没有自定义日期组件或新日期依赖、没有命中片段/高亮/数量 DTO、没有因为搜索新增专用 session-list entry DTO 或删除既有 `lastRunStatus`/`hasInFlightRequest` 等运行态摘要字段、没有把 `q`、空白 `q` 或非法短关键词下沉到 runtime/session/gateway contract、没有搜索 assistant/tool/Capability result、没有新增 conversation preview/anchor 语义、没有新增 PIU 专用搜索 store/query namespace、没有硬编码新增用户可见搜索文案、没有让 local/immersive search dialog 改写普通展开偏好或当前 Sidebar view、没有让搜索条件写入 URL/localStorage/sessionStorage、没有让 PIU 搜索改宿主 URL 或 layout state。

## 归档前更新基线（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/session-history-search/spec.md`。
- 更新 `openspec/specs/ts-minimal-agent-kernel/spec.md` 中 `GET /api/v1/sessions` query 白名单。
- 更新 `openspec/specs/agent-web-multi-host-modes/spec.md` 中 PIU History Popover 的搜索增强。
- 更新 `openspec/overview.md`、`openspec/designs/architecture/core-contracts.md`、`openspec/designs/modules/agent-channel-web.md`、`openspec/designs/modules/agent-session.md`、`openspec/designs/modules/agent-platform-gateway-local.md` 和 `openspec/designs/spec-to-design-map.md` 中与 session history search 相关的稳定事实。
