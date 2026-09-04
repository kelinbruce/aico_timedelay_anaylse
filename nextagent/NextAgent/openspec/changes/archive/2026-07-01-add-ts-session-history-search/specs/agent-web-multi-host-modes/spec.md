## MODIFIED Requirements

### Requirement: PIU chrome 暴露轻量操作

Collaborative 面板 SHALL 在面板 chrome 中使用轻量图标操作。该 chrome MUST 包含新建会话、最近历史、浮动/停靠、最大化/恢复和关闭操作。最近历史 MUST 通过既有 History Popover 展示。在无历史搜索条件时，History Popover MUST 默认展示最近 10 个会话，并支持滚动加载更多会话。

既有 History Popover SHALL 支持 `session-history-search` 定义的相同会话历史搜索能力：关键词搜索、创建时间范围过滤、过期响应保护、搜索空状态和按当前条件加载更多。History Popover MUST 暴露与 local/immersive 搜索对话框相同的关键词输入、创建时间图标入口、本地化紧凑已选范围摘要、清除行为、debounce 行为、IME 保护、可访问名称以及 Tooltip 或等价 hover 帮助规则。搜索模式 MUST 默认展示 20 条的搜索窗口。

Local、Immersive 和 Collaborative 宿主运行时在产品运行期互斥。Collaborative 历史搜索 MUST 复用 PIU 历史使用的既有 session-history store/action 路径，而 local/immersive 搜索使用对话框本地结果状态。本增强 MUST NOT 为 collaborative 模式新增 Sidebar，MUST NOT 新增第二个历史/搜索入口，MUST NOT 新增独立搜索路由或结果页，也 MUST NOT 在共享会话历史查询能力之外新增 PIU 专属搜索 store、查询命名空间或平行的搜索业务状态。

搜索与 History Popover 的打开/关闭状态 MUST 保持为 popover 的 UI 本地状态。关闭 History Popover MUST NOT 在当前宿主运行时生命周期内清除已提交的搜索查询。搜索条件 MUST NOT 写入宿主 URL、localStorage 或 sessionStorage，MUST 在宿主运行时 remount 后清除。搜索 MUST NOT 改变 `loadAIAgent` 或 `displayAIAgent` payload 语义，MUST NOT 改变 collaborative 面板的停靠、浮动或最大化布局状态。

#### Scenario: 用户在 PIU 模式打开最近历史
- **WHEN** 用户在 collaborative 模式点击历史图标
- **THEN** 面板 MUST 打开既有 History Popover
- **AND** 无搜索条件生效时，popover MUST 初始最多展示最近 10 个会话
- **AND** popover MUST 支持滚动时加载更多会话

#### Scenario: 用户在 PIU 模式搜索历史
- **WHEN** 用户在 History Popover 中输入历史关键词或选择完整的创建时间范围
- **THEN** popover MUST 以当前搜索条件请求会话历史
- **AND** popover MUST 提供与 local/immersive 搜索对话框相同的关键词输入、创建时间图标入口、本地化紧凑已选范围摘要、清除行为、debounce 行为、IME 保护、可访问名称以及 Tooltip 或等价 hover 帮助规则
- **AND** popover MUST 展示 20 条的搜索窗口
- **AND** 加载更多 MUST 携带相同搜索条件
- **AND** popover MUST NOT 展示摘要、高亮或结果计数

#### Scenario: PIU 历史搜索条件保持运行期本地
- **WHEN** 用户应用历史搜索条件并关闭或重新打开 History Popover
- **THEN** 已提交的搜索查询 MUST 在当前宿主运行时生命周期内保持生效
- **AND** 搜索查询 MUST NOT 写入浏览器 URL
- **AND** 搜索查询 MUST NOT 写入 localStorage 或 sessionStorage
- **AND** 搜索查询 MUST 在宿主运行时 remount 后清除

#### Scenario: PIU 历史搜索保持宿主模式权限
- **WHEN** 用户从 PIU 历史搜索结果中选择一个会话
- **THEN** `AIAgentPIU` MUST 通过普通 PIU 历史选择使用的同一运行时状态路径更新内部活跃会话 id
- **AND** 它 MUST 把所选会话 id 写入 `sessionStorage["nextagent:AIAgentPIU:activeSessionId"]`
- **AND** 浏览器 URL MUST NOT 改变
- **AND** 面板布局 MUST 保持当前停靠、浮动或最大化状态

## ADDED Requirements

### Requirement: Local 和 Immersive Sidebar 搜索使用对话框而 PIU 保留 History Popover

Local 和 Immersive 的 Sidebar 搜索 MUST 从 Sidebar 搜索操作打开一个对话框，而不是导航到某个路由或改变当前 Sidebar 视图。该 local/immersive 对话框行为与 collaborative PIU 相互独立。

Collaborative 模式 MUST 继续使用既有 History Popover，MUST NOT 获得 Sidebar、第二个历史入口、基于路由的搜索页或 PIU 专属搜索状态。

#### Scenario: 各宿主模式保持独立的搜索面
- **WHEN** local 或 immersive 模式正在运行
- **THEN** Sidebar 搜索 MUST 打开一个对话框且不改变浏览器路由
- **AND** Sidebar 搜索 MUST 在对话框背后保留当前 Sidebar 收藏/最近视图
- **WHEN** collaborative PIU 模式正在运行
- **THEN** 历史搜索 MUST 保留在既有 PIU History Popover 内
- **AND** collaborative PIU MUST NOT 渲染 Sidebar 搜索对话框
