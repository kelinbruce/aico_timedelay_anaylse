## 背景和现状（Context）

长期记忆 gateway contract 已在 `agent-contracts/gateway` 中更新对齐远端 V2 API YAML，包含 `LongTermMemoryStoreGateway`（6 方法）、`LongTermMemoryRetrieverGateway`（2 方法）和 `LongTermMemorySharingGateway`（4 方法），共 12 个操作。所有 DTO 使用 YAML 字段名，`OwnerScoped` 提供 `tenantId`/`subjectId`，`mutateLongTermMemory` 使用 flat PATCH shape。

前端现有路由架构在 `ImmersiveApp.tsx` 的 HashRouter 中，`/` 和 `/session/:sessionId` 由同一个 NextAgent shell 承载聊天内容，`/shared/:shareId` 是绕过该 shell 的独立全屏页面。当前记忆管理曾以同级 `/memory` 全屏 route 替换整个 shell，后续又收敛为不可恢复的 React 私有 view state；前者会丢失 Sidebar 或 RIGHT 顶栏，后者不能通过独立 URL 直达、刷新或浏览器历史恢复。目标是让 `/memory` 成为既有 Shell 内部的内容路径。前端 HTTP 调用通过 `apiClient` 统一处理 CSRF token、credentials 和错误转换，所有 service 使用 `/api/v1/...` 前缀。

`MemoryManagePage` 当前包含带独立“记”图标和副标题的页面级标题区、五个指标卡、三个 Tab、筛选区、列表区和右侧详情面板。独立图标、灰色页面底色和指标卡形成了与 Chat 首页不同的视觉体系；其中四个指标没有接口支持，单独保留一个活动记忆卡片也会造成布局失衡。目标增量是把页面收敛为现有 shell 的主内容区，复用 Chat 的标题、分隔线、字体、颜色和表面层级，并让内容在 Sidebar 占宽后的可用空间内自适应。

当前页面通过 Ant Design 静态全局 `message` API 显示成功、警告和错误信息。该 API 默认相对 viewport 顶部定位并把 portal 挂到 `document.body`，不知道 RIGHT 布局中常驻顶栏占用的空间，因此提示会出现在顶栏下方并被遮挡。这是 Shell 反馈定位上下文缺失，不是 `MemoryManagePage` 内容滚动本身造成的裁剪。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 在 immersive/PIU 模式下把长期记忆管理作为现有 NextAgent shell 的主内容 view；默认 LEFT 布局保持 Sidebar 常驻，RIGHT 布局保持既有顶栏常驻。
- 点击记忆管理入口导航到 Shell 内部 hash pathname `/memory`，浏览器显示 `#/memory`；只替换主内容并保留常驻导航。
- 让记忆管理内容区适配 shell 剩余宽高，拥有明确的内部滚动和响应式列表/详情布局，避免页面级 fixed viewport、外层页面滚动或重复产品导航。
- 让内容区标题、分隔线、字体、字号、颜色、背景和交互状态复用 Chat 主题体系；移除独立图标、副标题和全部指标卡，把活动记忆数量收敛为“我的记忆”Tab 内的轻量计数。
- 复用 Chat 在 immersive 中的宿主适配链路，使记忆管理页在不重新挂载的情况下响应 `site.theme` 和 `site.locale` 变化；所有界面自有文案支持简体中文和英文。
- 让详情正文在可解析为 JSON object/array 时展示两空格缩进的结构化 JSON，解析失败或内容不是 object/array 时保持原文。
- 让记忆管理的成功、警告和错误反馈依据 Shell 主内容区的实际顶部定位，在 LEFT/RIGHT 布局和尺寸变化后均保持可见。
- 封装 V2 API 全部 12 个端点，前端操作全部通过 service 层调用后端路由。
- 后端路由层将 `/api/v1/memory/long-term-mem/...` 请求委托给 `agent-contracts/channel` 的 `LongTermMemoryManagementPort`，完成可信 scope 注入、`userId` ↔ `subjectId` Web alias 映射和 `SafeError` → `LtmError` 映射；Channel 不直接调用 Gateway。
- 实现三个 Tab 的完整交互：我的记忆（列表/搜索/筛选/CRUD/pin/归档）、共享记忆库（浏览/搜索/发布/取消发布/复制）、已归档（单条撤销归档）；批量 API 实现前不展示批量操作。
- 复用 `apiClient` 的 CSRF token 注入、credentials 和错误处理。

**非目标：**
- 不实现权限控制（后端通过 CSRF 获取用户信息处理）。
- 不改变现有 session route、share 独立页面和 collaborative PIU 的行为。
- 不在 local 模式（`App.tsx`）中增加记忆管理入口或 view。
- 不为记忆管理页新增独立主题、语言状态或切换控件；主题和语言继续由既有 `AppProviders` 与宿主管理。
- 不把 memory view 写入 `sessionStorage`、`localStorage` 或后端；其浏览器投影只由当前 hash pathname 表达，进入会话路径时恢复 conversation view。
- 全站其它页面的 message、modal 或 notification 保持既有实现，不新增 HostSiteContext/public contract。
- 不通过单独提高 `z-index`、给记忆页增加固定顶部留白或硬编码宿主菜单高度解决反馈遮挡。
- 不在 `agent-platform-gateway-remote` 实现长期记忆 HTTP client 或远程记忆 API 调用；不修改 session/chat 已有的宿主身份传播和 Web Channel identity composition，也不要求 REMOTE deployment 默认安装特定 header identity resolver。Gateway provider 选择和 application service 构造仍由 `agent-app` composition 负责。

## 设计决策（Decisions）

### URL 前缀统一

前端和后端统一使用 `/api/v1/memory/long-term-mem` 前缀，与其它 service 的 `/api/v1/...` 模式保持一致。不再使用 `/rest/naie/memory/v2/...` 路径。Vite proxy 仅需已有的 `/api` 规则，无需额外的 `/rest` 代理。

### Shell 内容 view 集成

`/memory` 是 HashRouter 中由 NextAgent Shell 解释的主内容 pathname，不是与 Shell 平级的全屏 route。`/shared/:shareId` 继续是唯一绕过 NextAgent shell 的全屏页面；`/` 和 `/session/:sessionId` 的既有会话语义保持不变。

记忆管理使用 shell-owned、URL 可恢复的浏览器投影：

- LEFT 与 RIGHT 布局都从 `location.pathname` 派生 `memory` 是否为当前主内容；`Sidebar` 和 RIGHT 顶栏只发送选择意图并消费受控 active 状态，不持有平行的记忆主内容 boolean。
- 选择记忆管理入口时，shell 使用普通 history navigation 进入 `/memory`；重复选择当前入口保持 `/memory` 和 `MemoryManagePage`，不得 toggle 回聊天。
- `/memory` 激活时，shell 保持导航 chrome 挂载，只把主内容区从 `ChatWorkspace` 切换为 `MemoryManagePage`。LEFT 布局的 Sidebar 折叠状态、会话列表展开状态和其它本地导航状态不得因切换而重置。
- 直接打开、刷新或通过浏览器前进/后退进入 `/memory` 时，LEFT/RIGHT 均从 pathname 恢复 `MemoryManagePage` 和唯一的记忆入口 active 反馈。
- 从记忆管理选择收藏入口时导航到收藏 Function 拥有的 `/favorites` 内容路径；选择新会话、会话条目、收藏 turn 或搜索结果时复用既有 `/` 或 `/session/:sessionId` navigation，并由 pathname 自然恢复 conversation view。
- 投诉历史和 RIGHT 最近历史仍属于当前浏览器 history entry 的临时 state，不获得专用 pathname。URL 投影不写入 Zustand、`sessionStorage`、`localStorage` 或后端，也不获得 canonical session、request 或 persistence authority。

`MemoryManagePage` 只拥有右侧内容区：根容器使用父级可用高度和宽度，设置 `min-width: 0`、`min-height: 0`、`container-name: ltm-app`、`container-type: inline-size` 与受控 overflow。页面级 `1160px` 和 `720px` container query 显式查询 `ltm-app`；列表筛选的 `720px` 和 `480px` query 继续查询 `ltm-list`，防止列表面板这个嵌套 container 误触发页面纵向布局。内容区 header 与 Chat 的 `RightPaneLayout` 标题区同形：高度 `54px`、水平 padding `16px`、标题字号 `18px`、字重 `600`，底部使用左右各 `16px` 内缩的 `var(--color-border)` 分隔线；header 只显示“记忆管理”标题和右侧主要操作，不显示独立图标或副标题。

页面不渲染指标卡。活动记忆数量复用“我的记忆”列表响应的 `total`，作为“我的记忆”Tab 内的轻量计数展示，不额外请求统计接口；共享和归档列表不得覆盖该数量。页面的字体、文字颜色、背景、边框、hover/active 和主色 SHALL 使用 NextAgent 现有 `--font-family-app`、`--color-*` 主题变量，避免维护第二套固定色值。

记忆管理页 SHALL 与 Chat 复用同一条 immersive 宿主适配链路。`AppProviders` 继续把 `site.theme` 归一化为 `lightday | evening` 并写入根节点 `data-theme`，同时把 `site.locale` 归一化为 `zh-CN | en-US` 并更新既有 i18n 实例；`MemoryManagePage` 只消费该上下文，不保存平行偏好。页面自有的标题、Tab、筛选项、列表表头、空状态、详情、表单、确认框和反馈消息 SHALL 使用 `memoryManagement.*` 翻译资源，枚举展示值也 SHALL 通过同一资源解析。日期格式 SHALL 使用当前 i18n locale。宿主在运行时切换主题或语言后，已打开的记忆视图 SHALL 原地更新，不要求刷新或退出记忆视图。

主题样式 SHALL 只使用 Chat 已有的语义变量，包括 `--color-bg-*`、`--color-text-*`、`--color-border*`、`--color-primary`、状态色及 `--shadow-sm`。状态标签、提示、进度条和按钮边框不得保留仅适用于浅色背景的固定色值。记忆页不增加主题选择器；immersive 中的选择能力仍由宿主提供。

内容宽度大于 `1160px` 时列表/详情并列，`.ltm-workspace` 使用父级全部可用高度；平台 Shell 可以在页面上方保留 `64px` 菜单，但记忆内容区 SHALL 直接消费 Shell 分配的剩余高度，不得再次使用 `100vh` 或硬编码 `calc(100vh - 64px)` 重复扣减。详情卡片使用 `height/max-height: 100%`、`overflow-y: auto` 和 `overscroll-behavior: contain`，因此仅在详情总内容超过可用高度时显示卡片内纵向滚动条，详情内容本身不会继续撑高记忆主内容区。列表卡片同样限制在父级可用高度内，列表 Grid 使用 `auto auto auto minmax(0, 1fr) auto`：Tab、筛选区、表头和分页器保持固定，只有 `.ltm-rows` 使用 `overflow-y: auto` 和 `overscroll-behavior: contain` 承担低高度场景的数据行溢出，且禁止横向滚动。分页器位于最后一行并贴住卡片底部；列表行使用最小 `52px` 和 `4px` 垂直内边距，摘要列正文预览固定为单行省略，使平台顶部菜单占用 `64px` 后的基准桌面视口可容纳默认每页 10 条数据；Tab 按钮固定 `34px`，搜索和筛选控件固定 `32px`，筛选区子项顶部对齐，不以增高这些固定区域换取列表高度。

内容宽度不大于 `1160px` 时通过根容器 `ltm-app` 的 container query 纵向排列，并由 `.ltm-main` 承担内容区纵向滚动。窄布局下 `.ltm-main` 使用 `max-content` 行，`.ltm-workspace` 恢复自然高度和可见 overflow，并为列表和详情显式建立两个 `max-content` 行；`.ltm-rows` 同时恢复 `overflow: visible`，避免主内容区与列表数据行形成嵌套滚动；详情卡片在该布局下恢复自然高度。该断点不得为了强行保留并排详情而缩窄列表：搜索与三个筛选控件保持单行，表格保持完整列宽和正常行高。摘要列中的正文预览使用单行 `white-space: nowrap`、`text-overflow: ellipsis` 和 `overflow: hidden`，使大量换行或长连续文本稳定显示省略号；摘要 Grid 单元格及其文本使用 `min-width: 0` 和 `max-width: 100%`，不得由内容撑宽独立数据行。列表表头的全部列（包括摘要列）使用居中对齐，数据行的摘要内容仍保持左对齐以利阅读。任何宽度下都不得产生 document-level 横向滚动或带动常驻导航 chrome。

三个 Tab 的列表和两种详情视图统一通过 `confidenceBarClass` 决定置信度进度条颜色：`confidence < 0.6` 添加 `low` 状态，`confidence >= 0.6` 使用正常主题色。共享状态或归档状态只影响其它状态展示，不得固定置信度颜色；禁止共享列表始终使用正常色或归档列表始终使用低置信度色。

“我的记忆”筛选区由一个搜索框和三个下拉框组成：类型、来源和更新方式；置信度筛选 SHALL 被移除。来源筛选只提供当前存在生产写入链路的 `CONFIGURED`（用户设定）和 `LEARNED`（智能沉淀），不提供尚无生产写入入口的 `SYSTEM_DEFAULT`；前端仍保留 `SYSTEM_DEFAULT` 的显示映射，以便接口实际返回该值时安全展示。默认 grid 使用 `minmax(180px, 1fr) repeat(3, ...)`。搜索框有值时在输入框右侧显示显式清除按钮；搜索输入必须为该按钮预留独立的右侧内边距，通用控件样式不得覆盖该空间，输入文本不得延伸到按钮下方。搜索文本超过输入框可见宽度时使用单行省略号表达仍有隐藏内容，不得在边缘直接硬裁切；该显示规则只改变视觉呈现，不截断 `searchQ` 或发送给后台的合法 `queryText`。清除操作取消待执行的 debounce、立即清空 `searchQ` 和 `filters.q`、回到第一页，并触发不含 `queryText` 的当前 Tab 后端查询。共享记忆库只显示搜索、类型筛选；已归档显示搜索、类型筛选和来源筛选。`.ltm-list-panel` 建立命名 inline-size container：列表面板不大于 `720px` 时筛选区使用三列，不大于 `480px` 时使用单列，使响应式行为由筛选区真实可用宽度决定，而不是只看整个记忆页面宽度。所有 `.ltm-control` 使用 `width/max-width: 100%` 约束在 grid cell 内。

搜索框 placeholder SHALL 只说明界面承诺的摘要和正文搜索范围，中文使用“搜索摘要或正文”，英文使用 “Search summaries or content”；不得在提示中宣称支持标签搜索。该文案约束不改变现有 `queryText` 请求、服务端分页或清除搜索行为。

三个 Tab 共用的搜索框和 Web Channel 的 GET 列表、POST 搜索、GET 共享列表入口统一以 128 个 Unicode code point 作为 `queryText` 可提交上限。前端 SHALL 按 Unicode code point 计算当前长度，不得依赖 UTF-16 code unit 计数造成 Emoji 等补充平面字符被计为两个字符。输入超过上限时页面保留用户原始输入，不静默截断或改写；搜索框设置无效状态，在其下方显示包含 `current/128` 的当前语言错误，并取消待执行的 debounce，使超限字符串不进入 `filters.q` 或后台请求。用户删回合法长度后错误消失并恢复既有 350ms debounce。错误提示使用绝对定位，不增加筛选区高度；输入框 `title` 继续显示中文“最多输入 128 个字符”或英文 “Enter up to 128 characters”。绕过前端向任一公开入口提交超限 `queryText` 时，Channel SHALL 在调用 management port 前返回 HTTP 400。清除按钮、服务端分页和 `queryText` 字段语义保持不变。

详情正文通过记忆只读展示 helper 处理：先复用 Chat 回答和事件正文使用的通用敏感内容规则，再由记忆投影单独应用 `absolutePathPattern`，之后对非空字符串执行 `JSON.parse`；仅当结果是非 `null` object 或 array 时，以 `JSON.stringify(value, null, 2)` 输出到保留空白和换行的等宽文本容器。Chat 回答和事件正文不得应用 `absolutePathPattern`。正文容器必须限制在详情卡片可用宽度内，长键名、长字符串和普通文本都在卡片内强制换行，不显示正文自身的横向滚动条；解析失败或结果为 JSON scalar 时展示脱敏后的文本。该格式化和脱敏只影响记忆只读详情，不改写编辑表单或持久化内容。

详情摘要和正文按公开输入上限的一半决定是否提供折叠：摘要 Unicode code point 数超过 `1024` 时默认限制为两行，正文超过 `2000` 时默认限制为六个完整文本行；两者分别提供中英文“展开/收起”按钮。私有详情和共享详情使用同一阈值和视觉规则，切换记忆 ID 时重置为默认折叠。正文折叠外层显式使用 `height: auto`、`max-height: none` 和 `overflow: visible`，使旧的固定高度规则即使因页面热更新残留也不能生效；带边框、圆角和内边距的 `.ltm-markdown` 保持自然高度，内部 `.ltm-markdown-content` 使用六行 line clamp 和 `overflow: hidden` 裁剪预览。line clamp 不直接作用于带内边距的边框容器，避免内边距让第七行局部露出或让第六行被下边框分割；实现不通过字体行高与固定像素内边距计算固定高度，正文内容自身不建立横向或纵向滚动，标签和属性 section 继续处于正文之后的正常文档流。折叠仅改变展示容器，不截断传给 `MemoryContent` 的脱敏内容；复制操作使用同一脱敏结果。

私有记忆和共享记忆详情的正文标题旁统一提供“复制正文”操作。复制内容必须使用 API 返回的 `content` 经记忆专用绝对路径规则脱敏后的结果，不得复制 JSON 格式化后的展示字符串，也不得把占位符写回 API 响应对象；成功和失败均通过 Shell 提供的 message 实例反馈。浏览器 Clipboard API 不可用或写入失败时只提示失败，不修改记忆数据，也不降级为不可审计的隐藏 DOM 写入。

详情面板采用“身份、操作、内容”三层信息架构。顶部身份区只展示记忆类型、有效状态、私有/共享属性、置信度和摘要；操作区作为独立工具栏置于身份区下方，编辑是主操作，更新方式、共享和归档是次操作，删除与其它操作分组隔离。操作工具栏在支持的详情宽度内始终保持单行，通过紧凑按钮高度、水平内边距和间距容纳全部操作，不把删除或其它按钮折到下一行，也不引入横向滚动条。正文、标签和属性信息使用三个语义化 section；属性信息使用紧凑的 `dl` 键值清单，不再把每个字段渲染成独立卡片。“我的记忆”和“已归档”的属性清单只展示接口语义明确的记忆来源、更新方式、访问次数、最近访问时间、创建时间和更新时间；顶部已展示的共享状态不得再以含糊的“属性 / Property”重复显示。不得把 `archivedAt` 归档时间错误标记为“失效时间”，也不得在不存在失效时间字段时自行推算或展示占位项。共享记忆详情复用同一层级，只保留发布者、记忆来源和更新时间等接口实际提供的共享属性；不得展示接口未提供的订阅数量或复制人数。所有层级、间距、颜色、focus 状态和响应式行为继续使用 NextAgent 主题变量。

英文界面不得依赖中文短文案的固有宽度。`USER_CHARACTERISTICS` 在展示层使用简洁的 “User preference”，详情操作使用 “Keep fixed”“Auto-update”“Share”“Unshare”等短标签；筛选项仍保留完整说明。所有 Type chip 使用 `min-width: 0`、自身最大宽度和 `white-space: nowrap` 单行约束，列表 Type 列必须为标签文本与内边距预留足够宽度；详情 panel、detail、header、toolbar 与主操作组建立连续的可收缩边界。工具栏按钮在极端窄宽度下允许在按钮内部省略，但工具栏本身不得撑宽或产生横向滚动，支持的详情宽度下应完整显示简洁操作文案并保持单行。

查看态由每个语义 section 自己提供 `16px` 内边距；编辑态和新增态不使用这些 section，因此表单所在的 `.ltm-detail-body` 必须通过专用 form-body class 提供同等 `16px` 内边距。两种模式不得复用同一个全局 body padding，避免查看态重复留白或表单态贴住卡片边缘。

详情头中的摘要允许达到接口上限，不能假定其高度较小。摘要、工具栏、正文、标签和属性保持同一正常文档流，`.ltm-detail` 自身不建立第二层滚动；桌面并排布局由外层 `.ltm-detail-panel` 限制在主内容区可用高度内，并在内容溢出时提供唯一的详情纵向滚动。用户展开摘要或正文后，详情卡片内部可访问全部内容，且不会撑高 `.ltm-main` 或使页面外层出现滚动条。窄布局恢复详情自然高度，由 `.ltm-main` 承担两张纵向卡片的整体滚动。

新增和编辑态的“保存”/“保存修改”与“取消”使用专用 form-actions 操作组，并复用详情操作工具栏的紧凑按钮规格：最小高度 `30px`、水平内边距 `6px`、字号 `var(--ltm-font-xs)`。不得因表单操作位于身份区而退回通用按钮尺寸，避免模式切换时按钮高度、字号和宽度节奏突变。

编辑态顶部固定为两行：第一行由 `.ltm-form-heading-row` 展示“编辑记忆”标题及右侧状态标签，第二行由独立 `.ltm-form-actions` 展示“保存修改”和“取消”。form-actions 固定自身宽度且不再提供独立底部留白；form header 使用 `10px 16px 8px` 内边距、`6px` 行间距，标题行高为 `1.2`。`.ltm-detail` 使用 `align-content: start`，form header 使用 `align-content: start` 和 `grid-auto-rows: max-content`，禁止两条 `auto` Grid 行吸收卡片剩余高度而把两行内容撑高。这在保留 `30px` 点击目标和卡片边缘留白的前提下，使两行上下距离适中；查看态 `.ltm-detail-toolbar` 的边到边背景和间距不受影响。

三个 Tab 的列表成功返回后统一收敛选中状态：若当前选中 ID 仍存在于当前页结果中则保留，避免刷新覆盖用户选择；否则有数据时选择当前页第一条，无数据时清空选中 ID。Tab 点击仍先清空旧 Tab 的选中状态，因此新 Tab 不得短暂展示旧详情；“我的记忆”和“已归档”在自动选中后通过不记录使用行为的 `GET /{memoryId}/record` 加载完整记录，“共享记忆库”直接使用首条共享摘要显示详情。`accessCount` 是智能体实际使用记忆的统计，不得因管理界面选择、刷新或查看详情而写入或改变。该规则同样适用于筛选、搜索、分页或操作刷新后当前选择不再存在的情况。

新增和编辑表单的标签允许为空，上限为 10 个。标签数量使用现有 `parseLabels` 结果计算，即按空格、顿号和中英文逗号分隔、去除空项后统计；不得按输入字符串长度判断，也不得静默截断第 11 个及之后的标签。表单应持续显示 `当前数量/10`，超过 10 个时显示明确错误、设置标签输入的无效状态并禁用保存按钮，使超限数据不能进入 `manualSaveLongTermMemory`。Channel 的 `/manual` schema 同样 SHALL 接受空数组并拒绝第 11 个标签，以明确的 `LTM_QUERY_INVALID` 和 HTTP 400 返回。

手工新增和编辑展示并提交 `memoryType`、`confidence`、`briefIndex`、`content` 和 `labels`；新增固定提交受信来源 `knowledgeSourceType=CONFIGURED`，编辑必须提交当前记录已有的 `knowledgeSourceType`，不得把 `LEARNED` 智能沉淀记录改写为 `CONFIGURED`。`isPinned` 仍不是手工保存接口可设置字段。类型与置信度和文本字段在一次 `manualSaveLongTermMemory` 调用中原子保存，成功后不得为这些字段补发 PATCH。摘要约束为 1..2048 个 Unicode code point，正文为 1..4000，单个标签为 1..256，置信度为 `0..1` 的有限数值；前端需提供中英文约束提示、`maxLength` 和空值校验，并在摘要与正文输入框下实时显示与同一计数规则一致的 `current/max` 计数。Channel schema 在调用 management port 前执行同形校验。公开接口未定义字符白名单，因此合法 Unicode（含中文和常见标点）不得仅因字符种类被拒绝；若 management port 返回 VALIDATION SafeError，路由继续映射为 400。

管理界面的个人设定容量按每个可信 `tenantId + subjectId + agentId + memoryInstance` 最多 50 条 `knowledgeSourceType=CONFIGURED` 记录计算，不区分 `memoryType`。容量统计包含 `sharingState != SHARED` 的活动和归档记录；归档、撤销归档和编辑已有记录均不改变已占用额度，只有删除记录才释放额度。智能沉淀记录和共享库发布记录不占用个人设定额度。

`agent-memory` 的 `manualSaveLongTermMemory` 在不含 `memoryId` 且来源为 `CONFIGURED` 时，先分别用既有 `listLongTermMemory` 查询 `ACTIVE` 和 `ARCHIVED` 的 `total`，查询条件固定为同一可信 scope、同一 `memoryInstance`、`knowledgeSourceType=CONFIGURED`、`minConfidence=0`、`limit=1`、`offset=0`。显式使用 `minConfidence=0`，确保合法的低置信度个人设定记忆也计入额度。任一查询失败时不得继续写入；两个总数之和加一超过 50 时直接返回 `LTM_WRITE_INVALID`/`VALIDATION`，不得调用手工保存 Gateway。该查询是新管理接口的快速拒绝和明确错误路径，不承担并发一致性。

local Gateway SHALL 在手工创建事务内按相同 scope 和语义再次计数并写入，使不同 `memoryType` 的个人设定记录以及并发创建都不能越过上限；达到上限时返回同一 `LTM_WRITE_INVALID`/`VALIDATION` SafeError，由 Channel 按既有错误映射返回 HTTP 400。该约束不新增 Web DTO、错误码、count port 或平行接口。

编辑保存成功后不得只依赖提交前的 `detail` state 或保存响应投影。页面先恢复详情模式并以当前 `memoryId` 显式重新调用不记录访问的 `GET /{memoryId}/record`，随后重新加载当前 Tab 列表；这样即使列表刷新后选中 ID 未变化，详情也会显示后端最终持久化的值。

分页使用后端返回的 `total`、`offset` 和 `limit`。Ant Design `Pagination` 投影当前页、标准页码、上一页/下一页、`showQuickJumper` 和 `showSizeChanger`，页面在其两侧提供本地化的首页/尾页按钮；不显示记录总数或当前页说明。页大小状态允许 `10 / 20 / 50`，页码变化按 `offset=(page-1)*limit` 重新调用当前 Tab 对应接口；页大小变化回到第一页并使用新 `limit`、`offset=0` 请求。首页按 `offset=0` 跳转，尾页按 `offset=(ceil(total/limit)-1)*limit` 跳转，并在对应边界禁用。筛选、搜索或切换 Tab 时回到第一页但保留当前页大小；当前页在删除等操作后越界时按当前页大小回退到最后一个有效页。分页区允许在列表宽度不足时换行，所有控件仍位于列表卡片固定的分页行中，不产生横向滚动。

共享记忆库搜索不得在浏览器中仅过滤当前页。前端对 `GET /shared` 使用 REST query 字段 `queryText`；Channel schema 接收该字段，并以相同字段名传给既有 `ListPublishedLongTermMemoryManagementQuery.queryText`，不增加 wire-to-management 字段映射，也不修改 `agent-contracts/channel`。搜索与类型、分页参数在同一次后台请求中生效。

“我的记忆”和“已归档”复用 `GET /long-term-mem` 列表端点，并使用同名可选 query 字段 `queryText`。该字段加入既有 `ListLongTermMemoryManagementQuery` 与 `ListLongTermMemoryQuery`，由 `agent-memory` 原样委托给 Store Gateway；local SQLite Gateway 在应用状态、类型、来源、保持状态等现有筛选的同时，对摘要、正文和标签执行参数化文本匹配，并在 `COUNT` 与分页查询之前应用。前端不得再过滤当前页；列表响应的 `items` 与 `total` 必须来自同一次后端搜索结果。该增量只扩展既有 list query，不新增 port、DTO、owner 或第二套搜索流程。

`LongTermMemorySummary`、`LongTermMemorySummaryManagementView` 和前端 REST `LongTermMemorySummary` 继续携带必需字段 `accessCount`。local SQLite Gateway 从 `LongTermMemoryRecord.accessCount` 投影该字段，`agent-memory` 原样投影到管理摘要，Channel 继续使用既有 summary projection，不读取 Gateway Record；“我的记忆”和“已归档”表格不渲染访问次数列，也不消费列表摘要中的该字段。访问统计只在通过 `GET /{memoryId}/record` 加载的详情属性中展示。列表和管理详情查询只读取当前持久化计数，不产生使用副作用；只有智能体实际使用记忆的链路才拥有 `accessCount` 和 `lastAccessedAt` 的写入语义。

标签字段与摘要、正文同属长文本输入，在双列表单中必须使用 `.ltm-field.wide` 跨越全部列。placeholder 保留完整的中英文输入规则说明，标签计数或超限错误位于输入框下方；不得通过缩短英文文案、覆盖在输入框内或依赖单列 container query 掩盖半列宽度问题。

### Shell 反馈消息定位

反馈消息由 Shell 布局拥有定位上下文，唯一实施路径如下：

1. `ImmersiveLeftLayout` 和 `ImmersiveRightLayout` 为各自主内容节点保留 ref，并在包含 `MemoryManagePage` 的 Shell 子树外层提供 Ant Design `App` context。
2. 新增 `useShellFeedbackTop`，读取主内容节点的 `getBoundingClientRect().top`，返回 `contentTop + 12`；节点尚不可测量时返回 `12`。
3. hook 使用 `ResizeObserver` 监听主内容节点或 Shell 尺寸变化，同时监听 window resize；变化后重新测量。LEFT 主内容区从 viewport 顶部开始时结果为 `12px`，RIGHT 主内容区位于既有顶栏下方时结果随实际 content top 增加。
4. Shell 把该数值传给 Ant Design `App` 的 `message.top`。`MemoryManagePage` 通过 `App.useApp().message` 发送成功、警告和错误反馈，并移除 `import { message } from "antd"` 形式的静态全局调用。
5. message portal 保持 Ant Design 的 `document.body` 默认承载，不设置到 `.ltm-main` 或其它带 `overflow` 的节点，避免内容滚动导致提示移动或裁剪。

该路径测量 NextAgent 自身主内容区，因此不依赖 `PREL_MENU_HEIGHT`，也不在 immersive page root 叠加宿主菜单 padding/margin。该适配只用于记忆管理反馈；既有 modal 和其它页面反馈保持原状。

### 前端 Service 层

新增 `services/memoryService.ts`，对标 `sessionService.ts` 的模式。每个方法对应一个 V2 API 端点，通过 `apiClient.get/post/put/delete/patch` 调用。响应统一解包 `data` 字段。Owner Scope 和 Agent Scope 不进入前端 service 的 query/body；后端 Channel 从 trusted identity resolver 和 hosted-Agent selection/composition 获得 scope。

### 后端路由层

新增 `agent-channel-web/src/routes/memory.ts`，导出 `registerMemoryRoutes(instance, longTermMemoryManagement: LongTermMemoryManagementPort)`。在 `registerWebChannel` 中仅当 `dependencies.longTermMemoryManagement` 存在时调用。12 个 REST 端点与公开 Web 契约一一对应。Channel 只执行 wire validation、可信 scope 注入、取消连接、HTTP error 和 DTO projection，不导入或调用长期记忆 Gateway contract。

### userId ↔ subjectId 映射

前端使用 `userId` 字段名，内部 Owner Scope 使用 `subjectId` 字段名，两者是同一个值。Channel 从 trusted identity resolver 获得完整 `IdentityContext`，与独立 `agentId` 构造 `LongTermMemoryManagementScope` 传给 management port；在响应投影时从同一个 `identityContext` 将 `subjectId` 映射回 `userId`。此映射是 Web alias，不构成新的记忆业务模型，也不得依赖 Gateway Record owner 字段。

| 层 | 字段名 | 取值来源 |
|---|---|---|
| 前端 contracts | `userId` | `site.user.id` |
| Channel identity | `subjectId` | trusted identity resolver |
| Channel management contract | `identityContext.subjectId` | trusted `IdentityContext` |

### SafeError → LtmError 映射

Application port 返回 `SafeError | 业务数据` 的 union。路由层检测 `SafeError` 后映射为 `{ code, message, retryable }` 格式，并返回对应 HTTP 状态码：`LTM_MEMORY_NOT_FOUND` → 404，`LTM_STORAGE_UNAVAILABLE` → 500，`UNAVAILABLE` → 503，其它 → 400。成功响应包装为 `{ errorCode: 0, errorMsg: "SUCCESS", data }`，与长期记忆 V2 API 的成功信封保持一致。

### Memory Application 组合绑定

在 `WebChannelRegistrationContext` 中新增可选 `longTermMemoryManagement: LongTermMemoryManagementPort` 字段。`create-app.ts` 使用 selected Store/Retriever/Sharing Gateway bindings 调用 `agent-memory` public factory；`channel-composition.ts` 只把 management port 传递到 `registerWebChannel`。Gateway bindings 不进入 Channel registration context，`agent-app` 不做 DTO mapping 或 Gateway delegation。

### V2 API 端点映射

```
界面操作                     →  前端 service 方法            →  后端路由                         →  Application Port 方法
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
列表（我的记忆/已归档）       →  listLongTermMemory          →  GET  /long-term-mem              →  longTermMemoryManagement.listLongTermMemory
搜索                         →  listLongTermMemory(queryText) →  GET  /long-term-mem              →  longTermMemoryManagement.listLongTermMemory
Tab 活动计数                  →  listLongTermMemory          →  GET  /long-term-mem              →  longTermMemoryManagement.listLongTermMemory
                             →  (total 来自列表响应)        →                                   →
查看管理详情（不记录访问）    →  getLongTermMemory           →  GET  /long-term-mem/{id}/record  →  longTermMemoryManagement.getLongTermMemory
新增记忆                     →  manualSaveLongTermMemory    →  POST /long-term-mem/manual       →  longTermMemoryManagement.manualSaveLongTermMemory
编辑保存                     →  manualSaveLongTermMemory    →  POST /long-term-mem/manual       →  longTermMemoryManagement.manualSaveLongTermMemory
设为保持不变                  →  patchLongTermMemory         →  PATCH /long-term-mem/{id}        →  longTermMemoryManagement.mutateLongTermMemory
归档                         →  patchLongTermMemory         →  PATCH /long-term-mem/{id}        →  longTermMemoryManagement.mutateLongTermMemory
撤销归档                     →  patchLongTermMemory         →  PATCH /long-term-mem/{id}        →  longTermMemoryManagement.mutateLongTermMemory
删除                         →  deleteLongTermMemory        →  DELETE /long-term-mem/{id}       →  longTermMemoryManagement.deleteLongTermMemory
共享记忆库列表/搜索           →  listPublishedLongTermMemory →  GET  /long-term-mem/shared       →  longTermMemoryManagement.listPublishedLongTermMemory
共享到记忆库                  →  publishLongTermMemory       →  POST /long-term-mem/{id}/publish →  longTermMemoryManagement.publishLongTermMemory
取消共享                     →  unpublishLongTermMemory     →  POST /long-term-mem/{id}/unpublish →  longTermMemoryManagement.unpublishLongTermMemory
复制共享记忆                  →  copyPublishedMemory         →  POST /long-term-mem/shared/copy  →  longTermMemoryManagement.copyPublishedMemory
语义搜索（不使用）            →  —                           →  POST /long-term-mem/search       →  longTermMemoryManagement.searchLongTermMemory
无副作用 record（管理界面使用） →  getLongTermMemory         →  GET  /long-term-mem/{id}/record  →  longTermMemoryManagement.getLongTermMemory
自动保存（不使用）            →  —                           →  POST /long-term-mem              →  longTermMemoryManagement.saveLongTermMemory
```

### 统一响应解包

V2 API 所有响应为 `{ errorCode: number, errorMsg: string, data: T }`。后端路由层将 management view/result 包装为此格式。前端 `memoryService` 解包：`errorCode !== 0` 时抛出 `Error`，`errorCode === 0` 时返回 `data`。解包逻辑封装在 `memoryService` 内部。

`POST /long-term-mem/shared/copy` 的公开 REST `data` 直接投影为复制结果数组，不再把 application port 的 `{ results }` 内部结果容器暴露给浏览器。复制以当前可信 owner、Agent、`memoryInstance` 和共享来源 ID 识别既有 FORK；首次调用创建并返回 FORK，重复调用返回同一既有 FORK，且不新增第二条记录。Gateway 在事务内按本次操作是否新建记录生成 `copyStatus`，application port 和 Channel 仅逐层投影该字段，不依据时间、列表位置或前端状态反推。application port 与 Gateway 的 `{ results }` 容器保持不变，数组形状只属于 Channel REST projection。

复制完成后的前端行为只由 `copyStatus` 和既有 `record.state` 决定：

| `copyStatus` | `record.state` | 页面行为 |
|---|---|---|
| `COPIED` | `ACTIVE` | 切换到“我的记忆”，把分页重置为第一页并重新加载列表与计数 |
| `EXISTING` | `ACTIVE` | 提示“我的记忆”中已存在相同记忆；保持当前 Tab 和当前页 |
| `EXISTING` | `ARCHIVED` | 提示“已归档”中已存在相同记忆；保持当前 Tab 和当前页，不撤销归档 |

`COPIED` 的新 FORK 固定为 `ACTIVE`；其它组合不属于 Gateway 的合法结果。前端不根据 `memoryId` 查询列表位置，不请求或计算历史副本所在页，也不选中历史副本。

### apiClient.patch

`apiClient` 当前只有 `get/post/put/delete`。PATCH 方法通过 `fetchJson` 传递 `{ method: "PATCH", body }` 实现，与 `put` 同构。

### Owner Scope 与 Identity 注入策略

identity 字段必须来自 channel/auth boundary，不得走业务 query/body。HTTP headers 只能作为 auth/identity resolver 的 transport 输入；记忆路由不得直接解析原始 header 作为授权事实，只消费 resolver 产出的可信 `tenantId` 和 `subjectId`。`agentId` 来自 trusted hosted-Agent selection 或 app composition。

#### Contract 分层与实现顺序

身份链路涉及 application contract 和 REST wire contract，必须分清边界：

**第一层 — Memory management contract（`agent-contracts/channel`）：**

- `LongTermMemoryManagementScope` 包含完整 `IdentityContext` 和独立 `agentId`；`displayName` 到达 application boundary，但不进入 Gateway、REST DTO 或诊断。
- 12 个 route 只调用 `LongTermMemoryManagementPort` 的对应 method。
- application command/query/view/result 不复用 Gateway Request、Query 或 `*Record`。
- Channel 不接收 `LongTermMemoryGatewayBindings`，也不导入长期记忆 Gateway contract。

**第二层 — 前端 contracts（`frontend/agent-web/src/state/contracts.ts`，REST wire format）：**

- 描述浏览器与后端之间的 REST 请求/响应结构。
- 身份由 channel/auth resolver 处理，请求 body/query 不携带 `tenantId`/`userId`/`agentId`。
- 请求类型（`ManualSaveLongTermMemoryReq`、`PatchLongTermMemoryReq`、`SharingLongTermMemoryReq`、`CopyLongTermMemoryReq`、`ListSharedMemoryParams`、`MemoryOwnerScope`）移除 `tenantId`/`userId`/`agentId`。
- 响应类型（`LongTermMemoryRecord`、`LongTermMemorySummary`、`SharedMemorySummary`）只保留 management view 的公开投影字段；后端 projection 决定哪些字段暴露给前端。现有 `tenantId`、`userId` 和 `agentId` 从可信 management scope 投影，`subjectId` 映射为 `userId`。

**实现顺序（强制）：**

1. **先建立 management boundary** — 扩展 `agent-contracts/channel`，由 `agent-memory` 实现 `LongTermMemoryManagementPort`，Channel dependency 切换为 management port并删除 Gateway binding 入口。
2. **再收敛 route projection** — 12 个 route 从 trusted resolver 构造 `LongTermMemoryManagementScope`，移除 query/body authority 字段，并保持现有 REST response shape。

**链路全貌：**

```
HTTP request
  -> channel/auth identity resolver: IdentityContext
  -> trusted Agent resolver/composition: agentId
  -> LongTermMemoryManagementScope
  -> agent-contracts/channel.LongTermMemoryManagementPort
  -> agent-memory application service
  -> management view/result
  -> Channel REST projection: subjectId -> userId
```

**字段映射：**

| Application scope 字段 | 可信来源 | Web 投影 |
|----------|-------------|-------------|
| `tenantId` | channel/auth identity resolver | `tenantId` |
| `subjectId` | channel/auth identity resolver | `userId` |
| `agentId` | hosted-Agent selection/app composition | `agentId` |

**与 session/chat 复用接口层身份：**

- `registerWebChannel` 为 session、chat 和 memory 路由接收同一个 `WebChannelDependencies.identityResolver`。`requests.ts` 注册 memory 路由时 SHALL 原样传入该 resolver，`memory.ts` 只消费 resolver 输出的 `IdentityContext`。
- 记忆发布不新增宿主用户获取或 REMOTE 身份解析策略，也不要求改变 `AppProviders.tsx` 的既有身份投影；它与 session/chat 一样依赖已选 Web Channel 的 auth/identity boundary。
- 发布 body、前端 memory contract、management contract 和 Gateway contract 均不增加身份字段。
- `webIdentityResolver` 仍是产品 composition 可选注入点；未显式注入时沿用既有 composition identity 策略。本 change 不规定 REMOTE 必须获取真实宿主用户，也不规定具体的用户获取渠道。

**`HostSiteContext.user` 修订：**

新增 `oDomain` 字段：`oDomain?: { readonly id: string; readonly name: string }`。`oDomain.id` 是真正的 `tenantId`，不再使用 `user.domain`。Mock 环境（`prel-mock.ts` 和 `prelude-mock-source.mjs`）的 mock user 需包含 `oDomain: { id: "tenant-1", name: "Local tenant" }`，否则 immersive 模式下 `x-tenant-id` header 不会被设置。

**后端路由层改动：**

全部 13 条 Web 路由（对应 12 个 Gateway 操作）均为当前请求调用 trusted identity resolver 取得完整 `IdentityContext`，并与 trusted Agent resolver/composition 提供的 `agentId` 构造 `LongTermMemoryManagementScope`。路由不得缓存或复用上一请求的用户身份，不解析 query/body 中的 `tenantId`/`subjectId`/`userId`/`agentId`，也不直接调用 Gateway。

`memoryInstance` 为非 identity 字段，GET 端点从 query 读取，POST/PATCH 端点从 body 读取。`PATCH /:memoryId`、`POST /:memoryId/publish`、`POST /:memoryId/unpublish`、`POST /shared/copy` 均从 body 读取 `memoryInstance`，未提供时默认 `"defaultInstance"`。

**Query 参数类型转换：**

Fastify query string 参数均为字符串类型。后端 `asNumber` 和 `asBoolean` 辅助函数需支持字符串解析：`asNumber("1")` 返回 `1`，`asBoolean("true")` 返回 `true`，`asBoolean("false")` 返回 `false`。否则 `limit`、`offset`、`minConfidence`、`isPinned` 等参数会被丢弃。

**前端 service 层改动（`memoryService.ts`）：**

`scopeQuery` 函数不再将 `tenantId`/`userId`/`agentId` 拼入 query string，只保留 `memoryInstance`。`GET /shared` 不再传 `tenantId`/`agentId` query 参数。前端请求类型（`ManualSaveLongTermMemoryReq`、`PatchLongTermMemoryReq`、`SharingLongTermMemoryReq`、`CopyLongTermMemoryReq`、`ListSharedMemoryParams`）移除 `tenantId`/`userId`/`agentId` 字段；身份和 Agent scope 由后端可信边界提供。

**`MemoryManagePage` scope 构造：**

`scope.tenantId` 只用于页面展示侧兼容，取值优先使用 `host?.site?.user?.oDomain?.id`，再使用 `host?.site?.user?.domain`；它不进入发布 body，也不作为后端授权事实。所有 body 调用不再传 `tenantId`/`userId`/`agentId`。三个 Tab 的计数统一由独立的 `getLongTermMemoryTabTotals` 轻量请求组获取，不复用当前筛选列表的 `total`，因此搜索、筛选和切换 Tab 不会把局部结果写入全集计数。

### 共享操作路由

发布操作创建一条独立的 SHARED 副本，不修改原记录的 `sharingState`。因此前端通过 `publishedMap`（`Map<string, string>`：原始 memoryId → 共享副本 memoryId）追踪发布状态。`publishedMap` 在共享列表加载时从 `sourceMemoryId` 字段填充。发布成功后写入 map；取消发布时从 map 删除并用副本 ID 调用 `unpublishLongTermMemory`。按钮文字根据 `publishedMap.has(memoryId)` 在“共享到记忆库”和“取消共享”之间切换；FORK 副本的共享按钮禁用，并把不可再次共享的本地化说明放在按钮 `title` 上，避免详情头部额外占用一行常驻提示。

### 归档前置条件

归档操作要求记忆更新方式为 "允许自动更新"（`isPinned = false`）。当 `isPinned = true`（"保持不变"）时，点击归档显示 warning 提示，不弹出确认框，不发 API 请求。用户须先点击 "允许自动更新" 按钮将 `isPinned` 设为 false，然后才能归档。

### 手工保存字段边界

`manualSaveLongTermMemory` 接受必填 `memoryType` 和 `confidence`，不接受 `isPinned`。`ManualSaveLongTermMemoryManagementCommand` 与 `ManualSaveLongTermMemoryRequest` 使用同形的 `confidence: number`，范围固定为 `0..1`；Channel 在调用 management port 前完成 wire schema 校验，local Gateway 在持久化边界重复校验。类型和置信度必须与摘要、正文和标签在同一次 `manualSave` 持久化中保存，不得在保存后补发 PATCH。更新方式仍只通过详情态的独立 pin/unpin 操作修改。

新增表单提供记忆类型选择和置信度输入，初始类型使用 `USER_CHARACTERISTICS`，初始置信度为 `1`，来源固定为 `CONFIGURED`；用户可以在合法枚举和 `0..1` 范围内修改类型与置信度。编辑表单回显已有 `memoryType` 与 `confidence` 并允许修改，保存请求携带当前表单值及记录原有 `knowledgeSourceType`。每次进入新增态都重新使用默认值，不继承上一次编辑或创建的类型与置信度。该变更只作用于管理界面的手工保存链路，不改变 `add_memory` 等自动沉淀链路的来源分类或默认策略。

记忆类型 `select` 与置信度文本输入位于同一双列 Grid 行时，二者使用相同的显式控件高度和 `border-box` 盒模型，并从各自字段顶部对齐。记忆类型 `select` 使用更小的垂直内边距，在不改变控件总高度的前提下为原生文本行盒保留足够空间，避免选中文本下缘被裁切；置信度下方的提示文本只占用后续提示行，不改变两个输入控件本身的纵向位置。

后端容量 SafeError 继续保留 `LTM_WRITE_INVALID` 和既有英文安全消息，避免为单一界面展示新增平行错误契约。前端错误展示 helper SHALL 同时识别 `ApiError.code=LTM_WRITE_INVALID` 与容量消息 `At most 50 configured long-term memories are allowed.`，命中后改用 `memoryManagement.messages.capacityExceeded` 的当前语言资源；其它 `LTM_WRITE_INVALID` 或未知错误继续使用服务端消息或既有 fallback，避免把不同校验错误误报为容量超限。

长期记忆写入安全护栏拒绝使用稳定错误码 `LTM_CONTENT_GUARD_BLOCKED`。新增与编辑共用的前端错误展示 helper SHALL 仅按该错误码映射 `memoryManagement.messages.contentGuardBlocked`，中文显示“记忆内容未通过安全审核，请修改摘要、正文或标签后重试。”，英文显示 “Memory content did not pass the security review. Revise the summary, content, or tags and try again.”；页面不得直接展示后端英文安全消息，保存失败后保持当前表单及用户输入，允许用户修改后重试；`LTM_CONTENT_GUARD_UNAVAILABLE`、`LTM_CONTENT_GUARD_CANCELED` 或普通写入错误不得误映射为内容被拒绝。该增量不修改后端 SafeError、HTTP 状态或手工保存请求契约。

### 前端数据安全解析

所有 API 返回的字段通过 `safeArr`、`safeNum`、`safeStr` 辅助函数访问，`undefined`/`null`/非预期类型不会导致渲染崩溃。枚举查找通过 `safeLabel`/`safeChipClass` 加 fallback，未知枚举值显示 `-` 而非 `undefined`。`unwrap` 函数先校验响应是对象再访问 `errorCode`，防止 `null`/非 JSON 响应导致白屏。

### 请求竞态保护

列表和详情加载使用序列号 guard（`listSeqRef`、`detailSeqRef`）。每次请求递增序列号，响应返回时检查序列号是否匹配，不匹配则丢弃响应。防止快速切换 Tab 或连续点击不同行时旧响应覆盖新数据。搜索输入 debounce 350ms，避免高频按键产生大量请求。

### 操作防重复

`actionLoading` 状态在所有单条操作（pin、archive、delete、save、publish、copy）期间为 `true`，所有操作按钮 `disabled` 绑定此状态，防止重复提交。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Channel 只消费 composition 提供的 auth/identity resolver 输出，`agentId` 来自 hosted-Agent selection/app composition；query/body authority 字段必须拒绝。记忆只读投影在通用敏感内容规则之外单独应用绝对路径脱敏，Chat 正文不应用该路径规则；脱敏结果不写回编辑或持久化路径。本 change 不强制 REMOTE 获取真实宿主用户。 | route negative tests 断言 authority 字段返回 4xx 且 management port 未调用；scope handoff tests 确认配置的 resolver 输出被使用；记忆组件测试断言列表、详情与剪贴板不暴露原始敏感内容，Chat 回归测试断言正文绝对路径保持原文。 |
| 性能/容量 | 列表分页上限 100，搜索 offset 固定 0；搜索 debounce 350ms；Tab 活动计数通过列表接口的 total 字段获取而非单独计数接口；每个可信用户、Agent 和记忆实例最多 50 条 `CONFIGURED` 个人设定记忆，归档不释放额度。management 创建前查询 ACTIVE/ARCHIVED 总数用于快速拒绝，Gateway 事务计数用于并发一致性。 | management service 测试断言创建前查询、满额不写入和查询失败不写入；local Gateway 测试断言跨记忆类型的前 50 条创建成功、第 51 条返回 VALIDATION SafeError且归档后仍拒绝新增；Channel 测试断言该错误映射为 HTTP 400。 |
| 可靠性/恢复 | API 错误统一映射为 LtmError，前端展示友好错误提示；反馈消息依据内容区实际顶部定位且不受内容 overflow 裁剪；网络错误可重试；序列号 guard 防止竞态；数据安全解析防止白屏；操作防重复。 | 错误场景测试和反馈定位组件测试。 |
| 可维护性 | shell route owner、反馈定位、记忆内容组件和 service 职责分离；反馈位置不硬编码菜单高度；service 方法与 Web API 端点一一对应；后端路由方法与 management port 方法一一对应；safe* 辅助函数统一数据安全访问。 | TypeScript 编译、frontend build 和 architecture review。 |
| 可测试性 | shell layout 可通过路由组件测试验证常驻 chrome、内容切换和反馈位置；service 层可独立 mock 测试；后端路由可通过 mock management port 测试；页面组件可通过 mock service 测试交互。 | Vitest 单元/组件测试。 |
| 审计/可追溯性 | 无新日志或审计事件；API 调用走 `apiClient` 和 gateway 统一路径。 | 代码审查确认。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `#/memory` 直达、刷新和浏览器历史均在既有 shell 内恢复记忆管理 | 3.1、9.86-9.87 | `immersive-routing.test.tsx`、Playwright route journey |
| LEFT/RIGHT chrome 常驻、仅主内容切换 | 3.1 | shell component tests |
| 内容区自适应与独立滚动 | 3.4 | `MemoryManagePage.test.tsx`、CSS review |
| Chat 同形标题、主题风格、轻量计数和 JSON 正文展示 | 8.1-8.3 | `MemoryManagePage.test.tsx`、真实后端浏览器截图 |
| immersive 宿主主题和中英文动态切换 | 8.12 | `MemoryManagePage.test.tsx`、`i18n.test.ts`、immersive 浏览器检查 |
| 反馈消息避开常驻顶栏且不被内容裁剪 | 3.5 | `memory-feedback-placement.test.tsx`、静态 message negative assertion |
| V2 API 全部端点封装（前端） | 1.1-1.3 | `memoryService.test.ts` |
| 后端路由层 12 端点委托 management port | 4.1-4.6 | `memory.ts` 编译 + 路由测试 |
| userId ↔ subjectId 映射 | 5.2 | 代码审查 + 路由测试 |
| SafeError → LtmError 映射 | 5.2 | 代码审查 + 路由测试 |
| 三 Tab 完整交互 | 2.1-2.4 | `MemoryManagePage.test.tsx` |
| 批量操作在批量 API 实现前保持隐藏 | 6.10 | `MemoryManagePage.test.tsx` |
| 共享管理 | 2.4 | `MemoryManagePage.test.tsx` |
| 记忆摘要、正文和复制内容单独脱敏绝对路径，Chat 正文保留绝对路径 | 9.78-9.79、9.94-9.95 | `redactPathsInText.test.ts`、`MemoryManagePage.test.tsx`、`answerContent.test.ts`、`processDetailsProjection.test.ts` |
| build 和架构无回归 | 4.1 | `npm run build`、`npm run lint:architecture` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/long-memory-web-management/spec.md` 是长期记忆 Web 管理界面（含前端交互和后端路由代理）的唯一规范性承载。
- 架构和跨模块设计：`openspec/designs/modules/agent-web.md` 记录管理内容区、shell hash-route state 和职责边界；`openspec/designs/modules/agent-channel-web.md` 记录 memory 路由层只委托 management port 的职责。
- 导航：`openspec/designs/spec-to-design-map.md` 补充 `long-memory-web-management` 的导航。
- ADR：无；此变更复用现有 shell、session routes、service 模式和 gateway 组合模式，未引入新的跨模块 owner。

## 本轮记忆管理问题修复设计

1. **Tab 计数**：`memoryService.getLongTermMemoryTabTotals` 并行调用既有活动列表、共享列表和归档列表接口，统一使用 `limit=1, offset=0` 且不携带搜索或筛选参数，只返回各成功请求的 `total`。页面为聚合请求使用独立 sequence guard，并为缺失项保留最近成功值，避免计数失败覆盖当前列表状态。所有会改变三个集合成员关系的成功操作统一触发计数刷新；批量导入仅在响应 `successCount > 0` 时刷新，完全失败或结果未知时不把未确认写入计入界面。
2. **指定页码**：分页器持有独立文本输入，提交时按十进制整数解析并校验 `1..lastPage+1`，合法值转换为零基页号；非法值恢复当前页显示，不修改列表请求状态。
3. **筛选宽度**：只增加更新方式 grid cell 的最小宽度，并保留既有 container query 在窄布局下换列；不扩大全部控件或改变断点。
4. **置信度**：表单以字符串保存用户输入，提交前使用明确的最多两位小数 grammar 校验，再转换为 number。HTML `maxLength` 仅作为输入体验约束，正则校验仍作为可测试的决定性前端门禁。
5. **撤销归档**：`targetState=ACTIVE` 时省略 `archiveReason`；`targetState=ARCHIVED` 继续发送 `user_archive`。不放宽后端“存在时必须非空”的校验。
6. **发布身份边界**：记忆发布直接复用 `WebChannelDependencies.identityResolver(request) -> IdentityContext` 链路，`requests.ts` 把配置的 resolver 传入 memory 路由，`memory.ts` 以其输出构造 `LongTermMemoryManagementScope`。本 change 不要求 REMOTE deployment 额外装配身份解析器，不规定必须获取真实宿主用户或具体的用户获取渠道；产品仍可通过既有 `webIdentityResolver` 注入自身身份策略。不从 query、发布 body 或模型输入读取 authority 字段，`agentId` 继续来自 hosted-Agent selection/app composition，management/Gateway 契约不增加 `displayName`。参考 `docs/nextagent-ts-changes/agent-web-user-personalization.md`，用户画像持久化与跨用户昵称解析不属于本 change。
7. **英文类型、分页与字号**：为列表和详情顶部的类型标签增加同一 `ltm-type-chip` 单行约束，并把三个表格的 Type 列扩到能容纳 “User preference” 与标签内边距的宽度；普通标签仍可按既有规则换行。分页删除旧的自绘页码主体，改用 Ant Design `Pagination`；最终分页能力由本节设计正文和第 9 项扩展。删除 `--ltm-font-sm: 13px`，原使用点按信息密度改用 `--ltm-font-xs: 12px` 或 `--ltm-font-md: 14px`，不引入新的字号值。
8. **详情与表格宽度再平衡**：桌面并排布局把右侧详情列从最大 `430px` 调整为稳定 `480px`；`.ltm-detail-identity` 及其标签组禁止换行，置信度作为不可压缩项，使英文 “User preference / Active / Private / Confidence 100%” 保持同一行。列表继续占用剩余空间，但三个表格不再由摘要列吸收绝大多数宽度：按各 Tab 的字段数量分别收紧摘要最小宽度，为类型、来源、状态/发布者、置信度和日期设置可辨识列宽；置信度列增宽，进度条从 `48px` 扩到 `72px`。表格非摘要文本使用单行省略避免窄列反向撑宽。该调整只改变浏览器投影，不改变分页、列表数据或详情契约。
9. **完整分页控制**：保留 Ant Design 页码主体并启用快速跳页和页大小选择，页大小只允许 `10 / 20 / 50`；在组件两侧增加首页/尾页按钮。所有入口统一写入同一 `page`/`pageSize` 状态，不新增请求协议；页大小变化固定回到第一页，三个 Tab 继续由同一 `loadList` 生成 `limit/offset`。分页区使用占满列表宽度的 flex 容器把完整控件组整体推到右侧；空间不足时允许换行，各行仍向右对齐且不产生横向滚动。首页/尾页文案接入 `memoryManagement.pagination` 中英文资源。
10. **记忆敏感内容展示保护**：保留 `agent-runtime` 的 `system.output-redaction-guard` 作为 Chat 最终内容的权威安全 owner。`agent-web/src/utils` 的通用展示 helper 供 Chat 回答、Chat 事件正文和记忆管理共同使用，只处理有界凭据赋值、Bearer/`sk-` Token、手机号、Private Key 与历史 Markdown 转义占位符规范化；该 helper 不得包含或应用 `absolutePathPattern`。记忆管理在通用 helper 之后调用记忆专用展示 helper，由后者单独把 Unix/Windows 绝对文件路径替换为 `[REDACTED_PATH]`。因此 Chat 回答和事件正文中的绝对路径保持原文，记忆列表、私有/共享详情和复制正文中的绝对路径被隐藏；Chat 结构化安全路径字段继续服从其既有独立投影契约，不由本规则改变。IPv4/IPv6 属于电信网络业务事实，不参与脱敏。两个 helper 均不得改写 service response 或 state，使编辑表单、导入导出、共享复制和保存请求继续使用原始数据。记忆脱敏后再执行详情 JSON 格式化，保证 JSON 字符串值中的敏感内容也被替换且结构化展示继续有效。回归测试必须同时证明 Chat 正文保留绝对路径与记忆只读投影隐藏绝对路径，防止两条策略再次耦合；frontend 不得依赖 `agent-runtime` 私有实现。
11. **过期记录失败收敛**：`MemoryManagePage` 只按稳定的错误码识别记录已删除（HTTP 404、`LTM_MEMORY_NOT_FOUND`、`INVALID_BRAND_VALUE`），不匹配原始英文消息。详情读取和 `withLoading` 承载的记录操作复用同一判定和中英文资源；命中后清空失效选择与详情，刷新当前列表和三个 Tab 计数。`apiClient`、memory route、management port 和错误契约保持不变，非上述错误继续走既有安全反馈。

## 风险与取舍（Risks / Trade-offs）

- [LOCAL gateway 仅支持本地 SQLite] → `agent-app` 负责 provider selection；REMOTE adapter 实现后只替换 application service 下游绑定，Channel 依赖不变。
- [search 端点 offset 固定 0] → 管理界面的文本搜索走支持 `queryText` 和分页的 GET list 接口，不使用语义 search 端点，也不在前端过滤当前页。
- [统计接口未实现] → 不新增统计 API；三个 Tab 使用既有列表接口的未过滤 `total`，每次计数刷新最多新增三个 `limit=1` 轻量请求。
- [批量操作接口未实现] → 批量操作的批量 API 未实现。列表行不渲染复选框，表头不渲染全选复选框，批量操作栏不渲染。单条操作不受影响。

## 迁移计划（Migration Plan）

无数据迁移。`/memory` 从曾经绕过 Shell 的页面 route 和随后不可恢复的私有 view state，收敛为现有 Shell 拥有的 hash 内容 pathname；现有 `/`、`/session/:sessionId` 和 `/shared/:shareId` 行为保持不变。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/long-memory-web-management/spec.md`：归并 Web 管理界面（含前端交互和后端路由代理）的行为规范。
- `openspec/designs/functions/D8-数据与记忆/D8.2-记忆/FN-8.15-管理长期记忆.md`：创建 `FN-8.15`，并把 `long-memory-web-management` 标记为唯一主规格。
- `openspec/designs/features/D8-数据与记忆/D8.2-记忆/F-8.2-长期记忆.md`：把 `FN-8.15` 加入组成 Functions。
- `openspec/designs/functions/index.md`、`openspec/designs/features/index.md`：同步 Function 导航与 Feature 状态。
- `docs/NextAgent-function-list.md`、`docs/NextAgent-feature-list.md`：同步扁平概览中的 Function 与 Feature 映射。
- `openspec/designs/modules/agent-web.md`：归并记忆管理内容区、shell hash-route state 和常驻导航职责。
- `openspec/designs/modules/agent-channel-web.md`：归并 memory 路由层只委托 management port 的职责。
- `openspec/designs/spec-to-design-map.md`：补充导航。

## 已确认问题（Resolved Questions）

- **Identity 注入方案**：完整 `IdentityContext` 来自 channel/auth identity resolver，`agentId` 来自 hosted-Agent selection/app composition。记忆 route 构造 `{ identityContext, agentId }` 形状的 `LongTermMemoryManagementScope`，不直接读取原始 header 作为授权事实，也不接收 query/body authority 字段；`agent-memory` 映射 Gateway 时不传 `displayName`。
