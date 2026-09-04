# session-history-search Specification

## Purpose
Define the stable API, contract, persistence, and host-surface behavior for controlled session-history search through the existing session list capability.
## Requirements
### Requirement: 会话历史支持按问题相关文本和活动时间搜索

系统 SHALL 通过现有 `GET /api/v1/sessions` 会话列表接口支持受控搜索。该接口 SHALL 接受 `q`、`createdFrom`、`createdTo`、`offset` 和 `limit` 查询参数。

`createdFrom` 和 `createdTo` SHALL 使用整数 epoch millis，并按会话活动时间进行闭区间过滤。这里的活动时间指会话列表已经公开展示和排序使用的最后活动时间：内部事实为 `updatedAt`，Web 输出投影为 `lastActivityAt`。二者必须同时出现或同时缺省；只提供其中一个时，Web API SHALL 返回请求校验错误。`createdFrom` MUST 小于或等于 `createdTo`。系统 SHALL NOT 设置隐藏的默认时间范围；只有用户显式选择完整日期范围时才应用时间过滤。用户选择的开始和结束范围最大为固定 90 天；前端 SHOULD 在 DatePicker 中禁用超过该跨度的日期，Web API MUST 拒绝超过 90 天减 1 毫秒的 epoch millis 范围作为后端数值兜底。

结果 SHALL 按会话活跃时间排序：`updatedAt` 降序，同一活跃时间下按 `sessionId` 升序稳定排序。

#### Scenario: 按活动时间闭区间过滤

- **GIVEN** owner scope 和 Agent scope 下存在三个会话，其最后活动时间分别早于、位于、晚于请求时间范围
- **WHEN** 客户端请求 `GET /api/v1/sessions?createdFrom=<from>&createdTo=<to>&offset=0&limit=20`
- **THEN** 响应 MUST 只包含 `updatedAt >= from` 且 `updatedAt <= to` 的会话
- **AND** 结果排序仍 MUST 使用 `updatedAt` 降序、`sessionId` 升序

#### Scenario: 创建时间命中但活动时间越界的会话被排除

- **GIVEN** owner scope 和 Agent scope 下存在一个会话，其 `createdAt` 位于请求时间范围内，但 `updatedAt` 晚于请求时间范围
- **WHEN** 客户端请求 `GET /api/v1/sessions?createdFrom=<from>&createdTo=<to>&offset=0&limit=20`
- **THEN** 响应 MUST NOT 包含该会话
- **AND** 系统 MUST 以列表可见的最后活动时间而不是创建时间决定是否命中

### Requirement: 前端会话列表复用原展示并提供搜索和日期交互

前端 SHALL 在现有会话历史入口提供关键词输入框和创建时间范围选择入口。搜索结果 SHALL 复用原会话列表的列表项样式、点击、重命名和加载更多交互。搜索态无匹配结果时，前端 SHALL 复用原空态布局但使用 locale-backed 文案展示“未找到匹配会话”语义，MUST NOT 使用普通“没有历史会话”语义的文案。前端 MUST NOT 为搜索态新增独立页面、独立结果列表、命中片段、高亮、结果数量或不同的列表项布局。

新增或本 change 触达的前端可见文案、placeholder、Tooltip 或等价悬浮提示、aria-label、搜索空态和创建时间摘要标签 MUST 使用现有 i18n 资源。系统 MUST 在共享 `sessionHistory` 资源分组下提供 `searchPlaceholder`、`searchHistory`、`openDateRange`、`clearKeyword`、`clearCreatedTimeRange`、`createdFrom`、`createdTo` 和 `noMatchesTitle`，并 MAY 复用既有普通历史加载/空态资源。本文档中的中文和英文文案仅为 locale 示例，MUST NOT 被组件硬编码。

搜索输入框为空时 SHALL 在输入框内部右侧显示搜索图标；输入框有内容且 `q.trim()` 非空且不超过 50 个 Unicode code point 时 SHALL 显示可点击清除图标。`q.trim()` 超过 50 个 Unicode code point 时，前端 MUST NOT 发起关键词搜索请求，MUST 在输入框内部右侧用 icon-only 警示/提示状态替代搜索图标，并通过 Tooltip 或等价悬浮提示和 accessible label 以非技术用户可理解的通俗文案提示关键词超出长度限制，MUST NOT 使用 ASCII 等技术术语；该提示 MUST NOT 占用会话列表布局空间、不得把下方会话列表向下推，也不得触发搜索空态。清除图标和日期图标作为 icon-only 控件时 MUST 可通过键盘触发，并提供可访问名称和悬浮说明。用户修改输入内容后，前端 SHALL 在最后一次非 IME 组合输入变更后经过组件级短 debounce 间隔再发起合法关键词搜索请求；具体 debounce 数值属于前端实现常量，不进入 Web/API、runtime、session 或 gateway contract。IME 组合输入期间前端 MUST NOT 发起搜索请求；组合结束后 SHALL 按同一 debounce 规则发起查询。点击清除图标 SHALL 清空 `q` 并立即按当前日期条件重新查询。

创建时间范围入口 SHALL 位于搜索框外部右侧，以日期图标表示。点击或键盘触发日期图标后，前端 SHALL 打开承载 AntD `DatePicker.RangePicker` 的选择浮层；侧栏常驻区域 MUST NOT 直接内联显示完整 RangePicker 输入框。RangePicker SHALL 支持精确到秒的日期时间选择。系统 SHALL NOT 预设隐藏的默认日期范围；日期过滤只在用户选择完整开始和结束时间后生效。用户选择完整创建时间范围后，前端 SHALL 按浏览器本地时区解释用户选择的年月日时分秒，转换为整数 epoch millis 传给后端。用户选择的开始和结束范围最大为固定 90 天；前端 SHOULD 在 RangePicker 中禁用超过该跨度的日期，且 MUST 在提交前阻止超过该跨度的范围。选择后前端 SHALL 在搜索行下方、会话列表上方显示当前创建时间范围；清除日期条件后，该显示 SHALL 消失，并按当前关键词重新查询。

已选创建时间范围 SHALL 以紧凑筛选摘要呈现，而不是以内联 RangePicker 输入框、长文本按钮或搜索框占位文本呈现。该摘要 MUST 使用比搜索输入和会话标题更低强调级别的字体和次级文字颜色；具体字号属于前端组件常量，不进入 Web/API、runtime、session 或 gateway contract。摘要标签 MUST 使用 i18n 的 `createdFrom` 和 `createdTo` 资源；zh-CN 示例为 `起: YYYY/MM/DD HH:mm:ss` 和 `止: YYYY/MM/DD HH:mm:ss`，en-US 示例为 `From: MM/DD/YYYY HH:mm:ss` 和 `To: MM/DD/YYYY HH:mm:ss`。摘要 MUST 提供独立的 icon-only 清除按钮，清除按钮 MUST 有可访问名称和悬浮说明，zh-CN 语义为“清除搜索时间”。摘要在 local/immersive search dialog 和 collaborative PIU History Popover 中 MUST 保持紧凑，超出时使用省略并通过 Tooltip 或 accessible label 提供完整范围；摘要 MUST 占据正常布局空间，不得覆盖搜索框、会话列表、加载更多或 PIU/Prel 顶部菜单。

当 `q.trim()` 为空且没有完整创建时间范围时，260px Sidebar 普通未展开列表 SHALL 显示最近 10 条；普通展开态 SHALL 使用 20 条历史窗口并继续支持加载更多；local/immersive search dialog 和 collaborative PIU History Popover SHALL 显示最近 10 条。当 `q.trim()` 非空或完整创建时间范围存在时，前端 SHALL 进入搜索态并请求搜索列表；搜索态首屏 SHALL 请求并展示 20 条搜索窗口，MUST NOT 被普通会话列表未展开时最近 10 条的偏好截断；加载更多 SHALL 继续请求 20 条结果。搜索态 MUST NOT 覆盖普通会话列表展开偏好；清空全部搜索条件后，前端 SHALL 恢复普通会话列表及其既有展开偏好。

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

#### Scenario: 单字符关键词直接搜索
- **WHEN** 用户在会话列表搜索框输入 trim 后长度为 1 的关键词（ASCII 或非 ASCII）
- **THEN** 前端 MUST 按合法关键词发起包含该 `q` 的会话列表请求
- **AND** 前端 MUST NOT 显示警示/提示状态

#### Scenario: 超长关键词只提示不查询
- **WHEN** 用户在会话列表搜索框输入 trim 后超过 50 个 Unicode code point 的关键词
- **THEN** 前端 MUST NOT 发起包含该 `q` 的会话列表请求
- **AND** 前端 MUST 在搜索框内部右侧显示 icon-only 警示/提示状态
- **AND** Tooltip 或等价悬浮提示以及 accessible label MUST 以非技术用户可理解的通俗文案提示关键词超出长度限制，MUST NOT 使用 ASCII 等技术术语
- **AND** 该提示 MUST NOT 占用会话列表布局空间、不得移动会话列表、不得显示搜索空态

#### Scenario: 两字符关键词自动搜索
- **WHEN** 用户在会话列表搜索框输入 trim 后长度为 2 的关键词（包括全 ASCII）
- **THEN** 前端 MUST 按合法关键词发起会话列表请求
- **AND** 前端 MUST NOT 显示警示/提示状态

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

Web API SHALL 校验 `q`、`createdFrom`、`createdTo`、`offset` 和 `limit`。非空 `q.trim()` 长度 MUST NOT 超过 50 个 Unicode code point；`q` 的 `%`、`_`、`\` MUST 按字面量转义后再参与 ASCII 大小写不敏感匹配；`createdFrom` 和 `createdTo` MUST 是整数且有限的 epoch millis，MUST 成对出现，MUST 满足 `createdFrom <= createdTo`，且二者 epoch millis 跨度 MUST NOT 超过 90 天减 1 毫秒；`offset` MUST 是非负整数；搜索查询的 `limit` MUST 是正整数且 MUST NOT 超过 50。校验失败时，系统 SHALL 返回请求校验错误，MUST NOT 执行降级的宽松查询。

后端服务时区 MUST NOT 参与搜索语义。前端传入的 `createdFrom` 和 `createdTo` 是绝对时间；后端 SHALL 只按数值比较持久化的 `updatedAt`。

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
- **THEN** 后端 MUST 只按整数 epoch millis 数值比较 `updatedAt`
- **AND** 后端 MUST NOT 按服务端本地时区重新解释用户选择的日期字符串

#### Scenario: 非法查询参数失败关闭
- **WHEN** 客户端提供超过 50 个 Unicode code point 的 `q`、非整数或非有限时间戳、超过 90 天减 1 毫秒的创建时间范围、负数 `offset` 或超过 50 的搜索 `limit`
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

### Requirement: 会话搜索结果复用删除动作并保持搜索窗口

会话搜索结果 SHALL 复用普通会话列表项的删除动作入口和确认交互。删除操作 MUST 通过 `session-delete` capability 定义的 `DELETE /api/v1/sessions/:sessionId` 完成；搜索 capability MUST NOT 定义第二套删除 API、前端本地隐藏语义或搜索专用删除 store。

搜索态删除成功后，前端 SHALL 保留当前 `q`、`createdFrom`、`createdTo`、offset/limit 窗口和 latest request guard，刷新当前搜索结果。删除失败时，前端 SHALL 保留原搜索结果项并展示 safe error。删除 MUST NOT 改变搜索的匹配范围、排序、分页、日期过滤、关键词校验或无匹配空态语义。

#### Scenario: 搜索结果删除后按同一条件刷新
- **GIVEN** search dialog 当前展示 `q=网络延迟`、`createdFrom=<from>`、`createdTo=<to>` 的结果
- **WHEN** 用户删除结果中的 session `S1` 且后端返回成功
- **THEN** 前端 MUST 使用同一 `q`、`createdFrom` 和 `createdTo` 刷新搜索结果
- **AND** 新结果 MUST 继续按搜索契约排序和分页

#### Scenario: 搜索结果删除失败不覆盖当前结果
- **GIVEN** 搜索结果中存在 session `S1`
- **WHEN** 用户删除 `S1` 但后端返回 safe conflict 或 safe error
- **THEN** 前端 MUST 保留 `S1` 搜索结果项
- **AND** MUST NOT 清空搜索条件或切回普通列表

#### Scenario: 删除不改变搜索匹配语义
- **WHEN** `session-delete` capability 被实现
- **THEN** `GET /api/v1/sessions` 的 `q`、`createdFrom`、`createdTo`、offset 和 limit 行为 MUST 保持既有搜索契约
- **AND** 系统 MUST NOT 为删除新增搜索专用 tombstone、deleted marker、命中片段或结果数量字段

### Requirement: 会话列表查询校验返回确定字段级结果

系统 MUST 对 `GET /api/v1/sessions` 的时间范围和分页查询参数执行字段级校验。校验失败 MUST 返回 HTTP `400` 与 `REQUEST_VALIDATION_FAILED`，并 MUST 使用本 Requirement 规定的确定消息；可表示为有限安全整数的前导零或较长整数串 MUST 按其整数值处理。

**需求类别**：功能性需求

#### Scenario: 时间范围参数返回确定消息

- **WHEN** `createdFrom` 与 `createdTo` 仅提供一个
- **THEN** 错误消息 MUST 为 `createdFrom and createdTo must be provided together.`
- **WHEN** 任一时间参数不是整数串或超出有限安全整数范围
- **THEN** 错误消息 MUST 分别为 `{field} must be an integer.` 或 `{field} must be a finite safe integer.`
- **WHEN** `createdFrom` 大于 `createdTo`
- **THEN** 错误消息 MUST 为 `createdFrom must be less than or equal to createdTo.`
- **WHEN** 时间范围超过允许的 90 天边界
- **THEN** 错误消息 MUST 为 `created time range must not exceed 90 days.`

#### Scenario: 分页参数返回确定消息

- **WHEN** `offset` 或 `limit` 不是整数串或超出有限安全整数范围
- **THEN** 错误消息 MUST 分别为 `{field} must be an integer.` 或 `{field} must be a finite safe integer.`
- **WHEN** `offset` 为负数
- **THEN** 错误消息 MUST 为 `offset must be a non-negative integer.`
- **WHEN** `limit` 不是正整数
- **THEN** 错误消息 MUST 为 `limit must be a positive integer.`
- **WHEN** 搜索查询的 `limit` 大于 `50`
- **THEN** 错误消息 MUST 为 `search limit must not exceed 50.`
- **WHEN** 普通列表查询的 `limit` 大于 `200`
- **THEN** 错误消息 MUST 为 `limit must not exceed 200.`

#### Scenario: 可安全表示的整数串被接受

- **WHEN** 请求使用 `limit=01`
- **THEN** 系统 MUST 按整数 `1` 处理该参数并返回成功响应
- **WHEN** `createdFrom` 与 `createdTo` 是超过 13 位但仍可安全表示且范围合法的整数串
- **THEN** 系统 MUST 接受该时间范围
