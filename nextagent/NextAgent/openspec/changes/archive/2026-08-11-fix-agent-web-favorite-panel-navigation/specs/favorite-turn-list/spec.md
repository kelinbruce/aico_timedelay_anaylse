## Function

- **所属 Function**：`FN-1.13 查看收藏列表`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Local 与 Immersive 收藏内容视图

Local 和 Immersive 宿主 MUST 提供收藏入口。用户选择收藏入口时，系统 MUST 导航到当前宿主基地址下的 `#/favorites`，并在主内容区域展示按 session 分组的分页收藏内容。直接打开或刷新 `#/favorites` 时，系统 MUST 恢复收藏主内容和对应激活反馈。Local 和 Immersive LEFT 布局 MUST 保持左侧最近会话列表可见，MUST NOT 以收藏列表替换、覆盖或改写最近会话列表及其展开偏好；Immersive RIGHT 布局 MUST 在其主内容区域展示相同的收藏分组行为。

收藏主内容 MUST 在顶部展示高度为 56px、左右内边距为 16px 的标题栏。标题栏内容 MUST 左对齐，并依次展示返回按钮和“收藏”标题，两者间距 MUST 为 12px；标题字号 MUST 为 20px 且使用粗体。浅色主题下标题栏背景 MUST 为白色；暗色主题下标题栏 MUST 使用与主页对应的主题背景和文本颜色。用户从 session 对话进入收藏后选择返回时，系统 MUST 恢复该 session 对话路径；用户从新会话进入收藏后选择返回时，系统 MUST 恢复新会话路径；直接打开收藏 URL 且没有可恢复对话路径时，返回操作 MUST 进入新会话路径。

标题栏下方 MUST 依次展示过滤区和收藏内容区。过滤区 MUST 在同一行展示关键词搜索和日期过滤按钮，两者间距 MUST 为 8px，且二者宽度之和 MUST 占满可用容器宽度。搜索输入框 MUST 显示“请输入搜索内容”占位文本，右侧 MUST 提供搜索按钮；输入非空时 MUST 提供清除操作，清除后 MUST 立即恢复未按关键词过滤的结果。关键词过滤 MUST 对会话摘要和收藏问题文本执行不区分大小写的包含匹配。

日期过滤按钮 MUST 打开包含开始日期、结束日期和重置操作的过滤面板。用户选择开始日期或结束日期时，系统 MUST 分别打开可选择日期、时、分、秒的日期时间控件，并 MUST 提供“此刻”快捷操作；每个已有值的日期输入 MUST 分别提供快捷清除操作，清除一端 MUST 保留另一端；选择结果 MUST 以闭区间过滤 `favoritedAt`。重置 MUST 同时清除开始日期和结束日期。关键词搜索或日期条件变化时，浏览器 MUST 通过 `GET /api/v1/favorites` 的可选 `keyword`、`favoritedFrom` 和 `favoritedTo` 参数提交过滤条件；服务端 MUST 在当前可信 Owner Scope 和 Agent Scope 内先对会话摘要、收藏问题和 `favoritedAt` 执行过滤，再对过滤结果应用 `offset/limit`。后续分页 MUST 携带相同过滤条件。浏览器 MUST NOT 通过拉取全部未过滤收藏并在本地筛选来替代该接口能力。过滤 MUST NOT 修改收藏事实、响应 shape、浏览器持久化状态或既有授权边界。

系统 MUST 将当前过滤结果中 `sessionId` 相同的收藏 turn 投影到同一个会话分组卡片，并 MUST 以 `sessionId` 而不是可重复的会话标题判定分组；不同 `sessionId` 的收藏 turn MUST NOT 合并。收藏内容、过滤区、列表和卡片 MUST 占满宿主内容容器扣除统一内边距后的可用宽度，MUST NOT 再施加固定最大宽度。收起状态的会话分组卡片最大高度 MUST 为 56px，左右内边距 MUST 为 16px，圆角半径 MUST 为 1rem，并依次展示展开按钮、会话标题或稳定 session 标识回退值和 `MM-DD HH:mm` 格式的最近收藏时间。相邻会话分组卡片的垂直间距 MUST 为 8px。展开按钮与摘要间距 MUST 为 8px，二者 MUST 左对齐，时间 MUST 右对齐。分组顺序 MUST 由各分组在收藏查询顺序中的首次出现位置决定；分组内 turn MUST 保持收藏查询返回的相对顺序。

每个会话分组 MUST 默认处于收起状态且只展示摘要卡片。用户展开会话分组时，系统 MUST 自动滚动收藏内容区域，使目标会话卡片顶部与内容视口顶部对齐；受滚动区域底部边界限制而无法完成顶部对齐时，系统 MUST 至少保证目标会话卡片和展开正文的起始位置位于内容视口内。系统 MUST 为该分组当前已加载的每个收藏 turn 读取以 `rootMessageId` 为锚点的会话窗口，并 MUST 按收藏查询顺序展示对应的用户问题和智能体回答正文；每条正文 MUST 保留换行，并在正文前展示精确到秒的时间。展开区域中相邻收藏 turn 的间距 MUST 不超过 4px，用户问题和智能体回答的内容内边距 MUST 压缩为垂直不超过 8px、水平不超过 12px。智能体回答正文 MUST 复用实际对话卡片的 Markdown 渲染与安全清理逻辑，支持段落、列表、强调、代码和表格等已有 Markdown 能力；用户问题继续按纯文本显示。智能体回答容器及其 Markdown 内容根节点 MUST 根据实际内容自然调整高度，MUST NOT 使用 56px 的固定高度或最小高度；单个文本块 MUST NOT 因首尾默认外边距产生额外空白行。展开读取进行中 MUST 显示加载反馈；读取失败 MUST 保留展开状态、显示安全失败反馈并提供重试。用户收起会话分组时，系统 MUST 隐藏正文并恢复摘要卡片。展开或收起 MUST 只改变该会话分组的临时展示状态，MUST NOT 改变收藏事实、其他会话分组或浏览器持久化状态。会话分组标题 MUST NOT 打开会话或代表任一收藏 turn。

展开内容中每个收藏 turn 的用户问题最右侧 MUST 展示 16px 的已收藏五角星按钮。用户选择该按钮时，系统 MUST 在按钮左上方显示正文为“您确定要取消收藏该对话吗？”的确认浮层，并提供“取消”和“确认”操作。用户取消确认时，系统 MUST 保留收藏和展开内容；用户确认后，系统 MUST 提交单条取消收藏写入。取消收藏成功后，该 turn MUST 从当前分组移除，系统 MUST 显示成功反馈，且 MUST NOT 打开其会话；移除分组最后一个 turn 后，该会话分组 MUST 从当前收藏内容视图移除。取消收藏失败时，turn 正文 MUST 保留，系统 MUST 显示安全失败反馈并允许重试。用户选择正文区域时，系统 MUST 切换到对话视图，打开该 turn 所属 session，并定位到该 turn 的 `rootMessageId`；收藏按钮与正文导航 MUST 彼此解耦。

收藏标题栏、过滤区、会话卡片、展开正文、加载反馈和失败反馈的自定义样式 MUST 仅使用主页共享的主题 CSS 变量表达背景、文本、边框、悬停和状态颜色；复用的 Ant Design 控件和确认浮层 MUST 使用当前主页主题配置。收藏内容视图 MUST 在浅色与暗色主题下保持可读对比和相同布局结构。

系统 MUST 提供加载中、无收藏和读取失败的可观察反馈。系统 MUST 以会话分组为单位提供显式分页器，每页默认展示 15 个会话分组；切换页码 MUST 只改变当前可见分组，MUST NOT 修改收藏事实、过滤条件、URL 或宿主导航状态。分页器 MUST 使用完整过滤结果计算页数；浏览器 MAY 在一次请求中读取既有收藏硬上限 100 条用于建立会话分组和页数，但过滤条件仍 MUST 由真实 `GET /api/v1/favorites` 接口在服务端应用，MUST NOT 退回浏览器本地过滤。所有会话分组收起时，当前页最多 15 张摘要卡片 MUST 在收藏内容区域内完整显示且内容区域 MUST NOT 出现纵向滚动条；任一分组展开后，正文超出可用高度时内容区域 MUST 允许纵向滚动。读取失败时，系统 MUST 保持收藏内容视图为当前主内容，显示安全错误反馈和重试入口，且 MUST NOT 清空或替换左侧最近会话列表。收藏状态变更发生且收藏内容视图处于当前主内容时，系统 MUST 刷新完整收藏窗口并将失效页码收敛到新的有效范围。

Collaborative/PIU 的沉浸式首页卡片通过既有“更多”菜单选择收藏时，系统 MUST 在与记忆管理相同的 PIU 左侧扩展内容容器内展示收藏面板，并 MUST 复用上述收藏面板的过滤、session 分组、展开正文、取消收藏、反馈和显式分页行为。收藏面板 MUST NOT 以新的弹框覆盖 PIU 会话卡片。关闭收藏或打开收藏会话 MUST 收起左侧扩展内容容器，并 MUST NOT 改变 PIU 的浏览器 URL；打开收藏会话 MUST 将当前 session 切换到该收藏所属 session。收藏入口与记忆管理、投诉历史、定时任务及自定义扩展内容入口 MUST 复用同一个左侧扩展内容容器，后选择的入口 MUST 替换该容器中的先前内容而不产生叠加界面。PIU MUST NOT 为此新增收藏专用 URL、平行收藏查询状态或新的导航 authority。

**需求类别**：功能性需求

#### Scenario: LEFT 布局在主内容展示收藏且保留最近会话
- **GIVEN** Local 或 Immersive LEFT 布局正在显示最近会话列表
- **WHEN** 用户选择收藏入口
- **THEN** 系统 MUST 在主内容区域展示按 session 分组的收藏内容
- **AND** 左侧最近会话列表 MUST 保持可见且条目不变
- **AND** 浏览器 URL MUST 以 `#/favorites` 结尾

#### Scenario: 直达收藏 URL
- **WHEN** 用户直接打开或刷新当前宿主的 `#/favorites`
- **THEN** 系统 MUST 展示收藏内容视图
- **AND** 收藏入口 MUST 显示为当前主内容

#### Scenario: 返回进入收藏前的对话
- **GIVEN** 用户当前位于 session `S1` 的对话路径
- **WHEN** 用户进入收藏内容后选择标题栏返回按钮
- **THEN** 系统 MUST 返回 session `S1` 的对话路径
- **WHEN** 用户从新会话路径进入收藏内容后选择返回按钮
- **THEN** 系统 MUST 返回新会话路径

#### Scenario: 使用关键词和日期时间过滤收藏
- **GIVEN** 收藏列表存在多个分页窗口
- **WHEN** 用户提交关键词并选择开始和结束日期时间
- **THEN** 浏览器 MUST 调用收藏接口并传递 `keyword`、`favoritedFrom` 和 `favoritedTo`
- **AND** 服务端 MUST 先过滤再返回第一个分页窗口
- **AND** 系统 MUST 只显示摘要或收藏问题包含关键词且 `favoritedAt` 位于所选闭区间的会话分组
- **WHEN** 用户滚动加载后续分页
- **THEN** 后续收藏接口请求 MUST 携带相同过滤条件和新的 offset
- **WHEN** 用户清除关键词并重置日期范围
- **THEN** 浏览器 MUST 重新请求不带过滤参数的第一个收藏窗口
- **WHEN** 用户仅快捷清除开始日期或结束日期
- **THEN** 浏览器 MUST 保留另一端日期并以剩余过滤参数重新请求第一个收藏窗口

#### Scenario: RIGHT 布局展示相同收藏分组
- **GIVEN** Immersive RIGHT 布局正在显示对话
- **WHEN** 用户选择收藏入口
- **THEN** 系统 MUST 在主内容区域展示与 LEFT 布局相同的收藏会话分组行为

#### Scenario: PIU 更多菜单在左侧扩展内容容器展示收藏
- **GIVEN** Collaborative/PIU 沉浸式首页卡片可见
- **WHEN** 用户选择“更多”菜单中的收藏
- **THEN** 系统 MUST 在与记忆管理相同的 PIU 左侧扩展内容容器展示共享收藏内容
- **AND** 系统 MUST NOT 打开覆盖 PIU 会话卡片的新弹框
- **AND** 当前 session 与浏览器 URL MUST 保持不变
- **WHEN** 用户关闭收藏或选择一个收藏会话
- **THEN** 系统 MUST 收起左侧扩展内容容器
- **AND** 选择收藏会话时当前 session MUST 切换到目标 session

#### Scenario: 同一会话的收藏 turn 合并为一个展示分组
- **GIVEN** 当前已加载收藏窗口依次包含 `S1/M1`、`S2/M2` 和 `S1/M3`
- **WHEN** 系统投影收藏内容
- **THEN** 系统 MUST 只为 session `S1` 展示一个会话分组卡片
- **AND** `S1` 分组 MUST 包含 `M1` 和 `M3` 两个独立 turn 行
- **AND** `S2` MUST 保持为独立会话分组
- **AND** 分组顺序 MUST 为 `S1`、`S2`

#### Scenario: 会话标题相同但 session 不同
- **GIVEN** session `S1` 和 `S2` 具有相同会话标题且各自包含收藏 turn
- **WHEN** 系统投影收藏内容
- **THEN** 系统 MUST 展示两个独立会话分组
- **AND** 系统 MUST NOT 按会话标题合并收藏 turn

#### Scenario: 默认收起并展开会话正文
- **GIVEN** session `S1` 当前已加载 5 个收藏 turn
- **WHEN** 收藏内容视图首次展示 `S1` 分组
- **THEN** 系统 MUST 只展示不超过 56px 的自适应会话摘要卡片
- **WHEN** 用户展开 `S1` 分组
- **THEN** 系统 MUST 展示该分组全部 5 个收藏 turn 的用户问题和智能体回答正文
- **AND** 每条正文前 MUST 显示精确到秒的时间
- **AND** 系统 MUST 提供恢复为自适应摘要卡片的收起操作
- **AND** 其他会话分组的展示状态 MUST 保持不变

#### Scenario: 展开正文读取失败
- **WHEN** 用户展开会话分组且正文读取失败
- **THEN** 系统 MUST 保持该会话分组处于展开状态
- **AND** 系统 MUST 显示安全失败反馈和重试入口

#### Scenario: 展开会话后自动进入内容视口
- **GIVEN** 目标会话摘要位于收藏内容视口下部或视口外
- **WHEN** 用户展开该会话分组
- **THEN** 系统 MUST 自动滚动收藏内容区域并优先将目标会话卡片顶部与内容视口顶部对齐
- **AND** 当底部滚动边界阻止顶部对齐时，目标会话卡片和展开正文的起始位置 MUST 位于内容视口内
- **AND** 用户 MUST NOT 需要再次向下滚动才能看到展开正文的开头

#### Scenario: 显式分页按会话分组切换
- **GIVEN** 完整过滤结果包含 16 个不同 `sessionId` 的会话分组
- **WHEN** 收藏面板完成加载
- **THEN** 第一页 MUST 只展示前 15 个会话分组
- **AND** 系统 MUST 展示可选择第二页的显式分页器
- **WHEN** 用户选择第二页
- **THEN** 系统 MUST 只展示第 16 个会话分组
- **AND** 过滤条件、收藏事实和宿主导航状态 MUST 保持不变

#### Scenario: 同会话收藏在分页前合并
- **GIVEN** 收藏查询结果中的 session `S1` 包含 3 个 turn 且分布在查询结果的不同位置
- **WHEN** 系统建立会话分组和分页
- **THEN** 3 个 turn MUST 进入同一个 `S1` 分组
- **AND** 页数 MUST 按会话分组数量而不是 turn 数量计算

#### Scenario: 收起页面不产生滚动条
- **GIVEN** 当前页包含 15 个全部收起的会话分组
- **WHEN** 收藏面板处于可用宿主容器高度内
- **THEN** 15 张摘要卡片 MUST 完整显示在收藏内容区域
- **AND** 收藏内容区域 MUST NOT 显示纵向滚动条
- **WHEN** 用户展开会话分组且正文超出可用高度
- **THEN** 收藏内容区域 MUST 允许纵向滚动

#### Scenario: 智能体回答使用对话 Markdown 渲染
- **GIVEN** 收藏 turn 的智能体回答包含标题、强调、列表或代码等 Markdown 语法
- **WHEN** 用户展开所属会话分组
- **THEN** 系统 MUST 使用实际对话卡片的 Markdown 渲染与安全清理逻辑展示该回答
- **AND** 用户问题 MUST 继续按纯文本展示
- **AND** 短回答和长回答的容器高度 MUST 分别由各自内容决定，MUST NOT 统一为 56px

#### Scenario: 收藏空态
- **WHEN** 收藏查询成功且返回零个 turn
- **THEN** 收藏内容视图 MUST 显示无收藏反馈
- **AND** 系统 MUST NOT 以最近会话条目填充收藏内容视图

#### Scenario: 收藏读取失败可重试
- **WHEN** 收藏查询失败
- **THEN** 收藏内容视图 MUST 显示安全错误反馈和重试入口
- **AND** 收藏内容视图 MUST 保持为当前主内容
- **AND** 用户触发重试时，系统 MUST 重新请求收藏列表的首个分页窗口

#### Scenario: 选择收藏 turn 恢复目标对话
- **GIVEN** 收藏内容视图的 session `S1` 分组包含 `rootMessageId=M1` 的收藏 turn 行
- **WHEN** 用户选择该 turn 行
- **THEN** 系统 MUST 切换到对话视图
- **AND** 系统 MUST 打开 session `S1` 并定位到 `M1`

#### Scenario: 在收藏列表取消收藏
- **GIVEN** 收藏内容视图的 session `S1` 分组包含 request run `R1` 的收藏 turn 行
- **WHEN** 用户选择该 turn 用户问题右侧的收藏图标
- **THEN** 系统 MUST 显示取消收藏确认浮层
- **WHEN** 用户在确认浮层中选择确认
- **THEN** 系统 MUST 将 `S1/R1` 的收藏状态更新为未收藏
- **AND** 该 turn MUST 从当前会话分组移除
- **AND** 该会话分组的当前已加载数量 MUST 减少 1
- **AND** 系统 MUST 显示取消收藏成功反馈
- **AND** 系统 MUST NOT 打开该 turn 所属会话

#### Scenario: 放弃取消收藏
- **GIVEN** 收藏内容视图正在显示取消收藏确认浮层
- **WHEN** 用户选择取消
- **THEN** 系统 MUST 保留目标收藏 turn 及其展开正文
- **AND** 系统 MUST NOT 提交取消收藏写入

#### Scenario: 浅色与暗色主题保持一致布局
- **WHEN** 用户在浅色和暗色主题之间切换
- **THEN** 收藏标题栏、过滤区、会话卡片和展开正文 MUST 使用对应主题颜色
- **AND** 标题栏高度、过滤控件间距、收起卡片高度和内容排列 MUST 保持不变

#### Scenario: 取消会话分组中的最后一个收藏
- **GIVEN** session `S1` 分组只包含 request run `R1`
- **WHEN** 用户成功取消 `S1/R1` 的收藏
- **THEN** `S1` 会话分组 MUST 从当前收藏内容视图移除
- **AND** 其他会话分组 MUST 保持不变

#### Scenario: 取消收藏失败
- **GIVEN** 收藏内容视图的一个会话分组包含收藏 turn 行
- **WHEN** 用户取消收藏且写入失败
- **THEN** 该 turn 行 MUST 保留在原会话分组
- **AND** 系统 MUST 显示不包含原始后端错误详情的安全失败反馈
- **AND** 取消收藏操作 MUST 可再次触发

#### Scenario: 当前收藏窗口响应收藏状态变更
- **GIVEN** 收藏内容视图已加载多个分页条目
- **WHEN** 任一已收藏 turn 的收藏状态发生变更
- **THEN** 系统 MUST 刷新不少于当前已加载条目数量的收藏窗口
- **AND** 已取消收藏的 turn MUST 不再显示

### Requirement: 主内容入口选择互不耦合

Local 和 Immersive shell MUST 以当前选中的主内容入口决定主内容和激活反馈。Local 与 Immersive LEFT 的主内容入口集合 MUST 包含对话、收藏，以及当前宿主已提供的记忆管理和投诉历史；Immersive RIGHT 的集合还 MUST 包含最近历史。任一时刻，系统 MUST 只显示一个主内容视图；收藏、记忆管理、投诉历史和最近历史这些非对话入口中 MUST 至多一个显示为当前主内容。对话是当前主内容时，全部非对话入口 MUST 不显示为当前主内容。重复选择当前入口 MUST 保持当前主内容不变。

收藏主内容 MUST 使用 `#/favorites`。直接打开、刷新或通过浏览器前进/后退进入该路径时，shell MUST 从 URL 恢复收藏主内容和激活反馈。选择 session、新会话或收藏 turn 后，URL MUST 返回对应的 `/session/:sessionId` 或 `/` 对话路径。投诉历史、最近历史以及搜索、设置和帮助不因本 Requirement 获得新的专用 URL。记忆管理的 URL 与恢复行为由 `long-memory-web-management` Function 负责；本 Requirement 只约束选择记忆管理后收藏不再保持激活。

选择会话、新会话或收藏 turn MUST 将当前主内容切换为对话。选择另一个主内容入口 MUST 只切换当前主内容和对应激活反馈，MUST NOT 改写最近会话数据、收藏数据、搜索条件、浏览器存储或其他入口的业务状态。

搜索、设置和帮助属于临时交互。打开或关闭任一临时交互时，系统 MUST 保持当前主内容和对应激活反馈不变。

**需求类别**：功能性需求

#### Scenario: 主内容入口没有冲突激活结果
- **GIVEN** 收藏内容视图是当前主内容
- **WHEN** 用户选择记忆管理或投诉历史
- **THEN** 系统 MUST 只显示所选入口对应的主内容与激活反馈
- **AND** 收藏入口 MUST 不再显示为当前主内容

#### Scenario: 浏览器历史恢复收藏主内容
- **GIVEN** 用户从对话打开收藏主内容后又进入其它主内容
- **WHEN** 用户通过浏览器后退或前进进入 `#/favorites`
- **THEN** 系统 MUST 按当前 URL 恢复收藏主内容和唯一激活反馈

#### Scenario: 重复选择当前收藏入口
- **GIVEN** 收藏内容视图是当前主内容
- **WHEN** 用户再次选择收藏入口
- **THEN** 收藏内容视图 MUST 保持为当前主内容
- **AND** 系统 MUST NOT 切换到对话或最近历史

#### Scenario: 临时交互不改变收藏内容
- **GIVEN** 收藏内容视图是当前主内容
- **WHEN** 用户打开并关闭搜索、设置或帮助中的任一临时交互
- **THEN** 收藏内容视图 MUST 保持为当前主内容
- **AND** 收藏入口的激活反馈 MUST 保持不变

#### Scenario: 选择会话返回对话
- **GIVEN** 任一非对话主内容是当前主内容
- **WHEN** 用户选择已有 session 或新会话
- **THEN** 系统 MUST 将对话切换为当前主内容
- **AND** 系统 MUST 打开所选 session 或新会话状态

### Requirement: 收藏内容必须支持回答与问题分类

收藏内容视图 MUST 在过滤区上方提供“收藏回答”和“收藏问题”两个 Tab，默认选中“收藏回答”；Tab 下边线与下方过滤区之间 MUST 保留 8px 垂直间距，不得贴合显示。浏览器 MUST 通过 `GET /api/v1/favorites` 的可选 `favoriteType` 参数选择收藏类型；`favoriteType` MUST 只接受 `ANSWER` 或 `QUESTION`，省略时 MUST 等同于 `ANSWER`。选择 `ANSWER` 时系统 MUST 返回 `isFavorited=true` 的收藏 turn；选择 `QUESTION` 时系统 MUST 返回 `isQuestionFavorited=true` 的收藏 turn。两个 Tab MUST 复用相同的响应结构、session 分组、过滤、正文展开、分页、空态和失败反馈，MUST NOT 新增平行收藏事实或浏览器持久化状态。

用户切换 Tab 时，系统 MUST 将页码重置为第一页，清空仅属于前一 Tab 的临时展开和正文读取状态，并使用当前关键词和日期条件重新请求所选收藏类型。用户在“收藏回答”中确认取消收藏时，系统 MUST 将目标 turn 的 `isFavorited` 更新为 `false`；用户在“收藏问题”中确认取消收藏时，系统 MUST 将目标 turn 的 `isQuestionFavorited` 更新为 `false`。取消成功后的分组更新、成功反馈和会话导航行为 MUST 保持一致。

两个 Tab 中的会话卡片 MUST 使用完整可见的主题边框。鼠标悬停会话摘要时，卡片顶部、右侧、底部和左侧边框 MUST 全部保持可见，悬停背景 MUST NOT 覆盖任一边框。

**需求类别**：功能性需求

#### Scenario: 切换收藏回答和收藏问题
- **GIVEN** 当前收藏内容视图默认显示回答收藏
- **WHEN** 用户选择“收藏问题”Tab
- **THEN** 浏览器 MUST 使用 `favoriteType=QUESTION` 和当前过滤条件重新请求收藏接口
- **AND** 页面 MUST 只显示问题收藏的同形会话分组
- **AND** 页码 MUST 重置为第一页
- **WHEN** 用户切回“收藏回答”Tab
- **THEN** 浏览器 MUST 使用 `favoriteType=ANSWER` 和当前过滤条件重新请求收藏接口

#### Scenario: 按当前 Tab 取消收藏
- **GIVEN** 用户正在“收藏问题”Tab 查看 request run `R1`
- **WHEN** 用户确认取消该收藏
- **THEN** 系统 MUST 将 `R1` 的 `isQuestionFavorited` 更新为 `false`
- **AND** 系统 MUST NOT 修改 `R1` 的 `isFavorited`
- **WHEN** 用户在“收藏回答”Tab 确认取消 request run `R2`
- **THEN** 系统 MUST 将 `R2` 的 `isFavorited` 更新为 `false`
- **AND** 系统 MUST NOT 修改 `R2` 的 `isQuestionFavorited`

#### Scenario: 悬停卡片保持完整边框
- **WHEN** 用户将鼠标悬停在任一回答收藏或问题收藏的会话摘要上
- **THEN** 会话卡片四边的主题边框 MUST 保持完整可见
- **AND** 悬停背景 MUST 保持在边框以内

#### Scenario: Tab 与过滤区保持间距
- **WHEN** 收藏内容视图显示回答收藏或问题收藏
- **THEN** Tab 下边线与下方过滤区之间的垂直间距 MUST 为 8px

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：用户在 Local 与 Immersive 主内容区域通过专用标题栏返回原对话，或在 Collaborative/PIU 通过更多菜单在左侧扩展内容容器打开收藏；各宿主可在回答收藏与问题收藏之间切换，以关键词和可分别快捷清除的日期时间过滤收藏，按 session 查看可展开的收藏问答正文，并经确认取消当前类型的单条收藏或打开目标会话。
- **依据 Requirements**：`Local 与 Immersive 收藏内容视图`、`主内容入口选择互不耦合`、`收藏内容必须支持回答与问题分类`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在 Local/Immersive 通过 `#/favorites` 恢复收藏主内容及其激活反馈，在 Collaborative/PIU 通过与记忆管理相同的左侧扩展内容容器展示同一内容；收藏标题栏保留原对话返回目标，回答/问题 Tab 通过 `favoriteType` 复用同一查询、分组和卡片结构，切换时重置页码及上一 Tab 的临时读取状态；过滤区按关键词和可分别快捷清除的收藏日期时间筛选；内容占满 padding 内可用宽度，完整有界收藏窗口按 `sessionId` 分组后以每页 15 个 session 的显式分页器展示，全部收起时以 8px 会话卡片间距完整显示且无列表滚动条；展开会话后目标卡片优先顶部对齐且正文起始位置保持可见；摘要卡最大 56px，展开后以紧凑内边距读取并用共享 Markdown 渲染按内容自然高度、无首尾额外空白行的智能体回答，确认取消成功后按当前 Tab 更新对应收藏字段和分组。
- **依据 Requirements**：`Local 与 Immersive 收藏内容视图`、`主内容入口选择互不耦合`、`收藏内容必须支持回答与问题分类`

### 结果

- **变更类型**：修改
- **目标内容**：收藏列表不再替换最近会话列表；Local 与 Immersive 各布局提供一致的回答/问题分类、返回、过滤、会话摘要、问答正文、确认取消当前类型收藏结果、四边始终可见的卡片边框、浅色/暗色主题、收藏专用 URL，以及可由直达、刷新和浏览器历史恢复的唯一主内容激活反馈；Collaborative/PIU 在不改变 URL 的左侧扩展内容容器复用同一收藏行为，并与其他扩展内容入口互斥显示。
- **依据 Requirements**：`Local 与 Immersive 收藏内容视图`、`主内容入口选择互不耦合`、`收藏内容必须支持回答与问题分类`

### 主规格

- **变更类型**：新增
- **目标内容**：`favorite-turn-list`
- **依据 Requirements**：`Local 与 Immersive 收藏内容视图`、`主内容入口选择互不耦合`、`收藏内容必须支持回答与问题分类`
