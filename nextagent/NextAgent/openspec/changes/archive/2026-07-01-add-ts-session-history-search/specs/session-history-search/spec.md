## ADDED Requirements

### Requirement: 会话历史支持按问题相关文本和创建时间搜索

系统 SHALL 通过现有 `GET /api/v1/sessions` 会话列表接口支持受控搜索。该接口 SHALL 接受 `q`、`createdFrom`、`createdTo`、`offset` 和 `limit` 查询参数。

`q` SHALL 在 `trim()` 后作为 ASCII 大小写不敏感的字面量子串匹配会话标题和可见 USER 消息内容。`q` 中的空格 SHALL 保留为普通字符；`%`、`_`、`\` 等字符 MUST NOT 被解释为通配符或转义控制。`q` 为空或 `trim()` 后为空时，系统 SHALL 不生成或传递 `questionSearchText`，并 SHALL 按无文本搜索条件处理。非空 `q.trim()` 长度 MUST NOT 超过 50 个 Unicode code point；全 ASCII 查询的最小长度 MUST 为 3 个 code point；包含任意非 ASCII code point 的查询最小长度 MUST 为 2 个 code point。长度为 1、全 ASCII 且长度为 2，或超过 50 个 code point 时，Web API SHALL 返回请求校验错误，前端 SHALL 不发起关键词搜索请求。系统 SHALL 让 `cpu` 命中 `CPU`，也 SHALL 让 `CPU` 命中 `cpu`。系统 MUST NOT 承诺拼音、全半角、重音字符、Unicode 特殊大小写折叠、分词或语义相似匹配。

会话标题指持久化会话标题字段；系统 MUST NOT 区分标题来源是用户手动修改还是根据首个用户问题生成。USER 消息搜索范围 MUST 仅包含同一会话中 `role=USER` 且 `visible=true` 的消息内容。系统 MUST NOT 搜索 assistant 回答、工具输出、Capability result、隐藏消息或不可见历史。

`createdFrom` 和 `createdTo` SHALL 使用整数 epoch millis，并按会话创建时间进行闭区间过滤。二者必须同时出现或同时缺省；只提供其中一个时，Web API SHALL 返回请求校验错误。`createdFrom` MUST 小于或等于 `createdTo`。系统 SHALL NOT 设置隐藏的默认创建时间范围；只有用户显式选择完整日期范围时才应用创建时间过滤。用户选择的开始和结束范围最大为固定 90 天；前端 SHOULD 在 DatePicker 中禁用超过该跨度的日期，Web API MUST 拒绝超过 90 天减 1 毫秒的 epoch millis 范围作为后端数值兜底。

结果 SHALL 按会话活跃时间排序：`updatedAt` 降序，同一活跃时间下按 `sessionId` 升序稳定排序。分页 SHALL 使用 `offset` 和 `limit`，且分页对象 MUST 是去重后的 session，不是 message match row；同一 session 内多个 visible USER message 命中时，该 session 在结果中只能出现一次，重复命中不得影响 `offset`、`limit` 或 `hasMore`。当存在合法 trim 后非空的 `q` 或完整 `createdFrom/createdTo` 范围且未显式提供 `limit` 时，系统 SHALL 使用 20 作为搜索列表页大小。当不存在合法 trim 后非空的 `q` 且不存在完整 `createdFrom/createdTo` 范围且未显式提供 `limit` 时，系统 SHALL 保持既有普通会话列表默认页大小。搜索查询的 `limit` MUST NOT 超过 50。系统 MUST 支持使用相同搜索条件继续加载更多结果。

gateway-local SHALL 在 SQLite 查询层对 `sessions` 和 `messages` 源事实执行受限搜索，不新增私有全文搜索表、search document 表或 public 搜索索引 contract。实现 MUST 将 owner scope、Agent scope、创建时间过滤、标题/可见 USER 消息字面量匹配、去重后的 session 排序和分页下推到 SQL 层；visible USER message 命中 SHOULD 使用 `EXISTS` 或等价 session-level 子查询表达，MUST NOT 用 message match row 直接分页。实现 MUST NOT 在 JS 中拉取 owner+agent scope 下全部 session 或全部 message 后过滤，MUST NOT 做 `COUNT(*)`，MUST NOT 提供分词搜索、相关性排序、命中片段、高亮、结果数量或新的 public 全文搜索 endpoint。本 change 不承诺大量历史或极端高命中率查询在所有数据规模下固定低延迟；如果未来需要大规模全历史低延迟搜索，必须由独立 change 定义 FTS/search-index 方案、迁移和容量验证。

#### Scenario: 按标题命中会话
- **GIVEN** owner scope 和 Agent scope 下存在标题包含 `网络延迟` 的会话
- **WHEN** 客户端请求 `GET /api/v1/sessions?q=网络延迟&offset=0&limit=20`
- **THEN** 响应 MUST 包含该会话
- **AND** 响应 MUST 使用既有会话列表分页结构
- **AND** 结果 MUST 按 `updatedAt` 降序、`sessionId` 升序排序

#### Scenario: 按可见用户问题命中会话
- **GIVEN** owner scope 和 Agent scope 下存在一个会话，其可见 USER 消息内容包含 `小区告警`
- **WHEN** 客户端请求 `GET /api/v1/sessions?q=小区告警&offset=0&limit=20`
- **THEN** 响应 MUST 包含该会话
- **AND** 若同会话的 assistant 回答包含 `小区告警` 但没有标题或可见 USER 消息命中，响应 MUST NOT 因该 assistant 内容包含该会话

#### Scenario: 关键词按字面量匹配
- **GIVEN** owner scope 和 Agent scope 下存在标题或可见 USER 消息包含文本 `CPU_告警%`
- **WHEN** 客户端请求 `GET /api/v1/sessions?q=CPU_告警%&offset=0&limit=20`
- **THEN** 系统 MUST 将 `_` 和 `%` 当作普通字符匹配
- **AND** 系统 MUST NOT 将该请求扩展为通配符搜索

#### Scenario: 英文关键词大小写不敏感
- **GIVEN** owner scope 和 Agent scope 下存在标题或可见 USER 消息包含文本 `CPU 告警`
- **WHEN** 客户端请求 `GET /api/v1/sessions?q=cpu&offset=0&limit=20`
- **THEN** 响应 MUST 包含该会话
- **WHEN** 客户端请求 `GET /api/v1/sessions?q=CPU&offset=0&limit=20`
- **THEN** 响应 MUST 同样包含标题或可见 USER 消息包含 `cpu` 的会话

#### Scenario: 按创建时间闭区间过滤
- **GIVEN** owner scope 和 Agent scope 下存在三个会话，其 `createdAt` 分别早于、位于、晚于请求时间范围
- **WHEN** 客户端请求 `GET /api/v1/sessions?createdFrom=<from>&createdTo=<to>&offset=0&limit=20`
- **THEN** 响应 MUST 只包含 `createdAt >= from` 且 `createdAt <= to` 的会话
- **AND** 结果排序仍 MUST 使用 `updatedAt` 降序、`sessionId` 升序

#### Scenario: 创建时间边界必须成对出现
- **WHEN** 客户端只提供 `createdFrom` 或只提供 `createdTo`
- **THEN** Web API SHALL 返回请求校验错误
- **AND** 系统 MUST NOT 返回部分过滤后的会话列表

#### Scenario: 创建时间范围最大跨度为 90 天
- **WHEN** 客户端提供的 `createdFrom/createdTo` epoch millis 范围超过 90 天减 1 毫秒
- **THEN** Web API SHALL 返回请求校验错误
- **AND** 系统 MUST NOT 返回未过滤或部分过滤后的会话列表

#### Scenario: 单字符关键词失败关闭
- **WHEN** 客户端提供 trim 后长度为 1 的 `q`
- **THEN** Web API SHALL 返回请求校验错误

#### Scenario: 两字符 ASCII 关键词失败关闭
- **WHEN** 客户端提供全 ASCII 且 trim 后长度为 2 的 `q`
- **THEN** Web API SHALL 返回请求校验错误

#### Scenario: 两字中文关键词可查询
- **WHEN** 客户端提供包含非 ASCII code point 且 trim 后长度为 2 的 `q`
- **THEN** Web API SHALL 接受该关键词并映射为 `questionSearchText`

#### Scenario: 同一会话多条消息命中仍按 session 去重分页
- **GIVEN** owner scope 和 Agent scope 下同一会话有多条 visible USER 消息命中 `告警`
- **WHEN** 客户端请求 `GET /api/v1/sessions?q=告警&offset=0&limit=20`
- **THEN** 响应 MUST 只包含该会话一次
- **AND** `hasMore` MUST 基于去重后的 session 结果判断

#### Scenario: 搜索态加载更多保持条件
- **GIVEN** 客户端已经以 `q=网络延迟`、`createdFrom=<from>`、`createdTo=<to>` 加载第一页搜索结果
- **WHEN** 客户端继续加载更多结果
- **THEN** 后续请求 MUST 携带相同的 `q`、`createdFrom` 和 `createdTo`
- **AND** 响应 MUST 返回同一过滤条件下从新 `offset` 开始的下一页

#### Scenario: SQL 搜索与源事实等价
- **GIVEN** gateway-local 已经持久化会话标题和 visible USER 消息源事实
- **WHEN** 客户端请求命中标题或可见 USER 消息内容的 `q`
- **THEN** 响应 MUST 与直接按标题和可见 USER 消息执行 ASCII 大小写不敏感字面量子串判断的结果一致
- **AND** 响应排序仍 MUST 使用 `updatedAt` 降序、`sessionId` 升序
- **AND** 响应 MUST NOT 包含命中片段、高亮或结果数量

### Requirement: 前端会话列表复用原展示并提供搜索和日期交互

前端 SHALL 在现有会话历史入口提供关键词输入框和创建时间范围选择入口。搜索结果 SHALL 复用原会话列表的列表项样式、点击、重命名和加载更多交互。搜索态无匹配结果时，前端 SHALL 复用原空态布局但使用 locale-backed 文案展示“未找到匹配会话”语义，MUST NOT 使用普通“没有历史会话”语义的文案。前端 MUST NOT 为搜索态新增独立页面、独立结果列表、命中片段、高亮、结果数量或不同的列表项布局。

新增或本 change 触达的前端可见文案、placeholder、Tooltip 或等价悬浮提示、aria-label、搜索空态和创建时间摘要标签 MUST 使用现有 i18n 资源。系统 MUST 在共享 `sessionHistory` 资源分组下提供 `searchPlaceholder`、`searchHistory`、`openDateRange`、`clearKeyword`、`clearCreatedTimeRange`、`createdFrom`、`createdTo` 和 `noMatchesTitle`，并 MAY 复用既有普通历史加载/空态资源。本文档中的中文和英文文案仅为 locale 示例，MUST NOT 被组件硬编码。

搜索输入框为空时 SHALL 在输入框内部右侧显示搜索图标；输入框有内容且 `q.trim()` 满足最小搜索长度时 SHALL 显示可点击清除图标。非法短查询（1 个 code point，或全 ASCII 且长度为 2）时，前端 MUST NOT 发起关键词搜索请求，MUST 在输入框内部右侧用 icon-only 警示/提示状态替代搜索图标，并通过 Tooltip 或等价悬浮提示和 accessible label 提示 ASCII 至少 3 个字符、中文等非 ASCII 至少 2 个字符；该提示 MUST NOT 占用会话列表布局空间、不得把下方会话列表向下推，也不得触发搜索空态。清除图标和日期图标作为 icon-only 控件时 MUST 可通过键盘触发，并提供可访问名称和悬浮说明。用户修改输入内容后，前端 SHALL 在最后一次非 IME 组合输入变更后经过组件级短 debounce 间隔再发起合法关键词搜索请求；具体 debounce 数值属于前端实现常量，不进入 Web/API、runtime、session 或 gateway contract。IME 组合输入期间前端 MUST NOT 发起搜索请求；组合结束后 SHALL 按同一 debounce 规则发起查询。点击清除图标 SHALL 清空 `q` 并立即按当前日期条件重新查询。

创建时间范围入口 SHALL 位于搜索框外部右侧，以日期图标表示。点击或键盘触发日期图标后，前端 SHALL 打开承载 AntD `DatePicker.RangePicker` 的选择浮层；侧栏常驻区域 MUST NOT 直接内联显示完整 RangePicker 输入框。RangePicker SHALL 支持精确到秒的日期时间选择。系统 SHALL NOT 预设隐藏的默认日期范围；日期过滤只在用户选择完整开始和结束时间后生效。用户选择完整创建时间范围后，前端 SHALL 按浏览器本地时区解释用户选择的年月日时分秒，转换为整数 epoch millis 传给后端。用户选择的开始和结束范围最大为固定 90 天；前端 SHOULD 在 RangePicker 中禁用超过该跨度的日期，且 MUST 在提交前阻止超过该跨度的范围。选择后前端 SHALL 在搜索行下方、会话列表上方显示当前创建时间范围；清除日期条件后，该显示 SHALL 消失，并按当前关键词重新查询。

已选创建时间范围 SHALL 以紧凑筛选摘要呈现，而不是以内联 RangePicker 输入框、长文本按钮或搜索框占位文本呈现。该摘要 MUST 使用比搜索输入和会话标题更低强调级别的字体和次级文字颜色；具体字号属于前端组件常量，不进入 Web/API、runtime、session 或 gateway contract。摘要标签 MUST 使用 i18n 的 `createdFrom` 和 `createdTo` 资源；zh-CN 示例为 `起: YYYY/MM/DD HH:mm:ss` 和 `止: YYYY/MM/DD HH:mm:ss`，en-US 示例为 `From: MM/DD/YYYY HH:mm:ss` 和 `To: MM/DD/YYYY HH:mm:ss`。摘要 MUST 提供独立的 icon-only 清除按钮，清除按钮 MUST 有可访问名称和悬浮说明，zh-CN 语义为“清除搜索时间”。摘要在 local/immersive search dialog 和 collaborative PIU History Popover 中 MUST 保持紧凑，超出时使用省略并通过 Tooltip 或 accessible label 提供完整范围；摘要 MUST 占据正常布局空间，不得覆盖搜索框、会话列表、加载更多或 PIU/Prel 顶部菜单。

当 `q.trim()` 为空且没有完整创建时间范围时，260px Sidebar 普通未展开列表 SHALL 显示最近 10 条；普通展开态 SHALL 使用 20 条历史窗口并继续支持加载更多；local/immersive search dialog 和 collaborative PIU History Popover SHALL 显示最近 10 条。当 `q.trim()` 满足最小搜索长度或完整创建时间范围存在时，前端 SHALL 进入搜索态并请求搜索列表；搜索态首屏 SHALL 请求并展示 20 条搜索窗口，MUST NOT 被普通会话列表未展开时最近 10 条的偏好截断；加载更多 SHALL 继续请求 20 条结果。非法短查询且没有完整创建时间范围时，前端 SHALL 保持当前普通列表或上一合法搜索结果不被短关键词请求覆盖。搜索态 MUST NOT 覆盖普通会话列表展开偏好；清空全部搜索条件后，前端 SHALL 恢复普通会话列表及其既有展开偏好。

local、immersive 和 collaborative host runtime 在产品运行时互斥；同一真实运行时不会同时出现 Sidebar 与 collaborative PIU History Popover。Local/immersive Sidebar search dialog MUST keep query、result entries、offset、hasMore、loading/error state 和 latest request guard local to the dialog so search results do not overwrite the ordinary Sidebar session list or favorites/recent view. Collaborative PIU History Popover MUST continue to use the existing session history store/action shape for the current host runtime and MUST NOT add a PIU-specific search store or query namespace.

78px collapsed Sidebar SHALL NOT 显示会话行。collapsed Sidebar SHALL 提供一个 icon-only 搜索入口，点击或键盘触发后打开同一个 local/immersive search dialog。该 dialog MUST 复用本 requirement 中定义的关键词输入、日期图标入口、紧凑日期范围摘要、debounce、IME 保护、清除行为、可访问名称和悬浮提示规则，MUST NOT 只实现会话结果列表。该 dialog 在无搜索条件时 SHALL 显示最近 10 条，在搜索态 SHALL 显示 20 条搜索窗口。Dialog 打开或关闭 MUST NOT 改变 Sidebar collapsed 状态，MUST NOT 写入普通会话列表展开偏好，MUST NOT 覆盖普通 Sidebar 会话列表或收藏视图。选择会话 SHALL 沿用 local/immersive 既有导航行为并关闭 dialog。Dialog query MUST NOT 写入 URL、localStorage 或 sessionStorage。

collaborative PIU SHALL 增强现有 History Popover，不新增 Sidebar、第二个历史入口、独立搜索页面、PIU 专用搜索 store 或 PIU 专用 query namespace。该 History Popover MUST 复用本 requirement 中定义的关键词输入、日期图标入口、紧凑日期范围摘要、debounce、IME 保护、清除行为、可访问名称和悬浮提示规则，MUST NOT 只实现会话结果列表。该 History Popover 在无搜索条件时 SHALL 保持最近 10 条和滚动加载更多；搜索态 SHALL 显示 20 条搜索窗口并继续携带当前条件加载更多。选择会话 SHALL 继续使用 PIU runtime state 并写入既有 `nextagent:AIAgentPIU:activeSessionId` sessionStorage key，MUST NOT 改变宿主页 URL。History Popover 打开、关闭或搜索 MUST NOT 改变 PIU docked、floating 或 maximized layout state。

前端 SHALL 按当前关键词、创建时间范围、offset 和 limit 识别会话列表请求。若旧请求晚于新请求返回，旧请求 MUST NOT 覆盖当前会话列表、分页状态、错误状态或加载状态。搜索态中重命名会话成功后，前端 SHALL 保留当前关键词、创建时间范围和已加载窗口刷新列表，MUST NOT 无条件恢复普通会话列表。搜索关键词和创建时间范围 MUST NOT 写入 URL、localStorage 或 sessionStorage；PIU History Popover 关闭 MUST NOT 清空当前 runtime 内的 committed search query；页面刷新或 host runtime remount 后，搜索关键词和创建时间范围 MUST 为空。PIU 只允许继续写入既有 `nextagent:AIAgentPIU:activeSessionId` sessionStorage key，不得写入额外 search key。

#### Scenario: 输入合法关键词后自动搜索
- **WHEN** 用户在会话列表搜索框输入 `网络延迟`
- **THEN** 前端 MUST 在最后一次非 IME 组合输入变更后经过组件级短 debounce 间隔
- **AND** 前端 MUST 请求包含 `q=网络延迟`、`offset=0`、`limit=20` 的会话列表
- **AND** 列表展示 MUST 使用原会话列表样式
- **AND** 前端 MUST 展示该 20 条搜索窗口，不得只展示普通未展开态的 10 条最近历史窗口

#### Scenario: 短关键词只提示不查询
- **WHEN** 用户在会话列表搜索框输入 trim 后长度为 1 的关键词
- **THEN** 前端 MUST NOT 发起包含该 `q` 的会话列表请求
- **WHEN** 用户输入全 ASCII 且 trim 后长度为 2 的关键词
- **THEN** 前端 MUST NOT 发起包含该 `q` 的会话列表请求
- **AND** 前端 MUST 在搜索框内部右侧显示 icon-only 警示/提示状态
- **AND** Tooltip 或等价悬浮提示以及 accessible label MUST 提示 ASCII 至少 3 个字符、中文等非 ASCII 至少 2 个字符
- **AND** 该提示 MUST NOT 占用会话列表布局空间、不得移动会话列表、不得显示搜索空态

#### Scenario: 两字中文关键词自动搜索
- **WHEN** 用户在会话列表搜索框输入包含非 ASCII code point 且 trim 后长度为 2 的关键词
- **THEN** 前端 MUST 按合法关键词发起会话列表请求
- **AND** 前端 MUST NOT 显示短关键词警示状态

#### Scenario: 旧搜索请求不能覆盖新结果
- **GIVEN** 用户先输入 `网络延` 并触发请求 A
- **AND** 用户随后输入 `网络延迟` 并触发请求 B
- **WHEN** 请求 B 先返回并更新列表，随后请求 A 返回
- **THEN** 前端 MUST 保留请求 B 对应的 `网络延迟` 结果
- **AND** 请求 A MUST NOT 覆盖当前列表、分页状态、错误状态或加载状态

#### Scenario: 输入框清除只清除关键词
- **GIVEN** 搜索框中已有关键词 `告警`
- **AND** 当前已选择创建时间范围
- **WHEN** 用户点击输入框内的清除图标
- **THEN** 前端 MUST 清空关键词
- **AND** 前端 MUST 保留创建时间范围
- **AND** 前端 MUST 使用保留的创建时间范围重新请求会话列表

#### Scenario: 日期范围显示和清除
- **WHEN** 用户选择完整创建时间范围 `2026-06-01 00:00:00` 到 `2026-06-26 23:59:59`
- **THEN** 前端 MUST 通过日期图标触发的日期范围选择浮层接收该范围
- **AND** 前端 MUST 在搜索行下方、会话列表上方以小号字体和 locale-backed 标签的紧凑筛选摘要显示该创建时间范围
- **AND** 该摘要 MUST 提供完整范围 Tooltip 或等价悬浮提示以及 accessible label
- **AND** 前端 MUST 将该本地时间范围转换为整数 epoch millis 传给后端
- **WHEN** 用户清除日期条件
- **THEN** 前端 MUST 移除该时间范围显示
- **AND** 前端 MUST 按当前关键词重新请求会话列表

#### Scenario: 搜索态无匹配结果
- **GIVEN** 当前存在关键词或创建时间范围
- **WHEN** 搜索请求成功返回空 entries
- **THEN** 前端 MUST 使用 i18n 的 `sessionHistory.noMatchesTitle` 显示“未找到匹配会话”语义的空态
- **AND** 前端 MUST NOT 显示普通“没有历史会话”语义的空态
- **AND** 前端 MUST NOT 显示结果数量

#### Scenario: 搜索态使用独立结果窗口和更多分页
- **GIVEN** 搜索态返回超过 20 条匹配会话
- **WHEN** 用户点击查看更多
- **THEN** 前端 MUST 复用原会话列表的加载更多交互
- **AND** 加载更多请求 MUST 带上当前 `q`、`createdFrom` 和 `createdTo`
- **AND** 搜索态 MUST NOT 写入普通会话列表展开偏好

#### Scenario: collapsed Sidebar 打开搜索 dialog
- **GIVEN** Sidebar 处于 78px collapsed 状态
- **WHEN** 用户打开搜索入口且没有搜索条件
- **THEN** 前端 MUST 打开 local/immersive search dialog
- **AND** dialog MUST 显示最近 10 条会话
- **AND** dialog MUST 提供与 local/immersive search dialog 相同规则的关键词输入、日期图标入口、紧凑日期范围摘要和清除行为
- **WHEN** 用户输入关键词或选择完整创建时间范围
- **THEN** dialog MUST 显示 20 条搜索窗口
- **AND** Sidebar collapsed 状态、普通会话列表展开偏好、普通会话列表内容和收藏视图 MUST NOT 被 dialog 打开、关闭或搜索改变

#### Scenario: collaborative PIU History Popover 支持搜索
- **GIVEN** collaborative PIU 面板已经打开
- **WHEN** 用户打开现有 History Popover 且没有搜索条件
- **THEN** Popover MUST 显示最近 10 条会话并支持加载更多
- **AND** Popover MUST 提供同一规则的关键词输入、日期图标入口、紧凑日期范围摘要和清除行为
- **WHEN** 用户输入关键词或选择完整创建时间范围
- **THEN** Popover MUST 显示 20 条搜索窗口
- **AND** 选择会话 MUST 更新 PIU runtime active session 和既有 `nextagent:AIAgentPIU:activeSessionId`
- **AND** 选择会话 MUST NOT 修改宿主页 URL
- **AND** 搜索和 Popover 打开关闭 MUST NOT 修改 PIU docked、floating 或 maximized layout state

#### Scenario: 搜索条件只在当前 runtime 生命周期内保留
- **GIVEN** collaborative PIU History Popover 已经提交关键词或创建时间范围
- **WHEN** 用户关闭并重新打开 PIU History Popover
- **THEN** 当前 runtime 内的 committed search query MUST 保留
- **WHEN** 页面刷新或 host runtime remount
- **THEN** 搜索关键词和创建时间范围 MUST 清空
- **AND** 前端 MUST NOT 从 URL、localStorage 或 sessionStorage 恢复搜索条件
- **AND** local/immersive search dialog 的搜索条件 MUST 保持在 dialog 本地，不得恢复到普通 Sidebar 会话列表、URL、localStorage 或 sessionStorage
- **AND** PIU MUST NOT 写入除 `nextagent:AIAgentPIU:activeSessionId` 之外的 search-related sessionStorage key

#### Scenario: 搜索态重命名后保留过滤条件
- **GIVEN** 当前处于关键词或创建时间范围搜索态
- **AND** 用户已经加载一页或多页搜索结果
- **WHEN** 用户重命名其中一个会话并保存成功
- **THEN** 前端 MUST 使用保存前的关键词和创建时间范围刷新会话列表
- **AND** 前端 MUST 保留保存前已加载窗口大小
- **AND** 前端 MUST NOT 恢复为普通会话列表

### Requirement: 搜索查询保持 scope 隔离和安全校验

系统 SHALL 对会话历史搜索保持现有 Owner Scope 和 Agent Scope 隔离。`tenantId`、`subjectId` 和 `agentId` MUST 来自可信 channel/auth、runtime 或已持久化会话事实，MUST NOT 来自客户端请求体、查询字符串、模型输出或 Capability 参数。

Web API SHALL 校验 `q`、`createdFrom`、`createdTo`、`offset` 和 `limit`。非空 `q.trim()` 长度 MUST NOT 超过 50 个 Unicode code point；全 ASCII 查询最小长度 MUST 为 3；包含任意非 ASCII code point 的查询最小长度 MUST 为 2；`q` 的 `%`、`_`、`\` MUST 按字面量转义后再参与 ASCII 大小写不敏感匹配；`createdFrom` 和 `createdTo` MUST 是整数且有限的 epoch millis，MUST 成对出现，MUST 满足 `createdFrom <= createdTo`，且二者 epoch millis 跨度 MUST NOT 超过 90 天减 1 毫秒；`offset` MUST 是非负整数；搜索查询的 `limit` MUST 是正整数且 MUST NOT 超过 50。校验失败时，系统 SHALL 返回请求校验错误，MUST NOT 执行降级的宽松查询。

后端服务时区 MUST NOT 参与搜索语义。前端传入的 `createdFrom` 和 `createdTo` 是绝对时间；后端 SHALL 只按数值比较持久化的 `createdAt`。

#### Scenario: 搜索不能跨 owner scope
- **GIVEN** 两个不同 owner scope 下分别存在标题或可见 USER 消息命中同一关键词的会话
- **WHEN** 当前用户请求该关键词的会话列表
- **THEN** 响应 MUST 只包含当前 owner scope 下的会话

#### Scenario: 搜索不能跨 Agent scope
- **GIVEN** 同一 owner scope 下两个不同 Agent scope 分别存在标题或可见 USER 消息命中同一关键词的会话
- **WHEN** 当前会话列表请求由某一可信 Agent scope 处理
- **THEN** 响应 MUST 只包含该 Agent scope 下的会话

#### Scenario: 后端不使用服务端时区解释日期
- **GIVEN** 用户浏览器时区和后端服务运行时区不一致
- **AND** 前端已经把用户选择的本地创建时间范围转换为整数 epoch millis
- **WHEN** 后端处理 `createdFrom` 和 `createdTo`
- **THEN** 后端 MUST 只按整数 epoch millis 数值比较 `createdAt`
- **AND** 后端 MUST NOT 按服务端本地时区重新解释用户选择的日期字符串

#### Scenario: 非法查询参数失败关闭
- **WHEN** 客户端提供非法短查询、超过 50 个 Unicode code point 的 `q`、非整数或非有限时间戳、超过 90 天减 1 毫秒的创建时间范围、负数 `offset` 或超过 50 的搜索 `limit`
- **THEN** Web API SHALL 返回请求校验错误
- **AND** 系统 MUST NOT 返回未过滤或部分过滤的会话列表
### Requirement: Local and immersive Sidebar search opens a contained dialog

In local and immersive host modes, the Sidebar search entry SHALL open a dialog and MUST NOT navigate to a route. The current Sidebar view SHALL remain unchanged and MUST NOT be replaced by search results.

The dialog SHALL contain keyword search, creation-time range filtering, result rows, loading/error/empty states, and load-more behavior. Dialog result rows SHALL reuse the ordinary Sidebar session row behavior for opening sessions and renaming sessions, including write-permission gating for rename.

The dialog SHALL call the existing `GET /api/v1/sessions` search contract. Its query, result entries, offset, has-more, loading/error state, and latest-request guard SHALL be local to the dialog. Dialog search conditions MUST NOT write URL, localStorage, sessionStorage, ordinary Sidebar expanded preference, ordinary Sidebar collapsed state, current Sidebar favorites/recent view, or the global Sidebar session list.

When a session is renamed from the dialog, the frontend SHALL call the same session-title API, refresh the dialog result window using the current keyword, creation-time range, and loaded window size, and MAY update the already loaded ordinary Sidebar row with the same session id so the visible title does not remain stale.

#### Scenario: Local or immersive user opens history search
- **WHEN** the user clicks the Sidebar search entry in local or immersive mode
- **THEN** the frontend SHALL open a search dialog
- **AND** the browser URL MUST NOT change
- **AND** the current Sidebar view MUST remain unchanged behind the dialog

#### Scenario: Local or immersive search results stay inside the dialog
- **WHEN** the user enters a valid keyword or chooses a complete creation-time range in the dialog
- **THEN** the frontend SHALL request `/api/v1/sessions` with the current search conditions
- **AND** matching sessions SHALL be rendered inside the dialog result list
- **AND** the ordinary Sidebar session list and current Sidebar view MUST NOT be overwritten by the dialog results

#### Scenario: Dialog result row supports rename
- **WHEN** the user opens the row action menu for a dialog search result and chooses rename
- **THEN** the frontend SHALL show the same rename interaction used by the ordinary Sidebar session row
- **AND** successful rename SHALL refresh the dialog result window using the current filters
