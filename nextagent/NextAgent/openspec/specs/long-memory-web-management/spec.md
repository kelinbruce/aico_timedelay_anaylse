# long-memory-web-management Specification

## Purpose
定义 NextAgent 长期记忆管理 Web 能力的黑盒契约：immersive/PIU Shell 内 `#/memory` 主内容视图、三 Tab 列表/搜索/分页/详情、记忆新增/编辑/状态变更/发布/撤销发布/复制/导入/导出的 HTTP 路由与 management port 装配、SafeError 到 LtmError 的确定映射、共享知识发布者用户名展示，以及 local/immersive/collaborative 三宿主与 Shell 布局、主题和语言的复用边界。

## Function

- **所属 Function**：`FN-8.15 管理长期记忆`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: 长期记忆管理必须复用 immersive NextAgent Shell

系统 SHALL 在 immersive/PIU 模式中把长期记忆管理呈现为 NextAgent Shell 拥有的内容视图，并 SHALL 使用 HashRouter pathname `/memory` 表达该主内容选择，使浏览器可见 URL 以 `#/memory` 结尾。`/memory` SHALL 继续由既有 Shell 承载，SHALL NOT 成为绕过 Shell 的独立全屏页面。默认 LEFT 布局 SHALL 保持既有 Sidebar 挂载，并保留折叠状态和列表展开状态；RIGHT 布局 SHALL 保持既有顶部工具栏挂载。记忆内容视图激活时，记忆入口 SHALL 显示选中状态。

记忆内容选择 SHALL 从当前 hash pathname 派生，SHALL NOT 写入 `sessionStorage`、`localStorage` 或后端 API。直接打开、重新挂载或刷新 `#/memory` 时，Shell SHALL 恢复记忆内容视图和对应激活反馈；浏览器前进或后退进入 `/memory` 时 SHALL 得到相同结果。点击收藏入口时，Shell SHALL 导航到收藏 Function 拥有的 `/favorites` 主内容路径；选择新会话、会话条目、收藏 turn 或会话搜索结果时，Shell SHALL 执行既有 `/` 或 `/session/:sessionId` 会话导航并恢复会话内容。重复选择已激活的记忆入口 SHALL 保持记忆视图。local 模式（`App.tsx`）SHALL NOT 暴露记忆管理入口或内容视图。

#### Scenario: LEFT 布局打开记忆管理后保留 Sidebar
- **WHEN** 应用以 immersive/PIU 的 LEFT 布局运行
- **AND** 用户点击 Sidebar 中的“记忆管理”按钮
- **THEN** 既有 Sidebar 保持挂载
- **AND** Sidebar 折叠状态和会话列表展开状态保持不变
- **AND** 主内容区使用 `MemoryManagePage` 替换 `ChatWorkspace`
- **AND** 当前 URL 以 `#/memory` 结尾
- **AND** 记忆入口显示选中状态

#### Scenario: RIGHT 布局打开记忆管理后保留顶部工具栏
- **WHEN** 应用以 immersive/PIU 的 RIGHT 布局运行
- **AND** 用户点击顶部工具栏中的“记忆管理”按钮
- **THEN** 既有顶部工具栏保持挂载
- **AND** 主内容区使用 `MemoryManagePage` 替换会话内容
- **AND** 当前 URL 以 `#/memory` 结尾

#### Scenario: 会话导航恢复会话内容
- **WHEN** 记忆管理内容视图处于激活状态
- **AND** 用户选择新会话、会话条目、收藏 turn 或会话搜索结果
- **THEN** Shell 选择会话内容视图
- **AND** 执行既有 `/` 或 `/session/:sessionId` 导航

#### Scenario: 收藏入口恢复会话内容
- **WHEN** 记忆管理内容视图处于激活状态
- **AND** 用户点击“收藏”入口
- **THEN** router 导航到 `/favorites`
- **AND** Shell 显示收藏主内容
- **AND** 收藏入口显示选中状态
- **AND** 记忆入口不再显示选中状态

#### Scenario: 记忆管理入口关闭收藏面板
- **GIVEN** 收藏主内容处于激活状态
- **WHEN** 用户点击“记忆管理”入口
- **THEN** router 导航到 `/memory`
- **AND** Shell 只显示记忆管理内容视图
- **AND** 记忆管理入口显示选中状态
- **AND** 收藏入口不再显示选中状态

#### Scenario: 浏览器导航恢复记忆内容
- **WHEN** 用户通过浏览器前进或后退进入 `#/memory`
- **THEN** Shell 恢复记忆管理内容视图
- **AND** 记忆入口显示选中状态
- **AND** 其它主内容入口不显示为当前主内容

#### Scenario: 直达或刷新恢复记忆内容视图
- **WHEN** 用户直接打开或刷新当前宿主的 `#/memory`
- **THEN** Shell 从 URL 恢复记忆管理内容视图
- **AND** 记忆入口显示选中状态
- **AND** 系统不从浏览器存储读取记忆视图状态

#### Scenario: 记忆路径不绕过 Shell
- **WHEN** 检查 immersive HashRouter 路由配置
- **THEN** `/memory` 通过既有 NextAgent Shell 渲染 `MemoryManagePage`
- **AND** `/shared/:shareId` 仍是唯一绕过 NextAgent Shell 的全屏路由

#### Scenario: local 模式不暴露记忆管理
- **WHEN** 应用以 local 模式运行
- **THEN** 不渲染记忆管理入口和内容视图

### Requirement: 记忆管理布局必须适配 Shell 内容区

`MemoryManagePage` SHALL 只拥有 Shell 主内容区，SHALL NOT 渲染第二套 Sidebar、产品顶栏或全视口页面外壳。根容器 SHALL 使用父级内容区提供的尺寸，使用 `min-width: 0` 和 `min-height: 0` 允许 flex/grid 子项收缩，建立名为 `ltm-app` 的 inline-size container，并把滚动限制在记忆内容区内，使常驻 Sidebar 或 RIGHT 顶栏不会随内容滚动离开。页面级 `1160px` 和 `720px` 断点 SHALL 显式查询 `ltm-app`，不得被列表面板的嵌套 container 宽度误触发。

内容区标题 SHALL 与 Chat 首页标题结构同形：使用 `54px` 高度、`16px` 水平内边距、`18px` 字号、`600` 字重，并在底部展示左右各内缩 `16px` 的主题分隔线。标题区 SHALL 只展示“记忆管理”和右侧主要操作，SHALL NOT 展示独立记忆图标或副标题。页面字体、字号、文字颜色、背景、边框、hover/active 和主色 SHALL 复用 NextAgent 的 `--font-family-app` 与 `--color-*` 主题变量，SHALL NOT 建立与 Chat 平行的固定视觉主题。除标题既有的 `18px` 外，记忆管理内容区的正文和控件字号 MUST 只使用 `12px`、`14px` 或 `16px`，MUST NOT 定义或使用 `13px` 字号变量。

页面 SHALL NOT 渲染指标卡。“我的记忆”“共享记忆库”和“已归档”三个 Tab SHALL 分别以轻量计数呈现各自未应用搜索与筛选条件时的服务端 `total`；页面首次打开以及新增、批量导入、删除、归档、撤销归档、发布、取消发布或复制成功后 SHALL 刷新三个计数。批量导入响应仅当 `successCount > 0` 时视为成功写入并触发刷新；完全失败或结果未知时 SHALL NOT 推测数量变化。单个计数请求失败时 SHALL 保留该 Tab 最近一次成功值，且不得阻断当前 Tab 列表。记忆内容区宽度大于 `1160px` 时，列表区与详情区 SHALL 并排，详情区 SHALL 获得足以让英文类型/状态标签组和置信度保持同一行的稳定宽度，并限制在主内容区可用高度内；宽度不大于 `1160px` 时，container query SHALL 把详情区排列到列表区下方，并由记忆主内容区提供纵向滚动。三个 Tab 的表格 SHALL 限制摘要列占比并为类型、来源、状态/发布者、置信度和更新时间保留可辨识宽度；置信度列 SHALL 同时完整显示百分比和清晰可辨的进度条，不得把进度条压缩为装饰性短线。

**需求类别：功能性需求**

#### Scenario: 三个 Tab 显示未过滤总数
- **WHEN** 页面首次打开且服务端分别返回活动记忆 `12` 条、共享记忆 `7` 条和已归档记忆 `3` 条
- **THEN** “我的记忆”“共享记忆库”和“已归档”Tab 分别显示 `12`、`7` 和 `3`
- **AND** 用户在当前 Tab 输入搜索或修改筛选时，三个计数不使用过滤结果覆盖
- **AND** 任一计数刷新失败不清空其他已成功计数，也不阻断当前列表

#### Scenario: 导入成功后刷新我的记忆数量
- **WHEN** 用户确认批量导入且接口响应 `successCount > 0`
- **THEN** 页面重新请求三个 Tab 的未过滤总数
- **AND** “我的记忆”显示导入后的服务端总数

#### Scenario: 标题与 Chat 首页视觉一致
- **WHEN** 用户打开记忆管理内容视图
- **THEN** 顶部只显示“记忆管理”标题和右侧主要操作
- **AND** 标题下方显示主题分隔线
- **AND** 不显示独立记忆图标和副标题
- **AND** 页面使用 NextAgent 主题字体与颜色变量
- **AND** 正文和控件不使用 `13px` 字号

#### Scenario: 宽内容区并排显示列表和详情
- **WHEN** 记忆内容区宽度大于 `1160px`
- **THEN** 列表区和详情区并排可见
- **AND** 两个区域均不溢出到常驻导航区域下方
- **AND** 列表数据行超过卡片可用高度时，只在数据行区域产生纵向滚动
- **AND** 详情内容超过卡片可用高度时，只在详情卡片内部产生纵向滚动
- **AND** 详情内容不得撑高记忆主内容区或产生页面外层滚动
- **AND** 英文详情顶部的类型、状态、可见性标签和置信度保持在同一行

#### Scenario: 表格列宽平衡且置信度可辨识
- **WHEN** 任一 Tab 在桌面并排布局中显示记忆列表
- **THEN** 摘要列不挤占其它信息列的可用宽度
- **AND** 类型、来源、状态或发布者、置信度和更新时间保持可辨识
- **AND** 置信度进度条的可见宽度不小于 `72px`，百分比完整显示

#### Scenario: 窄内容区保持可用
- **WHEN** 记忆内容区宽度不大于 `1160px`
- **THEN** 详情区排列在列表区下方
- **AND** 列表和详情使用按内容计算的独立 Grid 行，两张卡片不重叠
- **AND** 所有控件无需页面级横向滚动即可访问
- **AND** 常驻 Shell 导航保持可见

#### Scenario: 记忆内容滚动不移动 Shell 导航
- **WHEN** 记忆列表或详情超过内容区可用高度
- **THEN** 桌面并排布局中的列表数据行溢出由数据行区域内部承担
- **AND** 详情溢出由详情卡片内部承担
- **AND** 窄布局中的整体溢出由记忆主内容区承担
- **AND** LEFT 布局的 Sidebar 或 RIGHT 布局的顶栏保持原位

#### Scenario: 并排布局高度不足时仅滚动列表数据行
- **WHEN** 记忆内容区宽度大于 `1160px`
- **AND** 当前页记忆数据行总高度超过列表卡片可用高度
- **THEN** 列表卡片保持在主内容区可用高度内
- **AND** 只有数据行区域显示内部纵向滚动，且不产生横向滚动
- **AND** Tab、筛选区、表头和分页器保持可见且不随数据行滚动
- **AND** 列表剩余高度不得分配给 Tab、筛选区或筛选控件
- **AND** Tab 按钮保持 `34px` 高度，搜索与筛选控件保持 `32px` 高度
- **AND** 存在分页器时，分页器位于列表卡片最底部
- **AND** 列表卡片的剩余高度只分配给列表内容区，不拉伸 Tab、筛选区、表头或分页器
- **AND** 摘要列中的正文预览只显示一行，超过一行时在末尾显示省略号
- **AND** 摘要单元格不因长连续文本改变当前数据行的列宽
- **AND** 列表所有表头列（含摘要列）水平居中对齐

#### Scenario: 平台顶部菜单占用高度后默认页仍保持紧凑
- **GIVEN** 平台 Shell 在主内容区上方保留 `64px` 菜单
- **AND** 当前列表使用默认每页 10 条
- **WHEN** 记忆管理内容区以桌面并排布局渲染
- **THEN** 页面使用 Shell 分配的剩余高度，不得基于 `100vh` 再次扣减平台菜单高度
- **AND** 每条数据行最小高度为 `52px`、垂直内边距为 `4px`
- **AND** 摘要正文预览只显示一行并在超出时省略
- **AND** Tab、搜索、筛选、表头和分页器的既有固定高度保持不变
- **AND** 支持的基准桌面视口不得仅因数据行高度使 10 条数据产生列表内部滚动

#### Scenario: 窄布局不建立嵌套列表滚动
- **WHEN** 记忆内容区宽度不大于 `1160px`
- **THEN** 列表数据行恢复自然高度和可见 overflow
- **AND** 列表与详情的整体纵向溢出由记忆主内容区承担
- **AND** 页面级断点以 `ltm-app` 根容器宽度为准，不以 `ltm-list` 列表容器宽度为准

### Requirement: 记忆管理必须跟随 immersive 宿主主题和语言

系统 SHALL 复用 Chat 在 immersive 模式中的 `HostSiteContext` 和 `AppProviders` 传播链路。`MemoryManagePage` SHALL 跟随宿主 `site.theme` 使用浅色或深色主题，并跟随宿主 `site.locale` 使用简体中文或英文。记忆管理页 SHALL NOT 保存独立主题或语言偏好，也 SHALL NOT 增加独立切换控件。

页面自有的标题、Tab、筛选项、列表表头、分页、空状态、详情、表单、确认框和反馈消息 SHALL 使用现有 i18n 实例中的 `memoryManagement.*` 资源；枚举展示值和日期格式也 SHALL 跟随当前 locale。主题样式 SHALL 使用 NextAgent 的语义主题变量，SHALL NOT 为状态标签、提示、进度条或按钮保留仅适用于浅色背景的固定色值。宿主运行时更新主题或语言时，已打开的记忆视图 SHALL 原地更新，无需刷新或重新进入。

#### Scenario: immersive 宿主切换为英文
- **WHEN** 记忆管理内容视图已打开
- **AND** 宿主把 `site.locale` 从 `zh-cn` 切换为 `en-us`
- **THEN** 标题、Tab、筛选项、详情和操作文案切换为英文
- **AND** 日期使用英文 locale 格式
- **AND** 当前 Tab、筛选、列表选择和详情状态保持不变

#### Scenario: immersive 宿主切换为深色主题
- **WHEN** 记忆管理内容视图已打开
- **AND** 宿主把 `site.theme` 从 `lightday` 切换为 `evening`
- **THEN** 记忆页背景、文字、边框、状态标签、提示和操作控件使用深色主题语义变量
- **AND** 页面不出现仅适用于浅色背景的固定边框或文字颜色
- **AND** 当前记忆内容状态保持不变

#### Scenario: 记忆管理不创建独立切换状态
- **WHEN** 检查记忆管理实现
- **THEN** 页面通过既有 i18n hook 获取语言
- **AND** 页面通过既有全局主题变量获取主题
- **AND** 页面不读写独立的主题或语言存储
- **AND** 页面不渲染独立主题或语言切换控件

### Requirement: 记忆操作反馈必须避开常驻 Shell 顶部区域

Shell SHALL 为其内容视图提供基于 Ant Design `App` context 的反馈消息实例；`MemoryManagePage` SHALL 通过 `App.useApp().message` 使用该实例，SHALL NOT 使用静态全局 `message` API。反馈消息的 viewport 顶部偏移 SHALL 等于当前主内容区 `getBoundingClientRect().top + 12px`；主内容区尚不可测量时 SHALL 暂用 `12px`，并在内容区可测量后、窗口尺寸变化或 Shell 布局尺寸变化时重新计算。

反馈消息 portal SHALL 保持在记忆内容滚动容器之外，SHALL NOT 挂载到 `.ltm-main` 或其它带 `overflow` 的内容节点。实现 SHALL NOT 通过只提高 `z-index`、给 `MemoryManagePage` 增加固定顶部留白，或复用/硬编码宿主菜单高度来规避遮挡。记忆管理 SHALL 只调整自身使用的 message 反馈，SHALL NOT 扩展为全站 modal、notification 或 message API 重构。

#### Scenario: RIGHT 顶栏不会遮挡反馈消息
- **WHEN** RIGHT 布局保持顶部工具栏挂载
- **AND** 记忆操作触发成功、警告或错误消息
- **THEN** 消息顶部位于主内容区 viewport 顶部下方 `12px`
- **AND** 消息不与顶部工具栏重叠

#### Scenario: LEFT 布局使用内容区实际顶部定位
- **WHEN** LEFT 布局中的主内容区顶部为 viewport 顶部
- **AND** 记忆操作触发反馈消息
- **THEN** 消息顶部偏移为 `12px`
- **AND** 实现不引入 RIGHT 顶栏高度对应的固定空白

#### Scenario: Shell 尺寸变化后重新定位反馈消息
- **WHEN** 窗口尺寸或 Shell 布局尺寸发生变化
- **THEN** 系统重新读取主内容区的 viewport 顶部
- **AND** 后续反馈消息使用新的顶部偏移

#### Scenario: 内容滚动不裁剪反馈消息
- **WHEN** 记忆内容区滚动且反馈消息处于显示状态
- **THEN** 反馈消息不随 `.ltm-main` 滚动
- **AND** 反馈消息不被记忆内容区的 `overflow` 裁剪

### Requirement: 后端 HTTP 路由必须委托给记忆管理端口

系统 SHALL 在 `agent-channel-web` 的 `/api/v1/memory/long-term-mem` 下注册 12 个 REST 端点，并把请求委托给 `agent-contracts/channel.LongTermMemoryManagementPort`。仅当 `registerWebChannel` 收到 `longTermMemoryManagement` 依赖时 SHALL 注册这些路由；依赖缺失时 SHALL NOT 注册。`agent-channel-web` MUST NOT 直接调用长期记忆 Gateway port。

#### Scenario: 提供管理依赖时注册全部端点
- **WHEN** 调用 `registerWebChannel` 时提供 `longTermMemoryManagement`
- **THEN** 在 `/api/v1/memory/long-term-mem` 下注册 12 个 REST 端点
- **AND** 每个端点委托给对应的管理端口方法

#### Scenario: 未提供管理依赖时不注册记忆路由
- **WHEN** 调用 `registerWebChannel` 时未提供 `longTermMemoryManagement`
- **THEN** 不注册记忆 REST 端点

### Requirement: 路由边界必须从可信身份解析器获得身份字段

后端路由层 MUST 为全部 13 条 Web 路由（对应 12 个 Gateway 操作）从 Web Channel composition 提供的 identity resolver 获得完整 `IdentityContext`，并与独立可信的 `agentId` 一起传给管理端口。记忆端点 SHALL NOT 建立记忆专用身份链路。路由层 SHALL NOT 从 query 或 request body 读取身份字段；客户端输入不得覆盖 resolver 输出。路由层 SHALL 把 `identityContext.subjectId` 投影为 REST alias `userId`，并从 application scope 投影 REST `tenantId` 和 `agentId`，不得从 Gateway Record 获取这些值。`displayName` SHALL NOT 进入 Gateway 请求或记忆 REST DTO。`agentId` SHALL 来自 hosted-Agent selection 或 app composition，SHALL NOT 来自客户端参数。`memoryInstance` 不是身份字段，GET 端点 MAY 从 query 读取，POST/PATCH 端点 MAY 从 body 读取；缺失时 SHALL 使用 `"defaultInstance"`。产品 MAY 通过既有 `webIdentityResolver` 注入身份策略；REMOTE deployment 未注入时 MUST 沿用既有 composition identity。本 change SHALL NOT 规定产品必须获取真实宿主用户或采用特定的用户获取渠道。

**需求类别：系统质量属性**

**质量属性：安全**

**适用范围：`FN-8.15 管理长期记忆`**

#### Scenario: 路由从可信请求身份解析 subjectId
- **WHEN** 请求携带可被可信 identity resolver 解析为 `subjectId = brand("alice")` 的身份信息
- **THEN** 路由层把包含该 `subjectId` 的完整 `IdentityContext` 传给 `LongTermMemoryManagementPort`

#### Scenario: 响应把 subjectId 投影为 userId
- **WHEN** application operation 在可信 scope `subjectId = "alice"` 下成功
- **THEN** 响应体包含 `userId: "alice"`

#### Scenario: 客户端身份字段不能覆盖可信 scope
- **WHEN** query 或 request body 携带 `tenantId`、`userId` 或 `agentId`
- **THEN** 路由返回 4xx
- **AND** 不调用 `LongTermMemoryManagementPort`

#### Scenario: 发布使用 composition 提供的身份
- **GIVEN** Web Channel composition 提供的 identity resolver 返回 `tenantId = "configured-tenant"` 和 `subjectId = "configured-subject"`
- **WHEN** 用户发布一条私有记忆
- **THEN** `LongTermMemoryManagementPort` 收到包含该 `tenantId` 和 `subjectId` 的 `IdentityContext`
- **AND** 发布请求 body 不包含身份字段

#### Scenario: REMOTE 未注入 resolver 时使用 composition identity
- **GIVEN** REMOTE deployment 未显式提供 `webIdentityResolver`
- **AND** application composition identity 为 `tenantId = "configured-tenant"` 和 `subjectId = "configured-subject"`
- **WHEN** 用户调用任一记忆接口
- **THEN** `LongTermMemoryManagementPort` 收到 application composition identity

### Requirement: SafeError 必须映射为 LtmError 和确定的 HTTP 状态

后端路由层 SHALL 识别管理端口返回的 `SafeError`，并映射为符合 V2 API `LtmError` schema 的 `{ code, message, retryable }`。`LTM_MEMORY_NOT_FOUND` 或 `NOT_FOUND` category SHALL 映射为 HTTP 404，`LTM_STORAGE_UNAVAILABLE` SHALL 映射为 HTTP 500，`UNAVAILABLE` category SHALL 映射为 HTTP 503，其它错误 SHALL 映射为 HTTP 400。成功响应 SHALL 包装为 `{ errorCode: 0, errorMsg: "SUCCESS", data }`。

#### Scenario: 记忆不存在时返回 404
- **WHEN** 管理端口返回 `code: "LTM_MEMORY_NOT_FOUND"` 的 `SafeError`
- **THEN** 路由层返回 HTTP 404
- **AND** 响应体为 `{ code: "LTM_MEMORY_NOT_FOUND", message, retryable }`

#### Scenario: 成功响应使用统一信封
- **WHEN** 管理端口返回 `LongTermMemoryManagementView`
- **THEN** 路由层返回 `{ errorCode: 0, errorMsg: "SUCCESS", data: <record> }`

### Requirement: memoryService 必须统一封装并解包 V2 API

`memoryService` SHALL 封装全部 V2 API HTTP 端点并解包 `{ errorCode, errorMsg, data }` 响应信封。`errorCode !== 0` 时 SHALL 抛出包含 `errorMsg` 的 `Error`；`errorCode === 0` 时 SHALL 返回 `data`。Identity Scope 和 Agent Scope SHALL 由后端可信边界提供，SHALL NOT 通过 service query 或 request body 传入。`ManualSaveLongTermMemoryReq`、`PatchLongTermMemoryReq`、`SharingLongTermMemoryReq`、`CopyLongTermMemoryReq`、`ListSharedMemoryParams` SHALL NOT 包含 `tenantId`、`userId` 或 `agentId`。`scopeQuery` SHALL 只把 `memoryInstance` 写入 query string。

#### Scenario: 成功调用返回 data
- **WHEN** 调用 `memoryService.listLongTermMemory({ state: "ACTIVE" })`
- **AND** API 返回 `{ errorCode: 0, errorMsg: "SUCCESS", data: { items: [...], total: 5, offset: 0, limit: 10 } }`
- **THEN** service 返回 `{ items: [...], total: 5, offset: 0, limit: 10 }`

#### Scenario: 错误调用抛出 Error
- **WHEN** 调用 `memoryService.getLongTermMemory({ memoryId })`
- **AND** API 返回 `{ errorCode: 404, errorMsg: "memory not found" }`
- **THEN** service 抛出包含 `errorMsg` 的 `Error`

### Requirement: 记忆列表必须支持筛选、搜索和分页

“我的记忆”Tab SHALL 调用 `listLongTermMemory` 并使用 `state=ACTIVE` 显示活动记忆分页列表。列表 SHALL 支持 `memoryType`、`knowledgeSourceType`、`isPinned` 和文本搜索，SHALL NOT 展示或发送 `minConfidence` 筛选。“已归档”Tab SHALL 调用 `listLongTermMemory` 并使用 `state=ARCHIVED`。三个 Tab 共用的搜索文本与公开 Web API 的 `queryText` 均以 128 个 Unicode code point 作为可提交上限；超限时页面 SHALL 保留用户输入、显示校验错误并阻止 debounce 和请求，不得静默截断；绕过前端提交超限值时 Channel SHALL 返回 HTTP 400 且不得调用 management port。当搜索文本非空且合法时，两个 Tab SHALL 在 GET 列表请求中发送 `queryText`；Channel、management port 和 Store Gateway SHALL 使用同名字段，不得由前端过滤当前页。后端 SHALL 在分页前对摘要、正文和标签应用搜索条件，并返回搜索后的 `items` 与 `total`。每条私有或已归档列表摘要 SHALL 包含当前持久化的 `accessCount`，但页面 SHALL NOT 在“我的记忆”或“已归档”表格中展示或消费该字段；访问统计仅在详情中展示。列表查询本身 SHALL NOT 增加该计数。三个 Tab 的分页 MUST 使用 Ant Design 标准页码分页器，并使用服务端返回的 `total`、`limit` 和 `offset`；分页区 MUST 提供首页、尾页、上一页、下一页、标准页码、指定页跳转以及每页 `10 / 20 / 50` 条选择。用户选择目标页时 MUST 使用 `offset=(page-1)*limit` 重新请求当前 Tab；修改每页条数时 MUST 回到第一页并使用新 `limit`、`offset=0` 重新请求；筛选、搜索或切换 Tab MUST 回到第一页。首页或第一页时首页按钮 MUST 禁用，尾页或唯一页时尾页按钮 MUST 禁用。

**需求类别：功能性需求**

#### Scenario: 活动记忆列表应用筛选条件
- **WHEN** 用户位于“我的记忆”Tab
- **AND** 选择 `memoryType=FACTUAL` 和 `isPinned=true`
- **THEN** 页面使用 `state=ACTIVE, memoryType=FACTUAL, isPinned=true` 调用 `listLongTermMemory`
- **AND** 只显示匹配的记忆

#### Scenario: 来源筛选只提供当前可产生的来源
- **WHEN** 用户打开来源筛选菜单
- **THEN** 菜单提供 `CONFIGURED`（用户设定）和 `LEARNED`（智能沉淀）
- **AND** 菜单不提供当前没有生产写入入口的 `SYSTEM_DEFAULT`
- **AND** 前端仍能在接口返回 `SYSTEM_DEFAULT` 时显示对应来源名称

#### Scenario: 英文筛选菜单不超过控件宽度
- **WHEN** 宿主语言为英文
- **THEN** 类型、来源和更新方式下拉框使用适合紧凑筛选控件的英文文案
- **AND** 筛选区只为实际存在的三个下拉框定义三列
- **AND** 下拉框宽度不超过自身 grid cell
- **AND** 筛选区根据列表面板自身宽度从单行切换为三列或单列
- **AND** 任一选中值均不撑出下拉框边界
- **AND** 更新方式下拉框为最长的“全部更新方式”及原生下拉箭头预留不重叠的水平空间

#### Scenario: 置信度过滤不显示也不发送
- **WHEN** 用户查看任一记忆 Tab
- **THEN** 筛选区不显示置信度下拉框
- **AND** 列表请求不携带 `minConfidence`

#### Scenario: 三个 Tab 使用一致的置信度颜色
- **WHEN** “我的记忆”“共享记忆库”或“已归档”列表显示置信度
- **THEN** 三个 Tab 使用同一颜色判定规则
- **AND** 置信度小于 `60%` 时使用低置信度颜色
- **AND** 置信度大于或等于 `60%` 时使用正常主题色
- **AND** 共享或归档状态不得覆盖该置信度颜色规则

#### Scenario: 我的记忆搜索调用后台并刷新数量
- **WHEN** 用户在“我的记忆”搜索框输入 `BGP`
- **THEN** 页面调用 `GET /api/v1/memory/long-term-mem?state=ACTIVE&queryText=BGP`
- **AND** Channel 将 `queryText: "BGP"` 原样传给 `listLongTermMemory`
- **AND** 后端在分页前匹配摘要、正文或标签
- **AND** “我的记忆”数量与列表分页使用搜索响应的 `total`
- **AND** 页面不再对当前页执行二次文本过滤

#### Scenario: 快速清除搜索条件
- **WHEN** 任一 Tab 的搜索框包含文本
- **THEN** 搜索框显示具有中英文无障碍名称的清除按钮
- **AND** 搜索文本与清除按钮之间保留独立空间，不得相互重叠
- **AND** 搜索文本超过输入框可见宽度时以单行省略号表示隐藏内容，不得直接硬裁切
- **AND** 省略显示不得截断实际搜索值
- **WHEN** 用户点击清除按钮
- **THEN** 页面立即清空输入并回到第一页
- **AND** 页面重新请求当前 Tab 列表且不发送 `queryText`
- **AND** 搜索框为空时隐藏清除按钮

#### Scenario: 搜索提示只描述界面支持的字段
- **WHEN** 用户查看任一 Tab 的搜索框
- **THEN** 中文 placeholder 显示“搜索摘要或正文”
- **AND** 英文 placeholder 显示 “Search summaries or content”
- **AND** placeholder 不宣称支持标签搜索

#### Scenario: 搜索输入不得超过接口长度上限
- **WHEN** 用户在任一 Tab 的搜索框输入超过 128 个 Unicode code point
- **THEN** 页面保留用户输入并把搜索框标记为无效
- **AND** Emoji 等补充平面字符按一个 Unicode code point 计数
- **AND** 页面显示包含当前 Unicode code point 数量和 `128` 上限的中英文错误
- **AND** debounce 和列表请求不接收超限 `queryText`
- **AND** 用户删回合法长度后错误消失并恢复搜索
- **AND** 中文输入框 title 显示“最多输入 128 个字符”
- **AND** 英文输入框 title 显示 “Enter up to 128 characters”
- **AND** 长度提示不得增加搜索或筛选区高度

#### Scenario: 公开记忆搜索接口拒绝超长文本
- **WHEN** 客户端向 GET 列表、POST 搜索或 GET 共享列表提交超过 128 个 Unicode code point 的 `queryText`
- **THEN** Channel 返回 HTTP 400 `LTM_QUERY_INVALID`
- **AND** 不调用对应的 `LongTermMemoryManagementPort` 方法

#### Scenario: 已归档搜索保留状态和分页语义
- **WHEN** 用户在“已归档”Tab 输入搜索文本
- **THEN** 页面在同一次列表请求中发送 `state=ARCHIVED`、`queryText`、`limit` 和 `offset`
- **AND** 后端只返回匹配的已归档记忆及其搜索后总数

#### Scenario: 翻到下一页时请求新的服务端分页
- **WHEN** 当前列表 `total=25, limit=10, offset=0`
- **AND** 用户点击“下一页”
- **THEN** 页面使用 `limit=10, offset=10` 重新调用当前 Tab 对应列表接口
- **AND** 成功后默认选中新页第一条

#### Scenario: 共享记忆库和已归档使用相同页码分页
- **WHEN** 用户位于“共享记忆库”或“已归档”Tab 且列表跨页
- **THEN** 页面显示相同的标准页码分页器
- **AND** 用户选择目标页时调用当前 Tab 对应的列表接口，并使用目标页 offset

#### Scenario: 选择页码直接跳转
- **GIVEN** 当前列表 `total=95, limit=10, offset=0`
- **WHEN** 用户在分页器中选择页码 `6`
- **THEN** 页面使用 `limit=10, offset=50` 重新调用当前 Tab 对应列表接口
- **AND** 成功后页码显示为 `6`

#### Scenario: 分页器提供完整跳转和页面大小能力
- **GIVEN** 当前列表 `total=95, limit=10, offset=20`
- **WHEN** 页面显示分页区
- **THEN** 分页区显示首页、尾页、上一页、下一页、标准页码和指定页跳转控件
- **AND** 分页区提供每页 `10 / 20 / 50` 条选择
- **AND** 完整分页控件在列表底部整体居右显示
- **AND** 可用宽度不足时允许换行，但每行仍保持右对齐且不得产生横向滚动
- **WHEN** 用户通过指定页跳转输入 `6`
- **THEN** 页面使用 `limit=10, offset=50` 重新调用当前 Tab 对应列表接口
- **WHEN** 用户选择每页 `20` 条
- **THEN** 页面使用 `limit=20, offset=0` 重新调用当前 Tab 对应列表接口

#### Scenario: 首页和尾页直接跳转
- **GIVEN** 当前列表 `total=95, limit=10, offset=40`
- **WHEN** 用户点击“首页”
- **THEN** 页面使用 `limit=10, offset=0` 重新调用当前 Tab 对应列表接口
- **WHEN** 用户随后点击“尾页”
- **THEN** 页面使用 `limit=10, offset=90` 重新调用当前 Tab 对应列表接口
- **AND** 位于首页时首页按钮禁用，位于尾页时尾页按钮禁用

#### Scenario: 筛选后回到第一页
- **WHEN** 用户位于第二页或之后
- **AND** 修改类型、来源、更新方式或搜索文本
- **THEN** 页面把 offset 重置为 `0`
- **AND** 使用新筛选重新请求列表

#### Scenario: 加载已归档记忆列表
- **WHEN** 用户切换到“已归档”Tab
- **THEN** 页面使用 `state=ARCHIVED` 调用 `listLongTermMemory`
- **AND** 显示已归档记忆

#### Scenario: 列表忽略兼容返回的访问次数且不产生使用副作用
- **WHEN** 长期记忆当前持久化的 `accessCount` 为 `7`
- **AND** 用户加载“我的记忆”或“已归档”列表
- **THEN** 列表响应包含 `accessCount: 7`
- **AND** 表格不显示“使用次数”列或该值
- **AND** 列表查询不会递增 `accessCount`

### Requirement: 记忆详情必须展示智能体使用统计且不产生统计副作用

用户选择“我的记忆”或“已归档”列表中的记忆时，页面 SHALL 调用 GET `/{memoryId}/record` 并委托 `getLongTermMemory` 加载完整记录。管理界面查看详情 SHALL NOT 增加 `accessCount` 或改变 `lastAccessedAt`；这两个统计只由智能体实际使用记忆的链路维护。详情区 SHALL 显示摘要、内容、标签、置信度、类型、来源、状态、保持状态、使用次数、最近使用时间、时间戳和操作按钮。

私有记忆详情和共享记忆详情 SHALL 在正文标题旁提供“复制正文”操作。复制操作 MUST 将经过只读展示脱敏的 `content` 写入浏览器剪贴板；JSON 结构化展示 SHALL NOT 改变除脱敏以外的复制内容。复制成功或失败 SHALL 显示明确反馈；Clipboard API 不可用或写入失败时 SHALL NOT 修改记忆数据。

详情面板 SHALL 使用稳定的信息层级：顶部身份区展示记忆类型、有效状态、私有/共享属性、置信度和摘要；独立操作工具栏展示当前状态允许的操作；正文、标签和属性信息分别位于独立语义 section。编辑 SHALL 作为主操作；更新方式、共享和归档 SHALL 作为次操作；删除 SHALL 与非破坏性操作分组隔离。属性信息 SHALL 使用紧凑键值清单，SHALL NOT 为每个属性创建独立卡片。共享记忆详情 SHALL 复用相同层级并只显示适用操作和属性。

页面 SHALL 只展示公开管理接口实际提供且语义明确的属性。共享记忆列表和详情 SHALL 将 `ownerUserId` 显示为“发布者 / Publisher”，不得显示接口未提供的订阅数量或复制人数。私有和已归档详情顶部已展示共享状态时，属性清单 SHALL NOT 再以“属性 / Property”重复展示相同状态。归档确认提示 SHALL 使用系统配置的归档保留期限语义，不得把默认 `90` 天硬编码为不可变规则。

**需求类别：功能性需求**

#### Scenario: 选择记忆后加载详情但不累计访问
- **WHEN** 用户在“我的记忆”Tab 点击一条记忆
- **THEN** 页面调用 `GET /api/v1/memory/long-term-mem/{memoryId}/record`
- **AND** 详情区显示完整记录
- **AND** 详情区显示服务端已有的 `accessCount`
- **AND** 对应列表行不显示 `accessCount`
- **AND** 管理界面点击不会写入或递增 `accessCount`

#### Scenario: 使用统计采用简洁字段名称
- **WHEN** 页面展示 `accessCount` 和 `lastAccessedAt`
- **THEN** 中文分别显示“使用次数”和“最近使用时间”
- **AND** 英文分别显示 “Usage count” 和 “Last used”
- **AND** 管理界面不得把查看详情解释为一次访问或据此更新统计

#### Scenario: 不展示接口不存在或重复的属性
- **WHEN** 用户查看共享列表、共享详情或私有记忆详情
- **THEN** 共享列表不显示订阅数量列
- **AND** 共享详情不显示复制人数
- **AND** `ownerUserId` 显示为“发布者 / Publisher”
- **AND** 私有详情属性清单不显示含糊且重复的“属性 / Property”项

#### Scenario: 归档确认不硬编码保留天数
- **WHEN** 用户确认归档一条允许自动更新的记忆
- **THEN** 确认提示说明记忆将移入已归档
- **AND** 提示说明达到系统配置的归档保留期限后会自动删除
- **AND** 提示不固定承诺 `90` 天

#### Scenario: JSON 正文使用结构化格式展示
- **WHEN** 详情正文可以解析为 JSON object 或 array
- **THEN** 页面以两空格缩进显示完整 JSON 结构
- **AND** 保留换行和层级缩进
- **AND** 长键名或长字符串在详情卡片可用宽度内换行
- **AND** 正文容器不显示横向滚动条
- **AND** 不修改原始持久化内容

#### Scenario: 非 JSON 正文保持原文
- **WHEN** 详情正文不能解析为 JSON object/array
- **THEN** 页面按原始文本展示正文
- **AND** 超出详情卡片可用宽度的连续文本强制换行
- **AND** 不因解析失败显示错误或空白

#### Scenario: 复制 JSON 正文保留原始内容
- **WHEN** 用户在 JSON 正文旁点击“复制正文”
- **THEN** 页面把经过绝对路径脱敏、但未经过 JSON 格式化的 `content` 写入浏览器剪贴板
- **AND** 不使用缩进后的展示字符串替代原始内容
- **AND** 页面显示复制成功反馈

#### Scenario: 剪贴板写入失败
- **WHEN** Clipboard API 不可用或写入失败
- **THEN** 页面显示复制失败反馈
- **AND** 不修改当前记忆或共享记忆

#### Scenario: 私有记忆详情按任务层级展示
- **WHEN** 用户选择一条私有记忆
- **THEN** 顶部身份区集中展示类型、状态、可见性、置信度和摘要
- **AND** 操作工具栏把编辑、更新方式、共享、归档与删除按主次和破坏性分组
- **AND** 正文、标签和属性信息分别位于独立 section
- **AND** 属性信息以键值清单展示而不是零散卡片

#### Scenario: 详情不虚构失效时间
- **WHEN** 用户在“我的记忆”或“已归档”中查看记忆详情
- **THEN** 属性清单不显示“失效时间”或 “Expiry”
- **AND** 页面不得把 `archivedAt` 归档时间改名或解释为失效时间
- **AND** 页面不得从创建时间、更新时间、归档时间或本地配置推算失效时间
- **AND** 只有公开管理接口未来明确提供失效时间字段时，才可通过独立规格增加该展示

#### Scenario: 详情在窄内容区保持层级
- **WHEN** 详情面板可用宽度不足以单行展示身份或操作
- **THEN** 身份标签可以自然换行
- **AND** 操作工具栏通过紧凑间距保持全部按钮在同一行
- **AND** 删除操作仍与非破坏性操作保持视觉分组
- **AND** 操作工具栏、正文、标签和属性清单均不产生横向滚动

#### Scenario: 超长摘要不阻断详情内容
- **WHEN** 记忆摘要达到接口允许的最大长度
- **THEN** 右侧详情卡片保持在记忆主内容区可用高度内
- **AND** 内容超过卡片可用高度时，详情卡片显示内部纵向滚动条
- **AND** 用户可以继续访问工具栏、正文、标签和属性信息
- **AND** 摘要不会把正文区域压缩为不可访问区域
- **AND** 展开后的详情内容不得撑出页面外层

#### Scenario: 超过半数长度阈值的摘要和正文默认折叠
- **WHEN** 私有或共享记忆的摘要超过 1024 个 Unicode code point
- **THEN** 详情默认把摘要折叠为最多两行，并显示“展开摘要”
- **AND** 用户可以展开完整摘要或再次收起
- **WHEN** 正文超过 2000 个 Unicode code point
- **THEN** 详情默认把正文折叠为六个完整文本行，并显示“展开正文”
- **AND** 用户可以展开完整正文或再次收起
- **AND** 摘要和正文内容容器自身不产生横向或纵向滚动条；只有详情总高度超过卡片可用高度时，详情卡片提供纵向滚动
- **AND** 裁剪发生在正文内容卡片自身，正文卡片的下边框和圆角保持完整
- **AND** 正文折叠由内部文本元素的六行 line clamp 决定，不使用基于 `em` 与固定像素内边距的高度公式
- **AND** 折叠外层显式使用 `height: auto` 和 `max-height: none`，旧固定高度规则即使残留也不得生效
- **AND** 第六行文字完整显示，并与正文卡片下边缘之间保持正文容器的既有内边距
- **AND** 标签和属性信息保持在正文之后的正常文档流中，不得被折叠容器或详情卡片裁剪
- **AND** 切换到另一条记忆时摘要和正文恢复默认折叠状态
- **AND** 折叠不改变 JSON 格式化结果和“复制正文”的完整脱敏文本

#### Scenario: 英文类型标签和操作文案不撑宽卡片
- **WHEN** 宿主语言为英文
- **AND** 记忆类型为 `USER_CHARACTERISTICS`
- **AND** 记忆内容区处于桌面并排布局
- **THEN** Type 标签显示 “User preference”，并在列表列宽和详情身份区内完整单行显示
- **AND** 标签文本不得换行或溢出标签边界
- **AND** 类型、状态、可见性标签组与置信度在详情顶部保持同一行
- **AND** 详情操作使用简洁英文文案并保持单行
- **AND** 详情面板及其 header、工具栏不得被英文内容撑出卡片宽度

#### Scenario: 编辑表单与卡片边缘保持留白
- **WHEN** 用户进入新增或编辑记忆状态
- **THEN** 表单内容区四周保持与查看态 section 一致的 `16px` 内边距
- **AND** 第一个表单控件不贴住详情卡片边框
- **AND** 查看态 section 不因表单留白规则产生重复内边距

#### Scenario: 编辑态操作按钮与详情操作按钮尺寸一致
- **WHEN** 用户进入新增或编辑记忆状态
- **THEN** “保存”“保存修改”和“取消”按钮复用详情操作工具栏的紧凑按钮规格
- **AND** 按钮高度和最小高度均为 `30px`
- **AND** 按钮水平内边距为 `6px`
- **AND** 按钮字号为 `var(--ltm-font-xs)`

#### Scenario: 编辑标题和操作区使用紧凑布局
- **WHEN** 用户进入编辑记忆状态
- **THEN** 第一行显示“编辑记忆”标题，并在右侧保留紧凑状态标签
- **AND** 第二行单独显示“保存修改”和“取消”操作按钮
- **AND** 编辑表单 header 使用 `10px 16px 8px` 内边距和 `6px` 行间距
- **AND** 标题行高为 `1.2`，操作组不再额外提供底部留白
- **AND** 详情 Grid 和表单 header 按内容顶部对齐，不把卡片剩余高度分配到两行中
- **AND** 不改变按钮的 `30px` 高度和可点击范围

#### Scenario: 表单操作按钮不贴住卡片边缘
- **WHEN** 用户进入新增或编辑记忆状态
- **THEN** “保存”“保存修改”和“取消”所在操作区与详情 header 底部分隔线保持 `8px` 留白
- **AND** 按钮继续使用既有紧凑尺寸
- **AND** 查看态详情操作工具栏的间距不受影响

#### Scenario: 切换 Tab 后默认显示第一条详情
- **WHEN** 用户已在“我的记忆”Tab 选择一条记忆
- **AND** 切换到“共享记忆库”或“已归档”Tab
- **AND** 新 Tab 的当前页列表包含至少一条数据
- **THEN** 页面自动选中新 Tab 当前页的第一条记录
- **AND** 列表首行显示选中状态
- **AND** 详情区显示该记录的信息
- **AND** 不显示或加载先前 Tab 的旧详情

#### Scenario: 当前 Tab 列表为空时保持空详情
- **WHEN** 当前 Tab 的列表请求成功
- **AND** 当前页不包含任何记录
- **THEN** 页面清空当前选中 ID
- **AND** 详情区显示空状态

#### Scenario: 列表刷新时保留仍然有效的用户选择
- **WHEN** 用户已在当前 Tab 主动选择一条非首行记录
- **AND** 筛选、搜索、分页或操作刷新后的当前页结果仍包含该记录
- **THEN** 页面保持该记录的选中状态
- **AND** 不用首行覆盖用户选择

### Requirement: 记忆只读展示必须扩展 Chat 通用敏感内容保护并单独隐藏绝对路径

系统 MUST 在记忆管理的只读展示投影中复用 Chat 的通用敏感内容类别：有界的凭据赋值 MUST 替换为 `[REDACTED_SECRET]`，Bearer Token 的值 MUST 替换为 `[REDACTED_TOKEN]` 且保留 `Bearer` 类型提示，`sk-` Token MUST 整体替换为 `[REDACTED_TOKEN]`，中国大陆手机号 MUST 替换为 `[REDACTED_PHONE]`。记忆只读投影 MUST 在该通用规则之外，将 Unix 绝对文件路径及 Windows 盘符绝对文件路径替换为 `[REDACTED_PATH]`；Chat 回答和事件正文 MUST NOT 因记忆规则而替换绝对文件路径。Private Key 块 MUST NOT 在记忆界面或剪贴板中显示，记忆只读投影 MUST 将该块替换为 `[REDACTED_SECRET]`；该展示结果不改变 Chat 最终内容由 runtime 整体阻断 Private Key 的既有控制语义。IPv4 和 IPv6 地址 MUST 保持原文。

该规则 MUST 覆盖“我的记忆”“共享记忆库”“已归档”列表行、私有与共享详情的摘要和正文，以及“复制正文”写入剪贴板的内容。只读内容已包含 `[REDACTED\_PATH]`、`[REDACTED\_SECRET]`、`[REDACTED\_TOKEN]` 或 `[REDACTED\_PHONE]` 等 Markdown 转义占位符时，系统 MUST 将其显示和复制为对应 canonical 占位符，MUST NOT 显示转义反斜杠。URL、以 `./` 开头的相对路径和不以根目录或盘符开头的路径 MUST 保持原文。

脱敏 MUST 只作用于只读展示和复制投影，MUST NOT 改写 API 响应对象、编辑表单、导入导出内容、共享复制命令或持久化数据。用户进入编辑态时 MUST 看到并可保存 API 返回的原始摘要和正文。

**需求类别：系统质量属性**
**质量属性：安全**
**适用范围：`FN-8.15 管理长期记忆`**

#### Scenario: 私有记忆列表和详情脱敏绝对路径
- **GIVEN** 私有记忆摘要包含 `/opt/nextagent/config.json`
- **AND** 正文包含 `C:\\Users\\operator\\alarm.log`
- **WHEN** 页面显示该记忆的列表行和详情
- **THEN** 摘要和正文中的绝对路径均显示为 `[REDACTED_PATH]`
- **AND** 页面不显示两个原始绝对路径

#### Scenario: 共享与归档记忆使用相同脱敏规则
- **GIVEN** 共享或归档记忆的摘要或正文包含绝对文件路径
- **WHEN** 页面显示对应列表行或详情
- **THEN** 绝对路径显示为 `[REDACTED_PATH]`
- **AND** 与私有记忆使用相同替换结果

#### Scenario: Chat 正文保留绝对路径
- **GIVEN** Chat 回答或事件正文包含 `/opt/nextagent/config.json` 或 `C:\\Users\\operator\\alarm.log`
- **WHEN** Chat 页面显示该正文
- **THEN** 两个绝对路径保持原文
- **AND** 记忆专用绝对路径规则不得把该正文替换为 `[REDACTED_PATH]`

#### Scenario: 相对路径和 URL 保持不变
- **GIVEN** 摘要或正文包含 `./logs/alarm.log`、`docs/runbook.md` 和 `https://example.com/a/b`
- **WHEN** 页面显示该摘要或正文
- **THEN** 三个值均保持原文

#### Scenario: Markdown 转义占位符与 Chat 显示一致
- **GIVEN** 记忆摘要或正文已包含 `[REDACTED\_PATH]`
- **WHEN** 用户在记忆管理中查看或复制该内容
- **THEN** 界面和剪贴板均包含 `[REDACTED_PATH]`
- **AND** 界面和剪贴板均不包含 `[REDACTED\_PATH]`
- **AND** 编辑表单仍回显原始 `[REDACTED\_PATH]`

#### Scenario: 凭据、Token 和手机号使用 Chat 的替换类别
- **GIVEN** 记忆摘要或正文包含 `password=hunter2`、`Bearer abcdefghijk`、`sk-abcdefghijk` 和手机号 `13800138000`
- **WHEN** 用户在列表、详情中查看或复制该内容
- **THEN** 凭据赋值显示为 `[REDACTED_SECRET]`
- **AND** 两种 Token 显示为 `[REDACTED_TOKEN]`
- **AND** 手机号显示为 `[REDACTED_PHONE]`
- **AND** 页面和剪贴板均不包含四个原始敏感值

#### Scenario: Private Key 不进入记忆只读投影
- **GIVEN** 记忆正文包含 PEM Private Key 块
- **WHEN** 用户查看或复制该正文
- **THEN** 页面和剪贴板使用 `[REDACTED_SECRET]` 替换该块
- **AND** 页面和剪贴板不包含 Private Key header、footer 或 key material
- **AND** 编辑表单仍回显 API 返回的原始正文

#### Scenario: IP 地址作为电信业务事实保持原文
- **GIVEN** 记忆摘要或正文包含 IPv4 `10.0.0.1` 和 IPv6 `2001:db8::1`
- **WHEN** 页面显示或复制该内容
- **THEN** 两个 IP 地址均保持原文

#### Scenario: 复制使用脱敏内容而编辑保留原始内容
- **GIVEN** API 返回的正文包含 `/var/log/nextagent/runtime.log`
- **WHEN** 用户在详情点击“复制正文”
- **THEN** 剪贴板内容包含 `[REDACTED_PATH]`
- **AND** 剪贴板内容不包含原始绝对路径
- **WHEN** 用户随后进入编辑态
- **THEN** 正文输入框仍显示 API 返回的原始绝对路径

### Requirement: 用户创建和编辑必须使用手工保存端点

“新增记忆”和“编辑保存”操作 SHALL 调用 `manualSaveLongTermMemory`（POST `/manual`）。创建时 SHALL 省略 `memoryId` 并使用 `knowledgeSourceType=CONFIGURED`；编辑时 SHALL 包含既有 `memoryId` 并保留当前记录已有的 `knowledgeSourceType`。新增和编辑表单 SHALL 提供 `memoryType` 选择与 `confidence` 输入；新增表单 SHALL 默认选择 `USER_CHARACTERISTICS`（用户偏好）并使用 `confidence=1`，编辑表单 SHALL 回显既有类型和置信度。记忆类型下拉框 SHALL 完整显示当前选中文本，SHALL NOT 裁切文字下缘，并 SHALL 与置信度输入保持既有同高和顶部对齐。用户 SHALL 能在合法记忆类型和 `0..1` 置信度范围内修改这两个值。置信度文本 SHALL 只接受 `0`、`1`、`0.x`、`0.xx`、`1.0` 或 `1.00`，其中 `x` 是十进制数字；其它小数位数、指数记法、符号和非数字字符 SHALL 标记为非法并阻止保存。手工保存端点 SHALL 接受必填 `confidence`，并在同一次持久化写入中保存类型、置信度、摘要、正文和标签；表单 SHALL NOT 为类型或置信度补发 PATCH。手工保存端点仍 SHALL NOT 接受用户设置 `isPinned`。

摘要 SHALL 为 1..2048 个 Unicode code point，正文 SHALL 为 1..4000，标签 SHALL 允许省略或为空数组、最多 10 个且每个标签为 1..256。前端 SHALL 显示与这些约束一致的中英文提示、限制输入长度并在非法时禁用保存。Channel SHALL 在调用 management port 前执行同形校验，非法请求 SHALL 返回 HTTP 400 和 `LTM_QUERY_INVALID`，不得被转换为 500。接口未规定字符白名单时，合法 Unicode 字符 SHALL NOT 仅因字符类别被拒绝。

同一可信 `tenantId`、`subjectId`、`agentId` 和 `memoryInstance` 下，`knowledgeSourceType=CONFIGURED` 且未发布为共享记录的个人设定记忆 SHALL 最多为 50 条，不区分 `memoryType`。容量统计 SHALL 同时包含 `ACTIVE` 和 `ARCHIVED` 状态；归档、撤销归档和编辑已有记录 SHALL NOT 改变已占用额度，删除记录 SHALL 释放额度。`knowledgeSourceType=LEARNED` 的智能沉淀记录和 `sharingState=SHARED` 的发布记录 SHALL NOT 占用个人设定额度。

不含 `memoryId` 的 `CONFIGURED` 手工新增进入 management service 时，系统 SHALL 先使用同一可信 scope 和 `memoryInstance` 查询 ACTIVE 与 ARCHIVED 的个人设定记忆 `total`。计数查询 SHALL 显式使用 `minConfidence=0`，使所有合法置信度记录都计入额度。若 `activeTotal + archivedTotal + 1 > 50`，management service SHALL 返回 `LTM_WRITE_INVALID`、`VALIDATION` category，且 SHALL NOT 调用手工保存 Gateway。任一计数查询失败时 SHALL 返回该错误且 SHALL NOT 继续写入。持久化 Gateway SHALL 在同一写事务内按相同计数语义重复校验，以防并发创建绕过。Channel SHALL 将容量错误映射为 HTTP 400。

#### Scenario: 创建记忆
- **WHEN** 用户填写 `memoryType`、`confidence`、`briefIndex`、`content` 和 `labels`
- **AND** 点击保存
- **THEN** 页面调用不含 `memoryId` 的 `POST /api/v1/memory/long-term-mem/manual`
- **AND** 请求包含用户当前设置的 `memoryType` 和 `confidence`
- **AND** 新记忆出现在列表中

#### Scenario: 新增表单使用类型和置信度默认值
- **WHEN** 用户打开新增记忆表单
- **THEN** 记忆类型默认选择 `USER_CHARACTERISTICS`
- **AND** 置信度默认显示为 `1`
- **AND** 用户可以在保存前修改类型和置信度

#### Scenario: 类型和置信度控件垂直对齐
- **WHEN** 新增或编辑表单以双列布局显示记忆类型和置信度
- **THEN** 类型选择框与置信度输入框使用相同的显式高度
- **AND** 两个控件使用 `border-box` 盒模型并从字段顶部对齐
- **AND** 置信度提示文本不得把置信度输入框推离类型选择框
- **AND** 记忆类型当前选中文本完整可见且文字下缘不被控件边界裁切

#### Scenario: 第 51 条个人设定记忆创建失败
- **GIVEN** 当前可信用户、Agent 和记忆实例下已经存在 50 条未共享且来源为 `CONFIGURED` 的个人设定记忆
- **WHEN** 用户继续通过 POST `/manual` 创建任意合法 `memoryType` 的第 51 条个人设定记忆
- **THEN** management service 分别查询 ACTIVE 和 ARCHIVED 的 `total`
- **AND** 两个总数加一大于 50
- **AND** 后端不得持久化该记录
- **AND** management port 返回 `LTM_WRITE_INVALID`、`VALIDATION` category
- **AND** Channel 返回 HTTP 400

#### Scenario: 第 51 条创建错误使用当前界面语言
- **WHEN** 手工新增返回 `LTM_WRITE_INVALID` 且安全消息为个人设定 50 条容量限制
- **THEN** 中文界面显示“个人设定记忆最多只能创建 50 条，请删除不再需要的记忆后重试。”
- **AND** 英文界面显示 “You can create up to 50 user-configured memories. Delete an unused memory and try again.”
- **AND** 页面不得直接显示后端英文容量诊断消息
- **AND** 其它 `LTM_WRITE_INVALID` 错误不得被错误替换为容量提示

#### Scenario: 新增和编辑的安全护栏拒绝使用当前界面语言
- **WHEN** 新增或编辑保存返回 `LTM_CONTENT_GUARD_BLOCKED`
- **THEN** 中文界面显示“记忆内容未通过安全审核，请修改摘要、正文或标签后重试。”
- **AND** 英文界面显示 “Memory content did not pass the security review. Revise the summary, content, or tags and try again.”
- **AND** 页面不得直接显示后端英文消息 `Long-term memory content was blocked by the security guardrail.`
- **AND** 页面保持在当前新增或编辑表单，并保留用户已填写的值
- **AND** 用户可以修改内容后重试
- **AND** `LTM_CONTENT_GUARD_UNAVAILABLE`、`LTM_CONTENT_GUARD_CANCELED` 及其它错误码不得被错误替换为安全护栏拒绝提示

#### Scenario: 不同记忆类型共用个人设定额度
- **GIVEN** 当前作用域已有 49 条 `USER_CHARACTERISTICS` 个人设定记忆
- **WHEN** 用户新增一条 `FACTUAL` 且来源为 `CONFIGURED` 的记忆
- **THEN** 新记录创建成功且个人设定总数为 50
- **WHEN** 用户再新增一条 `CONCEPTUAL` 且来源为 `CONFIGURED` 的记忆
- **THEN** management service 不调用手工保存 Gateway
- **AND** Channel 返回 HTTP 400

#### Scenario: 归档个人设定记忆不释放额度
- **GIVEN** 当前作用域已经存在 50 条不同类型的个人设定记忆
- **WHEN** 用户将其中一条记忆归档
- **AND** 随后通过 POST `/manual` 创建新的用户设定记忆
- **THEN** 后端不得持久化新记录
- **AND** Channel 返回 HTTP 400
- **WHEN** 用户撤销该记录的归档
- **THEN** 用户设定记忆总数仍为 50 条

#### Scenario: 达到容量后仍可编辑既有记忆
- **GIVEN** 当前作用域已经达到 50 条个人设定记忆
- **WHEN** 用户通过 POST `/manual` 并携带既有 `memoryId` 保存修改
- **THEN** 后端更新既有记录
- **AND** 不将该操作视为第 51 条创建

#### Scenario: 个人设定数量查询失败时不创建
- **WHEN** management service 在创建前查询 ACTIVE 或 ARCHIVED 个人设定数量失败
- **THEN** management port 返回对应 SafeError
- **AND** 不调用手工保存 Gateway
- **AND** 不持久化新记录

#### Scenario: 新增和编辑允许修改类型与置信度
- **WHEN** 用户打开新增或编辑表单
- **THEN** 表单显示记忆类型选择和置信度输入
- **AND** 编辑态使用已有记录的类型和置信度初始化
- **AND** 置信度输入只接受 `0..1` 且最多两位小数
- **AND** 保存请求不包含 `isPinned`
- **AND** 保存成功后不为类型或置信度调用 PATCH

#### Scenario: 标签数量不超过十个
- **WHEN** 用户在新增或编辑表单中输入不超过 10 个非空标签
- **THEN** 页面按空格、顿号和中英文逗号解析标签
- **AND** 显示当前标签数量和 `10` 个上限
- **AND** 保存按钮保持可用

#### Scenario: 标签允许为空
- **WHEN** 用户填写有效的类型、摘要和正文
- **AND** 标签输入为空
- **THEN** 保存按钮保持可用
- **AND** `/manual` 接受省略的 `labels` 或空数组

#### Scenario: 标签输入提示在中英文下保持可见
- **WHEN** 用户打开新增或编辑表单
- **THEN** 标签字段在双列表单中跨越全部列
- **AND** 中文和英文 placeholder 均使用标签字段的完整可用宽度
- **AND** 标签计数或错误提示显示在输入框下方，不遮挡 placeholder

#### Scenario: 超过十个标签时阻止保存
- **WHEN** 用户在新增或编辑表单中输入第 11 个非空标签
- **THEN** 页面显示“最多只能输入 10 个标签”的明确错误
- **AND** 标签输入标记为无效
- **AND** 保存按钮被禁用
- **AND** 页面不调用 `manualSaveLongTermMemory`
- **AND** 页面不静默截断用户输入

#### Scenario: 服务端明确拒绝第十一个标签
- **WHEN** 客户端绕过前端限制并向 `/manual` 提交 11 个标签
- **THEN** Channel 返回 HTTP 400
- **AND** 响应 code 为 `LTM_QUERY_INVALID`
- **AND** 不调用 `LongTermMemoryManagementPort`
- **AND** 不返回 HTTP 500

#### Scenario: 参数提示与接口限制一致
- **WHEN** 用户打开新增或编辑表单
- **THEN** 摘要提示必填且最多 2048 字符
- **AND** 正文提示必填且最多 4000 字符
- **AND** 摘要和正文输入框下实时显示 Unicode code point 计数，格式分别为 `current/2048` 和 `current/4000`
- **AND** 标签提示可选、最多 10 个且单个最多 256 字符
- **AND** 摘要或正文为空、任一字段超长时保存按钮禁用

#### Scenario: 编辑记忆
- **WHEN** 用户编辑记忆并点击保存
- **THEN** 页面调用包含既有 `memoryId` 的 `POST /api/v1/memory/long-term-mem/manual`
- **AND** 请求包含表单中修改后的 `memoryType` 和 `confidence`
- **AND** 请求保留当前记录已有的 `knowledgeSourceType`
- **AND** 编辑 `LEARNED` 智能沉淀记录时不得把来源改写为 `CONFIGURED`
- **AND** 不为 `memoryType`、`confidence` 或 `isPinned` 发送补偿 `PATCH`
- **AND** 成功后页面重新请求当前 Tab 的列表
- **AND** 页面重新调用 `GET /api/v1/memory/long-term-mem/{memoryId}/record` 获取已持久化详情，而不是复用保存前的本地详情 state
- **AND** 列表和详情区显示更新后的记忆

#### Scenario: 非法置信度被拒绝
- **WHEN** 用户输入 `1.0000000000000000000000000009`、`0.123`、`1e-1`、小于 `0`、大于 `1` 或非数值置信度
- **THEN** 前端标记置信度无效并阻止手工保存请求
- **AND** 绕过前端后 `/manual` 请求的置信度不是 `0..1` 内的有限数值时，Channel 返回 HTTP 400 `LTM_QUERY_INVALID`
- **AND** management port 不被调用
- **AND** local Gateway 对绕过 Channel 的同类非法请求返回 `LTM_WRITE_INVALID` `VALIDATION`

### Requirement: 详情区共享按钮必须反映发布状态

详情区 SHALL 使用一个按钮，并根据记忆是否已发布在“共享到记忆库”和“取消共享”之间切换。由于发布会创建独立的 SHARED 副本且不会修改原记录的 `sharingState`，前端 SHALL 使用 `publishedMap` 把原记忆 ID 映射到已发布副本 ID。加载共享列表时 SHALL 从 `sourceMemoryId` 填充该映射；发布成功后 SHALL 写入原记忆 ID 和返回的副本 ID；取消发布成功后 SHALL 删除映射。取消发布时 SHALL 使用 `publishedMap` 中的已发布副本 ID 调用 `unpublishLongTermMemory`，SHALL NOT 使用原记录 ID。`sharingState=FORK` 的副本 SHALL 不允许再次发布，其共享按钮 SHALL 禁用，并通过按钮的本地化 `title` 提供不可再次共享的说明；详情区 SHALL NOT 额外常驻显示相同提示。

#### Scenario: 从详情区发布记忆
- **WHEN** 用户对私有记忆点击“共享到记忆库”
- **THEN** 页面调用 `POST /api/v1/memory/long-term-mem/{originalMemoryId}/publish`
- **AND** 请求体不包含 `tenantId`、`userId`、`subjectId`、`displayName` 或 `agentId`
- **AND** Channel 使用与 session/chat 路由共享的 identity resolver 产生的 `IdentityContext` 作为发布归属
- **AND** 按钮文字变为“取消共享”
- **AND** `publishedMap` 保存已发布副本 ID

#### Scenario: 从详情区取消发布
- **WHEN** 用户对已发布记忆点击“取消共享”
- **THEN** 页面使用 `publishedMap` 中的 ID 调用 `POST /api/v1/memory/long-term-mem/{publishedCopyId}/unpublish`
- **AND** 按钮文字变为“共享到记忆库”
- **AND** `publishedMap` 删除对应项

#### Scenario: FORK 副本不能再次共享
- **WHEN** 当前记忆的 `sharingState` 为 `FORK`
- **THEN** “共享到记忆库”按钮处于禁用状态
- **AND** 按钮的本地化 `title` 说明副本不能再次共享
- **AND** 鼠标悬停按钮时可显示该说明
- **AND** 详情区不额外常驻显示相同提示
- **AND** 点击不调用发布接口

### Requirement: 异常 API 数据不得导致前端白屏

页面 SHALL 通过 `safeArr`、`safeNum`、`safeStr` 读取 API 响应字段，并为 `undefined`、`null` 或非预期类型提供回退值。`typeLabel`、`typeChipClass`、`sourceLabel` 等枚举查找 SHALL 对未知值返回 `-` 或空字符串。`unwrap` SHALL 在读取 `errorCode` 前验证响应是非空 object。异常数据形状 SHALL NOT 导致页面崩溃或空白渲染。

#### Scenario: 非法列表响应不导致页面崩溃
- **WHEN** `listLongTermMemory` 返回 `{ items: null, total: undefined }`
- **THEN** 页面显示空列表
- **AND** 页面保持可交互

#### Scenario: 未知 memoryType 使用回退显示
- **WHEN** 记忆摘要包含 `memoryType = "FUTURE_TYPE"`
- **THEN** 类型标签显示 `FUTURE_TYPE`，而不是 `undefined`
- **AND** 类型样式 class 使用空字符串，而不是 `undefined`

### Requirement: 列表和详情请求必须防止竞态覆盖

列表和详情加载 SHALL 使用 sequence guard 防止过期响应覆盖当前状态。每次请求 SHALL 递增对应序号；响应序号与当前序号不一致时 SHALL 丢弃响应。搜索输入 SHALL 使用 `350ms` debounce，避免逐字符发送请求。

#### Scenario: 快速切换 Tab 后只显示最终数据
- **WHEN** 用户快速从“我的记忆”切换到“共享记忆库”，再切换到“已归档”
- **THEN** 最终列表与“已归档”Tab 匹配
- **AND** 丢弃先前 Tab 的迟到响应

#### Scenario: 搜索输入只触发一次请求
- **WHEN** 用户逐字符输入 `network`
- **THEN** 停止输入 `350ms` 后只发送一次 API 请求
- **AND** 中间输入不发送请求

### Requirement: 记忆操作必须防止重复提交

pin、archive、delete、save、publish、copy 等操作在 API 请求未结束时 SHALL 通过 `actionLoading` 禁用相关操作按钮。前一个操作进行期间，用户 SHALL NOT 触发第二个操作。

#### Scenario: 操作进行期间禁用按钮
- **WHEN** 用户点击“归档”且 PATCH 请求尚未结束
- **THEN** 详情区全部操作按钮处于禁用状态
- **AND** 再次点击不产生效果

### Requirement: 已删除记忆的过期界面操作必须安全收敛

当记忆详情读取或基于当前列表记录执行的编辑、设置或取消保持不变、归档、撤销归档、删除、发布或取消发布操作返回 HTTP 404、`LTM_MEMORY_NOT_FOUND` 或 `INVALID_BRAND_VALUE` 时，页面 MUST 显示当前语言的“该记录已被删除”反馈，MUST NOT 显示底层标识符校验消息或原始后端错误。页面 MUST 清除失效的当前选中项和详情，并重新加载当前 Tab 列表与三个 Tab 的未过滤计数；刷新后若当前页仍有记录，页面 MUST 按既有列表选择规则选中有效记录。其它错误码 MUST 保持既有安全错误映射和重试行为。

**需求类别**：功能性需求

#### Scenario: 另一个页面删除后查看详情
- **GIVEN** 两个记忆管理页面同时显示同一条记忆
- **AND** 第一个页面已删除该记忆
- **WHEN** 第二个页面点击该记忆并且详情接口返回 HTTP 404、`LTM_MEMORY_NOT_FOUND` 或 `INVALID_BRAND_VALUE`
- **THEN** 第二个页面 MUST 显示当前语言的“该记录已被删除”反馈
- **AND** 第二个页面 MUST NOT 显示 `identifier value must be non-empty` 或其它原始标识符错误
- **AND** 第二个页面 MUST 清除失效详情并刷新当前列表和 Tab 计数

#### Scenario: 对已删除记录执行其它操作
- **GIVEN** 当前页面保留一条已被其它页面删除的记忆记录
- **WHEN** 用户对该记录执行编辑、设置或取消保持不变、归档、撤销归档、删除、发布或取消发布且接口返回 HTTP 404、`LTM_MEMORY_NOT_FOUND` 或 `INVALID_BRAND_VALUE`
- **THEN** 页面 MUST 显示与详情读取相同的本地化已删除反馈
- **AND** 页面 MUST 清除失效选择并刷新当前列表和 Tab 计数
- **AND** 页面 MUST NOT 将失败操作显示为成功

### Requirement: PATCH 端点必须按字段组执行变更

保持状态切换和归档状态切换 SHALL 使用 PATCH `/{memoryId}`。单次 PATCH SHALL 只包含一个字段组：保持状态使用 `isPinned`；归档到 `ARCHIVED` 使用 `targetState` 和非空 `archiveReason`；撤销归档到 `ACTIVE` 使用 `targetState` 且 SHALL NOT 发送 `archiveReason`。存在版本号时 PATCH SHALL 包含用于乐观并发控制的 `expectedVersion`。

#### Scenario: 设置记忆保持不变
- **WHEN** 用户对活动记忆点击“设为保持不变”
- **THEN** 页面调用 `PATCH /api/v1/memory/long-term-mem/{memoryId}`，请求体为 `{ isPinned: true, expectedVersion }`

#### Scenario: 归档允许自动更新的记忆
- **WHEN** 用户对 `isPinned = false` 的记忆点击“归档”
- **AND** 确认归档对话框
- **THEN** 页面调用 `PATCH /api/v1/memory/long-term-mem/{memoryId}`，请求体为 `{ targetState: "ARCHIVED", archiveReason: "user_archive", expectedVersion }`

#### Scenario: 保持不变的记忆禁止归档
- **WHEN** 用户对 `isPinned = true` 的记忆点击“归档”
- **THEN** 页面显示警告消息
- **AND** 不调用 API
- **AND** 不显示归档确认对话框

#### Scenario: 撤销归档
- **WHEN** 用户对已归档记忆点击“撤销归档”
- **THEN** 页面调用 `PATCH /api/v1/memory/long-term-mem/{memoryId}`，请求体为 `{ targetState: "ACTIVE", expectedVersion }`
- **AND** 请求体不包含 `archiveReason`

### Requirement: 批量操作必须在批量 API 实现前保持禁用

当前实现 SHALL NOT 提供批量保持、取消保持、归档、删除或撤销归档，因为批量 API 尚未实现。列表行 SHALL NOT 渲染 checkbox，列表头 SHALL NOT 渲染全选 checkbox，页面 SHALL NOT 渲染批量操作栏。单条记忆操作 SHALL 保持可用。

#### Scenario: 列表不显示批量选择和操作栏
- **WHEN** 用户查看“我的记忆”“共享记忆库”或“已归档”任一 Tab
- **THEN** 列表行和列表头均不渲染 checkbox
- **AND** 不渲染批量操作栏

### Requirement: 共享记忆库必须支持浏览、搜索、发布、取消发布和复制

“共享记忆库”Tab SHALL 调用 `listPublishedLongTermMemory` 显示共享记忆。搜索输入 SHALL 作为 REST query 字段 `queryText` 调用 GET `/shared`；Channel SHALL 以相同字段名把 `queryText` 传给既有 `ListPublishedLongTermMemoryManagementQuery.queryText`，不得增加字段映射，也不得只在前端过滤当前页。发布私有记忆 SHALL 调用 `publishLongTermMemory`（POST `/{memoryId}/publish`）；取消发布 SHALL 调用 `unpublishLongTermMemory`（POST `/{memoryId}/unpublish`）；复制共享记忆 SHALL 调用 `copyPublishedMemory`（POST `/shared/copy`）。复制端点成功响应的 `data` SHALL 直接为复制结果数组，不得额外包装为 `{ results }`。数组中的每个 `CopyPublishedMemoryResult` SHALL 包含非空 string `memoryId`、符合既有 `LongTermMemoryRecord` 契约的 object `record`、非空 string `sourceMemoryId` 和 string `copyStatus`；四个字段均为必填且不得为 `null`。`copyStatus` SHALL 为闭集枚举 `COPIED | EXISTING`，无默认值：本次调用新建 FORK 时为 `COPIED`，返回调用前已存在的 FORK 时为 `EXISTING`。系统 SHALL 在当前可信用户、Agent 和记忆实例 scope 中为每个共享来源最多保留一条 FORK；重复复制 SHALL 返回既有 FORK 结果而不新增记录。

#### Scenario: 浏览共享记忆库
- **WHEN** 用户切换到“共享记忆库”Tab
- **THEN** 页面调用 `GET /api/v1/memory/long-term-mem/shared`
- **AND** 显示共享记忆的 owner 和 subscriber 信息

#### Scenario: 搜索共享记忆库
- **WHEN** 用户在共享记忆库输入 `BGP`
- **THEN** 页面调用 `GET /api/v1/memory/long-term-mem/shared?queryText=BGP`
- **AND** Channel 调用 management port 时传入 `queryText: "BGP"`
- **AND** 结果和 total 来自后台搜索

#### Scenario: 发布私有记忆
- **WHEN** 用户对私有记忆点击“共享到记忆库”
- **THEN** 页面调用 `POST /api/v1/memory/long-term-mem/{memoryId}/publish`
- **AND** 共享列表出现对应的 SHARED 副本

#### Scenario: 复制共享记忆
- **WHEN** 用户对共享记忆点击“复制”
- **THEN** 页面使用该共享记忆 ID 调用 `POST /api/v1/memory/long-term-mem/shared/copy`
- **AND** 成功响应的 `data[0]` 包含 FORK 的 `memoryId`、`record`、`sourceMemoryId` 和 `copyStatus=COPIED`
- **AND** 在用户 scope 中创建 FORK 副本
- **AND** 页面切换到“我的记忆”Tab 并请求第一页

#### Scenario: 重复复制活动记忆
- **GIVEN** 当前用户已复制目标共享记忆且对应 FORK 的 `record.state=ACTIVE`
- **WHEN** 用户再次使用同一共享记忆 ID 调用复制端点
- **THEN** 成功响应的 `data[0]` 包含该既有 FORK 且 `copyStatus=EXISTING`
- **AND** 返回的 `memoryId` 与首次复制结果一致
- **AND** 当前用户 scope 中不新增另一条相同来源的 FORK
- **AND** 页面提示“我的记忆”中已存在相同记忆且请勿重复复制
- **AND** 页面保持在当前 Tab 和当前页，不执行历史副本定位

#### Scenario: 重复复制已归档记忆
- **GIVEN** 当前用户已复制目标共享记忆且对应 FORK 的 `record.state=ARCHIVED`
- **WHEN** 用户再次使用同一共享记忆 ID 调用复制端点
- **THEN** 成功响应的 `data[0]` 包含该既有 FORK 且 `copyStatus=EXISTING`
- **AND** 当前用户 scope 中不新增另一条相同来源的 FORK
- **AND** 页面提示“已归档”中已存在相同记忆且请勿重复复制
- **AND** 页面保持在当前 Tab 和当前页，不定位历史副本且不撤销归档

### Requirement: 活动记忆数量必须轻量展示

页面 SHALL NOT 显示“我的记忆”“保持不变”“共享中”“已复制”或“已归档”指标卡。“我的记忆”数量 SHALL 复用“我的记忆”列表响应的 `total`，并在“我的记忆”Tab 内以轻量计数展示，SHALL NOT 为计数额外发送请求。仅加载“我的记忆”Tab 时 SHALL 更新活动数量；切换到“共享记忆库”或“已归档”时 SHALL NOT 使用对应列表 `total` 覆盖活动数量。系统 SHALL NOT 为“保持不变”“共享中”“已复制”或“已归档”发送统计请求。

#### Scenario: 从活动列表响应更新我的记忆数量
- **WHEN** 页面加载“我的记忆”Tab
- **THEN** “我的记忆”Tab 内的轻量计数显示 `listLongTermMemory` 响应的 `total`
- **AND** 不发送单独的活动数量请求
- **AND** 页面不渲染任何指标卡

#### Scenario: 活动列表加载失败时显示零
- **WHEN** `listLongTermMemory` 调用失败
- **THEN** “我的记忆”Tab 内的轻量计数显示 `0`
- **AND** 列表区显示加载错误

#### Scenario: 共享列表数量不覆盖活动数量
- **WHEN** “我的记忆”数量当前为 `5`
- **AND** 用户切换到“共享记忆库”Tab
- **THEN** “我的记忆”Tab 内的轻量计数仍显示 `5`
- **AND** 不把共享列表 `total` 写入活动数量

### Requirement: 记忆管理端口必须由 composition root 完成装配

`create-app.ts` SHALL 使用已选择的长期记忆 Gateway bindings 调用 `agent-memory` public factory，并通过 `WebChannelRegistrationContext.longTermMemoryManagement` 把生成的 `LongTermMemoryManagementPort` 传给 channel 层。channel 层 SHALL 只接收管理端口，MUST NOT 接收 `LongTermMemoryGatewayBindings`。`agent-app` SHALL 只负责组合和依赖装配。

#### Scenario: 管理端口从 composition 流向 Web Channel
- **WHEN** 应用使用 LOCAL gateway provider 完成组合
- **THEN** `create-app.ts` 使用已选择的 bindings 调用 `agent-memory` factory
- **AND** `registerWebChannel` 通过 dependencies 接收 `longTermMemoryManagement`
- **AND** `registerWebChannel` 不接收 `LongTermMemoryGatewayBindings`
- **AND** 记忆路由完成注册

### Requirement: 共享知识展示发布者用户名

共享知识管理结果的每个条目 MUST 保留 required `ownerUserId`，并 MUST 允许返回 optional `ownerUserName`。`ownerUserId` MUST 继续表示共享记忆事实中的稳定 `ownerSubjectId`；`ownerUserName` 只用于展示，MUST NOT 取代身份关联、授权判断或共享记忆 owner scope。`ownerUserName` 存在时 MUST 是对应 `ownerUserId` 的 1..256 个 Unicode code point 的非空用户名；Web response MUST 拒绝其它新增用户属性。

系统 MUST 使用当前可信调用者的 `tenantId` 和 `subjectId` 作为用户查询授权上下文，并 MUST 只查询本次共享知识页面实际包含的发布者标识。系统 MUST 对同一页面的重复发布者标识去重，并 MUST 把当前请求的 `AbortSignal` 传递给用户查询。用户查询成功且返回对应用户时，management result MUST 设置 `ownerUserName`；用户查询返回普通 `SafeError` 或省略某个用户时，共享知识内容 MUST 继续返回，并 MUST 对受影响条目省略 `ownerUserName`。用户查询返回 category 为 `CANCELED` 的 `SafeError` 时，management operation MUST 返回取消结果，MUST NOT 把取消转换为成功页面。

共享知识列表和详情 MUST 优先显示非空 `ownerUserName`；字段缺失时 MUST 显示 `ownerUserId`。LOCAL 默认部署下，每个条目 MUST 显示 `${ownerUserId}-name`。用户查询失败、结果缺失和展示回退 MUST NOT 改变共享知识页面的内容、总数、分页、排序、发布、撤销发布或复制语义，也 MUST NOT 向 Web response 暴露用户查询的原始错误。

**需求类别**：功能性需求

#### Scenario: LOCAL 共享知识显示默认用户名

- **GIVEN** LOCAL 默认用户查询 Gateway 可用
- **WHEN** 共享知识页面包含发布者 `publisher-a`
- **THEN** management result MUST 同时包含 `ownerUserId=publisher-a` 和 `ownerUserName=publisher-a-name`
- **AND** 列表与详情 MUST 显示 `publisher-a-name`

#### Scenario: 同一页面批量解析发布者

- **GIVEN** 共享知识页面包含多个条目且部分条目具有相同 `ownerUserId`
- **WHEN** 系统解析发布者用户名
- **THEN** 用户查询输入 MUST 只包含该页面去重后的发布者标识
- **AND** 每个已解析条目 MUST 获得与其 `ownerUserId` 对应的 `ownerUserName`

#### Scenario: 单个发布者未解析时回退标识

- **WHEN** 用户查询结果省略某个页面发布者
- **THEN** 对应共享知识条目 MUST 保留 `ownerUserId` 并省略 `ownerUserName`
- **AND** 列表与详情 MUST 显示 `ownerUserId`
- **AND** 其它已解析条目 MUST 继续显示各自用户名

#### Scenario: 用户查询普通失败不阻断共享知识

- **WHEN** 用户查询返回 category 不为 `CANCELED` 的 `SafeError`
- **THEN** 共享知识 management operation MUST 返回原有页面内容和分页信息
- **AND** 全部受影响条目 MUST 省略 `ownerUserName` 并显示 `ownerUserId`
- **AND** Web response MUST NOT 包含原始用户查询错误

#### Scenario: 用户查询取消终止管理请求

- **WHEN** 用户查询返回 category 为 `CANCELED` 的 `SafeError`
- **THEN** management operation MUST 返回取消结果
- **AND** MUST NOT 返回部分补充用户名的成功页面

#### Scenario: 空共享知识页面不查询用户

- **WHEN** 共享知识页面不包含条目
- **THEN** 系统 MUST 返回原有空页面和分页信息
- **AND** MUST NOT 发起空目标集合的用户查询

### Requirement: Long-term memory management entry gate

Agent Web MUST 根据 `runtimeConfig.portalAbilityConfig.longTermMemoryManagementEnabled` 控制长期记忆管理入口可见性。字段为 `true` 或缺失时，入口 MUST 保持当前默认可见行为；字段为 `false` 时，入口 MUST NOT 渲染。

Local 宿主 MUST 继续不渲染长期记忆管理入口。Immersive 与 Collaborative/PIU 宿主 MUST 使用同一个 `longTermMemoryManagementEnabled` 值控制所有长期记忆管理入口。关闭入口 MUST NOT 影响直达 `#/memory` 的既有行为，也 MUST NOT 修改长期记忆 API 或记忆能力执行语义。

**需求类别**：功能性需求

#### Scenario: 默认显示长期记忆管理入口

- **WHEN** `longTermMemoryManagementEnabled` 为 `true` 或缺失
- **THEN** Immersive 与 Collaborative/PIU 宿主中的长期记忆管理入口 MUST 保持当前可见行为
- **AND** Local 宿主 MUST 继续不渲染该入口

#### Scenario: 关闭长期记忆管理入口

- **WHEN** `longTermMemoryManagementEnabled` 为 `false`
- **THEN** Immersive 与 Collaborative/PIU 宿主中的长期记忆管理入口 MUST NOT 渲染
- **AND** 直达 `#/memory` 的既有行为 MUST 保持不变
- **AND** 长期记忆 API 和记忆能力执行语义 MUST 保持不变

#### Scenario: 多宿主入口一致

- **WHEN** `longTermMemoryManagementEnabled` 为 `false`
- **THEN** Immersive 与 Collaborative/PIU 中的所有长期记忆管理入口 MUST 均不可见
- **AND** MUST NOT 出现一个宿主隐藏、另一个宿主仍可见的行为
