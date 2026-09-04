## MODIFIED Requirements

### Requirement: 前端会话列表复用原展示并提供搜索和日期交互

前端 SHALL 在现有会话历史入口提供关键词输入框和创建时间范围选择入口。搜索结果 SHALL 复用原会话列表的列表项样式、点击、重命名和加载更多交互。搜索态无匹配结果时，前端 SHALL 复用原空态布局但使用 locale-backed 文案展示“未找到匹配会话”语义，MUST NOT 使用普通“没有历史会话”语义的文案。前端 MUST NOT 为搜索态新增独立页面、独立结果列表、命中片段、高亮、结果数量或不同的列表项布局。

新增或本 change 触达的前端可见文案、placeholder、Tooltip 或等价悬浮提示、aria-label、搜索空态和创建时间摘要标签 MUST 使用现有 i18n 资源。系统 MUST 在共享 `sessionHistory` 资源分组下提供 `searchPlaceholder`、`searchHistory`、`openDateRange`、`clearKeyword`、`clearCreatedTimeRange`、`createdFrom`、`createdTo` 和 `noMatchesTitle`，并 MAY 复用既有普通历史加载/空态资源。本文档中的中文和英文文案仅为 locale 示例，MUST NOT 被组件硬编码。

搜索输入框为空时 SHALL 在输入框内部右侧显示搜索图标；输入框有内容且 `q.trim()` 非空且不超过 50 个 Unicode code point 时 SHALL 显示可点击清除图标。`q.trim()` 超过 50 个 Unicode code point 时，前端 MUST NOT 发起关键词搜索请求，MUST 在输入框内部右侧用 icon-only 警示/提示状态替代搜索图标，并通过 Tooltip 或等价悬浮提示和 accessible label 以非技术用户可理解的通俗文案提示关键词超出长度限制，MUST NOT 使用 ASCII 等技术术语；该提示 MUST NOT 占用会话列表布局空间、不得把下方会话列表向下推，也不得触发搜索空态。清除图标和日期图标作为 icon-only 控件时 MUST 可通过键盘触发，并提供可访问名称和悬浮说明。用户修改输入内容后，前端 SHALL 在最后一次非 IME 组合输入变更后经过组件级短 debounce 间隔再发起合法关键词搜索请求；具体 debounce 数值属于前端实现常量，不进入 Web/API、runtime、session 或 gateway contract。IME 组合输入期间前端 MUST NOT 发起搜索请求；组合结束后 SHALL 按同一 debounce 规则发起查询。点击清除图标 SHALL 清空 `q` 并立即按当前日期条件重新查询。

创建时间范围入口 SHALL 位于搜索框外部右侧，以日期图标表示。点击或键盘触发日期图标后，前端 SHALL 打开承载 AntD `DatePicker.RangePicker` 的选择浮层；侧栏常驻区域 MUST NOT 直接内联显示完整 RangePicker 输入框。RangePicker SHALL 支持精确到秒的日期时间选择。系统 SHALL NOT 预设隐藏的默认日期范围；日期过滤只在用户选择完整开始和结束时间后生效。用户选择完整创建时间范围后，前端 SHALL 按浏览器本地时区解释用户选择的年月日时分秒，转换为整数 epoch millis 传给后端。用户选择的开始和结束范围最大为固定 90 天；前端 SHOULD 在 RangePicker 中禁用超过该跨度的日期，且 MUST 在提交前阻止超过该跨度的范围。选择后前端 SHALL 在搜索行下方、会话列表上方显示当前创建时间范围；清除日期条件后，该显示 SHALL 消失，并按当前关键词重新查询。

已选创建时间范围 SHALL 以紧凑筛选摘要呈现，而不是以内联 RangePicker 输入框、长文本按钮或搜索框占位文本呈现。该摘要 MUST 使用比搜索输入和会话标题更低强调级别的字体和次级文字颜色；具体字号属于前端组件常量，不进入 Web/API、runtime、session 或 gateway contract。摘要标签 MUST 使用 i18n 的 `createdFrom` 和 `createdTo` 资源；zh-CN 示例为 `起: YYYY/MM/DD HH:mm:ss` 和 `止: YYYY/MM/DD HH:mm:ss`，en-US 示例为 `From: MM/DD/YYYY HH:mm:ss` 和 `To: MM/DD/YYYY HH:mm:ss`。摘要 MUST 提供独立的 icon-only 清除按钮，清除按钮 MUST 有可访问名称和悬浮说明，zh-CN 语义为“清除搜索时间”。摘要在 local/immersive search dialog 和 collaborative PIU History Popover 中 MUST 保持紧凑，超出时使用省略并通过 Tooltip 或 accessible label 提供完整范围；摘要 MUST 占据正常布局空间，不得覆盖搜索框、会话列表、加载更多或 PIU/Prel 顶部菜单。

当 `q.trim()` 为空且没有完整创建时间范围时，260px Sidebar 普通未展开列表 SHALL 显示最近 10 条；普通展开态 SHALL 使用 20 条历史窗口并继续支持加载更多；local/immersive search dialog 和 collaborative PIU History Popover SHALL 显示最近 10 条。当 `q.trim()` 非空或完整创建时间范围存在时，前端 SHALL 进入搜索态并请求搜索列表；搜索态首屏 SHALL 请求并展示 20 条搜索窗口，MUST NOT 被普通会话列表未展开时最近 10 条的偏好截断；加载更多 SHALL 继续请求 20 条结果。非法短查询且没有完整创建时间范围时，前端 SHALL 保持当前普通列表或上一合法搜索结果不被短关键词请求覆盖。搜索态 MUST NOT 覆盖普通会话列表展开偏好；清空全部搜索条件后，前端 SHALL 恢复普通会话列表及其既有展开偏好。

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
